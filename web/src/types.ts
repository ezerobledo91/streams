export type Category = "movie" | "series" | "tv";

export interface SourceItem {
  id: string;
  name: string;
  manifestUrl: string;
  baseUrl: string;
  active: boolean;
  priority: number;
  categories: Category[];
}

export interface SourcesPayload {
  loadedAt: string | null;
  catalog: SourceItem[];
  stream: SourceItem[];
  subtitle: SourceItem[];
}

export interface CatalogItem {
  id: string;
  type: Category;
  name: string;
  year: string | null;
  poster: string | null;
  background: string | null;
  description: string | null;
  rating: number | null;
  source?: {
    kind: string;
    id: string;
    name: string;
    catalogId?: string;
  };
  availability?: {
    region: string;
    providers: Array<{
      id: string;
      name: string;
      logo: string | null;
      types: string[];
    }>;
  };
}

export interface CatalogBrowsePayload {
  category: Category;
  query: string;
  genre: string;
  provider?: string;
  page: number;
  limit: number;
  total: number;
  items: CatalogItem[];
  summary: {
    tmdbEnabled: boolean;
    catalogSourcesQueried: number;
    tmdbItems: number;
    addonItems: number;
    includeAvailability?: boolean;
  };
}

export interface StreamsPayload {
  requestedType: string;
  requestedItemId: string;
  resolvedType: string;
  resolvedItemId: string;
  providerCount: number;
  results: Array<{
    provider: {
      id: string;
      name: string;
      baseUrl: string;
      manifestUrl: string;
    };
    ok: boolean;
    error?: string;
    streams: StreamItem[];
  }>;
}

export interface StreamItem {
  title?: string;
  name?: string;
  description?: string;
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  seeders?: number | string;
  seeds?: number | string;
  peers?: number | string;
  behaviorHints?: {
    seeders?: number | string;
    seeds?: number | string;
    peers?: number | string;
    videoSize?: number;
    filename?: string;
    bingeGroup?: string;
    reliabilityPenalty?: number;
    reliabilityProviderPenalty?: number;
    reliabilitySourcePenalty?: number;
    reliabilitySourceKey?: string;
  };
  sources?: string[];
}

export interface StreamCandidate {
  providerId: string;
  providerName: string;
  providerBaseUrl: string;
  displayName: string;
  magnet: string | null;
  directUrl: string | null;
  stream: StreamItem;
  fileIdx: number | null;
  score: number;
  seeders: number;
  peers: number;
  resolution: number;
  videoSizeBytes: number;
  fileExtension: string;
  webFriendly: boolean;
  likelyIncompatible: boolean;
}

export interface MetaEpisodeItem {
  season: number;
  episode: number;
  title: string;
  overview: string | null;
  rating: number | null;
  airDate: string | null;
  still: string | null;
}

export interface MetaSeasonItem {
  season: number;
  name: string;
  episodeCount: number;
  airDate: string | null;
}

export interface MetaDetailsPayload {
  requestedType: string;
  requestedItemId: string;
  resolvedType: string;
  resolvedItemId: string;
  info: {
    title: string;
    overview: string | null;
    poster: string | null;
    background: string | null;
    originalLanguage: string | null;
    rating: number | null;
    year: string | null;
    genres: string[];
    cast: string[];
    runtime: number | null;
  } | null;
  seasons: MetaSeasonItem[];
  episodes: MetaEpisodeItem[];
}

export interface SubtitlesPayload {
  requestedType: string;
  requestedItemId: string;
  resolvedType: string;
  resolvedItemId: string;
  providerCount: number;
  subtitles: Array<{
    id: string;
    providerId: string;
    providerName: string;
    label: string;
    language: string;
    extension: string;
    url: string;
  }>;
  results: Array<{
    provider: {
      id: string;
      name: string;
      baseUrl: string;
      manifestUrl: string;
    };
    ok: boolean;
    error?: string;
    subtitles: Array<{
      id: string;
      providerId: string;
      providerName: string;
      label: string;
      language: string;
      extension: string;
      url: string;
    }>;
  }>;
}

export interface PlaybackSessionPayload {
  sessionId: string;
  status: "loading" | "ready" | "error";
  error: string | null;
  streamUrl: string;
  streamKind?: "direct" | "hls";
  directStreamUrl?: string;
  hls?: {
    enabled: boolean;
    status: "idle" | "loading" | "ready" | "error";
    error: string | null;
    playlistUrl: string | null;
    segmentCount?: number;
  };
  subtitles: Array<{
    id: string;
    label: string;
    language: string;
    extension: string;
    url: string;
  }>;
  file: {
    name: string;
    length: number;
    extension: string;
  } | null;
  torrent: {
    progress: number;
    numPeers: number;
    downloadSpeed: number;
  } | null;
}

export interface LiveTvCategoryItem {
  id: string;
  name: string;
  count: number;
}

export interface LiveTvChannelItem {
  id: string;
  name: string;
  logo: string | null;
  streamUrl: string;
  webPlayable: boolean;
  category: {
    id: string;
    name: string;
  };
  groupTitle: string | null;
  tvgName: string | null;
  tvgId: string | null;
  language: string | null;
  country: string | null;
  sourceFile: string;
}

export interface ChannelGroup {
  baseName: string;
  primary: LiveTvChannelItem;
  subChannels: LiveTvChannelItem[];
}

export interface LiveTvCategoriesPayload {
  loadedAt: string | null;
  categories: LiveTvCategoryItem[];
}

export interface LiveTvChannelsPayload {
  loadedAt: string | null;
  category: string;
  query: string;
  webOnly: boolean;
  page: number;
  limit: number;
  total: number;
  items: LiveTvChannelItem[];
}

export interface RemoteSourceCache {
  exists: boolean;
  updatedAt: string | null;
  stale: boolean;
}

export interface RemoteSourceStatus {
  id: string;
  name: string;
  enabled: boolean;
  cache: RemoteSourceCache;
}

export interface AutoPlaybackCandidateSummary {
  providerId: string;
  providerName: string;
  displayName: string;
  resolution: number;
  score: number;
  seeders: number;
  peers: number;
  webFriendly: boolean;
  fileExtension: string;
  likelyIncompatible: boolean;
  hasMagnet: boolean;
  hasDirectUrl: boolean;
  fileIdx: number | null;
  sourceKey?: string;
}

export interface AutoPlaybackAlternative {
  mode: "direct" | "session";
  status: "ready";
  streamUrl: string;
  streamKind: "direct" | "hls";
  sessionId: string | null;
  session: PlaybackSessionPayload | null;
  selectedQuality: "4k" | "1080p" | "720p" | "sd";
  chosen: AutoPlaybackCandidateSummary;
}

export interface AutoPlaybackPayload extends AutoPlaybackAlternative {
  availableQualities: Array<"4k" | "1080p" | "720p" | "sd">;
  alternatives: AutoPlaybackAlternative[];
}

export interface PlaybackPreflightQualityOption {
  quality: "4k" | "1080p" | "720p" | "sd";
  mode: "direct" | "session";
  streamKind: "direct" | "hls";
  providerId: string;
  providerName: string;
  displayName: string;
  score: number;
}

export interface PlaybackPreflightPayload {
  requestedType: string;
  requestedItemId: string;
  resolvedType: string;
  resolvedItemId: string;
  providerCount: number;
  selectedQuality: "4k" | "1080p" | "720p" | "sd" | null;
  availableQualities: Array<"4k" | "1080p" | "720p" | "sd">;
  qualityOptions: PlaybackPreflightQualityOption[];
  recommended: AutoPlaybackPayload | null;
  preferredSourceKey: string | null;
  attempts: Array<{
    mode: "direct" | "torrent";
    providerId: string;
    displayName: string;
    ok: boolean;
    reason: string | null;
  }>;
  metrics: {
    ttfqMs: number;
  };
  cache: {
    hit: boolean;
    ttlMs: number;
    ageMs?: number;
  };
}

export interface UserUnavailableEntry {
  type: Category;
  itemId: string;
  reason: string;
  notedAt: number;
}

export interface ContinueWatchingEntry {
  type: "movie" | "series";
  itemId: string;
  name: string;
  poster: string | null;
  background: string | null;
  season: number | null;
  episode: number | null;
  episodeTitle: string | null;
  position: number;
  duration: number;
  lastWatched: number;
}

export interface UserRecord {
  username: string;
  displayName: string;
  favorites: CatalogItem[];
  unavailable: UserUnavailableEntry[];
  continueWatching: ContinueWatchingEntry[];
}
