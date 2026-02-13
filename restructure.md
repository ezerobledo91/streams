 Plan: Fix HLS Stall + Reestructuración de Archivos Monolíticos                                                       │
│                                                                                                                      │
│ Contexto                                                                                                             │
│                                                                                                                      │
│ La app streams-mvp reproduce torrents en el navegador. Cuando el archivo no es nativo del browser (.mkv, .avi,       │
│ etc.), el backend transcodifica a HLS con ffmpeg. El problema: el player muere a los 15-19 segundos porque:          │
│ 1. Solo se pre-generan 4 segmentos (24s de contenido) antes de empezar                                               │
│ 2. hls.js tiene timeouts muy agresivos (3 reintentos, 6s máx) y se rinde cuando no hay segmentos nuevos              │
│ 3. No hay UI de "Bufferizando..." - el video simplemente se congela                                                  │
│ 4. Solo 2 intentos de recovery ante errores fatales                                                                  │
│                                                                                                                      │
│ Además, server.js (4423 líneas) y WatchPage.tsx (1883 líneas) son imposibles de mantener.                            │
│                                                                                                                      │
│ ---                                                                                                                  │
│ FASE 1: Fix HLS (Prioridad inmediata)                                                                                │
│                                                                                                                      │
│ 1.1 Backend — server.js                                                                                              │
│                                                                                                                      │
│ a) Subir segmentos iniciales de 4 a 6 (línea 141)                                                                    │
│ - Default PLAYBACK_HLS_READY_SEGMENTS: 4 → 6 (36s de buffer inicial)                                                 │
│ - Subir límite superior: 8 → 12                                                                                      │
│                                                                                                                      │
│ b) Subir timeout de inicio HLS (línea 112)                                                                           │
│ - Default PLAYBACK_HLS_START_TIMEOUT_MS: 90000 → 120000                                                              │
│ - Subir límite superior: 240000 → 300000                                                                             │
│                                                                                                                      │
│ c) Grace period en stall detection (línea 4216)                                                                      │
│ - Si la sesión tiene menos de 2 minutos, usar stall timeout de 90s en vez de 60s                                     │
│ - Evita matar sesiones jóvenes donde el torrent aún está arrancando                                                  │
│                                                                                                                      │
│ d) Header informativo en respuesta del manifiesto (línea 4255)                                                       │
│ - Agregar X-HLS-Segment-Count al servir el .m3u8                                                                     │
│                                                                                                                      │
│ 1.2 Frontend — WatchPage.tsx                                                                                         │
│                                                                                                                      │
│ a) Reconfigurar hls.js (línea 773-786) — Timeouts tolerantes:                                                        │
│ manifestLoadingMaxRetry: 3 → 6                                                                                       │
│ manifestLoadingMaxRetryTimeout: 6000 → 15000                                                                         │
│ manifestLoadingRetryDelay: 800 → 1500                                                                                │
│ levelLoadingMaxRetry: 4 → 8                                                                                          │
│ levelLoadingMaxRetryTimeout: 6000 → 15000                                                                            │
│ levelLoadingRetryDelay: 800 → 1500                                                                                   │
│ + fragLoadingMaxRetry: 6                                                                                             │
│ + fragLoadingRetryDelay: 1500                                                                                        │
│ + fragLoadingMaxRetryTimeout: 20000                                                                                  │
│ + maxBufferLength: 60                                                                                                │
│ + maxBufferHole: 1.5                                                                                                 │
│ + maxMaxBufferLength: 120                                                                                            │
│ + nudgeMaxRetry: 5                                                                                                   │
│                                                                                                                      │
│ b) Subir timeout de MANIFEST_PARSED (línea 799): 20000 → 35000ms                                                     │
│                                                                                                                      │
│ c) Subir recovery attempts (líneas 827, 832): 2 → 4                                                                  │
│                                                                                                                      │
│ d) Agregar estado isBuffering + detectar bufferStalledError no-fatal y evento FRAG_BUFFERED                          │
│                                                                                                                      │
│ e) Agregar listeners waiting/playing/canplay en el video element para detectar buffer bajo                           │
│                                                                                                                      │
│ f) Mostrar overlay "Bufferizando..." cuando isBuffering es true (líneas 1622-1630)                                   │
│                                                                                                                      │
│ g) Subir PLAYER_READY_TIMEOUT_MS (línea 58): 28000 → 40000                                                           │
│                                                                                                                      │
│ ---                                                                                                                  │
│ FASE 2: Reestructuración Backend (server.js → módulos)                                                               │
│                                                                                                                      │
│ Estructura resultante:                                                                                               │
│ server.js                  (~60 líneas - solo setup + imports + inicio)                                              │
│ lib/                                                                                                                 │
│   utils.js                 ← safeText, clamp, compactText, ensureDirSync, nowMs, etc.                                │
│   http.js                  ← fetchJson (wrapper genérico de fetch con timeout)                                       │
│   config.js                ← TODAS las constantes de configuración                                                   │
│   state.js                 ← estado global mutable (sessions, caches, reliability)                                   │
│   tmdb/                                                                                                              │
│     client.js              ← resolveTmdbAuth, fetchTmdb, buildTmdbUrl                                                │
│   prowlarr/                                                                                                          │
│     client.js              ← fetchProwlarrStreams, buildProwlarrQueries                                              │
│     mapper.js              ← mapProwlarrSearchResultToStream, dedupeProwlarrStreams                                  │
│   reliability/                                                                                                       │
│     tracker.js             ← registerPlaybackOutcome, buildReliabilityPenalty, circuit breaker                       │
│     persistence.js         ← loadReliabilityFromDisk, scheduleReliabilityPersist                                     │
│   sources/                                                                                                           │
│     loader.js              ← ensureConfigFiles, loadSourcesFromDisk                                                  │
│   live-tv/                                                                                                           │
│     parser.js              ← parseLiveTvPlaylist, parseM3uExtinf                                                     │
│     manager.js             ← loadLiveTvFromDisk, dedupeLiveChannels                                                  │
│   catalog/                                                                                                           │
│     fetcher.js             ← fetchTmdbCatalogItems, fetchSourceCatalogItems                                          │
│   meta/                                                                                                              │
│     resolver.js            ← resolveStreamRequest, parseTmdbCompositeId                                              │
│     details.js             ← fetchMetaDetails, mapTmdbSeasons/Episodes                                               │
│   playback/                                                                                                          │
│     client.js              ← getPlaybackClient, buildSessionMagnet                                                   │
│     sessions.js            ← createPlaybackSession, destroySession, getSessionById                                   │
│     files.js               ← pickTorrentFile, pickBestVideoFileFromList                                              │
│     hls.js                 ← startSessionHlsTranscode, waitForHlsManifest                                            │
│     stream.js              ← sessionPublicInfo, pipeTorrentFileToResponse                                            │
│   subtitles/                                                                                                         │
│     converter.js           ← streamToBuffer, toWebVtt                                                                │
│     providers.js           ← fetchProviderSubtitles, OpenSubtitles, SubDL                                            │
│     detector.js            ← detectSubtitleLanguage, pickSubtitleFiles                                               │
│   routes/                                                                                                            │
│     tmdb.js                ← GET /api/tmdb/status                                                                    │
│     sources.js             ← GET/POST /api/sources/*                                                                 │
│     catalog.js             ← GET /api/catalog/browse                                                                 │
│     streams.js             ← GET /api/streams                                                                        │
│     meta.js                ← GET /api/meta/details                                                                   │
│     subtitles.js           ← GET /api/subtitles, proxy, opensubtitles                                                │
│     live-tv.js             ← GET/POST /api/live-tv/*                                                                 │
│     playback.js            ← POST/GET/DELETE /api/playback/*                                                         │
│     reliability.js         ← GET/POST /api/streams/reliability/*                                                     │
│                                                                                                                      │
│ Orden de extracción (respeta dependencias):                                                                          │
│                                                                                                                      │
│ 1. lib/utils.js — funciones puras sin deps                                                                           │
│ 2. lib/config.js — constantes (importa utils)                                                                        │
│ 3. lib/state.js — estado global mutable                                                                              │
│ 4. lib/http.js — fetchJson genérico                                                                                  │
│ 5. lib/tmdb/client.js — depende de utils, config, state, http                                                        │
│ 6. lib/reliability/tracker.js + persistence.js — depende de utils, config, state                                     │
│ 7. lib/prowlarr/mapper.js + client.js — depende de utils, config, http, tmdb, reliability                            │
│ 8. lib/sources/loader.js — depende de utils, config, state                                                           │
│ 9. lib/live-tv/parser.js + manager.js — depende de utils, config, state                                              │
│ 10. lib/catalog/fetcher.js — depende de utils, config, state, http, tmdb                                             │
│ 11. lib/meta/resolver.js + details.js — depende de utils, tmdb, config                                               │
│ 12. lib/subtitles/converter.js + detector.js + providers.js — depende de utils, config, http                         │
│ 13. lib/playback/client.js + files.js + hls.js + sessions.js + stream.js — depende de utils, config, state,          │
│ reliability, subtitles                                                                                               │
│ 14. lib/routes/*.js — cada archivo recibe app y registra sus endpoints                                               │
│ 15. Simplificar server.js a ~60 líneas (setup + imports + startServer)                                               │
│                                                                                                                      │
│ Patrón de cada módulo de rutas:                                                                                      │
│                                                                                                                      │
│ // lib/routes/playback.js                                                                                            │
│ function registerPlaybackRoutes(app) {                                                                               │
│   app.post("/api/playback/sessions", async (req, res) => { ... });                                                   │
│   // ...                                                                                                             │
│ }                                                                                                                    │
│ module.exports = { registerPlaybackRoutes };                                                                         │
│                                                                                                                      │
│ Estado mutable compartido:                                                                                           │
│                                                                                                                      │
│ state.js exporta objetos (Map, Object) que se mutan por referencia. Las variables let (playbackClient,               │
│ reliabilityPersistTimer) se exponen via getters/setters.                                                             │
│                                                                                                                      │
│ ---                                                                                                                  │
│ FASE 3: Reestructuración Frontend (WatchPage.tsx → módulos)                                                          │
│                                                                                                                      │
│ Estructura resultante:                                                                                               │
│ web/src/                                                                                                             │
│   lib/                                                                                                               │
│     release-hints.ts       ← extractReleaseHints, normalizeReleaseText, RELEASE_STOPWORDS                            │
│     candidate-scoring.ts   ← estimateAutoPlaybackScore, dedupeCandidates, diversifyByProvider,                       │
│ isCandidateBrowserCompatible                                                                                         │
│     subtitle-scoring.ts    ← scoreSubtitleTrackMatch                                                                 │
│     subtitle-memory.ts     ← read/write/trimSubtitleMemoryStore                                                      │
│     subtitle-tracks.ts     ← UiSubtitleTrack, dedupeSubtitleTracks                                                   │
│     audio-preferences.ts   ← normalizeLanguageCode, getAudioPriorityOrder, extractCandidateLanguageHints             │
│     video-helpers.ts       ← waitForVideoReady, startVideo, qualityFromResolution, constantes                        │
│   hooks/                                                                                                             │
│     useHlsPlayer.ts        ← attachVideoSource, hls.js lifecycle, isBuffering                                        │
│     usePlaybackSession.ts  ← playMagnetWithBackend, playDirectUrl, clearActivePlayback                               │
│     useStreamCandidates.ts ← loadStreamCandidates, applyCandidatePreferences, playWithFallback                       │
│     useSubtitleSelection.ts← scoring, memory, failover, refreshAddonSubtitles                                        │
│     useMetaDetails.ts      ← fetchMetaDetails, sync season/episode                                                   │
│   views/                                                                                                             │
│     WatchPage.tsx           (~450-500 líneas - solo composición de hooks + JSX)                                      │
│                                                                                                                      │
│ Orden de extracción:                                                                                                 │
│                                                                                                                      │
│ 1. lib/release-hints.ts — sin deps internas                                                                          │
│ 2. lib/subtitle-memory.ts — sin deps internas                                                                        │
│ 3. lib/audio-preferences.ts — sin deps internas                                                                      │
│ 4. lib/subtitle-tracks.ts — sin deps internas                                                                        │
│ 5. lib/video-helpers.ts — sin deps internas                                                                          │
│ 6. lib/subtitle-scoring.ts — depende de release-hints                                                                │
│ 7. lib/candidate-scoring.ts — depende de release-hints, subtitle-scoring, subtitle-tracks                            │
│ 8. hooks/useHlsPlayer.ts — usa hls.js externo                                                                        │
│ 9. hooks/useMetaDetails.ts — usa api.ts                                                                              │
│ 10. hooks/useSubtitleSelection.ts — usa lib/*                                                                        │
│ 11. hooks/usePlaybackSession.ts — usa api.ts, useHlsPlayer                                                           │
│ 12. hooks/useStreamCandidates.ts — usa lib/*, playback session                                                       │
│ 13. Simplificar WatchPage.tsx — composición de hooks + JSX puro                                                      │
│                                                                                                                      │
│ ---                                                                                                                  │
│ Verificación                                                                                                         │
│                                                                                                                      │
│ Fase 1 (HLS fix):                                                                                                    │
│                                                                                                                      │
│ 1. Iniciar servidor con npm run dev                                                                                  │
│ 2. Reproducir un torrent con archivo .mkv (no nativo del browser)                                                    │
│ 3. Verificar que el player no muere a los 15-19 segundos                                                             │
│ 4. Verificar que aparece "Bufferizando..." si el torrent es lento                                                    │
│ 5. Verificar que la recuperación funciona (el video continúa tras buffering)                                         │
│ 6. Verificar que streams .mp4 nativos siguen funcionando sin cambios                                                 │
│                                                                                                                      │
│ Fase 2 (backend refactor):                                                                                           │
│                                                                                                                      │
│ 1. npm start — servidor arranca sin errores                                                                          │
│ 2. Probar cada grupo de endpoints:                                                                                   │
│   - Catálogo: buscar películas                                                                                       │
│   - Streams: obtener streams de un título                                                                            │
│   - Playback: crear sesión, verificar HLS y directo                                                                  │
│   - Subtítulos: obtener subtítulos                                                                                   │
│   - Live TV: listar canales                                                                                          │
│   - Reliability: ver estadísticas                                                                                    │
│ 3. Verificar que no hay regresión en ningún endpoint                                                                 │
│                                                                                                                      │
│ Fase 3 (frontend refactor):                                                                                          │
│                                                                                                                      │
│ 1. npm run dev:web — frontend compila sin errores TypeScript                                                         │
│ 2. Navegar a Home, buscar título, reproducir                                                                         │
│ 3. Verificar subtítulos automáticos                                                                                  │
│ 4. Verificar cambio de calidad                                                                                       │
│ 5. Verificar playback de series (season/episode)                                                                     │
│ 6. Verificar Live TV                      
---

## Update 2026-02-13 - Auto playback behavior and quality UX

### Endpoint usage
- `POST /api/playback/auto` is the valid call.
- `GET /api/playback/auto` in `http://localhost:5173` can return the web app HTML (Vite dev server fallback), not a playback payload.

### Selection policy (current)
1. Backend validates direct HTTP streams first (`.mp4`, `.m4v`, `.webm`, `.m3u8`).
2. If no direct stream is valid, backend falls back to session playback from torrent sources.
3. Fallback can return:
- `mode: "session", streamKind: "direct"` (torrent file is browser-compatible, no HLS conversion)
- `mode: "session", streamKind: "hls"` (needs HLS conversion, returns m3u8 + segments)

### Why "Comet blocked" appears
- Some Comet instances return a non-playable block URL (for non-debrid mode).
- Backend correctly rejects that URL as incompatible direct playback.

### Quality response contract
- Backend always returns:
- `selectedQuality` (quality selected by backend)
- `availableQualities` (qualities validated in that run)

### Fixes applied for quality switching UX
- When a quality is requested (example: `720p`), backend now prioritizes that quality first but still evaluates other qualities when budget allows.
- Frontend no longer collapses the selector to a single option after a manual quality switch if more validated qualities were already available in the current playback context.

### Practical example observed
- Auto selected a 4K source that required HLS conversion (slower startup).
- Manual `720p` selected an `.mp4` torrent file and returned `session/direct` (`/stream`) with much faster start.
- This behavior is expected with mixed source formats and startup constraints.

### Auto policy (updated)
- In `quality=auto`, backend now prefers validated native playback (`streamKind=direct`) over HLS, even if native is lower resolution.
- Only when no native option validates, backend returns HLS/transcoded playback.
- Goal: fastest stable start first, then quality.
- In auto mode, each fallback candidate now uses a capped readiness wait (shorter for non-web-friendly sources) to avoid getting stuck on a single slow 4K/HLS candidate.
- Note: candidate wait capping was tested but removed because it caused false negatives (502) in unstable swarms.

## Update 2026-02-13 - Pending checklist status

### Closed
- README aligned with current HLS defaults (`PLAYBACK_HLS_START_TIMEOUT_MS=120000`, `PLAYBACK_HLS_READY_SEGMENTS=6`).
- README now documents `POST /api/playback/auto` and clarifies that `GET /api/playback/auto` is not a valid API endpoint.
- Frontend hook debt closed:
  - `web/src/hooks/usePlaybackSession.ts`
  - `web/src/hooks/useStreamCandidates.ts`
- `WatchPage.tsx` now uses the new hooks and keeps buffering/recovery behavior.

### Still pending
- Full manual end-to-end QA pass from this document (playback runtime scenarios, subtitles failover, Live TV).
- `Control panel + observability + cache` remains roadmap work; there is no `/api/admin/*` implementation yet.

## Update 2026-02-13 - Preflight fast-start strategy implemented

- Backend:
  - `POST /api/playback/preflight` added with:
    - functional quality pre-check (direct probe + warmup sessions)
    - in-memory cache (TTL)
    - recommended playback payload + `preferredSourceKey`
  - `POST /api/playback/metrics` added for client-side TTFQ/TTFF reporting
  - `/api/playback/auto` now accepts `preferredSourceKey` to prioritize preflight recommendation
  - playback session reuse by `sourceKey` (avoid re-creating same torrent session)
- Frontend:
  - Watch page now calls `preflight` on load (without pressing play) to preload available qualities
  - in movie autoplay mode, it uses preflight recommendation first and falls back to `auto`
  - reports `ttfq` and `ttff` metrics to backend
