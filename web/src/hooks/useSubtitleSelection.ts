import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from "react";
import { fetchSubtitles } from "../api";
import { isSpanishLanguage, normalizeLanguageCode } from "../lib/audio-preferences";
import { buildActiveStreamKey } from "../lib/candidate-scoring";
import {
  readSubtitleMemoryStore,
  trimSubtitleMemoryStore,
  writeSubtitleMemoryStore,
  type SubtitleMemoryStore
} from "../lib/subtitle-memory";
import { scoreSubtitleTrackMatch } from "../lib/subtitle-scoring";
import { dedupeSubtitleTracks, normalizeSubtitleVariantKey, type UiSubtitleTrack } from "../lib/subtitle-tracks";
import type { StreamCandidate } from "../types";

interface UseSubtitleSelectionOptions {
  decodedItemId: string;
  streamsType: string;
  isSeries: boolean;
  season: number;
  episode: number;
  activeCandidate: StreamCandidate | null;
  activeReleaseText: string;
  videoRef: MutableRefObject<HTMLVideoElement | null>;
  subtitleFailoverAttemptsRef: MutableRefObject<number>;
}

export function useSubtitleSelection({
  decodedItemId,
  streamsType,
  isSeries,
  season,
  episode,
  activeCandidate,
  activeReleaseText,
  videoRef,
  subtitleFailoverAttemptsRef
}: UseSubtitleSelectionOptions) {
  const [sessionSubtitles, setSessionSubtitles] = useState<UiSubtitleTrack[]>([]);
  const [addonSubtitles, setAddonSubtitles] = useState<UiSubtitleTrack[]>([]);
  const [loadingSubtitles, setLoadingSubtitles] = useState(false);
  const [subtitleMemory, setSubtitleMemory] = useState<SubtitleMemoryStore>(() => readSubtitleMemoryStore());
  const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState(-1);

  const activeStreamKey = useMemo(() => buildActiveStreamKey(activeCandidate), [activeCandidate]);
  const episodeMemoryKey = isSeries ? `${season}x${episode}` : "movie";
  const subtitleMemoryKey = useMemo(
    () => `${streamsType}|${decodedItemId}|${episodeMemoryKey}|${activeStreamKey || "generic"}`,
    [activeStreamKey, decodedItemId, episodeMemoryKey, streamsType]
  );
  const subtitleMemoryFallbackKey = useMemo(
    () => `${streamsType}|${decodedItemId}|${episodeMemoryKey}|generic`,
    [decodedItemId, episodeMemoryKey, streamsType]
  );
  const preferredSubtitleUrl =
    subtitleMemory[subtitleMemoryKey]?.url || subtitleMemory[subtitleMemoryFallbackKey]?.url || "";

  const saveSubtitleMemory = useCallback(
    (track: UiSubtitleTrack) => {
      if (!track?.url) return;
      const now = Date.now();
      setSubtitleMemory((prev) => {
        const current = prev[subtitleMemoryKey];
        const next: SubtitleMemoryStore = {
          ...prev,
          [subtitleMemoryKey]: {
            url: track.url,
            label: track.label,
            updatedAt: now,
            successCount: Number(current?.successCount || 0) + 1
          },
          [subtitleMemoryFallbackKey]: {
            url: track.url,
            label: track.label,
            updatedAt: now,
            successCount: Number(prev[subtitleMemoryFallbackKey]?.successCount || 0) + 1
          }
        };
        const trimmed = trimSubtitleMemoryStore(next);
        writeSubtitleMemoryStore(trimmed);
        return trimmed;
      });
    },
    [subtitleMemoryFallbackKey, subtitleMemoryKey]
  );

  const refreshAddonSubtitles = useCallback(
    async (silent = false) => {
      if (!decodedItemId) return;
      if (!silent) setLoadingSubtitles(true);
      try {
        const payload = await fetchSubtitles({
          type: streamsType,
          itemId: decodedItemId,
          season: isSeries ? season : undefined,
          episode: isSeries ? episode : undefined
        });
        const mapped = (payload.subtitles || []).map((item, index) => ({
          id: `addon-${item.providerId}-${index}`,
          label: item.label,
          language: item.language || "und",
          extension: item.extension || ".vtt",
          url: item.url,
          source: "addon" as const
        }));
        setAddonSubtitles(mapped);
      } catch {
        setAddonSubtitles([]);
      } finally {
        if (!silent) setLoadingSubtitles(false);
      }
    },
    [decodedItemId, episode, isSeries, season, streamsType]
  );

  useEffect(() => {
    void refreshAddonSubtitles(false);
  }, [refreshAddonSubtitles]);

  const subtitleTracks = useMemo(() => {
    const expectedEpisodeKey = isSeries ? `${season}x${episode}` : "";
    const ranked = dedupeSubtitleTracks([...sessionSubtitles, ...addonSubtitles])
      .filter((item) => isSpanishLanguage(item.language))
      .sort((a, b) => {
        const matchA = scoreSubtitleTrackMatch(
          a,
          activeCandidate,
          activeReleaseText,
          preferredSubtitleUrl,
          expectedEpisodeKey
        );
        const matchB = scoreSubtitleTrackMatch(
          b,
          activeCandidate,
          activeReleaseText,
          preferredSubtitleUrl,
          expectedEpisodeKey
        );
        if (matchA !== matchB) return matchB - matchA;

        const langA = normalizeLanguageCode(a.language);
        const langB = normalizeLanguageCode(b.language);
        if (langA !== langB) {
          if (langA === "es-419") return -1;
          if (langB === "es-419") return 1;
        }
        if (a.source !== b.source) return a.source === "torrent" ? -1 : 1;
        return a.label.localeCompare(b.label);
      });

    const variantSeen = new Set<string>();
    const base: UiSubtitleTrack[] = [];
    for (const track of ranked) {
      const variantKey = normalizeSubtitleVariantKey(track);
      if (variantSeen.has(variantKey)) {
        continue;
      }
      variantSeen.add(variantKey);
      base.push(track);
      if (base.length >= 12) break;
    }

    return base.map((item, index) => ({
      ...item,
      label: item.label || `Opcion ${index + 1}`
    }));
  }, [activeCandidate, activeReleaseText, addonSubtitles, episode, isSeries, preferredSubtitleUrl, season, sessionSubtitles]);

  useEffect(() => {
    subtitleFailoverAttemptsRef.current = 0;
    if (!subtitleTracks.length) {
      setSelectedSubtitleIndex(-1);
      return;
    }

    if (preferredSubtitleUrl) {
      const preferredIdx = subtitleTracks.findIndex((item) => item.url === preferredSubtitleUrl);
      if (preferredIdx >= 0) {
        setSelectedSubtitleIndex(preferredIdx);
        return;
      }
    }

    setSelectedSubtitleIndex(0);
  }, [preferredSubtitleUrl, subtitleTracks, subtitleFailoverAttemptsRef]);

  const handleSubtitleTrackError = useCallback(() => {
    if (selectedSubtitleIndex < 0) return;
    setSelectedSubtitleIndex((prev) => {
      if (prev < 0) return -1;
      const next = prev + 1;
      if (next < subtitleTracks.length) {
        subtitleFailoverAttemptsRef.current += 1;
        return next;
      }
      return -1;
    });
    if (subtitleFailoverAttemptsRef.current <= 1) {
      void refreshAddonSubtitles(true);
    }
  }, [refreshAddonSubtitles, selectedSubtitleIndex, subtitleTracks.length, subtitleFailoverAttemptsRef]);

  const handleSubtitleTrackLoad = useCallback(
    (event: { currentTarget: HTMLTrackElement }) => {
      const trackElement = event.currentTarget;
      const activeIndex = selectedSubtitleIndex;
      const activeTrack = activeIndex >= 0 ? subtitleTracks[activeIndex] : null;
      if (!activeTrack) return;

      window.setTimeout(() => {
        const cueCount = Number(trackElement.track?.cues?.length || 0);
        if (cueCount <= 0) {
          handleSubtitleTrackError();
          return;
        }

        const cues = trackElement.track?.cues;
        const lastCue = cues && cues.length ? (cues[cues.length - 1] as unknown as { endTime?: number }) : null;
        const lastCueEnd = Number(lastCue?.endTime || 0);
        const mediaDuration = Number(videoRef.current?.duration || 0);
        if (Number.isFinite(mediaDuration) && mediaDuration > 900 && lastCueEnd > 0) {
          const coverageRatio = lastCueEnd / mediaDuration;
          if (coverageRatio < 0.86 || coverageRatio > 1.18) {
            handleSubtitleTrackError();
            return;
          }
        }

        subtitleFailoverAttemptsRef.current = 0;
        saveSubtitleMemory(activeTrack);
      }, 450);
    },
    [handleSubtitleTrackError, saveSubtitleMemory, selectedSubtitleIndex, subtitleTracks, subtitleFailoverAttemptsRef, videoRef]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const applySelection = () => {
      const tracks = Array.from(video.textTracks || []);
      tracks.forEach((track) => {
        track.mode = "disabled";
      });
      if (selectedSubtitleIndex >= 0 && tracks[0]) {
        tracks[0].mode = "showing";
      }
    };

    const timer = window.setTimeout(applySelection, 150);
    return () => window.clearTimeout(timer);
  }, [selectedSubtitleIndex, subtitleTracks.length, videoRef]);

  const activeSubtitleTrack =
    selectedSubtitleIndex >= 0 && subtitleTracks[selectedSubtitleIndex]
      ? subtitleTracks[selectedSubtitleIndex]
      : null;
  const rememberedSubtitleIndex = preferredSubtitleUrl
    ? subtitleTracks.findIndex((item) => item.url === preferredSubtitleUrl)
    : -1;

  return {
    setSessionSubtitles,
    addonSubtitles,
    loadingSubtitles,
    selectedSubtitleIndex,
    setSelectedSubtitleIndex,
    subtitleTracks,
    activeSubtitleTrack,
    rememberedSubtitleIndex,
    preferredSubtitleUrl,
    refreshAddonSubtitles,
    handleSubtitleTrackError,
    handleSubtitleTrackLoad
  };
}
