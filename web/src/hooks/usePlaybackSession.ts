import { useCallback, useRef, useState } from "react";
import type { AutoPlaybackPayload } from "../types";
import type { UiSubtitleTrack } from "../lib/subtitle-tracks";

function mapSessionSubtitles(payload: AutoPlaybackPayload): UiSubtitleTrack[] {
  return (Array.isArray(payload.session?.subtitles) ? payload.session.subtitles : []).map((item) => ({
    id: `torrent-${item.id}`,
    label: item.label,
    language: item.language || "und",
    extension: item.extension || ".vtt",
    url: item.url,
    source: "torrent" as const
  }));
}

export function usePlaybackSession() {
  const activeSessionIdRef = useRef<string | null>(null);
  const subtitleFailoverAttemptsRef = useRef(0);
  const playbackAttemptRef = useRef(0);

  const [isPreparingPlayback, setIsPreparingPlayback] = useState(false);
  const [playerReady, setPlayerReady] = useState(false);
  const [hasPlaybackStarted, setHasPlaybackStarted] = useState(false);
  const [activeReleaseText, setActiveReleaseText] = useState("");

  const beginPlaybackAttempt = useCallback((): number => {
    playbackAttemptRef.current += 1;
    return playbackAttemptRef.current;
  }, []);

  const assertPlaybackAttemptActive = useCallback((attemptId: number) => {
    if (attemptId !== playbackAttemptRef.current) {
      throw new Error("Reproduccion cancelada por un nuevo intento.");
    }
  }, []);

  const resetPlaybackState = useCallback((resetStarted = false) => {
    activeSessionIdRef.current = null;
    subtitleFailoverAttemptsRef.current = 0;
    setIsPreparingPlayback(false);
    setPlayerReady(false);
    setActiveReleaseText("");
    if (resetStarted) {
      setHasPlaybackStarted(false);
    }
  }, []);

  const applyAutoPlaybackPayload = useCallback(
    (payload: AutoPlaybackPayload, setSessionSubtitles: (items: UiSubtitleTrack[]) => void) => {
      if (payload.mode === "session" && payload.session?.sessionId) {
        activeSessionIdRef.current = payload.session.sessionId;
        setSessionSubtitles(mapSessionSubtitles(payload));
      } else {
        activeSessionIdRef.current = null;
        setSessionSubtitles([]);
      }

      setActiveReleaseText(`${payload.chosen?.displayName || ""} ${payload.streamUrl || ""}`.trim());
      subtitleFailoverAttemptsRef.current = 0;
    },
    []
  );

  return {
    activeSessionIdRef,
    subtitleFailoverAttemptsRef,
    isPreparingPlayback,
    setIsPreparingPlayback,
    playerReady,
    setPlayerReady,
    hasPlaybackStarted,
    setHasPlaybackStarted,
    activeReleaseText,
    beginPlaybackAttempt,
    assertPlaybackAttemptActive,
    resetPlaybackState,
    applyAutoPlaybackPayload
  };
}
