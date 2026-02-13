import type {
  AutoPlaybackPayload,
  CatalogBrowsePayload,
  Category,
  LiveTvCategoriesPayload,
  LiveTvChannelsPayload,
  MetaDetailsPayload,
  PlaybackPreflightPayload,
  PlaybackSessionPayload,
  SourcesPayload,
  StreamsPayload,
  SubtitlesPayload
} from "./types";

interface ApiOptions extends RequestInit {
  timeoutMs?: number;
}

async function apiFetch<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 15000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
  waitReadyMs?: number;
  probeTimeoutMs?: number;
  maxCandidates?: number;
  validationBudgetMs?: number;
  preferredSourceKey?: string;
}): Promise<AutoPlaybackPayload> {
  return apiFetch<AutoPlaybackPayload>("/api/playback/auto", {
    method: "POST",
    body: JSON.stringify(payload),
    timeoutMs: Math.max(30000, Math.round(Number(payload.waitReadyMs) || 0) + 15000)
  });
}

export function fetchPlaybackPreflight(payload: {
  type: string;
  itemId: string;
  season?: number;
  episode?: number;
  quality?: "auto" | "4k" | "1080p" | "720p" | "sd";
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
    limit: String(params.limit ?? 160),
    webOnly: String(params.webOnly ?? true)
  });
  if (params.category?.trim()) {
    searchParams.set("category", params.category.trim());
  }
  if (params.query?.trim()) {
    searchParams.set("query", params.query.trim());
  }

  return apiFetch<LiveTvChannelsPayload>(`/api/live-tv/channels?${searchParams.toString()}`, {
    timeoutMs: 20000
  });
}

export function reloadLiveTvChannels(): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/live-tv/reload", {
    method: "POST",
    body: "{}",
    timeoutMs: 20000
  });
}
