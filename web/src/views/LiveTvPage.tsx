import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  List,
  LoaderCircle,
  Maximize,
  Minimize,
  RefreshCw,
  Search,
  SkipBack,
  SkipForward,
  Tv2,
  X
} from "lucide-react";
import { fetchLiveTvCategories, fetchLiveTvChannels, reloadLiveTvChannels } from "../api";
import type { LiveTvCategoryItem, LiveTvChannelItem } from "../types";
import { useHlsPlayer } from "../hooks/useHlsPlayer";
import { useTvKeyboard } from "../hooks/useTvKeyboard";

type PlayerState = "idle" | "loading" | "playing" | "buffering" | "error";

const DESKTOP_QUERY = "(min-width: 1001px), (orientation: landscape) and (min-width: 1001px)";

function isTvEnvironment(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return (
    ua.includes("smart-tv") ||
    ua.includes("smarttv") ||
    ua.includes("tizen") ||
    ua.includes("webos") ||
    ua.includes("android tv") ||
    ua.includes("fire tv") ||
    ua.includes("crkey") ||
    ua.includes("bravia") ||
    window.matchMedia("(pointer: none)").matches ||
    window.matchMedia("(hover: none) and (pointer: coarse)").matches
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => !window.matchMedia(DESKTOP_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(DESKTOP_QUERY);
    const handler = (e: MediaQueryListEvent) => setIsMobile(!e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);
  return isMobile;
}

interface ChannelSidebarProps {
  categories: LiveTvCategoryItem[];
  activeCategory: string;
  setActiveCategory: (id: string) => void;
  channels: LiveTvChannelItem[];
  selectedChannelId: string;
  searchInput: string;
  setSearchInput: (v: string) => void;
  setSearchQuery: (v: string) => void;
  loading: boolean;
  reloading: boolean;
  error: string | null;
  channelCount: number;
  activeCategoryLabel: string;
  brokenLogoUrls: Set<string>;
  onSelectChannel: (channel: LiveTvChannelItem) => void;
  onReload: () => void;
  markLogoAsBroken: (url: string | null) => void;
  showClose?: boolean;
  onClose?: () => void;
}

function ChannelSidebar({
  categories,
  activeCategory,
  setActiveCategory,
  channels,
  selectedChannelId,
  searchInput,
  setSearchInput,
  setSearchQuery,
  loading,
  reloading,
  error,
  channelCount,
  activeCategoryLabel,
  brokenLogoUrls,
  onSelectChannel,
  onReload,
  markLogoAsBroken,
  showClose,
  onClose
}: ChannelSidebarProps) {
  return (
    <>
      <div className="live-tv-drawer-head">
        <div>
          <h2>Canales en vivo</h2>
          <p className="muted">
            {channelCount} canales | {activeCategoryLabel}
          </p>
        </div>
        {showClose && onClose ? (
          <button
            type="button"
            className="live-tv-close-btn"
            onClick={onClose}
            title="Cerrar panel"
          >
            <X size={17} />
          </button>
        ) : null}
      </div>

      <div className="header-search-v2 live-tv-search">
        <button type="button" className="search-icon-btn" aria-label="Buscar canales">
          <Search size={20} />
        </button>
        <input
          type="search"
          placeholder="Buscar canal, pais o categoria..."
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        {searchInput ? (
          <button
            type="button"
            className="search-clear-btn"
            onClick={() => {
              setSearchInput("");
              setSearchQuery("");
            }}
          >
            <X size={18} />
          </button>
        ) : null}
      </div>

      <div className="live-tv-drawer-top-actions">
        <button type="button" className="live-tv-overlay-btn" onClick={onReload} disabled={reloading}>
          <RefreshCw size={16} className={reloading ? "spin" : ""} />
          <span>{reloading ? "Actualizando" : "Recargar listas"}</span>
        </button>
      </div>

      <div className="live-tv-categories">
        <button
          type="button"
          className={`live-tv-category ${activeCategory === "all" ? "is-active" : ""}`}
          onClick={() => setActiveCategory("all")}
        >
          Todos
        </button>
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={`live-tv-category ${activeCategory === category.id ? "is-active" : ""}`}
            onClick={() => setActiveCategory(category.id)}
          >
            <span>{category.name}</span>
            <small>{category.count}</small>
          </button>
        ))}
      </div>

      <div className="live-tv-channel-list">
        {loading ? (
          <p className="muted">Cargando canales...</p>
        ) : channels.length ? (
          channels.map((channel) => (
            <button
              key={channel.id}
              type="button"
              className={`live-tv-channel ${channel.id === selectedChannelId ? "is-active" : ""}`}
              onClick={() => onSelectChannel(channel)}
            >
              <div className="live-tv-channel-logo">
                {channel.logo && !brokenLogoUrls.has(channel.logo) ? (
                  <img
                    src={channel.logo}
                    alt={channel.name}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() => markLogoAsBroken(channel.logo)}
                  />
                ) : (
                  <Tv2 size={16} />
                )}
              </div>
              <div className="live-tv-channel-meta">
                <strong title={channel.name}>{channel.name}</strong>
                <span>{channel.category.name}</span>
              </div>
              <div className="live-tv-channel-active-dot" />
            </button>
          ))
        ) : (
          <p className="muted">No hay canales para el filtro actual.</p>
        )}
      </div>

      {error ? <p className="watch-error">{error}</p> : null}
    </>
  );
}

export function LiveTvPage() {
  const [categories, setCategories] = useState<LiveTvCategoryItem[]>([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [channels, setChannels] = useState<LiveTvChannelItem[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChannelPanel, setShowChannelPanel] = useState(false);
  const [brokenLogoUrls, setBrokenLogoUrls] = useState<Set<string>>(new Set());
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMobile = useIsMobile();
  const isTV = useMemo(() => isTvEnvironment(), []);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const channelsLoadSeqRef = useRef(0);
  const playbackAttemptSeqRef = useRef(0);
  const lastPlaybackKeyRef = useRef("");
  const selectedChannelIdRef = useRef("");
  const channelFailureCountRef = useRef<Map<string, number>>(new Map());
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_RECONNECT_ATTEMPTS = 5;
  const [transcodeOverrides, setTranscodeOverrides] = useState<Set<string>>(new Set());
  const channelsById = useMemo(() => new Map(channels.map((channel) => [channel.id, channel])), [channels]);
  useEffect(() => {
    selectedChannelIdRef.current = selectedChannelId;
  }, [selectedChannelId]);

  // Auto-scroll to active channel when changed via keyboard
  const keyboardNavigatedRef = useRef(false);
  useEffect(() => {
    if (!keyboardNavigatedRef.current) return;
    keyboardNavigatedRef.current = false;
    requestAnimationFrame(() => {
      const active = document.querySelector(".live-tv-channel.is-active");
      active?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [selectedChannelId]);

  const markChannelFailure = useCallback(() => {
    const channelId = selectedChannelIdRef.current;
    if (!channelId) return;
    const failedChannel = channelsById.get(channelId);
    const currentCount = channelFailureCountRef.current.get(channelId) || 0;
    const nextCount = currentCount + 1;
    channelFailureCountRef.current.set(channelId, nextCount);

    if (!failedChannel) {
      return;
    }
    const canTranscode = /^https?:\/\//i.test(String(failedChannel.streamUrl || ""));
    if (!failedChannel.webPlayable || !canTranscode) {
      return;
    }
    if (nextCount < 1) {
      return;
    }

    setTranscodeOverrides((prev) => {
      if (prev.has(channelId)) return prev;
      const next = new Set(prev);
      next.add(channelId);
      return next;
    });
  }, [channelsById]);

  const onRuntimeFailure = useCallback((reason: string) => {
    markChannelFailure();
    setPlayerState("error");
    setError(reason || "No se pudo recuperar la reproduccion en vivo.");
  }, [markChannelFailure]);
  const { attachVideoSource, isBuffering, destroyHls } = useHlsPlayer({
    activeSessionIdRef,
    onRuntimeFailure
  });

  const loadCategories = useCallback(async () => {
    try {
      const payload = await fetchLiveTvCategories();
      setCategories(payload.categories || []);
    } catch {
      setCategories([]);
    }
  }, []);

  const loadChannels = useCallback(async () => {
    const seq = ++channelsLoadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchLiveTvChannels({
        category: activeCategory === "all" ? "" : activeCategory,
        query: searchQuery,
        webOnly: true,
        limit: 1200
      });
      if (seq !== channelsLoadSeqRef.current) return;
      const nextItems = payload.items || [];
      setChannels(nextItems);
      setSelectedChannelId((current) => {
        if (!nextItems.length) return "";
        if (nextItems.some((item) => item.id === current)) return current;
        return nextItems[0].id;
      });
    } catch (apiError) {
      if (seq !== channelsLoadSeqRef.current) return;
      setChannels([]);
      setSelectedChannelId("");
      setPlayerState("idle");
      setError(apiError instanceof Error ? apiError.message : "No se pudieron cargar canales.");
    } finally {
      if (seq === channelsLoadSeqRef.current) {
        setLoading(false);
      }
    }
  }, [activeCategory, searchQuery]);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    void loadChannels();
  }, [loadChannels]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 320);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [searchInput]);

  const selectedChannel = useMemo(
    () => channels.find((item) => item.id === selectedChannelId) || null,
    [channels, selectedChannelId]
  );
  const playbackTarget = useMemo(() => {
    if (!selectedChannel) return null;
    const streamUrl = String(selectedChannel.streamUrl || "");
    const looksLikeHls = /\.m3u8(?:$|\?)/i.test(streamUrl) || streamUrl.toLowerCase().includes("/hls");
    const requiresBackendTranscode = !selectedChannel.webPlayable || transcodeOverrides.has(selectedChannel.id);
    const forceHls = requiresBackendTranscode || looksLikeHls;
    const sourceUrl = requiresBackendTranscode
      ? `/api/live-tv/channels/${encodeURIComponent(selectedChannel.id)}/hls/index.m3u8`
      : looksLikeHls
        ? `/api/live-tv/channels/${encodeURIComponent(selectedChannel.id)}/proxy`
        : `/api/live-tv/channels/${encodeURIComponent(selectedChannel.id)}/stream`;
    return {
      channelId: selectedChannel.id,
      key: `${selectedChannel.id}|${sourceUrl}|${forceHls ? "hls" : "auto"}`,
      sourceUrl,
      forceHls
    };
  }, [selectedChannel, transcodeOverrides]);
  const channelCount = channels.length;
  const activeCategoryLabel = useMemo(() => {
    if (activeCategory === "all") return "Todos";
    return categories.find((category) => category.id === activeCategory)?.name || "Categoria";
  }, [activeCategory, categories]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackTarget) return;

    const playbackKey = playbackTarget.key;
    if (lastPlaybackKeyRef.current === playbackKey) {
      return;
    }
    lastPlaybackKeyRef.current = playbackKey;
    const attemptId = ++playbackAttemptSeqRef.current;
    let cancelled = false;
    setPlayerState("loading");
    setError(null);
    void (async () => {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();

        // Para URLs de transcode HLS, esperar a que el manifest esté listo
        // antes de pasárselo a HLS.js (el backend devuelve 503 mientras ffmpeg arranca)
        if (playbackTarget.sourceUrl.includes("/hls/")) {
          const pollStart = Date.now();
          let manifestReady = false;
          while (Date.now() - pollStart < 60000) {
            if (cancelled || attemptId !== playbackAttemptSeqRef.current) return;
            try {
              const probe = await fetch(playbackTarget.sourceUrl);
              if (probe.ok) { manifestReady = true; break; }
              if (probe.status !== 503) throw new Error("No se pudo preparar el transcode.");
            } catch (fetchErr) {
              if (cancelled || attemptId !== playbackAttemptSeqRef.current) return;
              throw fetchErr;
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
          if (cancelled || attemptId !== playbackAttemptSeqRef.current) return;
          if (!manifestReady) throw new Error("Timeout esperando transcode del canal.");
        }

        await attachVideoSource(video, playbackTarget.sourceUrl, { forceHls: playbackTarget.forceHls });
        if (cancelled || attemptId !== playbackAttemptSeqRef.current) return;
        await video.play().then(() => {
          if (!cancelled && attemptId === playbackAttemptSeqRef.current) {
            setPlayerState("playing");
          }
        }).catch(() => {
          // autoplay can be blocked by browser policy
        });
        channelFailureCountRef.current.delete(playbackTarget.channelId);
      } catch (runtimeError) {
        if (cancelled || attemptId !== playbackAttemptSeqRef.current) return;
        markChannelFailure();
        setPlayerState("error");
        setError(runtimeError instanceof Error ? runtimeError.message : "No se pudo cargar este canal.");
      }
    })();

    return () => {
      cancelled = true;
      destroyHls();
    };
  }, [attachVideoSource, destroyHls, markChannelFailure, playbackTarget]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    function onLoadStart() {
      setPlayerState("loading");
    }
    function onWaiting() {
      setPlayerState("buffering");
    }
    function onCanPlay() {
      setPlayerState("playing");
    }
    function onPlaying() {
      setPlayerState("playing");
    }
    function onStalled() {
      setPlayerState("buffering");
    }
    function onError() {
      if (!video || !video.src || video.src === window.location.href) return;
      setPlayerState("error");
    }

    video.addEventListener("loadstart", onLoadStart);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("canplay", onCanPlay);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("stalled", onStalled);
    video.addEventListener("error", onError);

    return () => {
      video.removeEventListener("loadstart", onLoadStart);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("canplay", onCanPlay);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("stalled", onStalled);
      video.removeEventListener("error", onError);
    };
  }, []);

  // Reset reconnect counter when channel changes
  useEffect(() => {
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, [selectedChannelId]);

  // Reset reconnect counter on successful playback
  useEffect(() => {
    if (playerState === "playing") {
      reconnectAttemptRef.current = 0;
    }
  }, [playerState]);

  // Auto-reconnect on error with exponential backoff
  useEffect(() => {
    if (playerState !== "error" || !selectedChannel || !playbackTarget) return;
    const attempt = reconnectAttemptRef.current;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) return;

    const delayMs = Math.min(2000 * Math.pow(1.5, attempt), 15000);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) return;
      reconnectAttemptRef.current += 1;
      // Force re-attach by clearing the last key so the playback effect re-runs
      lastPlaybackKeyRef.current = "";
      setPlayerState("loading");
      setError(null);
    }, delayMs);

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [playerState, selectedChannel, playbackTarget]);

  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  // Controls auto-hide after 5s of inactivity
  const showControlsTemporarily = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      setControlsVisible(false);
    }, 5000);
  }, []);

  useEffect(() => {
    function onAnyInput() { showControlsTemporarily(); }
    window.addEventListener("keydown", onAnyInput);
    window.addEventListener("pointermove", onAnyInput);
    window.addEventListener("pointerdown", onAnyInput);
    return () => {
      window.removeEventListener("keydown", onAnyInput);
      window.removeEventListener("pointermove", onAnyInput);
      window.removeEventListener("pointerdown", onAnyInput);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [showControlsTemporarily]);

  // Auto-fullscreen on TV when playback starts
  useEffect(() => {
    if (isTV && selectedChannel && playerState === "playing" && !document.fullscreenElement) {
      playerShellRef.current?.requestFullscreen?.().catch(() => {});
    }
  }, [isTV, selectedChannel, playerState]);

  useEffect(() => {
    if (isBuffering && selectedChannel) {
      setPlayerState("buffering");
    }
  }, [isBuffering, selectedChannel]);

  async function handleReload() {
    setReloading(true);
    setError(null);
    try {
      await reloadLiveTvChannels();
      await loadCategories();
      await loadChannels();
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "No se pudieron recargar listas.");
    } finally {
      setReloading(false);
    }
  }

  async function handleToggleFullscreen() {
    const target = playerShellRef.current;
    if (!target) return;
    try {
      if (!document.fullscreenElement) {
        await target.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore denied fullscreen promise
    }
  }

  function handleSelectChannel(channel: LiveTvChannelItem) {
    setSelectedChannelId(channel.id);
    if (isMobile) setShowChannelPanel(false);
    // Auto-fullscreen en TV al seleccionar canal
    if (isTV || document.fullscreenElement) {
      requestAnimationFrame(() => {
        playerShellRef.current?.requestFullscreen?.().catch(() => {});
      });
    }
  }

  function markLogoAsBroken(logoUrl: string | null) {
    const clean = String(logoUrl || "").trim();
    if (!clean) return;
    setBrokenLogoUrls((prev) => {
      if (prev.has(clean)) return prev;
      const next = new Set(prev);
      next.add(clean);
      return next;
    });
  }

  // Keyboard / D-pad navigation
  const navigateChannel = useCallback((direction: -1 | 1) => {
    setSelectedChannelId((current) => {
      if (!channels.length) return current;
      const idx = channels.findIndex((ch) => ch.id === current);
      const nextIdx = idx === -1 ? 0 : Math.max(0, Math.min(channels.length - 1, idx + direction));
      keyboardNavigatedRef.current = true;
      return channels[nextIdx].id;
    });
  }, [channels]);

  const handleKeyBack = useCallback(() => {
    if (showChannelPanel) {
      setShowChannelPanel(false);
    } else if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {});
    }
  }, [showChannelPanel]);

  useTvKeyboard({
    onChannelUp: useCallback(() => navigateChannel(-1), [navigateChannel]),
    onChannelDown: useCallback(() => navigateChannel(1), [navigateChannel]),
    onSelect: useCallback(() => {}, []),
    onBack: handleKeyBack,
    onToggleFullscreen: useCallback(() => void handleToggleFullscreen(), [])
  });

  const sidebarProps: ChannelSidebarProps = {
    categories,
    activeCategory,
    setActiveCategory,
    channels,
    selectedChannelId,
    searchInput,
    setSearchInput,
    setSearchQuery,
    loading,
    reloading,
    error,
    channelCount,
    activeCategoryLabel,
    brokenLogoUrls,
    onSelectChannel: handleSelectChannel,
    onReload: () => void handleReload(),
    markLogoAsBroken
  };

  return (
    <main className="home-shell live-tv-shell">
      <header className="home-header is-scrolled">
        <div className="home-header-inner">
          <div className="home-header-left">
            <Link to="/" className="brand-logo" style={{ textDecoration: "none" }}>
              streams
            </Link>
            <nav className="home-nav">
              <Link to="/" className="nav-link">Inicio</Link>
              <Link to="/live-tv" className="nav-link is-active">TV en vivo</Link>
            </nav>
          </div>
          <div className="home-header-right">
            <button type="button" className="header-action-btn" onClick={() => void handleReload()} disabled={reloading} title="Recargar listas">
              <RefreshCw size={20} className={reloading ? "spin" : ""} />
            </button>
          </div>
        </div>
      </header>

      <div className="live-tv-header-spacer" />

      <section className="live-tv-theater-layout">
        <div className="live-tv-player-shell" ref={playerShellRef}>
          <video ref={videoRef} controls autoPlay playsInline className="video-player live-tv-video" />

          <div className={`live-tv-overlay-top ${controlsVisible ? "is-visible" : ""}`}>
            <div className="live-tv-current">
              {selectedChannel ? (
                <>
                  <h2>{selectedChannel.name}</h2>
                  <p className="muted">
                    {selectedChannel.category.name}
                    {selectedChannel.country ? ` | ${selectedChannel.country}` : ""}
                    {selectedChannel.language ? ` | ${selectedChannel.language}` : ""}
                  </p>
                </>
              ) : (
                <>
                  <h2>TV en vivo</h2>
                  <p className="muted">Selecciona un canal para comenzar.</p>
                </>
              )}
            </div>

            <div className="live-tv-overlay-actions">
              <button
                type="button"
                className="live-tv-overlay-btn"
                onClick={() => navigateChannel(-1)}
                title="Canal anterior"
              >
                <SkipBack size={16} />
              </button>
              <button
                type="button"
                className="live-tv-overlay-btn"
                onClick={() => navigateChannel(1)}
                title="Canal siguiente"
              >
                <SkipForward size={16} />
              </button>
              <button
                type="button"
                className="live-tv-overlay-btn has-label"
                onClick={() => setShowChannelPanel((v) => !v)}
                title={showChannelPanel ? "Cerrar canales" : "Abrir canales"}
              >
                <List size={16} />
                <span>Canales</span>
              </button>
              <button
                type="button"
                className="live-tv-overlay-btn"
                onClick={() => void handleToggleFullscreen()}
                title={isFullscreen ? "Salir de pantalla completa" : "Pantalla completa"}
              >
                {isFullscreen ? <Minimize size={16} /> : <Maximize size={16} />}
              </button>
            </div>
          </div>

          {selectedChannel ? (
            <div className={`live-tv-status-layer ${playerState === "playing" ? "is-hidden" : ""}`}>
              {playerState === "error" ? (
                reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS ? (
                  <>
                    <LoaderCircle size={22} className="player-spinner" />
                    <p>Reconectando... (intento {reconnectAttemptRef.current + 1}/{MAX_RECONNECT_ATTEMPTS})</p>
                  </>
                ) : (
                  <>
                    <AlertTriangle size={22} />
                    <p>Sin senal o canal no disponible.</p>
                  </>
                )
              ) : (
                <>
                  <LoaderCircle size={22} className="player-spinner" />
                  <p>{playerState === "buffering" ? "Buffering en curso..." : "Cargando senal en vivo..."}</p>
                </>
              )}
            </div>
          ) : (
            <div className="live-tv-status-layer">
              <Tv2 size={22} />
              <p>Elige un canal desde la lista.</p>
            </div>
          )}
        </div>
      </section>

      {/* Offcanvas de canales (desktop y mobile) */}
      <aside className={`live-tv-drawer ${showChannelPanel ? "is-open" : ""}`}>
        <ChannelSidebar
          {...sidebarProps}
          showClose
          onClose={() => setShowChannelPanel(false)}
        />
      </aside>

      {showChannelPanel ? (
        <button
          type="button"
          className="live-tv-drawer-backdrop"
          onClick={() => setShowChannelPanel(false)}
          aria-label="Cerrar panel de canales"
        />
      ) : null}
    </main>
  );
}
