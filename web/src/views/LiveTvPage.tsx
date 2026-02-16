import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ChevronDown,
  Edit2,
  EyeOff,
  Heart,
  List,
  Lock,
  LoaderCircle,
  Maximize,
  Minimize,
  RefreshCw,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Star,
  Tv2,
  X
} from "lucide-react";
import {
  fetchLiveTvCategories,
  fetchLiveTvChannels,
  reloadLiveTvChannels,
  fetchLiveTvPreferences,
  toggleLiveTvFavoriteApi,
  hideLiveTvChannelApi,
  setLiveTvChannelNameApi,
  setLiveTvChannelCategoryApi
} from "../api";
import type { LiveTvCategoryItem, LiveTvChannelItem, ChannelGroup } from "../types";
import { useHlsPlayer } from "../hooks/useHlsPlayer";

type PlayerState = "idle" | "loading" | "playing" | "buffering" | "error";

const ADULT_PASSWORD = "12345";

function isAdultCategory(name: string): boolean {
  return name.trim().toLowerCase() === "adultos";
}

const SUFFIX_NUMERIC_REGEX = /^(.+?)\s+(\d+|HD|SD|FHD|Plus|\+)$/i;
const SUFFIX_ALT_REGEX = /\s*\(Alt(?:\s*\d+)?\)\s*$/i;

function getBaseName(name: string): string {
  let cleaned = name.trim().replace(SUFFIX_ALT_REGEX, "").trim();
  const match = cleaned.match(SUFFIX_NUMERIC_REGEX);
  if (match) cleaned = match[1].trim();
  return cleaned;
}

function groupChannelsByName(channels: LiveTvChannelItem[], customNames: Record<string, string>): (ChannelGroup | LiveTvChannelItem)[] {
  const groupMap = new Map<string, LiveTvChannelItem[]>();
  const order: string[] = [];

  for (const ch of channels) {
    const displayName = customNames[ch.id] || ch.name;
    const base = getBaseName(displayName);
    const key = base.toLowerCase();
    if (!groupMap.has(key)) {
      groupMap.set(key, []);
      order.push(key);
    }
    groupMap.get(key)!.push(ch);
  }

  const result: (ChannelGroup | LiveTvChannelItem)[] = [];
  for (const key of order) {
    const items = groupMap.get(key)!;
    if (items.length >= 2) {
      const displayName = customNames[items[0].id] || items[0].name;
      result.push({
        baseName: getBaseName(displayName),
        primary: items[0],
        subChannels: items.slice(1)
      });
    } else {
      result.push(items[0]);
    }
  }
  return result;
}

function isChannelGroup(item: ChannelGroup | LiveTvChannelItem): item is ChannelGroup {
  return "primary" in item && "subChannels" in item;
}

interface ChannelSidebarProps {
  categories: LiveTvCategoryItem[];
  activeCategory: string;
  setActiveCategory: (id: string) => void;
  channels: LiveTvChannelItem[];
  groupedChannels: (ChannelGroup | LiveTvChannelItem)[];
  selectedChannelId: string;
  searchInput: string;
  setSearchInput: (v: string) => void;
  setSearchQuery: (v: string) => void;
  loading: boolean;
  reloading: boolean;
  error: string | null;
  channelCount: number;
  activeCategoryLabel: string;
  onSelectChannel: (channel: LiveTvChannelItem) => void;
  onReload: () => void;
  expandedGroups: Set<string>;
  onToggleGroup: (baseName: string) => void;
  adultUnlocked: boolean;
  onRequestAdultAccess: (categoryId: string) => void;
  favoriteIds: Set<string>;
  onToggleFavorite: (channel: LiveTvChannelItem) => void;
  onHideChannel: (channel: LiveTvChannelItem, reason: "no_funciona" | "no_interesa") => void;
  onRenameChannel: (channel: LiveTvChannelItem) => void;
  customNames: Record<string, string>;
  tvMode?: boolean;
  showClose?: boolean;
  onClose?: () => void;
}

function ChannelSidebar({
  categories,
  activeCategory,
  setActiveCategory,
  channels,
  groupedChannels,
  selectedChannelId,
  searchInput,
  setSearchInput,
  setSearchQuery,
  loading,
  reloading,
  error,
  channelCount,
  activeCategoryLabel,
  onSelectChannel,
  onReload,
  expandedGroups,
  onToggleGroup,
  adultUnlocked,
  onRequestAdultAccess,
  favoriteIds,
  onToggleFavorite,
  onHideChannel,
  onRenameChannel,
  customNames,
  tvMode,
  showClose,
  onClose
}: ChannelSidebarProps) {
  const normalCategories = categories.filter((c) => !isAdultCategory(c.name));
  const adultCategories = categories.filter((c) => isAdultCategory(c.name));
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
        <button type="button" className="live-tv-reload-btn" onClick={onReload} disabled={reloading} title="Recargar listas">
          <RefreshCw size={16} className={reloading ? "spin" : ""} />
        </button>
      </div>

      <div className="live-tv-categories">
        <button
          type="button"
          className={`live-tv-category live-tv-category-fav ${activeCategory === "__favorites__" ? "is-active" : ""}`}
          onClick={() => setActiveCategory("__favorites__")}
        >
          <Star size={12} />
          <span>Favoritos</span>
          {favoriteIds.size > 0 ? <small>{favoriteIds.size}</small> : null}
        </button>
        <button
          type="button"
          className={`live-tv-category ${activeCategory === "all" ? "is-active" : ""}`}
          onClick={() => setActiveCategory("all")}
        >
          Todos
        </button>
        {normalCategories.map((category) => (
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
        {adultCategories.map((category) => (
          <button
            key={category.id}
            type="button"
            className={`live-tv-category live-tv-category-hidden ${adultUnlocked && activeCategory === category.id ? "is-active" : ""}`}
            onClick={() => {
              if (adultUnlocked) {
                setActiveCategory(category.id);
              } else {
                onRequestAdultAccess(category.id);
              }
            }}
          >
            <Lock size={12} />
            <span>{adultUnlocked ? category.name : "Canal oculto"}</span>
            {adultUnlocked ? <small>{category.count}</small> : null}
          </button>
        ))}
      </div>

      <div className="live-tv-channel-list">
        {loading ? (
          <p className="muted">Cargando canales...</p>
        ) : channels.length ? (
          groupedChannels.map((item) => {
            if (isChannelGroup(item)) {
              const expanded = expandedGroups.has(item.baseName.toLowerCase());
              const primaryIsFav = favoriteIds.has(item.primary.id);
              const primaryName = customNames[item.primary.id] || item.primary.name;
              return (
                <div key={`group-${item.baseName}`} className={`live-tv-channel-group ${expanded ? "is-expanded" : ""}`}>
                  <div className="live-tv-channel-group-row">
                    <button
                      type="button"
                      className={`live-tv-channel ${item.primary.id === selectedChannelId ? "is-active" : ""}`}
                      onClick={() => onSelectChannel(item.primary)}
                    >
                      <div className="live-tv-channel-logo">
                        <Tv2 size={16} />
                      </div>
                      <div className="live-tv-channel-meta">
                        <strong title={primaryName}>{primaryName}</strong>
                        <span>{item.primary.category.name}</span>
                      </div>
                      <div className="live-tv-channel-active-dot" />
                    </button>
                    {!tvMode ? (
                      <div className="live-tv-channel-actions">
                        <button
                          type="button"
                          className={`live-tv-action-btn ${primaryIsFav ? "is-fav" : ""}`}
                          onClick={(e) => { e.stopPropagation(); onToggleFavorite(item.primary); }}
                          title={primaryIsFav ? "Quitar de favoritos" : "Agregar a favoritos"}
                        >
                          <Heart size={13} />
                        </button>
                        <button
                          type="button"
                          className="live-tv-action-btn"
                          onClick={(e) => { e.stopPropagation(); onRenameChannel(item.primary); }}
                          title="Renombrar canal"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          type="button"
                          className="live-tv-action-btn live-tv-action-hide"
                          onClick={(e) => { e.stopPropagation(); onHideChannel(item.primary, "no_funciona"); }}
                          title="Ocultar canal"
                        >
                          <EyeOff size={13} />
                        </button>
                      </div>
                    ) : null}
                    {!tvMode ? (
                    <button
                      type="button"
                      className="live-tv-group-badge"
                      onClick={() => onToggleGroup(item.baseName)}
                      title={expanded ? "Colapsar grupo" : `+${item.subChannels.length} variantes`}
                    >
                      {expanded ? <ChevronDown size={14} /> : <span>+{item.subChannels.length}</span>}
                    </button>
                    ) : null}
                  </div>
                  {expanded ? item.subChannels.map((sub) => {
                    const subIsFav = favoriteIds.has(sub.id);
                    const subName = customNames[sub.id] || sub.name;
                    return (
                      <div key={sub.id} className="live-tv-subchannel-row">
                        <button
                          type="button"
                          className={`live-tv-channel live-tv-subchannel ${sub.id === selectedChannelId ? "is-active" : ""}`}
                          onClick={() => onSelectChannel(sub)}
                        >
                          <div className="live-tv-channel-logo">
                            <Tv2 size={16} />
                          </div>
                          <div className="live-tv-channel-meta">
                            <strong title={subName}>{subName}</strong>
                            <span>{sub.category.name}</span>
                          </div>
                          <div className="live-tv-channel-active-dot" />
                        </button>
                        {!tvMode ? (
                          <div className="live-tv-channel-actions">
                            <button
                              type="button"
                              className={`live-tv-action-btn ${subIsFav ? "is-fav" : ""}`}
                              onClick={(e) => { e.stopPropagation(); onToggleFavorite(sub); }}
                              title={subIsFav ? "Quitar de favoritos" : "Agregar a favoritos"}
                            >
                              <Heart size={13} />
                            </button>
                            <button
                              type="button"
                              className="live-tv-action-btn"
                              onClick={(e) => { e.stopPropagation(); onRenameChannel(sub); }}
                              title="Renombrar canal"
                            >
                              <Edit2 size={13} />
                            </button>
                            <button
                              type="button"
                              className="live-tv-action-btn live-tv-action-hide"
                              onClick={(e) => { e.stopPropagation(); onHideChannel(sub, "no_funciona"); }}
                              title="Ocultar canal"
                            >
                              <EyeOff size={13} />
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  }) : null}
                </div>
              );
            }
            // Single channel (no group)
            const channel = item;
            const chIsFav = favoriteIds.has(channel.id);
            const chName = customNames[channel.id] || channel.name;
            return (
              <div key={channel.id} className="live-tv-channel-row">
                <button
                  type="button"
                  className={`live-tv-channel ${channel.id === selectedChannelId ? "is-active" : ""}`}
                  onClick={() => onSelectChannel(channel)}
                >
                  <div className="live-tv-channel-logo">
                    <Tv2 size={16} />
                  </div>
                  <div className="live-tv-channel-meta">
                    <strong title={chName}>{chName}</strong>
                    <span>{channel.category.name}</span>
                  </div>
                  <div className="live-tv-channel-active-dot" />
                </button>
                {!tvMode ? (
                  <div className="live-tv-channel-actions">
                    <button
                      type="button"
                      className={`live-tv-action-btn ${chIsFav ? "is-fav" : ""}`}
                      onClick={(e) => { e.stopPropagation(); onToggleFavorite(channel); }}
                      title={chIsFav ? "Quitar de favoritos" : "Agregar a favoritos"}
                    >
                      <Heart size={13} />
                    </button>
                    <button
                      type="button"
                      className="live-tv-action-btn"
                      onClick={(e) => { e.stopPropagation(); onRenameChannel(channel); }}
                      title="Renombrar canal"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      type="button"
                      className="live-tv-action-btn live-tv-action-hide"
                      onClick={(e) => { e.stopPropagation(); onHideChannel(channel, "no_funciona"); }}
                      title="Ocultar canal"
                    >
                      <EyeOff size={13} />
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })
        ) : (
          <p className="muted">No hay canales para el filtro actual.</p>
        )}
      </div>

      {error ? <p className="watch-error">{error}</p> : null}
    </>
  );
}

export function LiveTvPage() {
  const navigate = useNavigate();
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
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [adultUnlocked, setAdultUnlocked] = useState(false);
  const [showAdultPrompt, setShowAdultPrompt] = useState(false);
  const [adultPasswordInput, setAdultPasswordInput] = useState("");
  const [adultPasswordError, setAdultPasswordError] = useState(false);
  const pendingAdultCategoryRef = useRef<string>("");
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const [customCategories, setCustomCategories] = useState<Record<string, string>>({});
  const [showHideModal, setShowHideModal] = useState(false);
  const hideModalChannelRef = useRef<LiveTvChannelItem | null>(null);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [renameCategoryInput, setRenameCategoryInput] = useState("");
  const renameModalChannelRef = useRef<LiveTvChannelItem | null>(null);

  // OSD state
  const [osdVisible, setOsdVisible] = useState(false);
  const osdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load preferences from server on mount
  useEffect(() => {
    fetchLiveTvPreferences().then((prefs) => {
      setFavoriteIds(new Set(prefs.favorites));
      setHiddenIds(new Set(prefs.hidden));
      setCustomNames(prefs.customNames || {});
      setCustomCategories(prefs.customCategories || {});
    }).catch(() => {});
  }, []);

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
  const [transcodeChannels, setTranscodeChannels] = useState<Set<string>>(new Set());
  const QUALITY_OPTIONS = ["360p", "480p", "720p", "1080p"] as const;
  const [transcodeQuality, setTranscodeQuality] = useState(() => localStorage.getItem("streams_live_tv_quality") || "480p");
  const [forceTranscode, setForceTranscode] = useState(() => localStorage.getItem("streams_live_tv_force_transcode") === "true");
  const [showQualityMenu, setShowQualityMenu] = useState(false);
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
    if (!canTranscode) {
      return;
    }

    setTranscodeChannels((prev) => {
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
  const { attachVideoSource, destroyHls } = useHlsPlayer({
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
        category: "",
        query: searchQuery,
        webOnly: true,
        limit: 1200
      });
      if (seq !== channelsLoadSeqRef.current) return;
      const nextItems = payload.items || [];
      setChannels(nextItems);
      setSelectedChannelId((current) => {
        if (current) return current;
        if (!nextItems.length) return "";
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
  }, [searchQuery]);

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

  const currentDisplayName = useMemo(() => {
    if (!selectedChannel) return "TV en vivo";
    return customNames[selectedChannel.id] || selectedChannel.name;
  }, [selectedChannel, customNames]);

  const playbackTarget = useMemo(() => {
    if (!selectedChannel) return null;
    const channelId = selectedChannel.id;
    const streamUrl = String(selectedChannel.streamUrl || "");
    const looksLikeHls = /\.m3u8(?:$|\?)/i.test(streamUrl) || streamUrl.toLowerCase().includes("/hls");
    const canTranscode = /^https?:\/\//i.test(streamUrl);
    const needsTranscode = forceTranscode
      ? canTranscode
      : (transcodeChannels.has(channelId) || !selectedChannel.webPlayable);
    const encodedId = encodeURIComponent(channelId);

    let sourceUrl: string;
    let forceHls: boolean;

    if (needsTranscode) {
      sourceUrl = `/api/live-tv/channels/${encodedId}/hls/index.m3u8?quality=${transcodeQuality}`;
      forceHls = true;
    } else if (looksLikeHls) {
      sourceUrl = `/api/live-tv/channels/${encodedId}/proxy`;
      forceHls = true;
    } else {
      sourceUrl = `/api/live-tv/channels/${encodedId}/stream`;
      forceHls = false;
    }

    return {
      channelId,
      key: `${channelId}|${sourceUrl}`,
      sourceUrl,
      forceHls
    };
  }, [selectedChannel, transcodeChannels, transcodeQuality, forceTranscode]);

  // Filter out hidden channels and handle favorites virtual category
  const visibleChannels = useMemo(() => {
    const getEffectiveCategory = (ch: LiveTvChannelItem) => customCategories[ch.id] || ch.category?.id || "variado";

    let pool = channels;
    if (activeCategory === "__favorites__") {
      return pool.filter((ch) => favoriteIds.has(ch.id) && !hiddenIds.has(ch.id));
    }
    if (activeCategory && activeCategory !== "all") {
      pool = pool.filter((ch) => getEffectiveCategory(ch) === activeCategory);
    }
    return pool.filter((ch) => !hiddenIds.has(ch.id));
  }, [channels, hiddenIds, favoriteIds, activeCategory, customCategories]);

  const channelCount = visibleChannels.length;
  const groupedChannels = useMemo(() => groupChannelsByName(visibleChannels, customNames), [visibleChannels, customNames]);

  const handleToggleGroup = useCallback((baseName: string) => {
    const key = baseName.toLowerCase();
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleToggleFavorite = useCallback((channel: LiveTvChannelItem) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(channel.id)) next.delete(channel.id);
      else next.add(channel.id);
      return next;
    });
    toggleLiveTvFavoriteApi(channel.id).then((prefs) => {
      setFavoriteIds(new Set(prefs.favorites));
    }).catch(() => {});
  }, []);

  const handleRequestHideChannel = useCallback((channel: LiveTvChannelItem) => {
    hideModalChannelRef.current = channel;
    setShowHideModal(true);
  }, []);

  const handleConfirmHide = useCallback((_reason: "no_funciona" | "no_interesa") => {
    const ch = hideModalChannelRef.current;
    if (ch) {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.add(ch.id);
        return next;
      });
      hideLiveTvChannelApi(ch.id).then((prefs) => {
        setHiddenIds(new Set(prefs.hidden));
      }).catch(() => {});
    }
    setShowHideModal(false);
    hideModalChannelRef.current = null;
  }, []);

  const handleRequestRenameChannel = useCallback((channel: LiveTvChannelItem) => {
    renameModalChannelRef.current = channel;
    setRenameInput(customNames[channel.id] || channel.name);
    setRenameCategoryInput(customCategories[channel.id] || channel.category?.id || "");
    setShowRenameModal(true);
  }, [customNames, customCategories]);

  const handleRenameSubmit = useCallback(() => {
    const ch = renameModalChannelRef.current;
    if (ch) {
      setCustomNames((prev) => {
        const next = { ...prev };
        const trimmed = renameInput.trim();
        if (trimmed) next[ch.id] = trimmed;
        else delete next[ch.id];
        return next;
      });
      setLiveTvChannelNameApi(ch.id, renameInput).then((prefs) => {
        setCustomNames(prefs.customNames || {});
      }).catch(() => {});

      const catTrimmed = renameCategoryInput.trim();
      const originalCat = ch.category?.id || "";
      if (catTrimmed !== originalCat) {
        setCustomCategories((prev) => {
          const next = { ...prev };
          if (catTrimmed && catTrimmed !== originalCat) next[ch.id] = catTrimmed;
          else delete next[ch.id];
          return next;
        });
        setLiveTvChannelCategoryApi(ch.id, catTrimmed !== originalCat ? catTrimmed : "").then((prefs) => {
          setCustomCategories(prefs.customCategories || {});
        }).catch(() => {});
      }
    }
    setShowRenameModal(false);
    renameModalChannelRef.current = null;
  }, [renameInput, renameCategoryInput]);

  const handleRequestAdultAccess = useCallback((categoryId: string) => {
    pendingAdultCategoryRef.current = categoryId;
    setAdultPasswordInput("");
    setAdultPasswordError(false);
    setShowAdultPrompt(true);
  }, []);

  const handleAdultPasswordSubmit = useCallback(() => {
    if (adultPasswordInput === ADULT_PASSWORD) {
      setAdultUnlocked(true);
      setShowAdultPrompt(false);
      setAdultPasswordError(false);
      setActiveCategory(pendingAdultCategoryRef.current);
    } else {
      setAdultPasswordError(true);
    }
  }, [adultPasswordInput]);

  // Lock adult content when leaving the adult category
  useEffect(() => {
    if (!adultUnlocked) return;
    const isStillAdult = categories.some(
      (c) => isAdultCategory(c.name) && c.id === activeCategory
    );
    if (!isStillAdult) {
      setAdultUnlocked(false);
    }
  }, [activeCategory, adultUnlocked, categories]);

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

        if (playbackTarget.sourceUrl.includes("/hls/")) {
          const pollStart = Date.now();
          let manifestReady = false;
          while (Date.now() - pollStart < 60000) {
            if (cancelled || attemptId !== playbackAttemptSeqRef.current) return;
            try {
              const probe = await fetch(playbackTarget.sourceUrl, { method: "HEAD" });
              if (probe.ok) {
                manifestReady = true;
                break;
              }
              if (probe.status !== 503) throw new Error("No se pudo preparar el transcode.");
            } catch (fetchErr) {
              if (cancelled || attemptId !== playbackAttemptSeqRef.current) return;
              markChannelFailure();
              throw fetchErr;
            }
            await new Promise((r) => setTimeout(r, 2000));
          }
          if (cancelled || attemptId !== playbackAttemptSeqRef.current) return;
          if (!manifestReady) throw new Error("Timeout esperando transcode.");
        }

        await attachVideoSource(video, playbackTarget.sourceUrl, {
          forceHls: playbackTarget.forceHls,
          mode: "live"
        });
        if (cancelled || attemptId !== playbackAttemptSeqRef.current) return;
        await video.play().then(() => {
          if (!cancelled && attemptId === playbackAttemptSeqRef.current) {
            setPlayerState("playing");
          }
        }).catch(() => {});

        if (!cancelled && attemptId === playbackAttemptSeqRef.current && !transcodeChannels.has(playbackTarget.channelId)) {
          const videoCheckDelay = 2000;
          await new Promise((r) => setTimeout(r, videoCheckDelay));
          if (cancelled || attemptId !== playbackAttemptSeqRef.current) return;
          if (video.videoWidth === 0 && video.currentTime > 0) {
            const hlsUrl = `/api/live-tv/channels/${encodeURIComponent(playbackTarget.channelId)}/hls/index.m3u8`;
            fetch(hlsUrl).catch(() => {});
            markChannelFailure();
            destroyHls();
            video.pause();
            video.removeAttribute("src");
            video.load();
            lastPlaybackKeyRef.current = "";
            setPlayerState("loading");
            setError("Codec no soportado, cambiando a transcode...");
            return;
          }
        }

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
  }, [attachVideoSource, destroyHls, markChannelFailure, playbackTarget, transcodeChannels]);

  const bufferingOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const BUFFERING_OVERLAY_DELAY_MS = 3000;

    function clearBufferingTimer() {
      if (bufferingOverlayTimerRef.current) {
        clearTimeout(bufferingOverlayTimerRef.current);
        bufferingOverlayTimerRef.current = null;
      }
    }
    function scheduleBufferingOverlay() {
      if (bufferingOverlayTimerRef.current) return;
      bufferingOverlayTimerRef.current = setTimeout(() => {
        bufferingOverlayTimerRef.current = null;
        setPlayerState("buffering");
      }, BUFFERING_OVERLAY_DELAY_MS);
    }
    function onLoadStart() {
      clearBufferingTimer();
      setPlayerState("loading");
    }
    function onWaiting() {
      scheduleBufferingOverlay();
    }
    function onCanPlay() {
      clearBufferingTimer();
      setPlayerState("playing");
    }
    function onPlaying() {
      clearBufferingTimer();
      setPlayerState("playing");
    }
    function onStalled() {
      scheduleBufferingOverlay();
    }
    function onError() {
      clearBufferingTimer();
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
      clearBufferingTimer();
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

    const channelId = selectedChannel.id;
    const isTranscoding = transcodeChannels.has(channelId);
    const failCount = channelFailureCountRef.current.get(channelId) || 0;
    if (isTranscoding && failCount >= 3) return;

    const delayMs = Math.min(2000 * Math.pow(1.5, attempt), 15000);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (reconnectAttemptRef.current >= MAX_RECONNECT_ATTEMPTS) return;
      reconnectAttemptRef.current += 1;
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
  }, [playerState, selectedChannel, playbackTarget, transcodeChannels]);

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

  // OSD: show channel info temporarily
  const showOsd = useCallback(() => {
    setOsdVisible(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      setOsdVisible(false);
      osdTimerRef.current = null;
    }, 3000);
  }, []);

  // No necesitamos auto-fullscreen — el CSS ya hace 100dvh

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
    setShowChannelPanel(false);
    tvStateRef.current = "player";
    showOsd();
  }

  // Keyboard / D-pad navigation
  const navigateChannel = useCallback((direction: -1 | 1) => {
    setSelectedChannelId((current) => {
      if (!visibleChannels.length) return current;
      const idx = visibleChannels.findIndex((ch) => ch.id === current);
      const nextIdx = idx === -1 ? 0 : Math.max(0, Math.min(visibleChannels.length - 1, idx + direction));
      keyboardNavigatedRef.current = true;
      return visibleChannels[nextIdx].id;
    });
    showOsd();
  }, [visibleChannels, showOsd]);

  // Navigation: 3 states — "player", "overlay", "drawer"
  const tvStateRef = useRef<"player" | "overlay" | "drawer">("player");
  const overlayFocusIndexRef = useRef(0);
  const drawerFocusIndexRef = useRef(0);
  // Sub-zone within drawer: "categories", "channels", "actions"
  const drawerSubZoneRef = useRef<"categories" | "channels" | "actions">("channels");
  const categoryFocusIndexRef = useRef(0);
  // Track which channel row we're on when navigating actions
  const drawerActionIndexRef = useRef(0);

  const clearAllFocus = useCallback(() => {
    document.querySelectorAll(".tv-focused").forEach((el) => el.classList.remove("tv-focused"));
    const search = document.querySelector<HTMLInputElement>(".live-tv-drawer .live-tv-search input");
    if (search && document.activeElement === search) search.blur();
  }, []);

  // --- Overlay helpers ---
  const getOverlayButtons = useCallback((): HTMLElement[] => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".live-tv-overlay-actions .live-tv-overlay-btn, .live-tv-overlay-actions .live-tv-quality-wrapper .live-tv-overlay-btn")
    );
  }, []);

  const applyOverlayFocus = useCallback((index: number) => {
    clearAllFocus();
    const items = getOverlayButtons();
    if (!items.length) return;
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    overlayFocusIndexRef.current = clamped;
    items[clamped].classList.add("tv-focused");
    setControlsVisible(true);
  }, [clearAllFocus, getOverlayButtons]);

  const enterOverlay = useCallback(() => {
    tvStateRef.current = "overlay";
    showControlsTemporarily();
    requestAnimationFrame(() => {
      applyOverlayFocus(overlayFocusIndexRef.current);
    });
  }, [applyOverlayFocus, showControlsTemporarily]);

  // --- Drawer helpers ---
  const getDrawerChannelButtons = useCallback((): HTMLElement[] => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".live-tv-drawer.is-open .live-tv-channel")
    );
  }, []);

  const getDrawerCategories = useCallback((): HTMLElement[] => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".live-tv-drawer.is-open .live-tv-category")
    );
  }, []);

  // Get action buttons for the channel row at the given channel index
  const getChannelRowActions = useCallback((channelEl: HTMLElement): HTMLElement[] => {
    // The channel's row container is the parent (.live-tv-channel-row, .live-tv-channel-group-row, or .live-tv-subchannel-row)
    const row = channelEl.closest(".live-tv-channel-row, .live-tv-channel-group-row, .live-tv-subchannel-row");
    if (!row) return [];
    return Array.from(row.querySelectorAll<HTMLElement>(".live-tv-action-btn, .live-tv-group-badge"));
  }, []);

  const applyDrawerFocus = useCallback((el: HTMLElement) => {
    document.querySelectorAll(".live-tv-drawer .tv-focused").forEach((e) => e.classList.remove("tv-focused"));
    el.classList.add("tv-focused");
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  const applyDrawerChannelFocus = useCallback((index: number) => {
    const items = getDrawerChannelButtons();
    if (!items.length) return;
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    drawerFocusIndexRef.current = clamped;
    drawerSubZoneRef.current = "channels";
    applyDrawerFocus(items[clamped]);
  }, [getDrawerChannelButtons, applyDrawerFocus]);

  const applyDrawerCategoryFocus = useCallback((index: number) => {
    const items = getDrawerCategories();
    if (!items.length) return;
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    categoryFocusIndexRef.current = clamped;
    drawerSubZoneRef.current = "categories";
    applyDrawerFocus(items[clamped]);
  }, [getDrawerCategories, applyDrawerFocus]);

  const openDrawer = useCallback(() => {
    tvStateRef.current = "drawer";
    drawerSubZoneRef.current = "channels";
    setShowChannelPanel(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const items = getDrawerChannelButtons();
        const activeIdx = items.findIndex((el) => el.classList.contains("is-active"));
        applyDrawerChannelFocus(activeIdx >= 0 ? activeIdx : 0);
      });
    });
  }, [getDrawerChannelButtons, applyDrawerChannelFocus]);

  const closeDrawer = useCallback(() => {
    tvStateRef.current = "player";
    setShowChannelPanel(false);
    clearAllFocus();
  }, [clearAllFocus]);

  // Prevent native context menu (Fire TV Menu button triggers this)
  useEffect(() => {
    function onContextMenu(e: Event) {
      e.preventDefault();
    }
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  // Main keyboard handler — 3-state system: player / overlay / drawer
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target?.tagName;

      // If search input is focused in drawer, handle special keys only
      const searchEl = document.querySelector<HTMLInputElement>(".live-tv-drawer.is-open .live-tv-search input");
      const isInSearch = searchEl && document.activeElement === searchEl;
      if (isInSearch) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          searchEl.blur();
          applyDrawerCategoryFocus(0);
          return;
        }
        if (e.key === "Escape" || (e.key === "Backspace" && !searchEl.value)) {
          e.preventDefault();
          closeDrawer();
          return;
        }
        return;
      }

      // Don't intercept other input elements
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const state = tvStateRef.current;

      // ===== PLAYER state (default) =====
      if (state === "player") {
        switch (e.key) {
          case "ArrowUp":
          case "ChannelUp":
            e.preventDefault();
            navigateChannel(-1);
            break;
          case "ArrowDown":
          case "ChannelDown":
            e.preventDefault();
            navigateChannel(1);
            break;
          case "Enter":
          case " ":
            e.preventDefault();
            // Enter abre el overlay de controles
            enterOverlay();
            break;
          case "ArrowRight":
          case "ContextMenu":
            e.preventDefault();
            openDrawer();
            break;
          case "ArrowLeft":
            e.preventDefault();
            // En player, izquierda abre overlay (alternativa)
            enterOverlay();
            break;
          case "f":
          case "F":
            e.preventDefault();
            void handleToggleFullscreen();
            break;
          case "Escape":
          case "Backspace":
            e.preventDefault();
            if (showChannelPanel) {
              closeDrawer();
            } else if (document.fullscreenElement) {
              void document.exitFullscreen().catch(() => {});
            } else {
              navigate("/");
            }
            break;
        }
        return;
      }

      // ===== OVERLAY state (botones de acción del player) =====
      if (state === "overlay") {
        // Sub-state: quality menu open → navigate within it
        if (showQualityMenu) {
          const qOptions = Array.from(
            document.querySelectorAll<HTMLElement>(".live-tv-quality-menu .live-tv-quality-option")
          );
          const qFocused = qOptions.findIndex((el) => el.classList.contains("tv-focused"));
          switch (e.key) {
            case "ArrowUp":
              e.preventDefault();
              if (qFocused > 0) {
                qOptions.forEach((el) => el.classList.remove("tv-focused"));
                qOptions[qFocused - 1].classList.add("tv-focused");
              }
              break;
            case "ArrowDown":
              e.preventDefault();
              if (qFocused < qOptions.length - 1) {
                qOptions.forEach((el) => el.classList.remove("tv-focused"));
                qOptions[qFocused + 1].classList.add("tv-focused");
              }
              break;
            case "Enter":
            case " ":
              e.preventDefault();
              if (qFocused >= 0 && qOptions[qFocused]) qOptions[qFocused].click();
              break;
            case "Escape":
            case "Backspace":
            case "ArrowLeft":
            case "ArrowRight":
              e.preventDefault();
              setShowQualityMenu(false);
              qOptions.forEach((el) => el.classList.remove("tv-focused"));
              break;
          }
          return;
        }

        const items = getOverlayButtons();
        const idx = overlayFocusIndexRef.current;
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            if (idx > 0) applyOverlayFocus(idx - 1);
            break;
          case "ArrowRight":
            e.preventDefault();
            if (idx < items.length - 1) applyOverlayFocus(idx + 1);
            else openDrawer(); // último botón → abre drawer
            break;
          case "ArrowUp":
          case "ArrowDown":
            e.preventDefault();
            // Volver al player
            tvStateRef.current = "player";
            clearAllFocus();
            if (e.key === "ArrowUp") navigateChannel(-1);
            else navigateChannel(1);
            break;
          case "Enter":
          case " ":
            e.preventDefault();
            if (items[idx]) {
              items[idx].click();
              // Si abrió el quality menu, dar focus a la primera opción
              if (showQualityMenu === false) {
                requestAnimationFrame(() => {
                  const qOpts = document.querySelectorAll<HTMLElement>(".live-tv-quality-menu .live-tv-quality-option");
                  if (qOpts.length) {
                    qOpts.forEach((el) => el.classList.remove("tv-focused"));
                    qOpts[0].classList.add("tv-focused");
                  }
                });
              }
            }
            break;
          case "Escape":
          case "Backspace":
            e.preventDefault();
            tvStateRef.current = "player";
            clearAllFocus();
            break;
          case "ContextMenu":
            e.preventDefault();
            openDrawer();
            break;
        }
        return;
      }

      // ===== DRAWER state =====
      const subZone = drawerSubZoneRef.current;

      // --- Sub-zone: categories ---
      if (subZone === "categories") {
        const cats = getDrawerCategories();
        const idx = categoryFocusIndexRef.current;
        switch (e.key) {
          case "ArrowRight":
            e.preventDefault();
            if (idx < cats.length - 1) applyDrawerCategoryFocus(idx + 1);
            break;
          case "ArrowLeft":
            e.preventDefault();
            if (idx > 0) applyDrawerCategoryFocus(idx - 1);
            else closeDrawer();
            break;
          case "ArrowUp":
            e.preventDefault();
            // Ir a búsqueda
            clearAllFocus();
            drawerSubZoneRef.current = "channels"; // temporalmente para no quedar en limbo
            {
              const searchInput = document.querySelector<HTMLInputElement>(".live-tv-drawer.is-open .live-tv-search input");
              if (searchInput) { searchInput.focus(); searchInput.classList.add("tv-focused"); }
            }
            break;
          case "ArrowDown":
            e.preventDefault();
            applyDrawerChannelFocus(0);
            break;
          case "Enter":
          case " ":
            e.preventDefault();
            if (cats[idx]) cats[idx].click();
            break;
          case "Escape":
          case "Backspace":
          case "ContextMenu":
            e.preventDefault();
            closeDrawer();
            break;
        }
        return;
      }

      // --- Sub-zone: actions (fav, edit, hide, group badge) ---
      if (subZone === "actions") {
        const channels = getDrawerChannelButtons();
        const chEl = channels[drawerFocusIndexRef.current];
        const actions = chEl ? getChannelRowActions(chEl) : [];
        const aIdx = drawerActionIndexRef.current;
        switch (e.key) {
          case "ArrowRight":
            e.preventDefault();
            if (aIdx < actions.length - 1) {
              drawerActionIndexRef.current = aIdx + 1;
              clearAllFocus();
              actions[aIdx + 1].classList.add("tv-focused");
            }
            break;
          case "ArrowLeft":
            e.preventDefault();
            if (aIdx > 0) {
              drawerActionIndexRef.current = aIdx - 1;
              clearAllFocus();
              actions[aIdx - 1].classList.add("tv-focused");
            } else {
              // Volver al canal
              applyDrawerChannelFocus(drawerFocusIndexRef.current);
            }
            break;
          case "ArrowDown":
            e.preventDefault();
            // Ir al siguiente canal
            if (drawerFocusIndexRef.current < channels.length - 1) {
              applyDrawerChannelFocus(drawerFocusIndexRef.current + 1);
            }
            break;
          case "ArrowUp":
            e.preventDefault();
            // Ir al canal anterior
            if (drawerFocusIndexRef.current > 0) {
              applyDrawerChannelFocus(drawerFocusIndexRef.current - 1);
            } else {
              applyDrawerCategoryFocus(categoryFocusIndexRef.current);
            }
            break;
          case "Enter":
          case " ":
            e.preventDefault();
            if (actions[aIdx]) actions[aIdx].click();
            break;
          case "Escape":
          case "Backspace":
            e.preventDefault();
            // Volver al canal
            applyDrawerChannelFocus(drawerFocusIndexRef.current);
            break;
          case "ContextMenu":
            e.preventDefault();
            closeDrawer();
            break;
        }
        return;
      }

      // --- Sub-zone: channels (default drawer sub-zone) ---
      {
        const channels = getDrawerChannelButtons();
        const idx = drawerFocusIndexRef.current;
        switch (e.key) {
          case "ArrowDown":
          case "ChannelDown":
            e.preventDefault();
            if (idx < channels.length - 1) {
              applyDrawerChannelFocus(idx + 1);
            }
            break;
          case "ArrowUp":
          case "ChannelUp":
            e.preventDefault();
            if (idx > 0) {
              applyDrawerChannelFocus(idx - 1);
            } else {
              applyDrawerCategoryFocus(categoryFocusIndexRef.current);
            }
            break;
          case "ArrowRight": {
            e.preventDefault();
            // Ir a las acciones de este canal (fav, edit, hide, expand)
            const chEl = channels[idx];
            const actions = chEl ? getChannelRowActions(chEl) : [];
            if (actions.length > 0) {
              drawerSubZoneRef.current = "actions";
              drawerActionIndexRef.current = 0;
              clearAllFocus();
              actions[0].classList.add("tv-focused");
            }
            break;
          }
          case "ArrowLeft":
          case "Escape":
          case "Backspace":
            e.preventDefault();
            closeDrawer();
            break;
          case "Enter":
          case " ":
            e.preventDefault();
            if (channels[idx]) channels[idx].click();
            break;
          case "ContextMenu":
            e.preventDefault();
            closeDrawer();
            break;
          case "f":
          case "F":
            e.preventDefault();
            void handleToggleFullscreen();
            break;
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigateChannel, enterOverlay, openDrawer, closeDrawer, getOverlayButtons, applyOverlayFocus,
      getDrawerChannelButtons, applyDrawerChannelFocus, getDrawerCategories, applyDrawerCategoryFocus,
      getChannelRowActions, clearAllFocus, showChannelPanel, showOsd, showQualityMenu, navigate]);

  const sidebarProps: ChannelSidebarProps = {
    categories,
    activeCategory,
    setActiveCategory,
    channels: visibleChannels,
    groupedChannels,
    selectedChannelId,
    searchInput,
    setSearchInput,
    setSearchQuery,
    loading,
    reloading,
    error,
    channelCount,
    activeCategoryLabel,
    onSelectChannel: handleSelectChannel,
    onReload: () => void handleReload(),
    expandedGroups,
    onToggleGroup: handleToggleGroup,
    adultUnlocked,
    onRequestAdultAccess: handleRequestAdultAccess,
    favoriteIds,
    onToggleFavorite: handleToggleFavorite,
    onHideChannel: handleRequestHideChannel,
    onRenameChannel: handleRequestRenameChannel,
    customNames,
    tvMode: false
  };

  return (
    <main className="home-shell live-tv-shell">
      <section className="live-tv-theater-layout">
        <div className="live-tv-player-shell" ref={playerShellRef}>
          <video ref={videoRef} autoPlay playsInline className="video-player live-tv-video" />

          {/* Overlay inferior con botones de acción — visible al hover o actividad */}
          <div className={`live-tv-overlay-top ${controlsVisible ? "is-visible" : ""}`}>
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
                onClick={() => {
                  if (showChannelPanel) closeDrawer();
                  else openDrawer();
                }}
                title={showChannelPanel ? "Cerrar canales" : "Abrir canales"}
              >
                <List size={16} />
                <span>Canales</span>
              </button>
              <div className="live-tv-quality-wrapper">
                <button
                  type="button"
                  className="live-tv-overlay-btn has-label"
                  onClick={() => setShowQualityMenu((v) => !v)}
                  title="Calidad de video"
                >
                  <Settings size={16} />
                  <span>{(forceTranscode || transcodeChannels.has(selectedChannelId)) ? transcodeQuality : "Auto"}</span>
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
                      }}
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
                        }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
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

          {/* OSD tipo TV — se muestra al cambiar canal o presionar Enter */}
          <div className={`live-tv-osd ${osdVisible && selectedChannel ? "is-visible" : ""}`}>
            {selectedChannel ? (
              <>
                <h3>{currentDisplayName}</h3>
                <p>
                  {customCategories[selectedChannel.id]
                    ? (categories.find((c) => c.id === customCategories[selectedChannel.id])?.name || customCategories[selectedChannel.id])
                    : selectedChannel.category.name}
                  {selectedChannel.country ? ` | ${selectedChannel.country}` : ""}
                </p>
              </>
            ) : null}
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
          onClose={closeDrawer}
        />
      </aside>

      {showChannelPanel ? (
        <button
          type="button"
          className="live-tv-drawer-backdrop"
          onClick={closeDrawer}
          aria-label="Cerrar panel de canales"
        />
      ) : null}

      {showAdultPrompt ? (
        <div className="modal-backdrop" onClick={() => setShowAdultPrompt(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-form">
              <h3 style={{ margin: "0 0 4px", fontSize: 18 }}>
                <Lock size={16} style={{ marginRight: 8, verticalAlign: -2 }} />
                Contenido restringido
              </h3>
              <p className="muted" style={{ marginBottom: 8 }}>Ingresa la contraseña para acceder.</p>
              <input
                type="password"
                placeholder="Contraseña"
                value={adultPasswordInput}
                onChange={(e) => {
                  setAdultPasswordInput(e.target.value);
                  setAdultPasswordError(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdultPasswordSubmit();
                }}
                autoFocus
              />
              {adultPasswordError ? (
                <p className="watch-error" style={{ margin: 0, fontSize: 12 }}>Contraseña incorrecta.</p>
              ) : null}
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setShowAdultPrompt(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ borderColor: "var(--brand)", color: "var(--brand)" }}
                  onClick={handleAdultPasswordSubmit}
                >
                  Acceder
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showHideModal && hideModalChannelRef.current ? (
        <div className="modal-backdrop" onClick={() => setShowHideModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-form">
              <h3 style={{ margin: "0 0 4px", fontSize: 18 }}>
                <EyeOff size={16} style={{ marginRight: 8, verticalAlign: -2 }} />
                Ocultar canal
              </h3>
              <p className="muted" style={{ marginBottom: 4 }}>
                <strong>{hideModalChannelRef.current.name}</strong>
              </p>
              <p className="muted" style={{ marginBottom: 8 }}>
                Este canal no aparecera mas en la lista. Puedes restaurarlo desde las opciones.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ textAlign: "left" }}
                  onClick={() => handleConfirmHide("no_funciona")}
                >
                  No funciona / sin senal
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ textAlign: "left" }}
                  onClick={() => handleConfirmHide("no_interesa")}
                >
                  No me interesa
                </button>
              </div>
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setShowHideModal(false)}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showRenameModal && renameModalChannelRef.current ? (
        <div className="modal-backdrop" onClick={() => setShowRenameModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-form">
              <h3 style={{ margin: "0 0 4px", fontSize: 18 }}>
                <Edit2 size={16} style={{ marginRight: 8, verticalAlign: -2 }} />
                Editar canal
              </h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                Editando <strong>{renameModalChannelRef.current.name}</strong>
              </p>
              <label style={{ fontSize: 13, color: "var(--muted)", marginBottom: 2, display: "block" }}>Nombre</label>
              <input
                type="text"
                placeholder="Nombre del canal"
                value={renameInput}
                onChange={(e) => setRenameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameSubmit();
                }}
                autoFocus
              />
              <label style={{ fontSize: 13, color: "var(--muted)", marginTop: 10, marginBottom: 2, display: "block" }}>Categoría</label>
              <select
                value={renameCategoryInput}
                onChange={(e) => setRenameCategoryInput(e.target.value)}
                style={{ width: "100%", borderRadius: 8, fontSize: 14 }}
              >
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
                {!categories.some((c) => c.id === "adultos") && (
                  <option value="adultos">Adultos</option>
                )}
              </select>
              <div className="modal-actions">
                <button type="button" className="secondary-btn" onClick={() => setShowRenameModal(false)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="secondary-btn"
                  style={{ borderColor: "var(--brand)", color: "var(--brand)" }}
                  onClick={handleRenameSubmit}
                >
                  Guardar
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
