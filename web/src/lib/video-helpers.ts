export type QualityBucket = "4k" | "1080p" | "720p" | "sd";

export const PLAYER_READY_TIMEOUT_MS = 40000;

export function qualityFromResolution(resolution: number): QualityBucket {
  if (resolution >= 2160) return "4k";
  if (resolution >= 1080) return "1080p";
  if (resolution >= 720) return "720p";
  return "sd";
}

export async function waitForVideoReady(video: HTMLVideoElement, timeoutMs = PLAYER_READY_TIMEOUT_MS): Promise<void> {
  if (video.readyState >= 2) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("El navegador no pudo cargar el stream a tiempo."));
    }, timeoutMs);

    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error("El reproductor reporto error de formato o codec."));
    };

    function cleanup() {
      window.clearTimeout(timeout);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onError);
    }

    video.addEventListener("loadeddata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onError);
  });
}

export async function startVideo(video: HTMLVideoElement): Promise<"playing" | "gesture_required"> {
  try {
    await video.play();
    return "playing";
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      return "gesture_required";
    }
    const message = error instanceof Error ? error.message : "No se pudo iniciar reproduccion en navegador.";
    throw new Error(message);
  }
}
