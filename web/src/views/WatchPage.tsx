import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Captions,
  Clapperboard,
  Gauge,
  Languages,
  LoaderCircle,
  Maximize2,
  Play,
  XCircle
} from "lucide-react";
import {
  reportPlaybackMetric,
  destroyPlaybackSession,
  startAutoPlayback,
  saveWatchProgress,
  prefetchNextEpisode,
  clearUserUnavailable
} from "../api";
import { invalidateAvailability } from "../lib/availability-cache";
import { useAppStore } from "../store/AppStore";
import type { AutoPlaybackAlternative, AutoPlaybackPayload, Category } from "../types";
import { upsertWatchEntry, getWatchHistory } from "../lib/watch-history";
import { normalizeLanguageCode, type AudioPreference } from "../lib/audio-preferences";
import { startVideo, waitForVideoReady } from "../lib/video-helpers";
import { useHlsPlayer } from "../hooks/useHlsPlayer";
import { useMetaDetails } from "../hooks/useMetaDetails";
import { usePlaybackSession } from "../hooks/usePlaybackSession";
import { useStreamCandidates, type QualitySelection } from "../hooks/useStreamCandidates";
import { useSubtitleSelection } from "../hooks/useSubtitleSelection";

function normalizeType(raw: string): Category {
  const clean = String(raw || "").toLowerCase();
  if (clean === "series") return "series";
  if (clean === "tv") return "tv";
  return "movie";
}

function toStreamsType(type: Category): string {
  return type;
}

function qualityLabel(value: QualitySelection): string {
  if (value === "auto") return "Auto";
  if (value === "4k") return "4K";
  if (value === "1080p") return "1080p";
  if (value === "720p") return "720p";
  return "SD";
}

function formatRating(value: number | null | undefined): string {
  if (!Number.isFinite(Number(value))) return "N/D";
  return `${Number(value).toFixed(1)}/10`;
}

function formatEpisodeLabel(item: { season: number; episode: number; title: string }): string {
  return `T${item.season}E${item.episode} - ${item.title}`;
}

function typeLabel(value: Category): string {
  if (value === "series") return "Serie";
  if (value === "tv") return "TV";
  return "Pelicula";
}

type AudioTrackOption = {
  index: number;
  label: string;
  language: string;
};

type VideoWithAudioTracks = HTMLVideoElement & {
  audioTracks?: {
    length: number;
    [index: number]: {
      label?: string;
      language?: string;
      enabled?: boolean;
    };
  };
};

export function WatchPage() {
  const params = useParams<{ type: string; itemId: string }>();
  const navigate = useNavigate();
  const { state } = useAppStore();

  const type = normalizeType(params.type || "movie");
  const decodedItemId = decodeURIComponent(params.itemId || "");
  const selectedFromStore =
    state.selectedItem && state.selectedItem.id === decodedItemId ? state.selectedItem : null;

  const [season, setSeason] = useState(1);
  const [episode, setEpisode] = useState(1);
  const {
    selectedQuality,
    setSelectedQuality,
    availableQualities,
    applyValidatedQualities,
    resetValidatedQualities,
    syncSelectedQuality
  } = useStreamCandidates();
  const activeCandidate = null;
  const {
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
  } = usePlaybackSession();
  const [audioPreference, setAudioPreference] = useState<AudioPreference>(() => {
    if (typeof window === "undefined") return "es";
    return (localStorage.getItem("streams_audio_pref") as AudioPreference) || "es";
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [alternatives, setAlternatives] = useState<AutoPlaybackAlternative[]>([]);
  const [activeAlternativeIndex, setActiveAlternativeIndex] = useState<number>(-1);
  const [seekTooltip, setSeekTooltip] = useState<string | null>(null);
  const [activeChosenCandidate, setActiveChosenCandidate] = useState<AutoPlaybackPayload["chosen"] | null>(null);
  const [mkvAudioTracks, setMkvAudioTracks] = useState<AudioTrackOption[]>([]);
  const [selectedMkvAudioTrackIndex, setSelectedMkvAudioTrackIndex] = useState(0);
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCurrentMkv = String(activeChosenCandidate?.fileExtension || "").toLowerCase() === "mkv";
  const showMkvAudioTrackSelector = isCurrentMkv && mkvAudioTracks.length > 1;

  const handleAudioPreferenceChange = useCallback((value: AudioPreference) => {
    setAudioPreference(value);
    if (typeof window !== "undefined") {
      localStorage.setItem("streams_audio_pref", value);
    }
  }, []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerStageRef = useRef<HTMLDivElement | null>(null);
  const autoLoadKeyRef = useRef<string>("");
  const preferredSourceKeyRef = useRef<string>("");
  const hasEverPlayedRef = useRef(false);
  const lastSaveTimeRef = useRef(0);
  const hasResumedRef = useRef(false);
  const autoPlayAbortRef = useRef<AbortController | null>(null);
  const isPreparingRef = useRef(false);
  const runtimeFailureHandlerRef = useRef<(reason: string) => void>(() => {});
  const handleRuntimeFailure = useCallback((reason: string) => {
    runtimeFailureHandlerRef.current(reason);
  }, []);
  const { isBuffering, setIsBuffering, attachVideoSource, destroyHls } = useHlsPlayer({
    activeSessionIdRef,
    onRuntimeFailure: handleRuntimeFailure
  });

  const isSeries = type === "series";
  const streamsType = toStreamsType(type);
  const { loadingMeta, metaDetails } = useMetaDetails({
    decodedItemId,
    streamsType,
    isSeries,
    season,
    episode,
    setSeason,
    setEpisode
  });
  const {
    setSessionSubtitles,
    loadingSubtitles,
    selectedSubtitleIndex,
    setSelectedSubtitleIndex,
    subtitleTracks,
    activeSubtitleTrack,
    rememberedSubtitleIndex,
    refreshAddonSubtitles,
    handleSubtitleTrackError,
    handleSubtitleTrackLoad
  } = useSubtitleSelection({
    decodedItemId,
    streamsType,
    isSeries,
    season,
    episode,
    activeCandidate,
    activeReleaseText,
    videoRef,
    subtitleFailoverAttemptsRef
  });
  const title = metaDetails?.info?.title || selectedFromStore?.name || decodedItemId;
  const originalLanguageCode = normalizeLanguageCode(metaDetails?.info?.originalLanguage || "");

  function handleEnterFullscreen() {
    const stage = playerStageRef.current;
    if (!stage) return;

    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
        return;
      }
      
      if (stage.requestFullscreen) {
        void stage.requestFullscreen();
      } else if ((stage as any).webkitRequestFullscreen) {
        void (stage as any).webkitRequestFullscreen();
      } else if ((stage as any).mozRequestFullScreen) {
        void (stage as any).mozRequestFullScreen();
      } else if ((stage as any).msRequestFullscreen) {
        void (stage as any).msRequestFullscreen();
      }
    } catch {
      // fallback to video element if stage fails
      const video = videoRef.current;
      if (video?.requestFullscreen) void video.requestFullscreen();
    }
  }

  const showSeekTooltip = useCallback((text: string) => {
    setSeekTooltip(text);
    if (seekTimerRef.current) clearTimeout(seekTimerRef.current);
    seekTimerRef.current = setTimeout(() => setSeekTooltip(null), 1200);
  }, []);

  const refreshMkvAudioTracks = useCallback(() => {
    const video = videoRef.current as VideoWithAudioTracks | null;
    if (!video || !isCurrentMkv) {
      setMkvAudioTracks([]);
      setSelectedMkvAudioTrackIndex(0);
      return;
    }
    const rawTracks = video.audioTracks;
    if (!rawTracks || typeof rawTracks.length !== "number" || rawTracks.length <= 0) {
      setMkvAudioTracks([]);
      setSelectedMkvAudioTrackIndex(0);
      return;
    }

    const parsedTracks: AudioTrackOption[] = [];
    let enabledIndex = -1;
    for (let index = 0; index < rawTracks.length; index += 1) {
      const track = rawTracks[index] || {};
      const language = String(track.language || "und").trim() || "und";
      const label = String(track.label || "").trim() || `Pista ${index + 1}`;
      if (track.enabled) enabledIndex = index;
      parsedTracks.push({
        index,
        label: `${label} (${language})`,
        language
      });
    }
    setMkvAudioTracks(parsedTracks);
    if (enabledIndex >= 0) {
      setSelectedMkvAudioTrackIndex(enabledIndex);
    } else if (parsedTracks.length) {
      setSelectedMkvAudioTrackIndex((current) => Math.max(0, Math.min(parsedTracks.length - 1, current)));
    } else {
      setSelectedMkvAudioTrackIndex(0);
    }
  }, [isCurrentMkv]);

  const handleMkvAudioTrackChange = useCallback((nextIndex: number) => {
    const video = videoRef.current as VideoWithAudioTracks | null;
    const rawTracks = video?.audioTracks;
    if (!video || !rawTracks || typeof rawTracks.length !== "number" || rawTracks.length <= 1) {
      return;
    }
    const index = Math.max(0, Math.min(rawTracks.length - 1, Number(nextIndex) || 0));
    for (let trackIndex = 0; trackIndex < rawTracks.length; trackIndex += 1) {
      const track = rawTracks[trackIndex];
      if (!track) continue;
      track.enabled = trackIndex === index;
    }
    setSelectedMkvAudioTrackIndex(index);
    refreshMkvAudioTracks();
  }, [refreshMkvAudioTracks]);

  const clearActivePlayback = useCallback(async (resetStarted = false) => {
    const sessionId = activeSessionIdRef.current;
    setSessionSubtitles([]);
    resetPlaybackState(resetStarted);

    if (sessionId) {
      try {
        await destroyPlaybackSession(sessionId);
      } catch {
        // no-op
      }
    }

    destroyHls();
    setActiveChosenCandidate(null);
    setMkvAudioTracks([]);
    setSelectedMkvAudioTrackIndex(0);

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
  }, [activeSessionIdRef, destroyHls, resetPlaybackState, setSessionSubtitles]);

  useEffect(() => { isPreparingRef.current = isPreparingPlayback; }, [isPreparingPlayback]);

  const cancelPlayback = useCallback(() => {
    autoPlayAbortRef.current?.abort();
    autoPlayAbortRef.current = null;
    beginPlaybackAttempt();
    setIsPreparingPlayback(false);
    setActionError(null);
  }, [beginPlaybackAttempt, setIsPreparingPlayback]);

  useEffect(() => {
    return () => {
      autoPlayAbortRef.current?.abort();
      beginPlaybackAttempt();
      void clearActivePlayback(true);
    };
  }, [beginPlaybackAttempt, clearActivePlayback]);

  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    // Permitimos scroll para poder ver la info de la pelicula en TV
    document.body.style.overflow = "auto";
    document.documentElement.style.overflow = "auto";

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, []);

  const saveProgress = useCallback((force = false) => {
    const video = videoRef.current;
    if (!video || !video.duration || !decodedItemId) return;
    // No guardar progreso si aún no hay posición real (evita sobreescribir entries válidos con position=0)
    if (video.currentTime < 5) return;
    const now = Date.now();
    if (!force && now - lastSaveTimeRef.current < 30000) return;
    lastSaveTimeRef.current = now;
    const entryType = type === "series" ? "series" as const : "movie" as const;
    const entry = {
      type: entryType,
      itemId: decodedItemId,
      name: title,
      poster: metaDetails?.info?.poster || selectedFromStore?.poster || null,
      background: metaDetails?.info?.background || selectedFromStore?.background || null,
      season: isSeries ? season : undefined,
      episode: isSeries ? episode : undefined,
      episodeTitle: isSeries ? (metaDetails?.episodes?.find((e) => e.season === season && e.episode === episode)?.title) : undefined,
      position: Math.floor(video.currentTime),
      duration: Math.floor(video.duration)
    };
    upsertWatchEntry(entry);

    if (state.user) {
      void saveWatchProgress(state.user.username, {
        type: entryType,
        itemId: decodedItemId,
        name: entry.name,
        poster: entry.poster,
        background: entry.background,
        season: isSeries ? season : null,
        episode: isSeries ? episode : null,
        episodeTitle: isSeries ? (entry.episodeTitle || null) : null,
        position: entry.position,
        duration: entry.duration
      }).catch(() => {});
    }
  }, [decodedItemId, type, title, metaDetails, selectedFromStore, isSeries, season, episode, state.user]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const onTimeUpdate = () => saveProgress(false);
    const onPause = () => saveProgress(true);
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("pause", onPause);
    const onBeforeUnload = () => saveProgress(true);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("pause", onPause);
      window.removeEventListener("beforeunload", onBeforeUnload);
      saveProgress(true);
    };
  }, [saveProgress]);

  const playResolvedPayload = useCallback(
    async (payload: AutoPlaybackPayload, shouldAutoplay: boolean, playbackAttemptId: number) => {
      assertPlaybackAttemptActive(playbackAttemptId);
      if (!videoRef.current) {
        throw new Error("Video no disponible.");
      }

      const ttffStartedAt = performance.now();
      applyAutoPlaybackPayload(payload, setSessionSubtitles);
      setActiveChosenCandidate(payload.chosen || null);
      setMkvAudioTracks([]);
      setSelectedMkvAudioTrackIndex(0);
      const isHlsSession = payload.streamUrl.includes("/hls/") && payload.sessionId;
      const hlsMode = isHlsSession ? "event" : "vod";
      console.log(`[PLAY-DEBUG] attachVideoSource: url=${payload.streamUrl} mode=${hlsMode}`);
      try {
        await attachVideoSource(videoRef.current, payload.streamUrl, {
          mode: hlsMode
        });
        console.log("[PLAY-DEBUG] attachVideoSource OK, waiting for video ready...");
      } catch (err) {
        console.error("[PLAY-DEBUG] attachVideoSource FAILED:", err);
        throw err;
      }
      try {
        await waitForVideoReady(videoRef.current);
        console.log("[PLAY-DEBUG] waitForVideoReady OK");
      } catch (err) {
        console.error("[PLAY-DEBUG] waitForVideoReady FAILED:", err);
        throw err;
      }
      assertPlaybackAttemptActive(playbackAttemptId);
      setPlayerReady(true);
      refreshMkvAudioTracks();
      hasEverPlayedRef.current = true;

      // Persistir la fuente que funcionó para "seguir viendo"
      if (payload.chosen?.sourceKey) {
        preferredSourceKeyRef.current = payload.chosen.sourceKey;
        try { localStorage.setItem(`streams_src|${streamsType}|${decodedItemId}`, payload.chosen.sourceKey); } catch {}
      }

      if (!hasResumedRef.current && videoRef.current) {
        hasResumedRef.current = true;
        // Solo hacer resume en streams directos, no en HLS de torrent
        // (el HLS de torrent se genera en tiempo real y no permite seekear a posiciones futuras)
        const isHlsSession = payload.streamUrl.includes("/hls/") && payload.sessionId;
        if (!isHlsSession) {
          const history = getWatchHistory();
          const matchKey = isSeries
            ? `series:${decodedItemId}:${season}:${episode}`
            : `movie:${decodedItemId}`;
          const found = history.find((e) => {
            const k = e.type === "series" && e.season != null && e.episode != null
              ? `${e.type}:${e.itemId}:${e.season}:${e.episode}`
              : `${e.type}:${e.itemId}`;
            return k === matchKey;
          });
          if (found && found.duration > 0) {
            const pct = found.position / found.duration;
            if (pct > 0.02 && pct < 0.95) {
              videoRef.current.currentTime = Math.max(0, found.position - 5);
            }
          }
        }
      }

      applyValidatedQualities(payload.availableQualities);
      syncSelectedQuality(payload.selectedQuality || "auto");
      void refreshAddonSubtitles(true);
      void reportPlaybackMetric({
        metric: "ttff",
        status: "ok",
        valueMs: Math.round(performance.now() - ttffStartedAt),
        type: streamsType,
        itemId: decodedItemId,
        quality: payload.selectedQuality,
        streamKind: payload.streamKind,
        mode: payload.mode
      }).catch(() => {
        // no-op
      });

      if (!shouldAutoplay) return;
      const playResult = await startVideo(videoRef.current);
      if (playResult === "gesture_required") {
        setActionError("Stream listo. Toca Play para iniciar en este navegador.");
      }
    },
    [
      assertPlaybackAttemptActive,
      applyAutoPlaybackPayload,
      applyValidatedQualities,
      attachVideoSource,
      decodedItemId,
      refreshAddonSubtitles,
      setSessionSubtitles,
      streamsType,
      syncSelectedQuality,
      refreshMkvAudioTracks
    ]
  );

  const playWithBackendAuto = useCallback(
    async (quality: QualitySelection, shouldAutoplay: boolean, playbackAttemptId: number) => {
      assertPlaybackAttemptActive(playbackAttemptId);
      await clearActivePlayback();
      assertPlaybackAttemptActive(playbackAttemptId);
      if (!videoRef.current) {
        throw new Error("Video no disponible.");
      }

      setHasPlaybackStarted(true);
      setIsPreparingPlayback(true);
      setPlayerReady(false);
      setSessionSubtitles([]);

      // Crear AbortController para poder cancelar este intento
      autoPlayAbortRef.current?.abort();
      const abortCtrl = new AbortController();
      autoPlayAbortRef.current = abortCtrl;

      try {
        const payload = await startAutoPlayback({
          type: streamsType,
          itemId: decodedItemId,
          season: isSeries ? season : undefined,
          episode: isSeries ? episode : undefined,
          quality,
          audioPreference,
          originalLanguage: originalLanguageCode || undefined,
          waitReadyMs: 40000,
          validationBudgetMs: 75000,
          probeTimeoutMs: 3500,
          maxCandidates: 25,
          preferredSourceKey: preferredSourceKeyRef.current || undefined
        }, abortCtrl.signal);
        assertPlaybackAttemptActive(playbackAttemptId);
        setAlternatives(payload.alternatives || []);
        setActiveAlternativeIndex(-1);
        await playResolvedPayload(payload, shouldAutoplay, playbackAttemptId);
      } catch (error) {
        void reportPlaybackMetric({
          metric: "ttff",
          status: "error",
          type: streamsType,
          itemId: decodedItemId,
          quality: quality
        }).catch(() => {
          // no-op
        });
        resetValidatedQualities();
        setSessionSubtitles([]);
        throw error;
      } finally {
        setIsPreparingPlayback(false);
      }
    },
    [
      assertPlaybackAttemptActive,
      audioPreference,
      clearActivePlayback,
      decodedItemId,
      episode,
      isSeries,
      originalLanguageCode,
      playResolvedPayload,
      resetValidatedQualities,
      season,
      setSessionSubtitles,
      streamsType
    ]
  );

  const handleRuntimePlaybackFailure = useCallback(
    async (reason: string) => {
      // No auto-recuperar con un nuevo auto-playback: puede encontrar contenido
      // incorrecto y reemplazar un stream que estaba funcionando.
      // Solo mostrar el error — el usuario puede reintentar manualmente.
      console.warn("[PLAY-DEBUG] Runtime failure:", reason);
      setActionError(reason || "La reproduccion se detuvo. Presiona Reproducir para reintentar.");
    },
    []
  );

  useEffect(() => {
    runtimeFailureHandlerRef.current = (reason: string) => {
      void handleRuntimePlaybackFailure(reason);
    };
    return () => {
      runtimeFailureHandlerRef.current = () => {};
    };
  }, [handleRuntimePlaybackFailure]);

  async function handleStartPlayback() {
    setActionError(null);
    // Limpiar unavailable al intentar reproducir (permite reintentar sin bloqueos)
    if (state.user) {
      void clearUserUnavailable({ username: state.user.username, type, itemId: decodedItemId }).catch(() => {});
    }
    invalidateAvailability(type, decodedItemId);
    // Restaurar fuente preferida de "seguir viendo"
    if (!preferredSourceKeyRef.current) {
      try {
        const stored = localStorage.getItem(`streams_src|${streamsType}|${decodedItemId}`);
        if (stored) preferredSourceKeyRef.current = stored;
      } catch {}
    }
    try {
      const autoAttemptId = beginPlaybackAttempt();
      await playWithBackendAuto(selectedQuality || "auto", true, autoAttemptId);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return; // cancelado por el usuario
      const message = error instanceof Error ? error.message : "No hay video disponible por el momento.";
      setActionError(message);
    }
  }

  async function handleQualityClick(value: QualitySelection) {
    setSelectedQuality(value);
    setActionError(null);

    // Intentar reutilizar una alternativa ya validada antes de re-buscar
    if (value !== "auto" && alternatives.length > 0) {
      const matchIdx = alternatives.findIndex((alt) => alt.selectedQuality === value);
      if (matchIdx >= 0) {
        void handlePlayAlternative(alternatives[matchIdx], matchIdx);
        return;
      }
    }

    // Sin match → búsqueda completa
    setAlternatives([]);
    setActiveAlternativeIndex(-1);
    try {
      const autoAttemptId = beginPlaybackAttempt();
      await playWithBackendAuto(value, true, autoAttemptId);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "No se pudo cambiar la calidad.";
      setActionError(message);
    }
  }

  async function handlePlayAlternative(alt: AutoPlaybackAlternative, index: number) {
    setActionError(null);
    setActiveAlternativeIndex(index);
    try {
      const playbackAttemptId = beginPlaybackAttempt();
      await clearActivePlayback();
      if (!videoRef.current) throw new Error("Video no disponible.");
      setHasPlaybackStarted(true);
      setIsPreparingPlayback(true);
      setPlayerReady(false);

      const asPayload: AutoPlaybackPayload = {
        ...alt,
        availableQualities: [alt.selectedQuality],
        alternatives: []
      };
      await playResolvedPayload(asPayload, true, playbackAttemptId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cargar esta alternativa.";
      setActionError(message);
    } finally {
      setIsPreparingPlayback(false);
    }
  }

  useEffect(() => {
    const key = `${type}|${decodedItemId}|${season}|${episode}`;
    if (!decodedItemId) return;
    if (autoLoadKeyRef.current === key) return;
    autoLoadKeyRef.current = key;

    const attemptId = beginPlaybackAttempt();
    // Restaurar fuente preferida si existe, en vez de resetear
    try {
      const stored = localStorage.getItem(`streams_src|${type}|${decodedItemId}`);
      preferredSourceKeyRef.current = stored || "";
    } catch { preferredSourceKeyRef.current = ""; }
    resetValidatedQualities();
    void clearActivePlayback(true);
    setActionError(null);

    // Autoplay siempre: al entrar a la página y al cambiar episodio
    void playWithBackendAuto("auto", true, attemptId).catch((err) => {
      if ((err as Error)?.name === "AbortError") return;
      setActionError(err instanceof Error ? err.message : "No hay video disponible.");
    });
  }, [
    beginPlaybackAttempt,
    clearActivePlayback,
    decodedItemId,
    episode,
    playWithBackendAuto,
    resetValidatedQualities,
    season,
    type
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => {
      setIsBuffering(false);
      setPlayerReady(true);
      setActionError(null);
      refreshMkvAudioTracks();
    };
    const onCanPlay = () => {
      setIsBuffering(false);
      setPlayerReady(true);
      setActionError(null);
      refreshMkvAudioTracks();
    };
    const onLoadedData = () => {
      setPlayerReady(true);
      refreshMkvAudioTracks();
    };

    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("loadeddata", onLoadedData);
    video.addEventListener("loadedmetadata", onLoadedData);

    return () => {
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("loadeddata", onLoadedData);
      video.removeEventListener("loadedmetadata", onLoadedData);
    };
  }, [hasPlaybackStarted, setPlayerReady, refreshMkvAudioTracks]);

  useEffect(() => {
    if (!isCurrentMkv) {
      setMkvAudioTracks([]);
      setSelectedMkvAudioTrackIndex(0);
      return;
    }
    refreshMkvAudioTracks();
  }, [isCurrentMkv, refreshMkvAudioTracks]);

  const episodeList = metaDetails?.episodes || [];
  const seasonList = metaDetails?.seasons || [];

  // Prefetch del siguiente episodio al 70% de progreso
  const prefetchedRef = useRef(false);
  useEffect(() => { prefetchedRef.current = false; }, [season, episode, decodedItemId]);
  useEffect(() => {
    if (!isSeries || !episodeList.length) return;
    const video = videoRef.current;
    if (!video) return;
    function onTimeUpdate() {
      if (!video || video.duration <= 0 || prefetchedRef.current) return;
      if (video.currentTime / video.duration >= 0.70) {
        prefetchedRef.current = true;
        const hasNext = episodeList.some((e) => e.season === season && e.episode === episode + 1);
        if (hasNext) {
          void prefetchNextEpisode({
            type: "series", itemId: decodedItemId, season, episode,
            audioPreference, originalLanguage: originalLanguageCode || undefined
          }).catch(() => {});
        }
      }
    }
    video.addEventListener("timeupdate", onTimeUpdate);
    return () => video.removeEventListener("timeupdate", onTimeUpdate);
  }, [isSeries, season, episode, episodeList, decodedItemId, audioPreference, originalLanguageCode]);

  // D-pad keyboard controls with zone navigation: header / player / sidebar
  const tvZoneRef = useRef<"header" | "player" | "sidebar">("player");
  const sidebarFocusIndexRef = useRef(0);
  const headerFocusIndexRef = useRef(0);

  const getHeaderFocusables = useCallback((): HTMLElement[] => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        ".watch-hero-strip .back-link-icon, .watch-hero-strip .watch-top-action-btn"
      )
    );
  }, []);

  const getSidebarFocusables = useCallback((): HTMLElement[] => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        ".watch-info-panel button, .watch-info-panel select, .watch-info-panel .episode-item, .watch-details-panel .secondary-btn"
      )
    );
  }, []);

  const getPlayerFocusables = useCallback((): HTMLElement[] => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(
        ".player-stage .player-start-cta"
      )
    );
  }, []);

  const clearAllFocus = useCallback(() => {
    document.querySelectorAll(".tv-focused").forEach((el) => el.classList.remove("tv-focused"));
  }, []);

  const applyFocus = useCallback((el: HTMLElement) => {
    clearAllFocus();
    el.classList.add("tv-focused");
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [clearAllFocus]);

  const applySidebarFocus = useCallback((index: number) => {
    const items = getSidebarFocusables();
    if (!items.length) return;
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    sidebarFocusIndexRef.current = clamped;
    applyFocus(items[clamped]);
  }, [getSidebarFocusables, applyFocus]);

  const applyHeaderFocus = useCallback((index: number) => {
    const items = getHeaderFocusables();
    if (!items.length) return;
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    headerFocusIndexRef.current = clamped;
    applyFocus(items[clamped]);
  }, [getHeaderFocusables, applyFocus]);

  const goToZone = useCallback((zone: "header" | "player" | "sidebar") => {
    tvZoneRef.current = zone;
    if (zone === "header") {
      applyHeaderFocus(headerFocusIndexRef.current);
    } else if (zone === "sidebar") {
      applySidebarFocus(sidebarFocusIndexRef.current);
    } else {
      const playerItems = getPlayerFocusables();
      if (playerItems.length) {
        applyFocus(playerItems[0]);
      } else {
        clearAllFocus();
      }
    }
  }, [applyHeaderFocus, applySidebarFocus, getPlayerFocusables, applyFocus, clearAllFocus]);


  // Ref para cancelPlayback estable en keyboard handler
  const cancelPlaybackRef = useRef(cancelPlayback);
  useEffect(() => { cancelPlaybackRef.current = cancelPlayback; }, [cancelPlayback]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (tag === "SELECT") return;

      const video = videoRef.current;
      if (!video) return;
      const zone = tvZoneRef.current;
      const isPreparing = isPreparingRef.current;

      // --- Global: Escape/Backspace cancela carga o navega atrás ---
      if (e.key === "Escape" || e.key === "Backspace" || e.key === "BrowserBack") {
        e.preventDefault();
        if (isPreparing) {
          // Cancelar intento en curso en vez de navegar
          cancelPlaybackRef.current();
          return;
        }
        if (zone === "sidebar") { goToZone("player"); return; }
        if (document.fullscreenElement) { void document.exitFullscreen().catch(() => {}); return; }
        navigate("/");
        return;
      }

      // --- HEADER zone ---
      if (zone === "header") {
        const items = getHeaderFocusables();
        const idx = headerFocusIndexRef.current;
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            if (idx > 0) { headerFocusIndexRef.current = idx - 1; applyHeaderFocus(idx - 1); }
            break;
          case "ArrowRight":
            e.preventDefault();
            if (idx < items.length - 1) { headerFocusIndexRef.current = idx + 1; applyHeaderFocus(idx + 1); }
            break;
          case "ArrowDown":
            e.preventDefault();
            goToZone("player");
            break;
          case "Enter":
          case " ":
            e.preventDefault();
            if (items[idx]) items[idx].click();
            break;
        }
        return;
      }

      // --- PLAYER zone ---
      if (zone === "player") {
        const playerItems = getPlayerFocusables();
        const hasStartButton = playerItems.length > 0;

        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            if (!hasStartButton && !isPreparing) {
              video.currentTime = Math.max(0, video.currentTime - 10);
              showSeekTooltip("-10s");
            }
            break;
          case "ArrowRight":
            e.preventDefault();
            if (!hasStartButton && !isPreparing) {
              video.currentTime = Math.min(video.duration || 0, video.currentTime + 10);
              showSeekTooltip("+10s");
            }
            break;
          case "ArrowUp":
            e.preventDefault();
            goToZone("header");
            break;
          case "ArrowDown": {
            e.preventDefault();
            const items = getSidebarFocusables();
            if (items.length) {
              sidebarFocusIndexRef.current = 0;
              goToZone("sidebar");
            }
            break;
          }
          case "Enter":
          case " ":
            e.preventDefault();
            if (isPreparing) {
              cancelPlaybackRef.current();
            } else if (hasStartButton) {
              playerItems[0].click();
            } else {
              if (video.paused) video.play().catch(() => {});
              else video.pause();
            }
            break;
        }
        return;
      }

      // --- SIDEBAR zone ---
      const items = getSidebarFocusables();
      const idx = sidebarFocusIndexRef.current;
      const current = items[idx] || null;
      const isSelect = current?.tagName === "SELECT";

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (idx < items.length - 1) {
            sidebarFocusIndexRef.current = idx + 1;
            applySidebarFocus(idx + 1);
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (idx > 0) {
            sidebarFocusIndexRef.current = idx - 1;
            applySidebarFocus(idx - 1);
          } else {
            goToZone("player");
          }
          break;
        case "ArrowRight": {
          e.preventDefault();
          if (current) {
            const row = current.parentElement;
            if (row && (row.classList.contains("chip-row") || row.classList.contains("episode-list") || row.classList.contains("alt-source-list"))) {
              const siblings = Array.from(row.children) as HTMLElement[];
              const posInRow = siblings.indexOf(current);
              if (posInRow < siblings.length - 1) {
                const nextSibling = siblings[posInRow + 1];
                const globalIdx = items.indexOf(nextSibling);
                if (globalIdx !== -1) { sidebarFocusIndexRef.current = globalIdx; applySidebarFocus(globalIdx); }
              }
            }
          }
          break;
        }
        case "ArrowLeft": {
          e.preventDefault();
          if (current) {
            const row = current.parentElement;
            if (row && (row.classList.contains("chip-row") || row.classList.contains("episode-list") || row.classList.contains("alt-source-list"))) {
              const siblings = Array.from(row.children) as HTMLElement[];
              const posInRow = siblings.indexOf(current);
              if (posInRow > 0) {
                const prevSibling = siblings[posInRow - 1];
                const globalIdx = items.indexOf(prevSibling);
                if (globalIdx !== -1) { sidebarFocusIndexRef.current = globalIdx; applySidebarFocus(globalIdx); }
              }
            }
          }
          break;
        }
        case "Enter":
        case " ":
          e.preventDefault();
          if (isSelect) {
            (current as HTMLSelectElement).showPicker?.();
          } else if (current) {
            current.click();
          }
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, getSidebarFocusables, getHeaderFocusables, applySidebarFocus, applyHeaderFocus, goToZone, showSeekTooltip, getPlayerFocusables]);

  const displayYear = metaDetails?.info?.year || selectedFromStore?.year || "s/a";
  const displayRuntime = Number(metaDetails?.info?.runtime || 0) > 0 ? `${metaDetails?.info?.runtime} min` : null;
  const displayGenres = metaDetails?.info?.genres?.length ? metaDetails.info.genres.slice(0, 4) : [];
  const displayPoster = metaDetails?.info?.poster || selectedFromStore?.poster || selectedFromStore?.background;
  const displayDescription = metaDetails?.info?.overview || selectedFromStore?.description || "Sin descripcion";
  const displayRating = metaDetails?.info?.rating ?? selectedFromStore?.rating;

  const showLoaderOverlay =
    isPreparingPlayback || (hasPlaybackStarted && !playerReady) || (playerReady && isBuffering);
  const loadingStateText = isPreparingPlayback
      ? "Cargando video..."
      : hasPlaybackStarted && !playerReady
        ? "Preparando reproductor..."
        : playerReady && isBuffering
          ? "Bufferizando..."
          : "";
  return (
    <main className="app-shell watch-shell">
      <header className="watch-hero-strip">
        <Link className="back-link-icon" to="/" aria-label="Volver al inicio">
          <ArrowLeft size={20} />
        </Link>
        <div className="watch-title-wrap">
          <h1>{title}</h1>
          <div className="watch-meta-row">
            <span className="watch-pill">{typeLabel(type)}</span>
            <span className="watch-pill">{displayYear}</span>
            <span className="watch-pill">Rating {formatRating(displayRating)}</span>
            {displayRuntime ? <span className="watch-pill">{displayRuntime}</span> : null}
          </div>
        </div>
        <button
          type="button"
          className="watch-top-action-btn"
          onClick={handleEnterFullscreen}
          aria-label="Pantalla completa"
          title="Pantalla completa"
        >
          <Maximize2 size={17} />
        </button>
      </header>

      <section className="watch-layout">
        <section className="watch-player-panel">
          <div className={`player-stage ${showLoaderOverlay ? "is-loading" : "is-ready"}`} ref={playerStageRef}>
            <video ref={videoRef} controls playsInline className="video-player">
              {activeSubtitleTrack ? (
                <track
                  key={activeSubtitleTrack.id}
                  kind="subtitles"
                  src={activeSubtitleTrack.url}
                  label={activeSubtitleTrack.label}
                  srcLang={activeSubtitleTrack.language || "und"}
                  default
                  onError={handleSubtitleTrackError}
                  onLoad={handleSubtitleTrackLoad}
                />
              ) : null}
            </video>

            {seekTooltip ? (
              <div className="seek-indicator-overlay">
                {seekTooltip}
              </div>
            ) : null}

            {showLoaderOverlay ? (
              <div className={`player-overlay${hasPlaybackStarted ? " is-buffering-only" : ""}`} aria-live="polite">
                <div className="player-overlay-icon">
                  <LoaderCircle size={22} className="player-spinner" />
                </div>
                {loadingStateText ? <div className="player-overlay-text">{loadingStateText}</div> : null}
                {isPreparingPlayback ? (
                  <button
                    type="button"
                    className="player-cancel-btn"
                    onClick={cancelPlayback}
                    aria-label="Cancelar carga"
                  >
                    <XCircle size={16} />
                    <span>Cancelar</span>
                  </button>
                ) : null}
              </div>
            ) : null}

            {!hasPlaybackStarted && !showLoaderOverlay ? (
              <button
                type="button"
                className="player-start-cta"
                onClick={() => void handleStartPlayback()}
                aria-label="Iniciar reproduccion"
              >
                <span className="player-start-cta-icon">
                  <Play size={22} />
                </span>
                <span>Reproducir</span>
              </button>
            ) : null}
          </div>
        </section>

        <aside className="watch-info-panel">
          <div className="watch-block watch-block-quality">
            <div className="watch-block-title">
              <Gauge size={14} />
              <span>Calidad</span>
            </div>
            <div className="chip-row">
              <button
                type="button"
                onClick={() => void handleQualityClick("auto")}
                className={selectedQuality === "auto" && activeAlternativeIndex === -1 ? "is-active" : ""}
              >
                Auto
              </button>
              {availableQualities.length > 1 ? availableQualities.map((quality) => (
                <button
                  key={quality}
                  type="button"
                  onClick={() => void handleQualityClick(quality)}
                  className={selectedQuality === quality && activeAlternativeIndex === -1 ? "is-active" : ""}
                >
                  {qualityLabel(quality)}
                </button>
              )) : null}
            </div>

            {alternatives.length > 0 ? (
              <>
                <div className="watch-block-title" style={{ marginTop: 10 }}>
                  <span>Fuentes alternativas</span>
                </div>
                <div className="alt-source-list">
                  {alternatives.map((alt, idx) => (
                    <button
                      key={idx}
                      type="button"
                      className={`alt-source-item ${activeAlternativeIndex === idx ? "is-active" : ""}`}
                      onClick={() => void handlePlayAlternative(alt, idx)}
                    >
                      <span className="alt-source-quality">{qualityLabel(alt.selectedQuality)}</span>
                      <span className="alt-source-name">{alt.chosen.displayName}</span>
                      <span className="alt-source-meta">
                        {alt.streamKind === "direct" ? "Directo" : "HLS"}
                        {alt.chosen.seeders > 0 ? ` · ${alt.chosen.seeders}s` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            <p className="muted">
              {availableQualities.length > 1
                ? `Calidad actual: ${qualityLabel(selectedQuality)} | Opciones: ${availableQualities.map((item) => qualityLabel(item)).join(" | ")}`
                : `Calidad actual: ${qualityLabel(selectedQuality)}.`}
            </p>
          </div>

          <div className="watch-block watch-block-subtitles">
            <div className="watch-block-title">
              <Captions size={14} />
              <span>Subtitulos (solo espanol)</span>
            </div>
            <label className="season-select">
              <span>Seleccion</span>
              <select
                value={selectedSubtitleIndex}
                onChange={(event) => setSelectedSubtitleIndex(Number(event.target.value))}
              >
                <option value={-1}>Sin subtitulos</option>
                {subtitleTracks.map((item, index) => (
                  <option key={item.id} value={index}>
                    {`Opcion ${index + 1}`}
                  </option>
                ))}
              </select>
            </label>
            {rememberedSubtitleIndex >= 0 ? <p className="muted">Preferencia aprendida aplicada.</p> : null}
            {loadingSubtitles ? <p className="muted">Actualizando subtitulos...</p> : null}
          </div>

          <div className="watch-block watch-block-audio">
            <div className="watch-block-title">
              <Languages size={14} />
              <span>Audio</span>
            </div>
            <label className="season-select">
              <span>Audio preferido</span>
              <select
                value={audioPreference}
                onChange={(event) => handleAudioPreferenceChange(event.target.value as AudioPreference)}
              >
                <option value="original">Original + subtitulos</option>
                <option value="es">Espanol latino</option>
              </select>
            </label>
            {showMkvAudioTrackSelector ? (
              <label className="season-select">
                <span>Pista MKV</span>
                <select
                  value={selectedMkvAudioTrackIndex}
                  onChange={(event) => handleMkvAudioTrackChange(Number(event.target.value))}
                >
                  {mkvAudioTracks.map((track) => (
                    <option key={track.index} value={track.index}>
                      {track.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>

          {isSeries ? (
            <div className="watch-block watch-block-episodes">
              <div className="watch-block-title">
                <Clapperboard size={14} />
                <span>Temporadas y capitulos</span>
              </div>
              {seasonList.length ? (
                <label className="season-select">
                  <span>Temporada</span>
                  <select
                    value={season}
                    onChange={(event) => setSeason(Number(event.target.value || 1))}
                  >
                    {seasonList
                      .filter((item) => item.season > 0)
                      .map((item) => (
                        <option key={item.season} value={item.season}>
                          T{item.season} ({item.episodeCount} eps)
                        </option>
                      ))}
                  </select>
                </label>
              ) : (
                <div className="episode-fields">
                  <label>
                    Temporada
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={season}
                      onChange={(event) => setSeason(Number(event.target.value || 1))}
                    />
                  </label>
                  <label>
                    Episodio
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={episode}
                      onChange={(event) => setEpisode(Number(event.target.value || 1))}
                    />
                  </label>
                </div>
              )}

              {episodeList.length ? (
                <div className="episode-list">
                  {episodeList.map((item) => (
                    <button
                      key={`${item.season}-${item.episode}`}
                      type="button"
                      className={`episode-item ${item.episode === episode ? "is-active" : ""}`}
                      onClick={() => setEpisode(item.episode)}
                    >
                      {formatEpisodeLabel(item)}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">{loadingMeta ? "Cargando episodios..." : "Sin episodios detectados."}</p>
              )}
            </div>
          ) : null}

          <section className="watch-details-panel">
            <div className="watch-mini-media">
              {displayPoster ? <img src={displayPoster} alt={title} /> : <div className="media-card-placeholder">Sin imagen</div>}
            </div>

            <p className="watch-description">{displayDescription}</p>
            {displayGenres.length ? (
              <div className="watch-genre-row">
                {displayGenres.map((genre) => (
                  <span key={genre} className="watch-genre-chip">
                    {genre}
                  </span>
                ))}
              </div>
            ) : null}
            <p className="muted">
              Generos: {metaDetails?.info?.genres?.length ? metaDetails.info.genres.join(" | ") : "N/D"}
            </p>
            <p className="muted">
              Actores: {metaDetails?.info?.cast?.length ? metaDetails.info.cast.slice(0, 6).join(", ") : "N/D"}
            </p>
            <button
              type="button"
              className="secondary-btn"
              style={{ marginTop: 20, width: "100%" }}
              onClick={() => {
                window.scrollTo({ top: 0, behavior: "smooth" });
                goToZone("header");
              }}
            >
              Volver arriba
            </button>
          </section>

          {actionError ? <p className="muted watch-error">{actionError}</p> : null}
        </aside>
      </section>
    </main>
  );
}

