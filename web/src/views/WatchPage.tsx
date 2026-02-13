import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Captions,
  Clapperboard,
  Gauge,
  Languages,
  LoaderCircle,
  Play
} from "lucide-react";
import {
  fetchPlaybackPreflight,
  reportPlaybackMetric,
  destroyPlaybackSession,
  startAutoPlayback
} from "../api";
import { useAppStore } from "../store/AppStore";
import type { AutoPlaybackPayload, Category } from "../types";
import { getAudioPriorityOrder, normalizeLanguageCode, type AudioPreference } from "../lib/audio-preferences";
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
export function WatchPage() {
  const params = useParams<{ type: string; itemId: string }>();
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
  const [isPreflighting, setIsPreflighting] = useState(false);
  const [audioPreference, setAudioPreference] = useState<AudioPreference>("original");
  const [actionError, setActionError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const autoLoadKeyRef = useRef<string>("");
  const preferredSourceKeyRef = useRef<string>("");
  const runtimeFailureHandlerRef = useRef<(reason: string) => void>(() => {});
  const runtimeRecoveryInProgressRef = useRef(false);
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
  const audioPriority = useMemo(
    () => getAudioPriorityOrder(audioPreference, originalLanguageCode),
    [audioPreference, originalLanguageCode]
  );

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

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
  }, [activeSessionIdRef, destroyHls, resetPlaybackState, setSessionSubtitles]);

  useEffect(() => {
    return () => {
      beginPlaybackAttempt();
      void clearActivePlayback(true);
    };
  }, [beginPlaybackAttempt, clearActivePlayback]);

  useEffect(() => {
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
    };
  }, []);

  const playResolvedPayload = useCallback(
    async (payload: AutoPlaybackPayload, shouldAutoplay: boolean, playbackAttemptId: number) => {
      assertPlaybackAttemptActive(playbackAttemptId);
      if (!videoRef.current) {
        throw new Error("Video no disponible.");
      }

      const ttffStartedAt = performance.now();
      applyAutoPlaybackPayload(payload, setSessionSubtitles);
      await attachVideoSource(videoRef.current, payload.streamUrl);
      await waitForVideoReady(videoRef.current);
      assertPlaybackAttemptActive(playbackAttemptId);
      setPlayerReady(true);
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
      syncSelectedQuality
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

      try {
        const payload = await startAutoPlayback({
          type: streamsType,
          itemId: decodedItemId,
          season: isSeries ? season : undefined,
          episode: isSeries ? episode : undefined,
          quality,
          waitReadyMs: 22000,
          validationBudgetMs: 18000,
          probeTimeoutMs: 6000,
          maxCandidates: 18,
          preferredSourceKey: preferredSourceKeyRef.current || undefined
        });
        assertPlaybackAttemptActive(playbackAttemptId);
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
      clearActivePlayback,
      decodedItemId,
      episode,
      isSeries,
      playResolvedPayload,
      resetValidatedQualities,
      season,
      setSessionSubtitles,
      streamsType
    ]
  );

  const handleRuntimePlaybackFailure = useCallback(
    async (reason: string) => {
      if (runtimeRecoveryInProgressRef.current) return;
      runtimeRecoveryInProgressRef.current = true;
      try {
        const playbackAttemptId = beginPlaybackAttempt();
        await playWithBackendAuto("auto", true, playbackAttemptId);
        setActionError("La reproduccion se recupero automaticamente.");
      } catch {
        setActionError(reason || "No hay video disponible por el momento.");
      } finally {
        runtimeRecoveryInProgressRef.current = false;
      }
    },
    [beginPlaybackAttempt, playWithBackendAuto]
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
    try {
      const autoAttemptId = beginPlaybackAttempt();
      await playWithBackendAuto(selectedQuality || "auto", true, autoAttemptId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No hay video disponible por el momento.";
      setActionError(message);
    }
  }

  async function handleQualityClick(value: QualitySelection) {
    setSelectedQuality(value);
    setActionError(null);
    try {
      const autoAttemptId = beginPlaybackAttempt();
      await playWithBackendAuto(value, true, autoAttemptId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cambiar la calidad.";
      setActionError(message);
    }
  }

  useEffect(() => {
    const key = `${type}|${decodedItemId}|${season}|${episode}`;
    if (!decodedItemId) return;
    if (autoLoadKeyRef.current === key) return;
    autoLoadKeyRef.current = key;

    const playbackAttemptId = beginPlaybackAttempt();
    preferredSourceKeyRef.current = "";
    resetValidatedQualities();
    void clearActivePlayback(true);
    setActionError(null);
    setIsPreflighting(true);

    void (async () => {
      try {
        const preflight = await fetchPlaybackPreflight({
          type: streamsType,
          itemId: decodedItemId,
          season: isSeries ? season : undefined,
          episode: isSeries ? episode : undefined,
          quality: "auto",
          probeTimeoutMs: 4500,
          maxCandidates: 18,
          validationBudgetMs: 12000,
          warmupWaitMs: 12000,
          warmup: true
        });
        assertPlaybackAttemptActive(playbackAttemptId);
        applyValidatedQualities(preflight.availableQualities);
        if (preflight.selectedQuality) {
          syncSelectedQuality(preflight.selectedQuality);
        }
        preferredSourceKeyRef.current = preflight.preferredSourceKey || "";
        void reportPlaybackMetric({
          metric: "ttfq",
          status: "ok",
          valueMs: Number(preflight.metrics?.ttfqMs || 0),
          type: streamsType,
          itemId: decodedItemId
        }).catch(() => {
          // no-op
        });
      } catch {
        void reportPlaybackMetric({
          metric: "ttfq",
          status: "error",
          type: streamsType,
          itemId: decodedItemId
        }).catch(() => {
          // no-op
        });
        setActionError("No se pudieron precargar calidades. Puedes iniciar manualmente.");
      } finally {
        setIsPreflighting(false);
      }
    })().catch(() => {});
  }, [
    applyValidatedQualities,
    assertPlaybackAttemptActive,
    beginPlaybackAttempt,
    clearActivePlayback,
    decodedItemId,
    episode,
    isSeries,
    resetValidatedQualities,
    season,
    streamsType,
    syncSelectedQuality,
    type
  ]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onCanPlay = () => setIsBuffering(false);

    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("canplay", onCanPlay);

    return () => {
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("canplay", onCanPlay);
    };
  }, [hasPlaybackStarted]);

  const episodeList = metaDetails?.episodes || [];
  const seasonList = metaDetails?.seasons || [];
  const displayYear = metaDetails?.info?.year || selectedFromStore?.year || "s/a";
  const displayRuntime = Number(metaDetails?.info?.runtime || 0) > 0 ? `${metaDetails?.info?.runtime} min` : null;
  const displayGenres = metaDetails?.info?.genres?.length ? metaDetails.info.genres.slice(0, 4) : [];
  const displayPoster = metaDetails?.info?.poster || selectedFromStore?.poster || selectedFromStore?.background;
  const displayBackdrop = metaDetails?.info?.background || selectedFromStore?.background || displayPoster || null;
  const displayDescription = metaDetails?.info?.overview || selectedFromStore?.description || "Sin descripcion";
  const displayRating = metaDetails?.info?.rating ?? selectedFromStore?.rating;

  const showLoaderOverlay =
    isPreflighting || isPreparingPlayback || (hasPlaybackStarted && !playerReady) || (playerReady && isBuffering);
  const loadingStateText = isPreflighting
      ? "Obteniendo informacion del stream y calidades..."
      : isPreparingPlayback
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
      </header>

      <section className="watch-layout">
        <section className="watch-player-panel">
          <div className={`player-stage ${showLoaderOverlay ? "is-loading" : "is-ready"}`}>
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

            {showLoaderOverlay ? (
              <div className="player-overlay" aria-live="polite">
                <div className="player-overlay-icon">
                  <LoaderCircle size={22} className="player-spinner" />
                </div>
                {loadingStateText ? <div className="player-overlay-text">{loadingStateText}</div> : null}
              </div>
            ) : null}

            {!hasPlaybackStarted && !showLoaderOverlay ? (
              <button
                type="button"
                className="player-start-cta"
                onClick={() => void handleStartPlayback()}
                disabled={isPreparingPlayback}
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

          <div className="watch-block">
            <div className="watch-block-title">
              <Languages size={14} />
              <span>Audio</span>
            </div>
            <label className="season-select">
              <span>Audio preferido</span>
              <select
                value={audioPreference}
                onChange={(event) => setAudioPreference(event.target.value as AudioPreference)}
              >
                <option value="original">Original + subtitulos</option>
                <option value="es">Espanol latino</option>
              </select>
            </label>
            <p className="muted">
              Original detectado: {originalLanguageCode || "N/D"} | Prioridad activa: {audioPriority.join(" > ")}
            </p>
          </div>

          <div className="watch-block">
            <div className="watch-block-title">
              <Gauge size={14} />
              <span>Calidad</span>
            </div>
            <div className="chip-row">
              <button
                type="button"
                onClick={() => void handleQualityClick("auto")}
                disabled={isPreparingPlayback}
                className={selectedQuality === "auto" ? "is-active" : ""}
              >
                Auto
              </button>
              {availableQualities.length > 1 ? availableQualities.map((quality) => (
                <button
                  key={quality}
                  type="button"
                  onClick={() => void handleQualityClick(quality)}
                  disabled={isPreparingPlayback}
                  className={selectedQuality === quality ? "is-active" : ""}
                >
                  {qualityLabel(quality)}
                </button>
              )) : null}
            </div>
            <p className="muted">
              {availableQualities.length > 1
                ? `Calidad actual: ${qualityLabel(selectedQuality)} | Opciones: ${availableQualities.map((item) => qualityLabel(item)).join(" | ")}`
                : `Calidad actual: ${qualityLabel(selectedQuality)}.`}
            </p>
            {isPreflighting ? <p className="quality-status">Analizando calidad disponible...</p> : null}
          </div>

          <div className="watch-block">
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
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {rememberedSubtitleIndex >= 0 ? <p className="muted">Preferencia aprendida aplicada.</p> : null}
            {loadingSubtitles ? <p className="muted">Actualizando subtitulos...</p> : null}
          </div>

          {isSeries ? (
            <div className="watch-block">
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
                    disabled={isPreparingPlayback}
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
                      disabled={isPreparingPlayback}
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

          {actionError ? <p className="muted watch-error">{actionError}</p> : null}
        </aside>
      </section>
    </main>
  );
}

