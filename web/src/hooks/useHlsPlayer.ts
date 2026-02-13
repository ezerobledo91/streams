import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import Hls from "hls.js";
import { destroyPlaybackSession } from "../api";

interface UseHlsPlayerOptions {
  activeSessionIdRef: MutableRefObject<string | null>;
  onRuntimeFailure: (reason: string) => void;
}

export function useHlsPlayer({ activeSessionIdRef, onRuntimeFailure }: UseHlsPlayerOptions) {
  const [isBuffering, setIsBuffering] = useState(false);
  const hlsRef = useRef<Hls | null>(null);

  const destroyHls = useCallback(() => {
    if (!hlsRef.current) return;
    hlsRef.current.destroy();
    hlsRef.current = null;
  }, []);

  const attachVideoSource = useCallback(
    async (video: HTMLVideoElement, sourceUrl: string) => {
      const url = String(sourceUrl || "").trim();
      if (!url) {
        throw new Error("URL de reproduccion invalida.");
      }

      destroyHls();

      const isHlsSource = /\.m3u8(?:$|\?)/i.test(url) || url.includes("/hls/");
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
          startPosition: 0,
          liveSyncDurationCount: 6,
          liveMaxLatencyDurationCount: 12,
          manifestLoadingRetryDelay: 1500,
          manifestLoadingMaxRetryTimeout: 15000,
          manifestLoadingMaxRetry: 6,
          levelLoadingRetryDelay: 1500,
          levelLoadingMaxRetryTimeout: 15000,
          levelLoadingMaxRetry: 8,
          fragLoadingMaxRetry: 6,
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

        const timeout = window.setTimeout(() => {
          if (startupSettled) return;
          startupSettled = true;
          cleanupStartup();
          hls.off(Hls.Events.ERROR, onError);
          hls.destroy();
          if (hlsRef.current === hls) hlsRef.current = null;
          reject(new Error("Timeout cargando playlist HLS."));
        }, 35000);

        const cleanupStartup = () => {
          window.clearTimeout(timeout);
          hls.off(Hls.Events.MANIFEST_PARSED, onManifestParsed);
          hls.off(Hls.Events.MEDIA_ATTACHED, onMediaAttached);
        };

        const onManifestParsed = () => {
          if (startupSettled) return;
          startupSettled = true;
          cleanupStartup();
          resolve();
        };

        const onError = (_event: string, data: { fatal?: boolean; details?: string; type?: string }) => {
          if (!data?.fatal) {
            if (data?.details === "bufferStalledError") {
              setIsBuffering(true);
            }
            return;
          }
          const reason = data?.details ? `No se pudo cargar HLS (${data.details}).` : "No se pudo cargar HLS.";
          if (!startupSettled) {
            startupSettled = true;
            cleanupStartup();
            hls.off(Hls.Events.ERROR, onError);
            hls.destroy();
            if (hlsRef.current === hls) hlsRef.current = null;
            reject(new Error(reason));
            return;
          }

          if (data.type === Hls.ErrorTypes.NETWORK_ERROR && runtimeRecoveries < 4) {
            runtimeRecoveries += 1;
            hls.startLoad();
            return;
          }
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && runtimeRecoveries < 4) {
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
          onRuntimeFailure(reason);
          hls.off(Hls.Events.ERROR, onError);
          hls.destroy();
          if (hlsRef.current === hls) hlsRef.current = null;
        };

        const onMediaAttached = () => {
          hls.loadSource(url);
          hls.startLoad(0);
        };

        hls.on(Hls.Events.MANIFEST_PARSED, onManifestParsed);
        hls.on(Hls.Events.ERROR, onError);
        hls.on(Hls.Events.MEDIA_ATTACHED, onMediaAttached);
        hls.on(Hls.Events.FRAG_BUFFERED, () => {
          setIsBuffering(false);
        });
        hls.attachMedia(video);
      });
    },
    [activeSessionIdRef, destroyHls, onRuntimeFailure]
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
