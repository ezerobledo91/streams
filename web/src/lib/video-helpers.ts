export type QualityBucket = "4k" | "1080p" | "720p" | "sd";

export const PLAYER_READY_TIMEOUT_MS = 120000;

function hasPlaybackSignal(video: HTMLVideoElement): boolean {
  if (video.readyState >= 2) return true;

  const duration = Number(video.duration || 0);
  if (video.readyState >= 1 && Number.isFinite(duration) && duration > 0) {
    return true;
  }

  try {
    const buffered = video.buffered;
    if (buffered && buffered.length > 0) {
      const end = Number(buffered.end(buffered.length - 1) || 0);
      if (Number.isFinite(end) && end > 0) {
        return true;
      }
    }
  } catch {
    // no-op
  }

  try {
    const seekable = video.seekable;
    if (seekable && seekable.length > 0) {
      const end = Number(seekable.end(seekable.length - 1) || 0);
      if (Number.isFinite(end) && end > 0) {
        return true;
      }
    }
  } catch {
    // no-op
  }

  return false;
}

export function qualityFromResolution(resolution: number): QualityBucket {
  if (resolution >= 2160) return "4k";
  if (resolution >= 1080) return "1080p";
  if (resolution >= 720) return "720p";
  return "sd";
}

export async function waitForVideoReady(video: HTMLVideoElement, timeoutMs = PLAYER_READY_TIMEOUT_MS): Promise<void> {
  if (hasPlaybackSignal(video)) return;

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("El navegador no pudo cargar el stream a tiempo."));
    }, timeoutMs);
    const poll = window.setInterval(() => {
      if (hasPlaybackSignal(video)) {
        cleanup();
        resolve();
      }
    }, 300);

    const onReady = () => {
      if (!hasPlaybackSignal(video)) return;
      cleanup();
      resolve();
    };
    const onError = () => {
      if (hasPlaybackSignal(video)) {
        cleanup();
        resolve();
        return;
      }
      cleanup();
      reject(new Error("El reproductor reporto error de formato o codec."));
    };

    function cleanup() {
      window.clearTimeout(timeout);
      window.clearInterval(poll);
      video.removeEventListener("loadeddata", onReady);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("playing", onReady);
      video.removeEventListener("error", onError);
    }

    video.addEventListener("loadeddata", onReady);
    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("playing", onReady);
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
