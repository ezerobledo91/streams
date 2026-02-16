import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
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
import { fetchLiveTvCategories, fetchLiveTvChannels, reloadLiveTvChannels } from "../api";
import type { LiveTvCategoryItem, LiveTvChannelItem, ChannelGroup } from "../types";
import { useHlsPlayer } from "../hooks/useHlsPlayer";
import { getLiveTvFavoriteIds, toggleLiveTvFavorite } from "../lib/live-tv-favorites";
import { getLiveTvHiddenIds, hideLiveTvChannel } from "../lib/live-tv-hidden";
import { getChannelDisplayName, getLiveTvCustomNames, setLiveTvChannelName } from "../lib/live-tv-names";

type PlayerState = "idle" | "loading" | "playing" | "buffering" | "error";

const DESKTOP_QUERY = "(min-width: 1001px), (orientation: landscape) and (min-width: 1001px)";
const ADULT_PASSWORD = "12345";

function isAdultCategory(name: string): boolean {
  return name.trim().toLowerCase() === "adultos";
}

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

const SUFFIX_NUMERIC_REGEX = /^(.+?)\s+(\d+|HD|SD|FHD|Plus|\+)$/i;
const SUFFIX_ALT_REGEX = /\s*\(Alt(?:\s*\d+)?\)\s*$/i;

function getBaseName(name: string): string {
  // First strip "(Alt N)" or "(Alt)" suffix
  let cleaned = name.trim().replace(SUFFIX_ALT_REGEX, "").trim();
  // Then strip trailing numeric/quality suffixes like "2", "HD", "Plus"
  const match = cleaned.match(SUFFIX_NUMERIC_REGEX);
  if (match) cleaned = match[1].trim();
  return cleaned;
}

function groupChannelsByName(channels: LiveTvChannelItem[]): (ChannelGroup | LiveTvChannelItem)[] {
  const groupMap = new Map<string, LiveTvChannelItem[]>();
  const order: string[] = [];
  const customNames = getLiveTvCustomNames();

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
  showClose,
  onClose
}: ChannelSidebarProps) {
  // Separate normal and adult categories; adult goes last
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
              const primaryName = getChannelDisplayName(item.primary);
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
                    <button
                      type="button"
                      className="live-tv-group-badge"
                      onClick={() => onToggleGroup(item.baseName)}
                      title={expanded ? "Colapsar grupo" : `+${item.subChannels.length} variantes`}
                    >
                      {expanded ? <ChevronDown size={14} /> : <span>+{item.subChannels.length}</span>}
                    </button>
                  </div>
                  {expanded ? item.subChannels.map((sub) => {
                    const subIsFav = favoriteIds.has(sub.id);
                    const subName = getChannelDisplayName(sub);
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
                      </div>
                    );
                  }) : null}
                </div>
              );
            }
            // Single channel (no group)
            const channel = item;
            const chIsFav = favoriteIds.has(channel.id);
            const chName = getChannelDisplayName(channel);
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
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => getLiveTvFavoriteIds());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => getLiveTvHiddenIds());
  const [showHideModal, setShowHideModal] = useState(false);
  const hideModalChannelRef = useRef<LiveTvChannelItem | null>(null);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const renameModalChannelRef = useRef<LiveTvChannelItem | null>(null);

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
  // Canales que requieren transcode (proxy falló o codec no soportado)
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
      const fetchCategory = (activeCategory === "all" || activeCategory === "__favorites__") ? "" : activeCategory;
      const payload = await fetchLiveTvChannels({
        category: fetchCategory,
        query: searchQuery,
        webOnly: true,
        limit: 1200
      });
      if (seq !== channelsLoadSeqRef.current) return;
      const nextItems = payload.items || [];
      setChannels(nextItems);
      setSelectedChannelId((current) => {
        if (current) return current; // Mantener el canal actual si ya existe uno
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
  
  const currentDisplayName = useMemo(() => {
    if (!selectedChannel) return "TV en vivo";
    return getChannelDisplayName(selectedChannel);
  }, [selectedChannel]);

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
    if (activeCategory === "__favorites__") {
      return channels.filter((ch) => favoriteIds.has(ch.id) && !hiddenIds.has(ch.id));
    }
    return channels.filter((ch) => !hiddenIds.has(ch.id));
  }, [channels, hiddenIds, favoriteIds, activeCategory]);

  const channelCount = visibleChannels.length;
  const groupedChannels = useMemo(() => groupChannelsByName(visibleChannels), [visibleChannels]);

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
    toggleLiveTvFavorite(channel);
    setFavoriteIds(getLiveTvFavoriteIds());
  }, []);

  const handleRequestHideChannel = useCallback((channel: LiveTvChannelItem) => {
    hideModalChannelRef.current = channel;
    setShowHideModal(true);
  }, []);

  const handleConfirmHide = useCallback((reason: "no_funciona" | "no_interesa") => {
    const ch = hideModalChannelRef.current;
    if (ch) {
      hideLiveTvChannel(ch, reason);
      setHiddenIds(getLiveTvHiddenIds());
    }
    setShowHideModal(false);
    hideModalChannelRef.current = null;
  }, []);

  const handleRequestRenameChannel = useCallback((channel: LiveTvChannelItem) => {
    renameModalChannelRef.current = channel;
    setRenameInput(getChannelDisplayName(channel));
    setShowRenameModal(true);
  }, []);

  const handleRenameSubmit = useCallback(() => {
    const ch = renameModalChannelRef.current;
    if (ch) {
      setLiveTvChannelName(ch.id, renameInput);
      // Force refresh of names in UI
      setChannels([...channels]);
    }
    setShowRenameModal(false);
    renameModalChannelRef.current = null;
  }, [renameInput, channels]);

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

        // Para transcode HLS, esperar a que ffmpeg tenga el manifest listo (503 = en preparación)
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
        }).catch(() => {
          // autoplay can be blocked by browser policy
        });

        // Detectar streams sin video renderizable (ej: H.265/HEVC que el browser no decodifica)
        // El tiempo avanza y los segmentos bajan, pero videoWidth queda en 0.
        if (!cancelled && attemptId === playbackAttemptSeqRef.current && !transcodeChannels.has(playbackTarget.channelId)) {
          const videoCheckDelay = 2000;
          await new Promise((r) => setTimeout(r, videoCheckDelay));
          if (cancelled || attemptId !== playbackAttemptSeqRef.current) return;
          if (video.videoWidth === 0 && video.currentTime > 0) {
            // Pre-calentar transcode: disparar la petición para que ffmpeg arranque YA
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
      // Solo mostrar overlay de buffering si el stall dura más de 3 segundos
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

    // Si ya estamos en transcode (último recurso) y el canal ya falló varias veces, no insistir
    const channelId = selectedChannel.id;
    const isTranscoding = transcodeChannels.has(channelId);
    const failCount = channelFailureCountRef.current.get(channelId) || 0;
    if (isTranscoding && failCount >= 3) return;

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

  // Auto-fullscreen on TV when playback starts
  useEffect(() => {
    if (isTV && selectedChannel && playerState === "playing" && !document.fullscreenElement) {
      playerShellRef.current?.requestFullscreen?.().catch(() => {});
    }
  }, [isTV, selectedChannel, playerState]);

  // isBuffering de hls.js ya no fuerza el overlay directamente.
  // El overlay de buffering se maneja con el debounce de 3s en los eventos del video.

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


  // Keyboard / D-pad navigation
  const navigateChannel = useCallback((direction: -1 | 1) => {
    setSelectedChannelId((current) => {
      if (!visibleChannels.length) return current;
      const idx = visibleChannels.findIndex((ch) => ch.id === current);
      const nextIdx = idx === -1 ? 0 : Math.max(0, Math.min(visibleChannels.length - 1, idx + direction));
      keyboardNavigatedRef.current = true;
      return visibleChannels[nextIdx].id;
    });
  }, [visibleChannels]);

  // Zone-based D-pad navigation: player / overlay / drawer (with sub-zones: search, top-actions, categories, channels)
  const tvZoneRef = useRef<"player" | "overlay" | "drawer">("player");
  const overlayFocusIndexRef = useRef(2); // Default to List button
  const drawerSubZoneRef = useRef<"search" | "top-actions" | "categories" | "channels">("channels");
  const drawerFocusIndexRef = useRef(0);
  const categoryFocusIndexRef = useRef(0);

  const getDrawerChannels = useCallback((): HTMLElement[] => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".live-tv-drawer.is-open .live-tv-channel, .live-tv-drawer.is-open .live-tv-action-btn, .live-tv-drawer.is-open .live-tv-group-badge")
    );
  }, []);

  const getDrawerCategories = useCallback((): HTMLElement[] => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".live-tv-drawer.is-open .live-tv-category")
    );
  }, []);

  const getDrawerSearchInput = useCallback((): HTMLInputElement | null => {
    return document.querySelector<HTMLInputElement>(".live-tv-drawer.is-open .live-tv-search input");
  }, []);

  const getDrawerTopActions = useCallback((): HTMLElement[] => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".live-tv-drawer.is-open .live-tv-reload-btn, .live-tv-drawer.is-open .live-tv-close-btn")
    );
  }, []);

  const applyDrawerFocus = useCallback((subZone: "search" | "top-actions" | "categories" | "channels", index: number) => {
    const clearAllDrawerFocus = () => {
      document.querySelectorAll(".live-tv-drawer .tv-focused").forEach((el) => el.classList.remove("tv-focused"));
      const search = getDrawerSearchInput();
      if (search && document.activeElement === search) search.blur();
    };

    clearAllDrawerFocus();
    drawerSubZoneRef.current = subZone;
    
    if (subZone === "search") {
      const input = getDrawerSearchInput();
      if (input) { input.focus(); input.classList.add("tv-focused"); }
    } else if (subZone === "top-actions") {
      const items = getDrawerTopActions();
      if (!items.length) return;
      const clamped = Math.max(0, Math.min(items.length - 1, index));
      items[clamped].classList.add("tv-focused");
    } else if (subZone === "categories") {
      const items = getDrawerCategories();
      if (!items.length) return;
      const clamped = Math.max(0, Math.min(items.length - 1, index));
      categoryFocusIndexRef.current = clamped;
      items[clamped].classList.add("tv-focused");
      items[clamped].scrollIntoView({ block: "nearest", behavior: "smooth" });
    } else {
      const items = getDrawerChannels();
      if (!items.length) return;
      const clamped = Math.max(0, Math.min(items.length - 1, index));
      drawerFocusIndexRef.current = clamped;
      items[clamped].classList.add("tv-focused");
      items[clamped].scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [getDrawerSearchInput, getDrawerCategories, getDrawerChannels, getDrawerTopActions]);

  const getOverlayFocusables = useCallback((): HTMLElement[] => {
    return Array.from(
      document.querySelectorAll<HTMLElement>(".live-tv-overlay-actions .live-tv-overlay-btn")
    );
  }, []);

  const clearAllFocus = useCallback(() => {
    document.querySelectorAll(".tv-focused").forEach((el) => el.classList.remove("tv-focused"));
    document.querySelectorAll(".live-tv-drawer .tv-focused").forEach((el) => el.classList.remove("tv-focused"));
    // Blur search if it was focused
    const search = getDrawerSearchInput();
    if (search && document.activeElement === search) search.blur();
  }, [getDrawerSearchInput]);

  const applyOverlayFocus = useCallback((index: number) => {
    clearAllFocus();
    const items = getOverlayFocusables();
    if (!items.length) return;
    const clamped = Math.max(0, Math.min(items.length - 1, index));
    overlayFocusIndexRef.current = clamped;
    items[clamped].classList.add("tv-focused");
    setControlsVisible(true);
  }, [clearAllFocus, getOverlayFocusables]);

  const enterDrawerZone = useCallback(() => {
    tvZoneRef.current = "drawer";
    setShowChannelPanel(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // Focus on the active channel in the list
        const items = getDrawerChannels();
        const activeIdx = items.findIndex((el: HTMLElement) => el.classList.contains("is-active"));
        const startIdx = activeIdx >= 0 ? activeIdx : 0;
        applyDrawerFocus("channels", startIdx);
      });
    });
  }, [getDrawerChannels, applyDrawerFocus]);

  const exitToPlayerZone = useCallback(() => {
    tvZoneRef.current = "player";
    clearAllFocus();
    if (isMobile) setShowChannelPanel(false);
  }, [clearAllFocus, isMobile]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      const tag = target?.tagName;

      // If search input is focused, let most keys through for typing
      const searchInput = getDrawerSearchInput();
      const isInSearch = searchInput && document.activeElement === searchInput;
      if (isInSearch) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          applyDrawerFocus("categories", 0);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          exitToPlayerZone();
          return;
        }
        // Backspace on empty search → exit to player
        if (e.key === "Backspace" && !searchInput.value) {
          e.preventDefault();
          exitToPlayerZone();
          return;
        }
        // Let all other keys pass to the input for typing
        return;
      }

      // Don't intercept other inputs
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const zone = tvZoneRef.current;

      // --- PLAYER zone ---
      if (zone === "player") {
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
          case "ArrowRight":
            e.preventDefault();
            enterDrawerZone();
            break;
          case "ArrowLeft":
            e.preventDefault();
            navigateChannel(-1);
            break;
          case "Enter":
          case " ": {
            e.preventDefault();
            tvZoneRef.current = "overlay";
            applyOverlayFocus(overlayFocusIndexRef.current);
            break;
          }
          case "f":
          case "F":
            e.preventDefault();
            void handleToggleFullscreen();
            break;
          case "Escape":
          case "Backspace":
            e.preventDefault();
            if (showChannelPanel) {
              setShowChannelPanel(false);
            } else if (document.fullscreenElement) {
              void document.exitFullscreen().catch(() => {});
            }
            break;
        }
        return;
      }

      // --- OVERLAY zone ---
      if (zone === "overlay") {
        const items = getOverlayFocusables();
        const idx = overlayFocusIndexRef.current;
        switch (e.key) {
          case "ArrowLeft":
            e.preventDefault();
            if (idx > 0) applyOverlayFocus(idx - 1);
            break;
          case "ArrowRight":
            e.preventDefault();
            if (idx < items.length - 1) applyOverlayFocus(idx + 1);
            else enterDrawerZone();
            break;
          case "ArrowUp":
          case "ArrowDown":
            e.preventDefault();
            tvZoneRef.current = "player";
            clearAllFocus();
            break;
          case "Enter":
          case " ":
            e.preventDefault();
            if (items[idx]) items[idx].click();
            break;
          case "Escape":
          case "Backspace":
            e.preventDefault();
            tvZoneRef.current = "player";
            clearAllFocus();
            break;
        }
        return;
      }

      // --- DRAWER zone ---
      const subZone = drawerSubZoneRef.current;

      if (subZone === "top-actions") {
        const actions = getDrawerTopActions();
        const idx = document.querySelector(".live-tv-reload-btn.tv-focused") ? 0 : 1;
        switch (e.key) {
          case "ArrowRight":
            e.preventDefault();
            if (idx === 0) applyDrawerFocus("top-actions", 1);
            break;
          case "ArrowLeft":
            e.preventDefault();
            if (idx === 1) applyDrawerFocus("top-actions", 0);
            else exitToPlayerZone();
            break;
          case "ArrowDown":
            e.preventDefault();
            applyDrawerFocus("search", 0);
            break;
          case "Enter":
          case " ":
            e.preventDefault();
            actions[idx]?.click();
            break;
          case "Escape":
          case "Backspace":
            e.preventDefault();
            exitToPlayerZone();
            break;
        }
        return;
      }

      if (subZone === "search") {
        const searchInput = getDrawerSearchInput();
        const isInSearch = searchInput && document.activeElement === searchInput;
        if (isInSearch) {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            applyDrawerFocus("categories", 0);
            return;
          }
          if (e.key === "ArrowUp") {
            e.preventDefault();
            applyDrawerFocus("top-actions", 0);
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            exitToPlayerZone();
            return;
          }
          if (e.key === "Backspace" && !searchInput.value) {
            e.preventDefault();
            exitToPlayerZone();
            return;
          }
          return;
        }
      }

      if (subZone === "categories") {
        const cats = getDrawerCategories();
        const idx = categoryFocusIndexRef.current;
        switch (e.key) {
          case "ArrowRight":
            e.preventDefault();
            if (idx < cats.length - 1) applyDrawerFocus("categories", idx + 1);
            break;
          case "ArrowLeft":
            e.preventDefault();
            if (idx > 0) {
              applyDrawerFocus("categories", idx - 1);
            } else {
              exitToPlayerZone();
            }
            break;
          case "ArrowUp":
            e.preventDefault();
            applyDrawerFocus("search", 0);
            break;
          case "ArrowDown":
            e.preventDefault();
            applyDrawerFocus("channels", 0);
            break;
          case "Enter":
          case " ":
            e.preventDefault();
            if (cats[idx]) cats[idx].click();
            break;
          case "Escape":
          case "Backspace":
            e.preventDefault();
            exitToPlayerZone();
            break;
        }
        return;
      }

      // subZone === "channels"
      const channels = getDrawerChannels();
      const idx = drawerFocusIndexRef.current;
      switch (e.key) {
        case "ArrowDown":
        case "ChannelDown":
          e.preventDefault();
          // Intentar bajar a la siguiente fila (asumiendo que hay ~3 elementos por fila en promedio si hay acciones)
          // Pero es mejor ir al siguiente elemento enfocable directamente
          if (idx < channels.length - 1) {
            // Si el actual es un canal principal y el siguiente es una acción del mismo,
            // y el usuario pulsó abajo, quizás quiera ir al siguiente canal principal.
            let nextIdx = idx + 1;
            if (channels[idx].classList.contains("live-tv-channel") && !e.shiftKey) {
              // Buscar el siguiente elemento que sea "live-tv-channel" para un scroll más rápido
              for (let i = idx + 1; i < channels.length; i++) {
                if (channels[i].classList.contains("live-tv-channel")) {
                  nextIdx = i;
                  break;
                }
              }
            }
            applyDrawerFocus("channels", nextIdx);
          }
          break;
        case "ArrowUp":
        case "ChannelUp":
          e.preventDefault();
          if (idx > 0) {
            let prevIdx = idx - 1;
            if (channels[idx].classList.contains("live-tv-channel") && !e.shiftKey) {
              for (let i = idx - 1; i >= 0; i--) {
                if (channels[i].classList.contains("live-tv-channel")) {
                  prevIdx = i;
                  break;
                }
              }
            }
            applyDrawerFocus("channels", prevIdx);
          } else {
            applyDrawerFocus("categories", categoryFocusIndexRef.current);
          }
          break;
        case "ArrowRight":
          e.preventDefault();
          if (idx < channels.length - 1 && !channels[idx+1].classList.contains("live-tv-channel")) {
            applyDrawerFocus("channels", idx + 1);
          } else {
            // Tal vez abrir info o algo, por ahora nada
          }
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (idx > 0 && !channels[idx].classList.contains("live-tv-channel")) {
            applyDrawerFocus("channels", idx - 1);
          } else {
            exitToPlayerZone();
          }
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (channels[idx]) channels[idx].click();
          break;
        case "Escape":
        case "Backspace":
          e.preventDefault();
          exitToPlayerZone();
          break;
        case "f":
        case "F":
          e.preventDefault();
          void handleToggleFullscreen();
          break;
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigateChannel, enterDrawerZone, exitToPlayerZone, getDrawerChannels, getDrawerCategories, getDrawerSearchInput, applyDrawerFocus, showChannelPanel]);

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
    onRenameChannel: handleRequestRenameChannel
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
                  <h2>{currentDisplayName}</h2>
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
                Renombrar canal
              </h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                Introduce el nuevo nombre para <strong>{renameModalChannelRef.current.name}</strong>
              </p>
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
