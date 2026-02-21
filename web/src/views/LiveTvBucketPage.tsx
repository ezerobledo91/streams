import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, LoaderCircle, Search, Settings, Tv2 } from "lucide-react";
import { useHlsPlayer } from "../hooks/useHlsPlayer";
import { useGamepad } from "../hooks/useGamepad";
import type { LiveTvCategoryItem, LiveTvChannelItem, LiveTvCategoriesPayload, LiveTvChannelsPayload } from "../types";

type FetchCategories = () => Promise<LiveTvCategoriesPayload>;
type FetchChannels = (params: {
  category?: string;
  query?: string;
  page?: number;
  limit?: number;
  webOnly?: boolean;
}) => Promise<LiveTvChannelsPayload>;

interface LiveTvBucketPageProps {
  title: string;
  subtitle: string;
  apiPrefix: "/api/eventos" | "/api/247";
  fetchCategories: FetchCategories;
  fetchChannels: FetchChannels;
}

type PlayerState = "idle" | "loading" | "playing" | "error";
type TvScope = "channels" | "categories" | "controls" | "quality";

const QUALITY_OPTIONS = ["360p", "480p", "720p", "1080p"] as const;

export function LiveTvBucketPage({
  title,
  subtitle,
  apiPrefix,
  fetchCategories,
  fetchChannels
}: LiveTvBucketPageProps) {
  const navigate = useNavigate();
  useGamepad(true);
  const lastChannelStorageKey =
    apiPrefix === "/api/eventos" ? "streams_last_channel_eventos" : "streams_last_channel_247";
  const [categories, setCategories] = useState<LiveTvCategoryItem[]>([]);
  const [channels, setChannels] = useState<LiveTvChannelItem[]>([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(lastChannelStorageKey) || "";
  });
  const [loading, setLoading] = useState(false);
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [transcodeQuality, setTranscodeQuality] = useState(
    () => localStorage.getItem("streams_live_tv_quality") || "480p"
  );
  const [forceTranscode, setForceTranscode] = useState(
    () => localStorage.getItem("streams_live_tv_force_transcode") === "true"
  );
  const [showQualityMenu, setShowQualityMenu] = useState(false);

  const rootRef = useRef<HTMLElement | null>(null);
  const playerShellRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const lastPlaybackKeyRef = useRef("");
  const tvScopeRef = useRef<TvScope>("channels");
  const channelFocusIndexRef = useRef(0);
  const categoryFocusIndexRef = useRef(0);
  const controlsFocusIndexRef = useRef(0);
  const qualityFocusIndexRef = useRef(0);
  const { attachVideoSource, destroyHls, isBuffering } = useHlsPlayer({
    activeSessionIdRef,
    onRuntimeFailure: (reason) => {
      setError(reason || "No se pudo reproducir el canal.");
      setPlayerState("error");
    }
  });

  const clearFocused = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll(".tv-focused").forEach((item) => item.classList.remove("tv-focused"));
  }, []);

  const focusElement = useCallback((element: HTMLElement | null) => {
    if (!element) return;
    clearFocused();
    element.classList.add("tv-focused");
    element.focus({ preventScroll: false });
    element.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [clearFocused]);

  const getControlButtons = useCallback(
    () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>(".live-tv-overlay-actions .live-tv-overlay-btn") || []),
    []
  );
  const getCategoryButtons = useCallback(
    () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>(".live-tv-categories .live-tv-category") || []),
    []
  );
  const getChannelButtons = useCallback(
    () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>(".live-tv-channel-list .live-tv-channel") || []),
    []
  );
  const getQualityButtons = useCallback(
    () => Array.from(rootRef.current?.querySelectorAll<HTMLElement>(".live-tv-quality-menu .live-tv-quality-option") || []),
    []
  );

  const focusControl = useCallback((nextIndex: number) => {
    const controls = getControlButtons();
    if (!controls.length) return;
    const safe = Math.max(0, Math.min(controls.length - 1, nextIndex));
    controlsFocusIndexRef.current = safe;
    tvScopeRef.current = "controls";
    focusElement(controls[safe]);
  }, [focusElement, getControlButtons]);

  const focusCategory = useCallback((nextIndex: number) => {
    const categories = getCategoryButtons();
    if (!categories.length) return;
    const safe = Math.max(0, Math.min(categories.length - 1, nextIndex));
    categoryFocusIndexRef.current = safe;
    tvScopeRef.current = "categories";
    focusElement(categories[safe]);
  }, [focusElement, getCategoryButtons]);

  const focusChannel = useCallback((nextIndex: number) => {
    const channelButtons = getChannelButtons();
    if (!channelButtons.length) return;
    const safe = Math.max(0, Math.min(channelButtons.length - 1, nextIndex));
    channelFocusIndexRef.current = safe;
    tvScopeRef.current = "channels";
    focusElement(channelButtons[safe]);
  }, [focusElement, getChannelButtons]);

  const focusQuality = useCallback((nextIndex: number) => {
    const qualityButtons = getQualityButtons();
    if (!qualityButtons.length) return;
    const safe = Math.max(0, Math.min(qualityButtons.length - 1, nextIndex));
    qualityFocusIndexRef.current = safe;
    tvScopeRef.current = "quality";
    focusElement(qualityButtons[safe]);
  }, [focusElement, getQualityButtons]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    let cancelled = false;
    fetchCategories()
      .then((payload) => {
        if (cancelled) return;
        setCategories(payload.categories || []);
      })
      .catch(() => {
        if (cancelled) return;
        setCategories([]);
      });
    return () => {
      cancelled = true;
    };
  }, [fetchCategories]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchChannels({
      category: activeCategory === "all" ? undefined : activeCategory,
      query: searchQuery || undefined,
      page: 1,
      limit: 600,
      webOnly: true
    })
      .then((payload) => {
        if (cancelled) return;
        const next = payload.items || [];
        setChannels(next);
        setSelectedChannelId((current) => {
          if (current && next.some((item) => item.id === current)) return current;
          if (typeof window !== "undefined") {
            const stored = localStorage.getItem(lastChannelStorageKey) || "";
            if (stored && next.some((item) => item.id === stored)) return stored;
          }
          return next[0]?.id || "";
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const reason = err instanceof Error ? err.message : "No se pudieron cargar canales.";
        setChannels([]);
        setError(reason);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeCategory, fetchChannels, lastChannelStorageKey, searchQuery]);

  useEffect(() => {
    if (!selectedChannelId || typeof window === "undefined") return;
    localStorage.setItem(lastChannelStorageKey, selectedChannelId);
  }, [lastChannelStorageKey, selectedChannelId]);

  const selectedChannel = useMemo(
    () => channels.find((item) => item.id === selectedChannelId) || null,
    [channels, selectedChannelId]
  );

  useEffect(() => {
    const categoriesWithAll = ["all", ...categories.map((item) => item.id)];
    const activeIndex = Math.max(0, categoriesWithAll.indexOf(activeCategory));
    categoryFocusIndexRef.current = activeIndex;
  }, [activeCategory, categories]);

  useEffect(() => {
    const currentIndex = channels.findIndex((item) => item.id === selectedChannelId);
    if (currentIndex >= 0) {
      channelFocusIndexRef.current = currentIndex;
      return;
    }
    channelFocusIndexRef.current = 0;
  }, [channels, selectedChannelId]);

  useEffect(() => {
    if (showQualityMenu) {
      qualityFocusIndexRef.current = 0;
      requestAnimationFrame(() => focusQuality(qualityFocusIndexRef.current));
      return;
    }
    if (tvScopeRef.current === "quality") {
      requestAnimationFrame(() => focusControl(controlsFocusIndexRef.current));
    }
  }, [focusControl, focusQuality, showQualityMenu]);

  useEffect(() => {
    if (!channels.length || showQualityMenu) return;
    requestAnimationFrame(() => focusChannel(channelFocusIndexRef.current));
  }, [channels, focusChannel, showQualityMenu]);

  const playbackTarget = useMemo(() => {
    if (!selectedChannel) return null;
    const channelId = selectedChannel.id;
    const streamUrl = String(selectedChannel.streamUrl || "");
    const looksLikeHls = /\.m3u8(?:$|\?)/i.test(streamUrl) || streamUrl.toLowerCase().includes("/hls");
    const canUseProxy = /^https?:\/\//i.test(streamUrl);
    const encodedId = encodeURIComponent(channelId);

    if (forceTranscode && canUseProxy) {
      const qualityQuery = encodeURIComponent(transcodeQuality);
      return {
        key: `${channelId}|transcode|${transcodeQuality}`,
        sourceUrl: `${apiPrefix}/channels/${encodedId}/stream?mode=transcode&quality=${qualityQuery}`,
        forceHls: true
      };
    }

    if (canUseProxy) {
      return {
        key: `${channelId}|direct`,
        sourceUrl: `${apiPrefix}/channels/${encodedId}/stream?mode=direct`,
        forceHls: looksLikeHls
      };
    }

    return {
      key: `${channelId}|auto`,
      sourceUrl: `${apiPrefix}/channels/${encodedId}/stream`,
      forceHls: false
    };
  }, [apiPrefix, forceTranscode, selectedChannel, transcodeQuality]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackTarget) return;
    if (lastPlaybackKeyRef.current === playbackTarget.key) return;
    lastPlaybackKeyRef.current = playbackTarget.key;

    let cancelled = false;
    setPlayerState("loading");
    setError(null);

    void (async () => {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();

        if (playbackTarget.sourceUrl.includes("mode=transcode")) {
          const pollStart = Date.now();
          let manifestReady = false;
          while (Date.now() - pollStart < 60000) {
            if (cancelled) return;
            const probe = await fetch(playbackTarget.sourceUrl, { method: "HEAD" });
            if (probe.ok) {
              manifestReady = true;
              break;
            }
            if (probe.status !== 503) {
              throw new Error("No se pudo preparar el transcode.");
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
          if (!manifestReady) {
            throw new Error("Timeout esperando transcode.");
          }
        }

        await attachVideoSource(video, playbackTarget.sourceUrl, {
          forceHls: playbackTarget.forceHls,
          mode: "live"
        });
        if (cancelled) return;
        await video.play().catch(() => {});
        if (!cancelled) setPlayerState("playing");
      } catch (err: unknown) {
        if (cancelled) return;
        const reason = err instanceof Error ? err.message : "No se pudo reproducir el canal.";
        setError(reason);
        setPlayerState("error");
      }
    })();

    return () => {
      cancelled = true;
      destroyHls();
    };
  }, [attachVideoSource, destroyHls, playbackTarget]);

  useEffect(() => {
    return () => {
      destroyHls();
    };
  }, [destroyHls]);

  useEffect(() => {
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

    function handleKeyDown(event: KeyboardEvent) {
      const tag = (event.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (showQualityMenu || tvScopeRef.current === "quality") {
        switch (event.key) {
          case "ArrowUp":
            event.preventDefault();
            focusQuality(qualityFocusIndexRef.current - 1);
            return;
          case "ArrowDown":
            event.preventDefault();
            focusQuality(qualityFocusIndexRef.current + 1);
            return;
          case "Enter":
          case " ":
            event.preventDefault();
            getQualityButtons()[qualityFocusIndexRef.current]?.click();
            return;
          case "ArrowLeft":
          case "ArrowRight":
          case "Escape":
          case "Backspace":
            event.preventDefault();
            setShowQualityMenu(false);
            focusControl(controlsFocusIndexRef.current);
            return;
          default:
            return;
        }
      }

      switch (tvScopeRef.current) {
        case "controls": {
          switch (event.key) {
            case "ArrowLeft":
              event.preventDefault();
              focusControl(controlsFocusIndexRef.current - 1);
              return;
            case "ArrowRight":
              event.preventDefault();
              focusControl(controlsFocusIndexRef.current + 1);
              return;
            case "ArrowDown":
              event.preventDefault();
              focusCategory(categoryFocusIndexRef.current);
              return;
            case "ArrowUp":
              event.preventDefault();
              focusChannel(channelFocusIndexRef.current);
              return;
            case "Enter":
            case " ":
              event.preventDefault();
              getControlButtons()[controlsFocusIndexRef.current]?.click();
              return;
            case "Escape":
            case "Backspace":
              event.preventDefault();
              focusChannel(channelFocusIndexRef.current);
              return;
            case "f":
            case "F":
              event.preventDefault();
              void handleToggleFullscreen();
              return;
            default:
              return;
          }
        }
        case "categories": {
          switch (event.key) {
            case "ArrowLeft":
              event.preventDefault();
              focusCategory(categoryFocusIndexRef.current - 1);
              return;
            case "ArrowRight":
              event.preventDefault();
              focusCategory(categoryFocusIndexRef.current + 1);
              return;
            case "ArrowDown":
              event.preventDefault();
              focusChannel(channelFocusIndexRef.current);
              return;
            case "ArrowUp":
              event.preventDefault();
              focusControl(controlsFocusIndexRef.current);
              return;
            case "Enter":
            case " ":
              event.preventDefault();
              getCategoryButtons()[categoryFocusIndexRef.current]?.click();
              return;
            case "Escape":
            case "Backspace":
              event.preventDefault();
              focusChannel(channelFocusIndexRef.current);
              return;
            default:
              return;
          }
        }
        default: {
          switch (event.key) {
            case "ArrowDown":
            case "ChannelDown":
              event.preventDefault();
              focusChannel(channelFocusIndexRef.current + 1);
              return;
            case "ArrowUp":
            case "ChannelUp":
              event.preventDefault();
              focusChannel(channelFocusIndexRef.current - 1);
              return;
            case "ArrowLeft":
              event.preventDefault();
              focusCategory(categoryFocusIndexRef.current);
              return;
            case "ArrowRight":
              event.preventDefault();
              focusControl(controlsFocusIndexRef.current);
              return;
            case "Enter":
            case " ":
              event.preventDefault();
              getChannelButtons()[channelFocusIndexRef.current]?.click();
              return;
            case "Escape":
            case "Backspace":
              event.preventDefault();
              navigate("/live-tv");
              return;
            case "f":
            case "F":
              event.preventDefault();
              void handleToggleFullscreen();
              return;
            default:
              return;
          }
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearFocused();
    };
  }, [
    clearFocused,
    focusCategory,
    focusChannel,
    focusControl,
    focusQuality,
    getCategoryButtons,
    getChannelButtons,
    getControlButtons,
    getQualityButtons,
    navigate,
    showQualityMenu
  ]);

  return (
    <main ref={rootRef} className="home-shell live-tv-shell">
      <section className="live-tv-theater-layout">
        <div ref={playerShellRef} className="live-tv-player-shell">
          <video ref={videoRef} autoPlay playsInline className="video-player live-tv-video" />
          <div className="live-tv-overlay-top is-visible">
            <div className="live-tv-current">
              <h2>{selectedChannel?.name || title}</h2>
              <p className="muted">{selectedChannel?.category?.name || subtitle}</p>
            </div>
            <div className="live-tv-overlay-actions">
              <div className="live-tv-quality-wrapper">
                <button
                  type="button"
                  className="live-tv-overlay-btn has-label"
                  data-tv-focusable
                  data-tv-group="live-controls"
                  data-tv-action="toggle-quality"
                  onClick={() => {
                    controlsFocusIndexRef.current = 0;
                    tvScopeRef.current = "controls";
                    setShowQualityMenu((value) => !value);
                  }}
                  title="Transcode y calidad"
                >
                  <Settings size={16} />
                  <span>{forceTranscode ? transcodeQuality : "Auto"}</span>
                </button>
                {showQualityMenu ? (
                  <div className="live-tv-quality-menu">
                    <button
                      type="button"
                      className={`live-tv-quality-option live-tv-quality-toggle ${forceTranscode ? "is-active" : ""}`}
                      onClick={() => {
                        const next = !forceTranscode;
                        setForceTranscode(next);
                        localStorage.setItem("streams_live_tv_force_transcode", String(next));
                        lastPlaybackKeyRef.current = "";
                        setShowQualityMenu(false);
                        tvScopeRef.current = "controls";
                      }}
                      data-tv-focusable
                      data-tv-group="live-quality"
                      data-tv-action="toggle-transcode"
                    >
                      {forceTranscode ? "Transcode: ON" : "Transcode: OFF"}
                    </button>
                    <div className="live-tv-quality-divider" />
                    {QUALITY_OPTIONS.map((q) => (
                      <button
                        key={q}
                        type="button"
                        className={`live-tv-quality-option ${q === transcodeQuality ? "is-active" : ""}`}
                        onClick={() => {
                          if (q !== transcodeQuality) {
                            setTranscodeQuality(q);
                            localStorage.setItem("streams_live_tv_quality", q);
                            lastPlaybackKeyRef.current = "";
                          }
                          setShowQualityMenu(false);
                          tvScopeRef.current = "controls";
                        }}
                        data-tv-focusable
                        data-tv-group="live-quality"
                        data-tv-action={`quality-${q}`}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>
          {selectedChannel ? (
            <div className={`live-tv-status-layer ${playerState === "playing" && !isBuffering ? "is-hidden" : ""}`}>
              {playerState === "error" ? (
                <>
                  <AlertTriangle size={22} />
                  <p>{error || "Sin senal o canal no disponible."}</p>
                </>
              ) : (
                <>
                  <LoaderCircle size={22} className="player-spinner" />
                  <p>{isBuffering ? "Buffering en curso..." : "Cargando senal en vivo..."}</p>
                </>
              )}
            </div>
          ) : (
            <div className="live-tv-status-layer">
              <Tv2 size={22} />
              <p>Selecciona un canal del panel.</p>
            </div>
          )}
        </div>
      </section>

      <aside className="live-tv-drawer is-open" style={{ transform: "translateX(0)" }}>
        <div className="live-tv-drawer-head">
          <div>
            <h2>{title}</h2>
            <p className="muted">{channels.length} canales</p>
          </div>
        </div>

        <div className="header-search-v2 live-tv-search">
          <button type="button" className="search-icon-btn" aria-label="Buscar">
            <Search size={20} />
          </button>
          <input
            type="search"
            placeholder="Buscar por nombre o categoria..."
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
        </div>

        <div className="live-tv-categories">
          <button
            type="button"
            className={`live-tv-category ${activeCategory === "all" ? "is-active" : ""}`}
            onClick={() => {
              categoryFocusIndexRef.current = 0;
              tvScopeRef.current = "categories";
              setActiveCategory("all");
            }}
            data-tv-focusable
            data-tv-group="live-categories"
            data-tv-action="category-all"
          >
            Todos
          </button>
          {categories.map((category, index) => (
            <button
              key={category.id}
              type="button"
              className={`live-tv-category ${activeCategory === category.id ? "is-active" : ""}`}
              onClick={() => {
                categoryFocusIndexRef.current = index + 1;
                tvScopeRef.current = "categories";
                setActiveCategory(category.id);
              }}
              data-tv-focusable
              data-tv-group="live-categories"
              data-tv-action={`category-${category.id}`}
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
            channels.map((channel, index) => (
              <div key={channel.id} className="live-tv-channel-row">
                <button
                  type="button"
                  className={`live-tv-channel ${channel.id === selectedChannelId ? "is-active" : ""}`}
                  onClick={() => {
                    channelFocusIndexRef.current = index;
                    tvScopeRef.current = "channels";
                    setSelectedChannelId(channel.id);
                  }}
                  data-tv-focusable
                  data-tv-group="live-channels"
                  data-tv-action={`channel-${channel.id}`}
                >
                  <div className="live-tv-channel-logo">
                    <Tv2 size={16} />
                  </div>
                  <div className="live-tv-channel-meta">
                    <strong title={channel.name}>{channel.name}</strong>
                    <span>{channel.category.name}</span>
                  </div>
                  <div className="live-tv-channel-active-dot" />
                </button>
              </div>
            ))
          ) : (
            <p className="muted">No hay canales para este filtro.</p>
          )}
        </div>
      </aside>
    </main>
  );
}
