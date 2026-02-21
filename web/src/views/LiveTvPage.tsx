import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Download,
  Edit2,
  Eye,
  EyeOff,
  List,
  LoaderCircle,
  Lock,
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
  fetchLiveTvQualities,
  fetchLiveTvChannels,
  reloadLiveTvChannels,
  fetchLiveTvPreferences,
  toggleLiveTvFavoriteApi,
  hideLiveTvChannelApi,
  setLiveTvChannelNameApi,
  setLiveTvChannelCategoryApi,
  fetchActiveSource,
  setActiveSourceApi,
  refreshRemoteSourcesApi
} from "../api";
import type { LiveTvCategoryItem, LiveTvChannelItem, RemoteSourceStatus } from "../types";
import { useHlsPlayer } from "../hooks/useHlsPlayer";

type PlayerState = "idle" | "loading" | "playing" | "buffering" | "error";
type ActiveSource = "local" | "remote";
type TvScope = "player" | "selector";
type SelectorPane = "categories" | "channels" | "chan-actions";

const ADULT_PASSWORD = "12345";
const LAST_CHANNEL_STORAGE_KEY = "streams_last_channel_live_tv";
const DEFAULT_LIVE_TV_QUALITY_OPTIONS = ["360p", "480p", "720p", "1080p"];

function normalizeQualityOptions(input: string[]): string[] {
  const unique = Array.from(
    new Set(
      (Array.isArray(input) ? input : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
  if (!unique.length) return [...DEFAULT_LIVE_TV_QUALITY_OPTIONS];
  return unique.sort((a, b) => {
    const aNum = Number.parseInt(a, 10);
    const bNum = Number.parseInt(b, 10);
    if (Number.isFinite(aNum) && Number.isFinite(bNum)) return aNum - bNum;
    return a.localeCompare(b);
  });
}

function formatRelativeDate(iso: string): string {
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    const diffH = Math.floor(diffMs / 3600000);
    if (diffH < 1) return "hace menos de 1h";
    if (diffH < 24) return `hace ${diffH}h`;
    return `hace ${Math.floor(diffH / 24)}d`;
  } catch {
    return "";
  }
}

function isAdultCategory(name: string): boolean {
  return name.trim().toLowerCase() === "adultos";
}

export function LiveTvPage() {
  const navigate = useNavigate();

  // ── State ────────────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<LiveTvCategoryItem[]>([]);
  const [activeCategory, setActiveCategory] = useState("all");
  const [channels, setChannels] = useState<LiveTvChannelItem[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState(() => {
    if (typeof window === "undefined") return "";
    return localStorage.getItem(LAST_CHANNEL_STORAGE_KEY) || "";
  });
  const [searchInput, setSearchInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showChannelPanel, setShowChannelPanel] = useState(false);
  const [playerState, setPlayerState] = useState<PlayerState>("idle");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [adultUnlocked, setAdultUnlocked] = useState(false);
  const [showAdultPrompt, setShowAdultPrompt] = useState(false);
  const [adultPasswordInput, setAdultPasswordInput] = useState("");
  const [adultPasswordError, setAdultPasswordError] = useState(false);
  const pendingAdultCategoryRef = useRef<string>("");
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [customNames, setCustomNames] = useState<Record<string, string>>({});
  const [customCategories, setCustomCategories] = useState<Record<string, string>>({});
  const [activeSource, setActiveSource] = useState<ActiveSource>("local");
  const [remoteSources, setRemoteSources] = useState<RemoteSourceStatus[]>([]);
  const [changingSource, setChangingSource] = useState(false);
  const [refreshingRemote, setRefreshingRemote] = useState(false);

  // ── Modo edición + ocultador de categorías ────────────────────────────────
  const [editMode, setEditMode] = useState(false);
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState<Set<string>>(() => {
    try {
      const s = localStorage.getItem("streams_hidden_cat_ids");
      return s ? new Set(JSON.parse(s) as string[]) : new Set<string>();
    } catch { return new Set<string>(); }
  });
  const [showHiddenCats, setShowHiddenCats] = useState(false);

  const [showHideModal, setShowHideModal] = useState(false);
  const hideModalChannelRef = useRef<LiveTvChannelItem | null>(null);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameInput, setRenameInput] = useState("");
  const [renameCategoryInput, setRenameCategoryInput] = useState("");
  const renameModalChannelRef = useRef<LiveTvChannelItem | null>(null);

  const [osdVisible, setOsdVisible] = useState(false);
  const osdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Refs — player ─────────────────────────────────────────────────────────
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
  const [qualityOptions, setQualityOptions] = useState<string[]>(() => [...DEFAULT_LIVE_TV_QUALITY_OPTIONS]);
  const [transcodeQuality, setTranscodeQuality] = useState(() => localStorage.getItem("streams_live_tv_quality") || "720p");
  const [forceTranscode, setForceTranscode] = useState(() => localStorage.getItem("streams_live_tv_force_transcode") === "true");
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [directFallbackChannelIds, setDirectFallbackChannelIds] = useState<Set<string>>(new Set());
  const keyboardNavigatedRef = useRef(false);

  // ── Refs — TV navigation ──────────────────────────────────────────────────
  const tvScopeRef = useRef<TvScope>("player");
  const selectorPaneRef = useRef<SelectorPane>("channels");
  const catIndexRef = useRef(0);
  const chanIndexRef = useRef(0);
  const chanActionIndexRef = useRef(0);
  const editModeRef = useRef(false);
  const catPanelRef = useRef<HTMLDivElement | null>(null);
  const chanPanelRef = useRef<HTMLDivElement | null>(null);
  const activeCategoryRef = useRef("all");
  const searchQueryRef = useRef("");

  useEffect(() => { activeCategoryRef.current = activeCategory; }, [activeCategory]);
  useEffect(() => { selectedChannelIdRef.current = selectedChannelId; }, [selectedChannelId]);
  useEffect(() => { editModeRef.current = editMode; }, [editMode]);

  // ── Preferences ───────────────────────────────────────────────────────────
  useEffect(() => {
    fetchLiveTvPreferences().then((prefs) => {
      setFavoriteIds(new Set(prefs.favorites));
      setHiddenIds(new Set(prefs.hidden));
      setCustomNames(prefs.customNames || {});
      setCustomCategories(prefs.customCategories || {});
    }).catch(() => {});

    fetchActiveSource().then((data) => {
      setActiveSource((data.activeSource as ActiveSource) || "local");
      setRemoteSources(data.remoteSources || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLiveTvQualities().then((payload) => {
      if (cancelled) return;
      const normalized = normalizeQualityOptions(payload.qualities || []);
      const apiDefault = String(payload.default || "").trim();
      const fallback = normalized.includes(apiDefault)
        ? apiDefault
        : (normalized.includes("720p") ? "720p" : normalized[normalized.length - 1]);
      setQualityOptions(normalized);
      setTranscodeQuality((current) => {
        const currentValue = String(current || "").trim();
        const nextValue = normalized.includes(currentValue) ? currentValue : fallback;
        if (nextValue !== currentValue) {
          localStorage.setItem("streams_live_tv_quality", nextValue);
        }
        return nextValue;
      });
    }).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Player failures ───────────────────────────────────────────────────────
  const markChannelFailure = useCallback(() => {
    const channelId = selectedChannelIdRef.current;
    if (!channelId) return;
    const currentCount = channelFailureCountRef.current.get(channelId) || 0;
    channelFailureCountRef.current.set(channelId, currentCount + 1);
  }, []);

  const onRuntimeFailure = useCallback((reason: string) => {
    markChannelFailure();
    setPlayerState("error");
    setError(reason || "No se pudo recuperar la reproduccion en vivo.");
  }, [markChannelFailure]);

  const { attachVideoSource, destroyHls } = useHlsPlayer({
    activeSessionIdRef,
    onRuntimeFailure
  });

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadCategories = useCallback(async () => {
    try {
      const payload = await fetchLiveTvCategories();
      setCategories(payload.categories || []);
    } catch {
      setCategories([]);
    }
  }, []);

  const loadChannels = useCallback(async (categoryId: string = "all") => {
    const seq = ++channelsLoadSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const payload = await fetchLiveTvChannels({
        category: categoryId !== "all" && categoryId !== "__favorites__" ? categoryId : "",
        query: searchQueryRef.current,
        webOnly: true,
        limit: 500
      });
      if (seq !== channelsLoadSeqRef.current) return;
      const nextItems = payload.items || [];
      const availableIds = new Set(nextItems.map((item) => item.id));
      for (const id of [...channelFailureCountRef.current.keys()]) {
        if (!availableIds.has(id)) channelFailureCountRef.current.delete(id);
      }
      setDirectFallbackChannelIds((prev) => {
        let changed = false;
        const next = new Set<string>();
        for (const id of prev) {
          if (availableIds.has(id)) next.add(id);
          else changed = true;
        }
        return changed ? next : prev;
      });
      setChannels(nextItems);
      setSelectedChannelId((current) => {
        if (current && nextItems.some((item) => item.id === current)) return current;
        const stored = localStorage.getItem(LAST_CHANNEL_STORAGE_KEY) || "";
        if (stored && nextItems.some((item) => item.id === stored)) return stored;
        return nextItems[0]?.id || "";
      });
    } catch (apiError) {
      if (seq !== channelsLoadSeqRef.current) return;
      setChannels([]);
      setSelectedChannelId("");
      setPlayerState("idle");
      setError(apiError instanceof Error ? apiError.message : "No se pudieron cargar canales.");
    } finally {
      if (seq === channelsLoadSeqRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCategories();
    void loadChannels("all");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const trimmed = searchInput.trim();
      searchQueryRef.current = trimmed;
      void loadChannels(activeCategoryRef.current);
    }, 320);
    return () => window.clearTimeout(timeout);
  }, [searchInput, loadChannels]);

  useEffect(() => {
    if (!selectedChannelId) return;
    localStorage.setItem(LAST_CHANNEL_STORAGE_KEY, selectedChannelId);
  }, [selectedChannelId]);

  useEffect(() => {
    if (!forceTranscode) {
      setDirectFallbackChannelIds(new Set());
    }
  }, [forceTranscode]);

  useEffect(() => {
    if (!keyboardNavigatedRef.current) return;
    keyboardNavigatedRef.current = false;
    requestAnimationFrame(() => {
      document.querySelector(".live-tv-chan-item.is-active")
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [selectedChannelId]);

  // ── Derived state ─────────────────────────────────────────────────────────
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
    const looksLikeHls =
      /\.m3u8(?:$|\?)/i.test(streamUrl) ||
      /\/(?:hls|playlist|master|manifest)(?:$|[/?#])/i.test(streamUrl);
    const canTranscode = /^https?:\/\//i.test(streamUrl);
    const needsTranscode = canTranscode && forceTranscode;
    const encodedId = encodeURIComponent(channelId);

    let sourceUrl: string;
    let forceHls: boolean;
    let sourceMode: "direct" | "proxy" | "stream" | "hls";

    if (needsTranscode) {
      sourceUrl = `/api/live-tv/channels/${encodedId}/hls/index.m3u8?quality=${transcodeQuality}`;
      forceHls = true;
      sourceMode = "hls";
    } else if (canTranscode) {
      const canTryRealDirect = !directFallbackChannelIds.has(channelId);
      if (canTryRealDirect) {
        sourceUrl = streamUrl;
        forceHls = looksLikeHls;
        sourceMode = "direct";
      } else {
        sourceUrl = `/api/live-tv/channels/${encodedId}/proxy`;
        forceHls = looksLikeHls;
        sourceMode = "proxy";
      }
    } else {
      sourceUrl = `/api/live-tv/channels/${encodedId}/stream`;
      forceHls = false;
      sourceMode = "stream";
    }

    return { channelId, key: `${channelId}|${sourceUrl}`, sourceUrl, forceHls, sourceMode };
  }, [selectedChannel, transcodeQuality, forceTranscode, directFallbackChannelIds]);

  const visibleChannels = useMemo(() => {
    if (activeCategory === "__favorites__") {
      return channels.filter((ch) => favoriteIds.has(ch.id) && !hiddenIds.has(ch.id));
    }
    return channels.filter((ch) => !hiddenIds.has(ch.id));
  }, [channels, hiddenIds, favoriteIds, activeCategory]);

  // Categorías visibles (filtra las ocultas salvo que showHiddenCats esté activo)
  const visibleCategories = useMemo(
    () => showHiddenCats ? categories : categories.filter((c) => !hiddenCategoryIds.has(c.id)),
    [categories, hiddenCategoryIds, showHiddenCats]
  );

  // ── Handlers — categoría ──────────────────────────────────────────────────
  const handleSelectCategory = useCallback((catId: string) => {
    setActiveCategory(catId);
    activeCategoryRef.current = catId;
    void loadChannels(catId === "__favorites__" ? "all" : catId);
  }, [loadChannels]);

  // ── Handlers — ocultar categoría ─────────────────────────────────────────
  const handleToggleCategoryHide = useCallback((catId: string) => {
    setHiddenCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      localStorage.setItem("streams_hidden_cat_ids", JSON.stringify([...next]));
      return next;
    });
  }, []);

  // ── Handlers — favorito ──────────────────────────────────────────────────
  const handleToggleFavorite = useCallback((channelId: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) next.delete(channelId);
      else next.add(channelId);
      return next;
    });
    toggleLiveTvFavoriteApi(channelId).then((prefs) => {
      setFavoriteIds(new Set(prefs.favorites));
    }).catch(() => {});
  }, []);

  // ── Handlers — modales (hide / rename) ───────────────────────────────────
  const handleRequestHide = useCallback((ch: LiveTvChannelItem) => {
    hideModalChannelRef.current = ch;
    setShowHideModal(true);
  }, []);

  const handleRequestRename = useCallback((ch: LiveTvChannelItem) => {
    renameModalChannelRef.current = ch;
    setRenameInput(customNames[ch.id] || ch.name);
    setRenameCategoryInput(customCategories[ch.id] || ch.category?.id || "");
    setShowRenameModal(true);
  }, [customNames, customCategories]);

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

  // ── Handlers — contenido adulto ───────────────────────────────────────────
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
      handleSelectCategory(pendingAdultCategoryRef.current);
    } else {
      setAdultPasswordError(true);
    }
  }, [adultPasswordInput, handleSelectCategory]);

  useEffect(() => {
    if (!adultUnlocked) return;
    const isStillAdult = categories.some(
      (c) => isAdultCategory(c.name) && c.id === activeCategory
    );
    if (!isStillAdult) setAdultUnlocked(false);
  }, [activeCategory, adultUnlocked, categories]);

  // ── Playback ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playbackTarget) return;

    const playbackKey = playbackTarget.key;
    if (lastPlaybackKeyRef.current === playbackKey) return;
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
              if (probe.ok) { manifestReady = true; break; }
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

        channelFailureCountRef.current.delete(playbackTarget.channelId);
      } catch (runtimeError) {
        if (cancelled || attemptId !== playbackAttemptSeqRef.current) return;
        markChannelFailure();
        if (playbackTarget.sourceMode === "direct") {
          setDirectFallbackChannelIds((prev) => {
            if (prev.has(playbackTarget.channelId)) return prev;
            const next = new Set(prev);
            next.add(playbackTarget.channelId);
            return next;
          });
          lastPlaybackKeyRef.current = "";
        }
        setPlayerState("error");
        setError(runtimeError instanceof Error ? runtimeError.message : "No se pudo cargar este canal.");
      }
    })();

    return () => {
      cancelled = true;
      destroyHls();
    };
  }, [attachVideoSource, destroyHls, markChannelFailure, playbackTarget]);

  const bufferingOverlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const BUFFERING_DELAY_MS = 3000;

    function clearBufferingTimer() {
      if (bufferingOverlayTimerRef.current) {
        clearTimeout(bufferingOverlayTimerRef.current);
        bufferingOverlayTimerRef.current = null;
      }
    }
    function scheduleBuffering() {
      if (bufferingOverlayTimerRef.current) return;
      bufferingOverlayTimerRef.current = setTimeout(() => {
        bufferingOverlayTimerRef.current = null;
        setPlayerState("buffering");
      }, BUFFERING_DELAY_MS);
    }

    const onLoadStart = () => { clearBufferingTimer(); setPlayerState("loading"); };
    const onWaiting = () => scheduleBuffering();
    const onCanPlay = () => { clearBufferingTimer(); setPlayerState("playing"); };
    const onPlaying = () => { clearBufferingTimer(); setPlayerState("playing"); };
    const onStalled = () => scheduleBuffering();
    const onError = () => {
      clearBufferingTimer();
      if (!video || !video.src || video.src === window.location.href) return;
      setPlayerState("error");
    };

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

  useEffect(() => {
    reconnectAttemptRef.current = 0;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  }, [selectedChannelId]);

  useEffect(() => {
    if (playerState === "playing") reconnectAttemptRef.current = 0;
  }, [playerState]);

  useEffect(() => {
    if (playerState !== "error" || !selectedChannel || !playbackTarget) return;
    const attempt = reconnectAttemptRef.current;
    if (attempt >= MAX_RECONNECT_ATTEMPTS) return;
    const isTranscoding = Boolean(playbackTarget?.sourceUrl?.includes("/hls/"));
    const failCount = channelFailureCountRef.current.get(selectedChannel.id) || 0;
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
  }, [playerState, selectedChannel, playbackTarget]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  const showControlsTemporarily = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setControlsVisible(false), 5000);
  }, []);

  useEffect(() => {
    const onAnyInput = () => showControlsTemporarily();
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

  const showOsd = useCallback(() => {
    setOsdVisible(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => {
      setOsdVisible(false);
      osdTimerRef.current = null;
    }, 3000);
  }, []);

  // ── Acciones de API ───────────────────────────────────────────────────────
  async function handleReload() {
    setReloading(true);
    setError(null);
    try {
      await reloadLiveTvChannels();
      await loadCategories();
      await loadChannels(activeCategoryRef.current);
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "No se pudieron recargar listas.");
    } finally {
      setReloading(false);
    }
  }

  async function handleSetSource(source: ActiveSource) {
    if (source === activeSource || changingSource) return;
    setChangingSource(true);
    setError(null);
    try {
      await setActiveSourceApi(source);
      setActiveSource(source);
      const data = await fetchActiveSource();
      setRemoteSources(data.remoteSources || []);
      await loadCategories();
      setActiveCategory("all");
      activeCategoryRef.current = "all";
      await loadChannels("all");
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "No se pudo cambiar la fuente.");
    } finally {
      setChangingSource(false);
    }
  }

  async function handleRefreshRemote() {
    if (refreshingRemote) return;
    setRefreshingRemote(true);
    setError(null);
    try {
      await refreshRemoteSourcesApi();
      const data = await fetchActiveSource();
      setRemoteSources(data.remoteSources || []);
      await loadCategories();
      await loadChannels(activeCategoryRef.current);
    } catch (apiError) {
      setError(apiError instanceof Error ? apiError.message : "No se pudieron actualizar listas remotas.");
    } finally {
      setRefreshingRemote(false);
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
      // ignored
    }
  }

  // ── TV helpers — panel selector ───────────────────────────────────────────
  const getPaneItems = useCallback((pane: SelectorPane): HTMLElement[] => {
    if (pane === "categories") {
      return Array.from(document.querySelectorAll<HTMLElement>(".live-tv-selector.is-open .live-tv-cat-item"));
    }
    if (pane === "channels") {
      return Array.from(document.querySelectorAll<HTMLElement>(".live-tv-selector.is-open .live-tv-chan-item"));
    }
    // chan-actions: botones de acción del canal enfocado actualmente
    const focusedChan = document.querySelector<HTMLElement>(".live-tv-selector.is-open .live-tv-chan-item.tv-focused");
    if (!focusedChan) return [];
    return Array.from(
      focusedChan.closest(".live-tv-chan-row")?.querySelectorAll<HTMLElement>(".live-tv-chan-action-btn") ?? []
    );
  }, []);

  const applyPaneFocus = useCallback((pane: SelectorPane, index: number) => {
    if (pane !== "chan-actions") {
      // Limpia todo el foco incluyendo botones de acción
      document.querySelectorAll(".live-tv-selector .tv-focused").forEach((e) => e.classList.remove("tv-focused"));
    } else {
      // Solo limpia el foco de botones de acción (el canal queda resaltado)
      document.querySelectorAll(".live-tv-selector .live-tv-chan-action-btn.tv-focused").forEach((e) => e.classList.remove("tv-focused"));
    }
    const items = getPaneItems(pane);
    const el = items[Math.max(0, Math.min(items.length - 1, index))];
    el?.classList.add("tv-focused");
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [getPaneItems]);

  const openPanel = useCallback(() => {
    setShowChannelPanel(true);
    tvScopeRef.current = "selector";
    selectorPaneRef.current = "channels";
    requestAnimationFrame(() => {
      const items = getPaneItems("channels");
      const activeIdx = items.findIndex((el) => el.classList.contains("is-active"));
      chanIndexRef.current = activeIdx >= 0 ? activeIdx : 0;
      applyPaneFocus("channels", chanIndexRef.current);
    });
  }, [getPaneItems, applyPaneFocus]);

  const closePanel = useCallback(() => {
    setShowChannelPanel(false);
    tvScopeRef.current = "player";
    document.querySelectorAll(".live-tv-selector .tv-focused").forEach((e) => e.classList.remove("tv-focused"));
  }, []);

  // ── Handlers — canales ────────────────────────────────────────────────────
  function handleSelectChannel(channel: LiveTvChannelItem) {
    setSelectedChannelId(channel.id);
    closePanel();
    showOsd();
  }

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

  // ── Keyboard / D-pad — estados: player | selector (panes: categories | channels | chan-actions) ──
  useEffect(() => {
    const onContextMenu = (e: Event) => e.preventDefault();
    window.addEventListener("contextmenu", onContextMenu);
    return () => window.removeEventListener("contextmenu", onContextMenu);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const scope = tvScopeRef.current;

      // ===== PLAYER =====
      if (scope === "player") {
        switch (e.key) {
          case "ArrowUp":
          case "ChannelUp":
            e.preventDefault(); navigateChannel(-1); break;
          case "ArrowDown":
          case "ChannelDown":
            e.preventDefault(); navigateChannel(1); break;
          case "Enter":
          case "ArrowRight":
          case "ContextMenu":
            e.preventDefault(); openPanel(); break;
          case "f":
          case "F":
            e.preventDefault(); void handleToggleFullscreen(); break;
          case "Escape":
          case "Backspace":
            e.preventDefault();
            if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
            else navigate("/");
            break;
        }
        return;
      }

      // ===== SELECTOR =====
      const pane = selectorPaneRef.current;

      if (e.key === "Escape" || e.key === "Backspace" || e.key === "BrowserBack") {
        e.preventDefault();
        if (pane === "chan-actions") {
          // Volver al panel de canales
          selectorPaneRef.current = "channels";
          applyPaneFocus("channels", chanIndexRef.current);
        } else {
          closePanel();
        }
        return;
      }

      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          if (pane === "chan-actions") {
            selectorPaneRef.current = "channels";
            applyPaneFocus("channels", chanIndexRef.current);
          } else if (pane === "channels") {
            selectorPaneRef.current = "categories";
            applyPaneFocus("categories", catIndexRef.current);
          } else {
            closePanel();
          }
          break;

        case "ArrowRight":
          e.preventDefault();
          if (pane === "categories") {
            selectorPaneRef.current = "channels";
            applyPaneFocus("channels", chanIndexRef.current);
          } else if (pane === "channels" && editModeRef.current) {
            // En modo edición: ArrowRight entra a los botones de acción del canal
            selectorPaneRef.current = "chan-actions";
            chanActionIndexRef.current = 0;
            applyPaneFocus("chan-actions", 0);
          }
          break;

        case "ArrowUp":
        case "ChannelUp":
          e.preventDefault();
          if (pane === "chan-actions") {
            chanActionIndexRef.current = Math.max(0, chanActionIndexRef.current - 1);
            applyPaneFocus("chan-actions", chanActionIndexRef.current);
          } else {
            const idxUp = pane === "categories" ? catIndexRef : chanIndexRef;
            idxUp.current = Math.max(0, idxUp.current - 1);
            applyPaneFocus(pane, idxUp.current);
          }
          break;

        case "ArrowDown":
        case "ChannelDown":
          e.preventDefault();
          if (pane === "chan-actions") {
            const actionItems = getPaneItems("chan-actions");
            chanActionIndexRef.current = Math.min(actionItems.length - 1, chanActionIndexRef.current + 1);
            applyPaneFocus("chan-actions", chanActionIndexRef.current);
          } else {
            const itemsDown = getPaneItems(pane);
            const idxDown = pane === "categories" ? catIndexRef : chanIndexRef;
            idxDown.current = Math.min(itemsDown.length - 1, idxDown.current + 1);
            applyPaneFocus(pane, idxDown.current);
          }
          break;

        case "Enter":
        case " ":
          e.preventDefault();
          if (pane === "categories") {
            getPaneItems("categories")[catIndexRef.current]?.click();
            selectorPaneRef.current = "channels";
            chanIndexRef.current = 0;
            requestAnimationFrame(() => applyPaneFocus("channels", 0));
          } else if (pane === "channels") {
            getPaneItems("channels")[chanIndexRef.current]?.click();
          } else if (pane === "chan-actions") {
            getPaneItems("chan-actions")[chanActionIndexRef.current]?.click();
          }
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigateChannel, navigate, openPanel, closePanel, applyPaneFocus, getPaneItems]);

  // ── Render ────────────────────────────────────────────────────────────────
  const remoteUpdatedAt = remoteSources
    .map((s) => s.cache.updatedAt)
    .filter(Boolean)
    .sort()
    .pop() ?? null;

  const hiddenCatCount = hiddenCategoryIds.size;

  return (
    <main className="home-shell live-tv-shell">
      <section className="live-tv-theater-layout">
        <div className={`live-tv-player-shell ${showChannelPanel ? "has-panel-open" : ""}`} ref={playerShellRef}>
          <div className="live-tv-main-area">
            <video ref={videoRef} autoPlay playsInline className="video-player live-tv-video" />

            {/* Overlay con botones de acción */}
            <div className={`live-tv-overlay-top ${controlsVisible ? "is-visible" : ""}`}>
              <div className="live-tv-overlay-actions">
                <button type="button" className="live-tv-overlay-btn" onClick={() => navigateChannel(-1)} title="Canal anterior">
                  <SkipBack size={16} />
                </button>
                <button type="button" className="live-tv-overlay-btn" onClick={() => navigateChannel(1)} title="Canal siguiente">
                  <SkipForward size={16} />
                </button>
                <button
                  type="button"
                  className="live-tv-overlay-btn has-label"
                  onClick={() => { if (showChannelPanel) closePanel(); else openPanel(); }}
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
                        }}
                      >
                        {forceTranscode ? "Transcode: ON" : "Transcode: OFF"}
                      </button>
                      <div className="live-tv-quality-divider" />
                      {qualityOptions.map((q) => (
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

            {/* OSD tipo TV */}
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

            {/* Estado del player */}
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

          {/* ── Panel selector de dos columnas (overlay sobre el player) ── */}
          <div className={`live-tv-selector ${showChannelPanel ? "is-open" : ""}`}>
            {/* Header: source switcher + búsqueda + controles */}
            <div className="live-tv-selector-header">
              <div className="live-tv-selector-header-top">
                <div className="live-tv-source-switcher" style={{ flex: 1 }}>
                  <button
                    type="button"
                    className={`live-tv-source-tab ${activeSource === "local" ? "is-active" : ""}`}
                    onClick={() => void handleSetSource("local")}
                    disabled={changingSource || activeSource === "local"}
                    title="Canales locales"
                  >
                    Local
                  </button>
                  <button
                    type="button"
                    className={`live-tv-source-tab ${activeSource === "remote" ? "is-active" : ""}`}
                    onClick={() => void handleSetSource("remote")}
                    disabled={changingSource || activeSource === "remote"}
                    title="Canales remotos"
                  >
                    {changingSource && activeSource === "local" ? <LoaderCircle size={12} className="spin" /> : null}
                    Remoto
                  </button>
                </div>
                {activeSource === "remote" ? (
                  <button
                    type="button"
                    className="live-tv-remote-refresh-btn"
                    onClick={() => void handleRefreshRemote()}
                    disabled={refreshingRemote}
                    title={remoteUpdatedAt ? `Actualizado ${formatRelativeDate(remoteUpdatedAt)}` : "Sin caché descargada"}
                  >
                    <Download size={13} className={refreshingRemote ? "spin" : ""} />
                    {refreshingRemote ? "..." : "Actualizar"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="live-tv-reload-btn"
                  onClick={() => void handleReload()}
                  disabled={reloading}
                  title="Recargar listas"
                >
                  <RefreshCw size={16} className={reloading ? "spin" : ""} />
                </button>
                {/* Botón modo edición */}
                <button
                  type="button"
                  className={`live-tv-edit-btn ${editMode ? "is-active" : ""}`}
                  onClick={() => setEditMode((v) => !v)}
                  title={editMode ? "Salir del modo edición" : "Modo edición (renombrar / ocultar canales y categorías)"}
                >
                  <Edit2 size={15} />
                </button>
                <button type="button" className="live-tv-close-btn" onClick={closePanel} title="Cerrar panel">
                  <X size={17} />
                </button>
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
                  <button type="button" className="search-clear-btn" onClick={() => setSearchInput("")}>
                    <X size={18} />
                  </button>
                ) : null}
              </div>
              {error ? <p className="watch-error" style={{ margin: 0, fontSize: 12 }}>{error}</p> : null}
            </div>

            {/* Cuerpo: columna categorías | columna canales */}
            <div className="live-tv-selector-cols">
              {/* Columna izquierda: categorías */}
              <div className="live-tv-cat-panel" ref={catPanelRef}>
                {/* Favoritos */}
                <button
                  type="button"
                  className={`live-tv-cat-item ${activeCategory === "__favorites__" ? "is-active" : ""}`}
                  onClick={() => handleSelectCategory("__favorites__")}
                >
                  <Star size={14} />
                  Favoritos
                  {favoriteIds.size > 0 ? <small style={{ marginLeft: 4, fontSize: 11, opacity: 0.7 }}>({favoriteIds.size})</small> : null}
                </button>
                {/* Todos */}
                <button
                  type="button"
                  className={`live-tv-cat-item ${activeCategory === "all" ? "is-active" : ""}`}
                  onClick={() => handleSelectCategory("all")}
                >
                  Todos
                </button>

                {/* Categorías no adultas — con botón de ocultar en modo edición */}
                {visibleCategories.filter((c) => !isAdultCategory(c.name)).map((cat) => (
                  editMode ? (
                    <div key={cat.id} className="live-tv-cat-row">
                      <button
                        type="button"
                        className={`live-tv-cat-item ${activeCategory === cat.id ? "is-active" : ""} ${hiddenCategoryIds.has(cat.id) ? "is-hidden-cat" : ""}`}
                        onClick={() => handleSelectCategory(cat.id)}
                      >
                        {cat.name}
                        <small style={{ marginLeft: "auto", fontSize: 11, opacity: 0.5 }}>{cat.count}</small>
                      </button>
                      <button
                        type="button"
                        className="live-tv-cat-hide-btn"
                        onClick={() => handleToggleCategoryHide(cat.id)}
                        title={hiddenCategoryIds.has(cat.id) ? "Mostrar esta categoría" : "Ocultar esta categoría"}
                      >
                        {hiddenCategoryIds.has(cat.id) ? <Eye size={13} /> : <EyeOff size={13} />}
                      </button>
                    </div>
                  ) : (
                    <button
                      key={cat.id}
                      type="button"
                      className={`live-tv-cat-item ${activeCategory === cat.id ? "is-active" : ""}`}
                      onClick={() => handleSelectCategory(cat.id)}
                    >
                      {cat.name}
                      <small style={{ marginLeft: "auto", fontSize: 11, opacity: 0.5 }}>{cat.count}</small>
                    </button>
                  )
                ))}

                {/* Contenido adulto */}
                {categories.filter((c) => isAdultCategory(c.name)).map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className={`live-tv-cat-item ${adultUnlocked && activeCategory === cat.id ? "is-active" : ""}`}
                    style={{ color: "#555" }}
                    onClick={() => {
                      if (adultUnlocked) handleSelectCategory(cat.id);
                      else handleRequestAdultAccess(cat.id);
                    }}
                  >
                    <Lock size={13} />
                    {adultUnlocked ? cat.name : "Canal oculto"}
                  </button>
                ))}

                {/* Toggle para ver/ocultar categorías filtradas */}
                {hiddenCatCount > 0 ? (
                  <button
                    type="button"
                    className="live-tv-cat-show-hidden-btn"
                    onClick={() => setShowHiddenCats((v) => !v)}
                    title={showHiddenCats ? "Ocultar categorías filtradas" : "Ver categorías ocultas"}
                  >
                    {showHiddenCats ? <Eye size={12} /> : <EyeOff size={12} />}
                    {showHiddenCats ? "Ocultar filtradas" : `Filtradas (${hiddenCatCount})`}
                  </button>
                ) : null}
              </div>

              {/* Columna derecha: canales */}
              <div className="live-tv-chan-panel" ref={chanPanelRef}>
                {loading ? (
                  <p className="muted" style={{ padding: "16px" }}>Cargando...</p>
                ) : visibleChannels.length === 0 ? (
                  <p className="muted" style={{ padding: "16px" }}>No hay canales para este filtro.</p>
                ) : (
                  visibleChannels.map((ch) =>
                    editMode ? (
                      /* Modo edición: fila con botones de acción */
                      <div key={ch.id} className="live-tv-chan-row">
                        <button
                          type="button"
                          className={`live-tv-chan-item ${ch.id === selectedChannelId ? "is-active" : ""}`}
                          onClick={() => handleSelectChannel(ch)}
                          title={customNames[ch.id] || ch.name}
                        >
                          <Tv2 size={15} />
                          <span>{customNames[ch.id] || ch.name}</span>
                          {favoriteIds.has(ch.id) ? (
                            <Star size={11} style={{ marginLeft: "auto", color: "#ff8c42", flexShrink: 0 }} />
                          ) : null}
                        </button>
                        <div className="live-tv-chan-action-btns">
                          <button
                            type="button"
                            className={`live-tv-chan-action-btn ${favoriteIds.has(ch.id) ? "is-fav" : ""}`}
                            onClick={() => handleToggleFavorite(ch.id)}
                            title="Favorito"
                          >
                            <Star size={13} />
                          </button>
                          <button
                            type="button"
                            className="live-tv-chan-action-btn"
                            onClick={() => handleRequestRename(ch)}
                            title="Renombrar"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            type="button"
                            className="live-tv-chan-action-btn"
                            onClick={() => handleRequestHide(ch)}
                            title="Ocultar"
                          >
                            <EyeOff size={13} />
                          </button>
                        </div>
                      </div>
                    ) : (
                      /* Modo normal: botón simple */
                      <button
                        key={ch.id}
                        type="button"
                        className={`live-tv-chan-item ${ch.id === selectedChannelId ? "is-active" : ""}`}
                        onClick={() => handleSelectChannel(ch)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          handleToggleFavorite(ch.id);
                        }}
                        title={`${customNames[ch.id] || ch.name} | Clic derecho para favorito`}
                      >
                        <Tv2 size={15} />
                        <span>{customNames[ch.id] || ch.name}</span>
                        {favoriteIds.has(ch.id) ? (
                          <Star size={11} style={{ marginLeft: "auto", color: "#ff8c42", flexShrink: 0 }} />
                        ) : null}
                      </button>
                    )
                  )
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Modal: contenido adulto */}
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
                onKeyDown={(e) => { if (e.key === "Enter") handleAdultPasswordSubmit(); }}
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

      {/* Modal: ocultar canal */}
      {showHideModal && hideModalChannelRef.current ? (
        <div className="modal-backdrop" onClick={() => setShowHideModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-form">
              <h3 style={{ margin: "0 0 4px", fontSize: 18 }}>
                <EyeOff size={16} style={{ marginRight: 8, verticalAlign: -2 }} />
                Ocultar canal
              </h3>
              <p className="muted" style={{ marginBottom: 8 }}>
                <strong>{hideModalChannelRef.current.name}</strong>
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button type="button" className="secondary-btn" style={{ textAlign: "left" }} onClick={() => handleConfirmHide("no_funciona")}>
                  No funciona / sin senal
                </button>
                <button type="button" className="secondary-btn" style={{ textAlign: "left" }} onClick={() => handleConfirmHide("no_interesa")}>
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

      {/* Modal: renombrar canal */}
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
                onKeyDown={(e) => { if (e.key === "Enter") handleRenameSubmit(); }}
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
