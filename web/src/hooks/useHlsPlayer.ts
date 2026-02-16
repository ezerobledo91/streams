import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import Hls from "hls.js";
import { destroyPlaybackSession } from "../api";

interface UseHlsPlayerOptions {
  activeSessionIdRef: MutableRefObject<string | null>;
  onRuntimeFailure: (reason: string) => void;
}

interface AttachVideoSourceOptions {
  forceHls?: boolean;
  mode?: "vod" | "live";
}

function buildHlsConfig(mode: "vod" | "live" = "vod"): Partial<ConstructorParameters<typeof Hls>[0]> {
  if (mode === "live") {
    return {
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 30,
      startPosition: 0,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      maxBufferHole: 2,
      // Evitar que hls.js salte al "live edge": valores muy altos
      liveSyncDuration: 999999,
      liveMaxLatencyDuration: 9999999,
      initialLiveManifestSize: 1,
      manifestLoadingRetryDelay: 500,
      manifestLoadingMaxRetryTimeout: 15000,
      manifestLoadingMaxRetry: 40,
      levelLoadingRetryDelay: 500,
      levelLoadingMaxRetryTimeout: 10000,
      levelLoadingMaxRetry: 20,
      fragLoadingMaxRetry: 20,
      fragLoadingRetryDelay: 500,
      fragLoadingMaxRetryTimeout: 10000,
      nudgeMaxRetry: 15
    };
  }
  return {
    enableWorker: true,
    lowLatencyMode: false,
    backBufferLength: 60,
    startPosition: 0,
    maxBufferLength: 30,
    maxMaxBufferLength: 60,
    maxBufferHole: 0.5,
    // Desactivar live sync: usar valores muy altos para que nunca salte al "live edge"
    liveSyncDuration: 999999,
    liveMaxLatencyDuration: 9999999,
    manifestLoadingRetryDelay: 500,
    manifestLoadingMaxRetryTimeout: 15000,
    manifestLoadingMaxRetry: 30,
    levelLoadingRetryDelay: 500,
    levelLoadingMaxRetryTimeout: 10000,
    levelLoadingMaxRetry: 20,
    fragLoadingMaxRetry: 15,
    fragLoadingRetryDelay: 500,
    fragLoadingMaxRetryTimeout: 10000,
    nudgeMaxRetry: 5,
    nudgeOffset: 0.1
  };
}

export function useHlsPlayer({ activeSessionIdRef, onRuntimeFailure }: UseHlsPlayerOptions) {
  const [isBuffering, setIsBuffering] = useState(false);
  const isBufferingRef = useRef(false);
  const bufferingTimerRef = useRef<number | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const onRuntimeFailureRef = useRef(onRuntimeFailure);

  useEffect(() => {
    onRuntimeFailureRef.current = onRuntimeFailure;
  }, [onRuntimeFailure]);

  const destroyHls = useCallback(() => {
    if (bufferingTimerRef.current) { window.clearTimeout(bufferingTimerRef.current); bufferingTimerRef.current = null; }
    isBufferingRef.current = false;
    if (!hlsRef.current) return;
    hlsRef.current.destroy();
    hlsRef.current = null;
  }, []);

  const attachVideoSource = useCallback(
    async (video: HTMLVideoElement, sourceUrl: string, options?: AttachVideoSourceOptions) => {
      const url = String(sourceUrl || "").trim();
      if (!url) {
        throw new Error("URL de reproduccion invalida.");
      }

      destroyHls();

      const isHlsSource = Boolean(options?.forceHls) || /\.m3u8(?:$|\?)/i.test(url) || url.includes("/hls/");
      if (!isHlsSource) {
        video.src = url;
        video.load();
        return;
      }

      // Solo usar reproductor nativo en dispositivos Apple (Safari/iOS)
      // En el resto (Android, TVs, Chrome), Hls.js es mucho más robusto para proxys.
      const isApple = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                     (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);

      if (video.canPlayType("application/vnd.apple.mpegurl") && (isApple || isSafari)) {
        video.src = url;
        video.load();
        return;
      }

      if (!Hls.isSupported()) {
        throw new Error("Este navegador no soporta HLS.");
      }

      await new Promise<void>((resolve, reject) => {
        const hls = new Hls(buildHlsConfig(options?.mode || "vod"));
        hlsRef.current = hls;
        let startupSettled = false;
        let runtimeRecoveries = 0;
        let lastSourceReloadAt = 0;
        let stallTimeout: number | null = null;

        const timeout = window.setTimeout(() => {
          if (startupSettled) return;
          if (hlsRef.current !== hls) return;
          startupSettled = true;
          cleanupStartup();
          hls.off(Hls.Events.ERROR, onError);
          hls.destroy();
          if (hlsRef.current === hls) hlsRef.current = null;
          reject(new Error("Timeout cargando playlist HLS."));
        }, 90000);

        const cleanupStartup = () => {
          window.clearTimeout(timeout);
          if (stallTimeout) { window.clearTimeout(stallTimeout); stallTimeout = null; }
          hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
          hls.off(Hls.Events.MEDIA_ATTACHED, onMediaAttached);
          hls.off(Hls.Events.FRAG_LOADING, onFragLoading);
          hls.off(Hls.Events.FRAG_BUFFERED, onFragBuffered);
        };

        const onManifestParsed = () => {
          if (startupSettled) return;
          startupSettled = true;
          cleanupStartup();
          resolve();
        };

        const onError = (_event: string, data: { fatal?: boolean; details?: string; type?: string }) => {
          const responseCode = Number((data as { response?: { code?: number } })?.response?.code || 0);

          // Error de llave AES: el proxy no puede obtener la key de encriptación.
          // No tiene sentido reintentar, escalar a transcode inmediatamente.
          if (data?.details === "keyLoadError") {
            const reason = `Llave de cifrado bloqueada (${responseCode || "error"}). Cambiando a transcode...`;
            if (!startupSettled) {
              startupSettled = true;
              cleanupStartup();
            }
            hls.off(Hls.Events.ERROR, onError);
            hls.off(Hls.Events.FRAG_LOADING, onFragLoading);
            hls.off(Hls.Events.FRAG_BUFFERED, onFragBuffered);
            hls.destroy();
            if (hlsRef.current === hls) hlsRef.current = null;
            if (!startupSettled) {
              reject(new Error(reason));
            } else {
              onRuntimeFailureRef.current(reason);
            }
            return;
          }

          const shouldReloadSource =
            responseCode === 401 || responseCode === 403 || responseCode === 404 || responseCode === 503;

          if (shouldReloadSource && nowCanReloadSource(responseCode)) {
            runtimeRecoveries += 1;
            hls.stopLoad();
            hls.loadSource(url);
            hls.startLoad(-1);
            return;
          }

          if (!data?.fatal) {
            if (data?.details === "bufferStalledError") {
              setBuffering(true);
              // Si el buffer se estanca por más de 45 segundos, forzar error para recuperación
              // (torrents lentos necesitan más tiempo para descargar segmentos)
              if (!stallTimeout) {
                stallTimeout = window.setTimeout(() => {
                  if (hlsRef.current === hls) {
                    onRuntimeFailureRef.current("La señal se estancó demasiado tiempo.");
                  }
                }, 45000);
              }
            }
            if (data?.details === "bufferNudgeOnStall" || data?.details === "fragBufferedError") {
              setBuffering(false);
              if (stallTimeout) { window.clearTimeout(stallTimeout); stallTimeout = null; }
            }
            return;
          }
          const reason = data?.details ? `No se pudo cargar HLS (${data.details}).` : "No se pudo cargar HLS.";
          if (!startupSettled) {
            startupSettled = true;
            cleanupStartup();
            hls.off(Hls.Events.ERROR, onError);
            hls.off(Hls.Events.FRAG_LOADING, onFragLoading);
            hls.off(Hls.Events.FRAG_BUFFERED, onFragBuffered);
            hls.destroy();
            if (hlsRef.current === hls) hlsRef.current = null;
            reject(new Error(reason));
            return;
          }

          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && runtimeRecoveries < 8) {
            runtimeRecoveries += 1;
            window.setTimeout(() => {
              if (hlsRef.current === hls) hls.startLoad();
            }, 1000 + runtimeRecoveries * 500);
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && runtimeRecoveries < 8) {
            runtimeRecoveries += 1;
            hls.recoverMediaError();
            return;
          }

          const sessionId = activeSessionIdRef.current;
          if (sessionId) {
            activeSessionIdRef.current = null;
            void destroyPlaybackSession(sessionId).catch(() => {
              // ignore cleanup race
            });
          }
          onRuntimeFailureRef.current(reason);
          hls.off(Hls.Events.ERROR, onError);
          hls.off(Hls.Events.FRAG_LOADING, onFragLoading);
          hls.off(Hls.Events.FRAG_BUFFERED, onFragBuffered);
          hls.destroy();
          if (hlsRef.current === hls) hlsRef.current = null;
        };

        const nowCanReloadSource = (responseCode: number) => {
          // 503 = transcode en preparación, dar más margen
          const maxRetries = responseCode === 503 ? 30 : 8;
          if (runtimeRecoveries >= maxRetries) return false;
          const now = Date.now();
          const minDelay = responseCode === 503 ? 2000 : 1500;
          if (now - lastSourceReloadAt < minDelay) return false;
          lastSourceReloadAt = now;
          return true;
        };

        const onMediaAttached = () => {
          hls.loadSource(url);
          hls.startLoad(0);
        };

        const setBuffering = (value: boolean) => {
          if (isBufferingRef.current === value) return;
          isBufferingRef.current = value;
          if (bufferingTimerRef.current) { window.clearTimeout(bufferingTimerRef.current); bufferingTimerRef.current = null; }
          if (value) {
            // Debounce buffering=true para evitar flicker en transiciones rápidas de segmentos
            bufferingTimerRef.current = window.setTimeout(() => {
              bufferingTimerRef.current = null;
              if (isBufferingRef.current) setIsBuffering(true);
            }, 300);
          } else {
            setIsBuffering(false);
          }
        };
        const onFragLoading = () => {
          // No marcar buffering en cada frag load - solo bufferStalledError indica buffering real
        };
        const onFragBuffered = () => {
          setBuffering(false);
        };

        hls.on(Hls.Events.ERROR, onError);
        hls.on(Hls.Events.MEDIA_ATTACHED, onMediaAttached);
        hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        hls.on(Hls.Events.FRAG_LOADING, onFragLoading);
        hls.on(Hls.Events.FRAG_BUFFERED, onFragBuffered);

        hls.attachMedia(video);
      });
    },
    [activeSessionIdRef, destroyHls]
  );

  useEffect(() => {
    return () => {
      destroyHls();
    };
  }, [destroyHls]);

  return {
    isBuffering,
    setIsBuffering,
    attachVideoSource,
    destroyHls
  };
}
