import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import Hls from "hls.js";
import { destroyPlaybackSession } from "../api";

interface UseHlsPlayerOptions {
  activeSessionIdRef: MutableRefObject<string | null>;
  onRuntimeFailure: (reason: string) => void;
}

interface AttachVideoSourceOptions {
  forceHls?: boolean;
}

export function useHlsPlayer({ activeSessionIdRef, onRuntimeFailure }: UseHlsPlayerOptions) {
  const [isBuffering, setIsBuffering] = useState(false);
  const hlsRef = useRef<Hls | null>(null);
  const onRuntimeFailureRef = useRef(onRuntimeFailure);

  useEffect(() => {
    onRuntimeFailureRef.current = onRuntimeFailure;
  }, [onRuntimeFailure]);

  const destroyHls = useCallback(() => {
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

      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = url;
        video.load();
        return;
      }

      if (!Hls.isSupported()) {
        throw new Error("Este navegador no soporta HLS.");
      }

      await new Promise<void>((resolve, reject) => {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          backBufferLength: 90,
          startPosition: -1,
          liveSyncDurationCount: 6,
          liveMaxLatencyDurationCount: 12,
          manifestLoadingRetryDelay: 2000,
          manifestLoadingMaxRetryTimeout: 30000,
          manifestLoadingMaxRetry: 20,
          levelLoadingRetryDelay: 2000,
          levelLoadingMaxRetryTimeout: 20000,
          levelLoadingMaxRetry: 12,
          fragLoadingMaxRetry: 8,
          fragLoadingRetryDelay: 1500,
          fragLoadingMaxRetryTimeout: 20000,
          maxBufferLength: 60,
          maxBufferHole: 1.5,
          maxMaxBufferLength: 120,
          nudgeMaxRetry: 5
        });
        hlsRef.current = hls;
        let startupSettled = false;
        let runtimeRecoveries = 0;
        let lastSourceReloadAt = 0;

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
              setIsBuffering(true);
            }
            if (data?.details === "bufferNudgeOnStall" || data?.details === "fragBufferedError") {
              setIsBuffering(false);
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

        const onFragLoading = () => {
          setIsBuffering(true);
        };
        const onFragBuffered = () => {
          setIsBuffering(false);
        };

        hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        hls.on(Hls.Events.ERROR, onError);
        hls.on(Hls.Events.MEDIA_ATTACHED, onMediaAttached);
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
