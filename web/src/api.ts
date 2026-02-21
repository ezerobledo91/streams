import type {
  AutoPlaybackPayload,
  CatalogBrowsePayload,
  CatalogItem,
  Category,
  ContinueWatchingEntry,
  LiveTvCategoriesPayload,
  LiveTvChannelsPayload,
  MetaDetailsPayload,
  PlaybackPreflightPayload,
  PlaybackSessionPayload,
  RemoteSourceStatus,
  SourcesPayload,
  StreamsPayload,
  SubtitlesPayload,
  UserRecord
} from "./types";

interface ApiOptions extends RequestInit {
  timeoutMs?: number;
}

async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Combinar signal externo (cancelación manual) con timeout interno
  const externalSignal = options.signal;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(path, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      },
      signal: controller.signal
    });

    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(String(payload.error || `HTTP ${response.status}`));
    }
    return payload as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchSources(): Promise<SourcesPayload> {
  return apiFetch<SourcesPayload>("/api/sources");
}

export function reloadSources(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/sources/reload", {
    method: "POST",
    body: "{}"
  });
}

export function fetchCatalogByCategory(params: {
  category: Category;
  query?: string;
  genre?: string;
  year?: string;
  limit?: number;
  page?: number;
}): Promise<CatalogBrowsePayload> {
  const searchParams = new URLSearchParams({
    category: params.category,
    limit: String(params.limit ?? 30),
    page: String(params.page ?? 1)
  });
  if (params.query?.trim()) {
    searchParams.set("query", params.query.trim());
  }
  if (params.genre?.trim()) {
    searchParams.set("genre", params.genre.trim());
  }
  if (params.year?.trim()) {
    searchParams.set("year", params.year.trim());
  }

  return apiFetch<CatalogBrowsePayload>(`/api/catalog/browse?${searchParams.toString()}`);
}

export function fetchStreams(params: {
  type: string;
  itemId: string;
  season?: number;
  episode?: number;
}): Promise<StreamsPayload> {
  const searchParams = new URLSearchParams({
    type: params.type,
    itemId: params.itemId,
    onlyActive: "true"
  });
  if (Number.isFinite(params.season)) {
    searchParams.set("season", String(params.season));
  }
  if (Number.isFinite(params.episode)) {
    searchParams.set("episode", String(params.episode));
  }

  return apiFetch<StreamsPayload>(`/api/streams?${searchParams.toString()}`, {
    timeoutMs: 20000
  });
}

export function fetchSubtitles(params: {
  type: string;
  itemId: string;
  season?: number;
  episode?: number;
}): Promise<SubtitlesPayload> {
  const searchParams = new URLSearchParams({
    type: params.type,
    itemId: params.itemId,
    onlyActive: "true"
  });
  if (Number.isFinite(params.season)) {
    searchParams.set("season", String(params.season));
  }
  if (Number.isFinite(params.episode)) {
    searchParams.set("episode", String(params.episode));
  }

  return apiFetch<SubtitlesPayload>(`/api/subtitles?${searchParams.toString()}`, {
    timeoutMs: 20000
  });
}

export function fetchMetaDetails(params: {
  type: string;
  itemId: string;
  season?: number;
  episode?: number;
}): Promise<MetaDetailsPayload> {
  const searchParams = new URLSearchParams({
    type: params.type,
    itemId: params.itemId
  });
  if (Number.isFinite(params.season)) {
    searchParams.set("season", String(params.season));
  }
  if (Number.isFinite(params.episode)) {
    searchParams.set("episode", String(params.episode));
  }

  return apiFetch<MetaDetailsPayload>(`/api/meta/details?${searchParams.toString()}`, {
    timeoutMs: 20000
  });
}

export function createPlaybackSession(payload: {
  magnet?: string | null;
  infoHash?: string;
  displayName?: string;
  trackers?: string[];
  fileIdx?: number | null;
  providerId?: string;
  sourceKey?: string;
  season?: number;
  episode?: number;
  waitReadyMs?: number;
}): Promise<PlaybackSessionPayload> {
  const searchParams = new URLSearchParams();
  if (Number.isFinite(payload.waitReadyMs) && Number(payload.waitReadyMs) > 0) {
    searchParams.set("waitReadyMs", String(Math.round(Number(payload.waitReadyMs))));
  }
  const path = `/api/playback/sessions${searchParams.size ? `?${searchParams.toString()}` : ""}`;
  return apiFetch<PlaybackSessionPayload>(path, {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: Math.max(20000, Math.round(Number(payload.waitReadyMs) || 0) + 15000)
  });
}

export function startAutoPlayback(payload: {
  type: string;
  itemId: string;
  season?: number;
  episode?: number;
  quality?: "auto" | "4k" | "1080p" | "720p" | "sd";
  audioPreference?: "es" | "original";
  originalLanguage?: string;
  waitReadyMs?: number;
  probeTimeoutMs?: number;
  maxCandidates?: number;
  validationBudgetMs?: number;
  preferredSourceKey?: string;
}, signal?: AbortSignal): Promise<AutoPlaybackPayload> {
  return apiFetch<AutoPlaybackPayload>("/api/playback/auto", {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
    timeoutMs: Math.max(30000, Math.round(Number(payload.validationBudgetMs) || Number(payload.waitReadyMs) || 0) + 15000)
  });
}

export function fetchPlaybackPreflight(payload: {
  type: string;
  itemId: string;
  season?: number;
  episode?: number;
  quality?: "auto" | "4k" | "1080p" | "720p" | "sd";
  audioPreference?: "es" | "original";
  originalLanguage?: string;
  probeTimeoutMs?: number;
  maxCandidates?: number;
  validationBudgetMs?: number;
  warmupWaitMs?: number;
  warmup?: boolean;
}): Promise<PlaybackPreflightPayload> {
  return apiFetch<PlaybackPreflightPayload>("/api/playback/preflight", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: Math.max(15000, Math.round(Number(payload.warmupWaitMs) || 0) + 10000)
  });
}

export function reportPlaybackMetric(payload: {
  metric: string;
  status?: "ok" | "error";
  valueMs?: number;
  type?: string;
  itemId?: string;
  quality?: string;
  streamKind?: string;
  mode?: string;
}): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/playback/metrics", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: 8000
  });
}

export function fetchPlaybackSessionStatus(
  sessionId: string,
  options?: {
    waitMs?: number;
    knownStatus?: string;
    knownHlsStatus?: string;
    knownSegments?: number;
  }
): Promise<PlaybackSessionPayload> {
  const searchParams = new URLSearchParams();
  const waitMs = Number(options?.waitMs || 0);
  if (Number.isFinite(waitMs) && waitMs > 0) {
    searchParams.set("waitMs", String(Math.max(0, Math.round(waitMs))));
  }
  if (options?.knownStatus) {
    searchParams.set("knownStatus", options.knownStatus);
  }
  if (options?.knownHlsStatus) {
    searchParams.set("knownHlsStatus", options.knownHlsStatus);
  }
  if (Number.isFinite(options?.knownSegments)) {
    searchParams.set("knownSegments", String(Math.max(0, Math.round(Number(options?.knownSegments)))));
  }
  const query = searchParams.toString();
  const path = `/api/playback/sessions/${encodeURIComponent(sessionId)}/status${query ? `?${query}` : ""}`;
  const timeoutMs = Math.max(20000, Math.round(waitMs) + 6000);
  return apiFetch<PlaybackSessionPayload>(path, {
    timeoutMs
  });
}

export function destroyPlaybackSession(sessionId: string): Promise<void> {
  return apiFetch<void>(`/api/playback/sessions/${encodeURIComponent(sessionId)}`, {
    method: "DELETE",
    timeoutMs: 15000
  });
}

export function fetchLiveTvCategories(): Promise<LiveTvCategoriesPayload> {
  return apiFetch<LiveTvCategoriesPayload>("/api/live-tv/categories", {
    timeoutMs: 15000
  });
}

export function fetchLiveTvChannels(params: {
  category?: string;
  query?: string;
  page?: number;
  limit?: number;
  webOnly?: boolean;
}): Promise<LiveTvChannelsPayload> {
  const searchParams = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 400),
    webOnly: String(params.webOnly ?? true)
  });
  if (params.category?.trim()) {
    searchParams.set("category", params.category.trim());
  }
  if (params.query?.trim()) {
    searchParams.set("query", params.query.trim());
  }

  return apiFetch<LiveTvChannelsPayload>(`/api/live-tv/channels?${searchParams.toString()}`, {
    timeoutMs: 30000
  });
}

function fetchLiveBucketCategories(apiPrefix: "/api/eventos" | "/api/247"): Promise<LiveTvCategoriesPayload> {
  return apiFetch<LiveTvCategoriesPayload>(`${apiPrefix}/categories`, {
    timeoutMs: 15000
  });
}

function fetchLiveBucketChannels(
  apiPrefix: "/api/eventos" | "/api/247",
  params: {
    category?: string;
    query?: string;
    page?: number;
    limit?: number;
    webOnly?: boolean;
  }
): Promise<LiveTvChannelsPayload> {
  const searchParams = new URLSearchParams({
    page: String(params.page ?? 1),
    limit: String(params.limit ?? 400),
    webOnly: String(params.webOnly ?? true)
  });
  if (params.category?.trim()) {
    searchParams.set("category", params.category.trim());
  }
  if (params.query?.trim()) {
    searchParams.set("query", params.query.trim());
  }

  return apiFetch<LiveTvChannelsPayload>(`${apiPrefix}/channels?${searchParams.toString()}`, {
    timeoutMs: 30000
  });
}

export function fetchEventosCategories(): Promise<LiveTvCategoriesPayload> {
  return fetchLiveBucketCategories("/api/eventos");
}

export function fetchEventosChannels(params: {
  category?: string;
  query?: string;
  page?: number;
  limit?: number;
  webOnly?: boolean;
}): Promise<LiveTvChannelsPayload> {
  return fetchLiveBucketChannels("/api/eventos", params);
}

export function fetch247Categories(): Promise<LiveTvCategoriesPayload> {
  return fetchLiveBucketCategories("/api/247");
}

export function fetch247Channels(params: {
  category?: string;
  query?: string;
  page?: number;
  limit?: number;
  webOnly?: boolean;
}): Promise<LiveTvChannelsPayload> {
  return fetchLiveBucketChannels("/api/247", params);
}

export function checkAvailabilityBatch(
  items: Array<{ type: string; itemId: string }>
): Promise<{ results: Record<string, boolean> }> {
  return apiFetch<{ results: Record<string, boolean> }>("/api/availability/batch", {
    method: "POST",
    body: JSON.stringify({ items }),
    timeoutMs: 5000
  });
}

export function reloadLiveTvChannels(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/live-tv/reload", {
    method: "POST",
    body: "{}",
    timeoutMs: 20000
  });
}

export function loginUser(payload: {
  username: string;
  displayName?: string;
}): Promise<{ user: UserRecord }> {
  return apiFetch<{ user: UserRecord }>("/api/users/login", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function fetchUserData(username: string): Promise<{ user: UserRecord }> {
  return apiFetch<{ user: UserRecord }>(`/api/users/${encodeURIComponent(username)}`);
}

export function toggleUserFavorite(username: string, item: CatalogItem): Promise<{ user: UserRecord }> {
  return apiFetch<{ user: UserRecord }>(`/api/users/${encodeURIComponent(username)}/favorites`, {
    method: "POST",
    body: JSON.stringify({ item })
  });
}

export function reportUserUnavailable(params: {
  username: string;
  type: Category;
  itemId: string;
}): Promise<{ user: UserRecord }> {
  return apiFetch<{ user: UserRecord }>(`/api/users/${encodeURIComponent(params.username)}/unavailable`, {
    method: "POST",
    body: JSON.stringify({ type: params.type, itemId: params.itemId })
  });
}

export function clearUserUnavailable(params: {
  username: string;
  type: string;
  itemId: string;
}): Promise<{ user: UserRecord }> {
  return apiFetch<{ user: UserRecord }>(`/api/users/${encodeURIComponent(params.username)}/unavailable`, {
    method: "DELETE",
    body: JSON.stringify({ type: params.type, itemId: params.itemId })
  });
}

export function fetchUserList(): Promise<{ users: UserRecord[] }> {
  return apiFetch<{ users: UserRecord[] }>("/api/users/list");
}

export function saveWatchProgress(
  username: string,
  entry: Omit<ContinueWatchingEntry, "lastWatched">
): Promise<{ user: UserRecord }> {
  return apiFetch<{ user: UserRecord }>(
    `/api/users/${encodeURIComponent(username)}/continue-watching`,
    {
      method: "POST",
      body: JSON.stringify(entry)
    }
  );
}

export function fetchContinueWatching(
  username: string
): Promise<{ items: ContinueWatchingEntry[] }> {
  return apiFetch<{ items: ContinueWatchingEntry[] }>(
    `/api/users/${encodeURIComponent(username)}/continue-watching`
  );
}

export function reportGlobalUnavailable(
  type: string,
  itemId: string
): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/availability/report-unavailable", {
    method: "POST",
    body: JSON.stringify({ type, itemId })
  });
}

export function prefetchNextEpisode(payload: {
  type: string;
  itemId: string;
  season: number;
  episode: number;
  audioPreference?: string;
  originalLanguage?: string;
}): Promise<{ prefetched: boolean }> {
  return apiFetch<{ prefetched: boolean }>("/api/playback/prefetch-next", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

// --- Live TV Preferences (server-side) ---

export interface LiveTvPreferences {
  favorites: string[];
  hidden: string[];
  customNames: Record<string, string>;
  customCategories: Record<string, string>;
}

export function fetchLiveTvPreferences(): Promise<LiveTvPreferences> {
  return apiFetch<LiveTvPreferences>("/api/live-tv/preferences");
}

export function toggleLiveTvFavoriteApi(channelId: string): Promise<LiveTvPreferences> {
  return apiFetch<LiveTvPreferences>("/api/live-tv/preferences/favorites", {
    method: "POST",
    body: JSON.stringify({ channelId })
  });
}

export function hideLiveTvChannelApi(channelId: string): Promise<LiveTvPreferences> {
  return apiFetch<LiveTvPreferences>("/api/live-tv/preferences/hidden", {
    method: "POST",
    body: JSON.stringify({ channelId })
  });
}

export function unhideLiveTvChannelApi(channelId: string): Promise<LiveTvPreferences> {
  return apiFetch<LiveTvPreferences>("/api/live-tv/preferences/hidden", {
    method: "DELETE",
    body: JSON.stringify({ channelId })
  });
}

export function setLiveTvChannelNameApi(channelId: string, name: string): Promise<LiveTvPreferences> {
  return apiFetch<LiveTvPreferences>("/api/live-tv/preferences/names", {
    method: "POST",
    body: JSON.stringify({ channelId, name })
  });
}

export function setLiveTvChannelCategoryApi(channelId: string, categoryId: string): Promise<LiveTvPreferences> {
  return apiFetch<LiveTvPreferences>("/api/live-tv/preferences/categories", {
    method: "POST",
    body: JSON.stringify({ channelId, categoryId })
  });
}

// --- Fuentes remotas Live TV ---

export interface ActiveSourcePayload {
  activeSource: "local" | "remote" | "all";
  remoteSources: RemoteSourceStatus[];
}

export function fetchActiveSource(): Promise<ActiveSourcePayload> {
  return apiFetch<ActiveSourcePayload>("/api/live-tv/active-source");
}

export function setActiveSourceApi(source: "local" | "remote" | "all"): Promise<{ ok: boolean; activeSource: string }> {
  return apiFetch<{ ok: boolean; activeSource: string }>("/api/live-tv/active-source", {
    method: "POST",
    body: JSON.stringify({ source }),
    timeoutMs: 150000 // hasta 2.5 min si descarga varias listas
  });
}

export function fetchRemoteSourcesApi(): Promise<{ sources: RemoteSourceStatus[] }> {
  return apiFetch<{ sources: RemoteSourceStatus[] }>("/api/live-tv/remote-sources");
}

export function refreshRemoteSourcesApi(): Promise<{ ok: boolean; results: Array<{ id: string; ok: boolean; error?: string }> }> {
  return apiFetch<{ ok: boolean; results: Array<{ id: string; ok: boolean; error?: string }> }>("/api/live-tv/remote-sources/refresh", {
    method: "POST",
    body: "{}",
    timeoutMs: 120000
  });
}

export async function fetchNetworkLogo(name: string): Promise<string | null> {
  try {
    const data = await apiFetch<any>(`/api/meta/search-network?query=${encodeURIComponent(name)}`);
    return data.logoUrl || null;
  } catch {
    return null;
  }
}
