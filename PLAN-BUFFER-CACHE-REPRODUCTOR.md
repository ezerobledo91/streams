# Plan de Optimizacion - Buffer, Cache, Reproductor y Prefetch

> Documento generado: 2026-02-15
> Objetivo: Mejorar experiencia de reproduccion, reducir tiempos de espera, prefetch inteligente

---

## INDICE

1. [Diagnostico actual del sistema](#1-diagnostico-actual)
2. [Buffer y HLS - Optimizacion](#2-buffer-y-hls)
3. [Alternativas de reproductor](#3-alternativas-de-reproductor)
4. [Cache - Estrategia completa](#4-cache-estrategia-completa)
5. [Prefetch de episodios (series)](#5-prefetch-de-episodios)
6. [Prefetch de favoritos y "Para ver mas tarde"](#6-prefetch-de-favoritos)
7. [Optimizacion WebTorrent](#7-optimizacion-webtorrent)
8. [Live TV - Buffer y reconexion](#8-live-tv-buffer-y-reconexion)
9. [Resumen de cambios](#9-resumen-de-cambios)

---

## 1. Diagnostico actual

### Stack de reproduccion
- **Backend**: WebTorrent v2.8.5 (libtorrent) + ffmpeg (transcode HLS)
- **Frontend**: hls.js v1.6.15 + `<video>` nativo HTML5
- **Formatos nativos**: .mp4, .webm, .m4v (streaming directo)
- **Formatos que requieren transcode**: .mkv, .avi, .ts, .wmv, etc. (ffmpeg → HLS)

### Configuracion HLS actual
| Parametro | Valor | Descripcion |
|-----------|-------|-------------|
| `PLAYBACK_HLS_SEGMENT_SECONDS` | 6s | Duracion de cada segmento .ts |
| `PLAYBACK_HLS_READY_SEGMENTS` | 6 | Segmentos minimos antes de empezar (= 36s de espera) |
| `PLAYBACK_HLS_START_TIMEOUT_MS` | 120s | Timeout maximo esperando ffmpeg |
| `PLAYBACK_HLS_PRESET` | ultrafast | Preset de ffmpeg (ya el mas rapido) |
| `PLAYBACK_HLS_MAX_HEIGHT` | 1080p | Resolucion maxima |
| `PLAYBACK_HLS_CRF` | 23 | Calidad (23 es default, 28 seria mas rapido) |
| `PLAYBACK_HLS_VIDEO_MAXRATE_KBPS` | auto | Bitrate maximo segun resolucion |

### Buffer HLS.js (frontend)
| Parametro | Valor | Descripcion |
|-----------|-------|-------------|
| `maxBufferLength` | 60s | Buffer maximo adelantado |
| `maxMaxBufferLength` | 120s | Limite absoluto de buffer |
| `backBufferLength` | 90s | Buffer de contenido ya visto |
| `liveSyncDurationCount` | 6 | Segmentos de sync para live |
| `liveMaxLatencyDurationCount` | 12 | Latencia maxima en live |
| `fragLoadingMaxRetry` | 8 | Reintentos por fragmento |

### Caches existentes
| Cache | Ubicacion | TTL | Que guarda |
|-------|-----------|-----|------------|
| Manifest addons | Backend (memoria) | 5 min | Manifiestos de proveedores de catalogo |
| Preflight playback | Backend (memoria) | 45s | Resultados de busqueda de streams |
| Availability batch | Frontend (memoria) | Infinito (sesion) | Si un titulo tiene streams disponibles |
| Watch history | Frontend (localStorage) | Permanente | Posicion de reproduccion, max 50 |
| Reliability | Backend (archivo JSON) | Permanente | Estadisticas de exito/fallo por proveedor |

### Sesiones de playback
- Max 5 sesiones simultaneas (`PLAYBACK_MAX_SESSIONS=5`)
- TTL de 30 minutos de inactividad (`PLAYBACK_SESSION_TTL_MS`)
- Max 36 conexiones WebTorrent (`PLAYBACK_MAX_CONNS=36`)
- Se reusan sesiones si el sourceKey coincide

### Problemas identificados
1. **36 segundos de espera minima** para HLS (6 segmentos x 6s)
2. **Sin prefetch** de episodios siguientes
3. **Cache de preflight muy corto** (45s) - se vuelve a buscar al cambiar episodio
4. **Sin cache de streams** a nivel de catalogo (cada busqueda es nueva)
5. **backBufferLength=90s** desperdicia memoria en TVs con poca RAM
6. **Sin codec check** antes de intentar reproducir directo (puede fallar en .mp4 con HEVC)

---

## 2. Buffer y HLS

### A. Reducir tiempo de inicio HLS

El cuello de botella mas grande: se esperan 6 segmentos de 6s = 36 segundos minimo antes de poder reproducir.

```env
# ANTES:
PLAYBACK_HLS_SEGMENT_SECONDS=6
PLAYBACK_HLS_READY_SEGMENTS=6

# PROPUESTA:
PLAYBACK_HLS_SEGMENT_SECONDS=4     # Segmentos mas cortos (4s)
PLAYBACK_HLS_READY_SEGMENTS=3      # Solo 3 segmentos para arrancar
# Resultado: 3 x 4 = 12 segundos vs 36 segundos actuales
```

**Impacto**: Reduccion de ~24 segundos en el tiempo de inicio de HLS.

**Trade-off**: Segmentos de 4s generan mas overhead HTTP, pero en local (localhost) es irrelevante.

### B. Subir CRF para velocidad de transcode

```env
# ANTES:
PLAYBACK_HLS_CRF=23

# PROPUESTA:
PLAYBACK_HLS_CRF=26     # Menos calidad visual pero transcode 30-40% mas rapido
```

**Contexto**: CRF 26 en ultrafast es perfectamente aceptable para TV a distancia de sofa. La diferencia visual es minima.

### C. Optimizar configuracion HLS.js (frontend)

```typescript
// useHlsPlayer.ts - CAMBIOS
const hls = new Hls({
  enableWorker: true,
  lowLatencyMode: false,

  // REDUCIR back buffer (TVs tienen poca RAM)
  backBufferLength: 30,           // ERA: 90 → menos memoria

  // Buffer mas agresivo hacia adelante
  maxBufferLength: 45,            // ERA: 60 → suficiente, no desperdiciar
  maxMaxBufferLength: 90,         // ERA: 120 → reducir para TVs

  // Inicio mas rapido
  startPosition: -1,
  maxBufferHole: 2.5,             // ERA: 1.5 → mas tolerante a huecos

  // Live TV optimizado
  liveSyncDurationCount: 4,       // ERA: 6 → menos latencia en live
  liveMaxLatencyDurationCount: 8, // ERA: 12 → catch-up mas agresivo
  liveBackBufferLength: 15,       // NUEVO: minimo back buffer en live

  // Reintentos mas rapidos
  manifestLoadingRetryDelay: 1000,    // ERA: 2000
  manifestLoadingMaxRetryTimeout: 20000, // ERA: 30000
  manifestLoadingMaxRetry: 15,        // ERA: 20
  levelLoadingRetryDelay: 1000,       // ERA: 2000
  levelLoadingMaxRetryTimeout: 15000, // ERA: 20000
  fragLoadingMaxRetry: 6,            // ERA: 8
  fragLoadingRetryDelay: 800,        // ERA: 1500
  fragLoadingMaxRetryTimeout: 12000, // ERA: 20000

  // Stall recovery
  nudgeMaxRetry: 8,                   // ERA: 5 → mas intentos antes de rendirse
  nudgeOffset: 0.2,                   // NUEVO: offset mas chico
});
```

### D. Agregar ABR (Adaptive Bitrate) al transcode

Actualmente se genera 1 sola calidad HLS. Para TVs con conexion variable, generar multiples calidades:

```javascript
// lib/playback/hls.js - ffmpeg con multiples calidades
// Opcion 1: Simple (un solo output pero con maxrate adaptable)
// Opcion 2: Multi-quality HLS (mas complejo)

// RECOMENDACION: Opcion 1 es suficiente para uso local
// El maxrate auto actual ya escala segun resolucion:
// ≤576p → 700kbps
// ≤720p → 1000kbps
// ≤1080p → 1800kbps
// >1080p → 2800kbps

// MEJORA: Bajar maxrate para inicio rapido del contenido
// y que suba gradualmente (ya lo maneja el codec con CRF)
```

---

## 3. Alternativas de reproductor

### Estado actual
- `<video>` nativo + hls.js para HLS
- Sin reproductor custom (controles del navegador)

### Opciones evaluadas

| Reproductor | Pros | Contras | Recomendacion |
|-------------|------|---------|---------------|
| **Video.js** | Controles custom, plugins, temas | 200KB+ extra, pesado para TV | NO |
| **Shaka Player** | DASH + HLS, DRM, ABR avanzado | Complejo, innecesario sin DRM | NO |
| **Plyr** | UI bonita, liviano (25KB) | No soporta HLS nativo, necesita hls.js igual | OPCIONAL |
| **hls.js (actual)** | Liviano, solo HLS, bien mantenido | Solo HLS, sin DASH | MANTENER |
| **Media Chrome** | Web Components, accesible, TV-friendly | Nuevo, menos comunidad | CONSIDERAR |
| **dash.js** | DASH nativo | No necesario, todo es HLS/MP4 | NO |

### Recomendacion: Mantener hls.js + controles custom propios

**Razon**: Para PWA en TV, los controles del navegador (`<video controls>`) no son navegables con D-pad. La solucion es:

1. **Quitar `controls` del `<video>`** y crear controles custom con botones HTML
2. Los controles custom son navegables con D-pad (tabIndex, focus management)
3. hls.js sigue manejando el streaming, solo cambia la UI de controles

```typescript
// Controles custom para TV:
<div className="custom-player-controls" data-tv-focusable>
  <button onClick={togglePlay}>Play/Pause</button>
  <input type="range" value={currentTime} onChange={seek} />  {/* Progress bar */}
  <button onClick={skipBack10}>-10s</button>
  <button onClick={skipForward10}>+10s</button>
  <button onClick={toggleMute}>Mute</button>
  <input type="range" value={volume} onChange={setVolume} />
  <button onClick={toggleFullscreen}>Fullscreen</button>
</div>
```

### Alternativa para formatos problematicos: mpv.js / libmpv

Para archivos que ffmpeg tarda mucho en transcodear (4K HEVC con HDR), una alternativa seria integrar libmpv via WebAssembly. **Pero esto es extremadamente complejo y no recomendado para una PWA**. El approach de ffmpeg + HLS es el correcto.

### NUEVA libreria recomendada: `media-chrome`

```bash
npm install media-chrome
```

- Web Components accesibles
- Soporte nativo de teclado/D-pad
- Temas oscuros incluidos
- Solo 15KB gzipped
- Se integra con hls.js

```html
<media-controller>
  <video slot="media" ref={videoRef}></video>
  <media-control-bar>
    <media-play-button></media-play-button>
    <media-seek-backward-button></media-seek-backward-button>
    <media-seek-forward-button></media-seek-forward-button>
    <media-time-range></media-time-range>
    <media-time-display></media-time-display>
    <media-mute-button></media-mute-button>
    <media-volume-range></media-volume-range>
    <media-fullscreen-button></media-fullscreen-button>
  </media-control-bar>
</media-controller>
```

**Ventaja clave para TV**: media-chrome maneja keyboard navigation out-of-the-box.

---

## 4. Cache - Estrategia completa

### A. Cache de streams por titulo (backend)

Actualmente el preflight cache dura 45 segundos. Para series donde el usuario cambia de episodio frecuentemente, esto es muy poco.

```javascript
// lib/routes/playback.js
// ANTES:
const PREFLIGHT_CACHE_TTL_MS = 45 * 1000;

// PROPUESTA: Cache por niveles
const PREFLIGHT_CACHE_TTL_SERIES_MS = 5 * 60 * 1000;  // 5 min para series
const PREFLIGHT_CACHE_TTL_MOVIE_MS = 3 * 60 * 1000;   // 3 min para peliculas
const PREFLIGHT_CACHE_TTL_RETRY_MS = 30 * 1000;        // 30s si fallo (para reintentar rapido)
```

### B. Cache de resultados de Prowlarr (backend)

Prowlarr es la fuente mas lenta (12-18s). Cachear sus resultados:

```javascript
// lib/prowlarr/client.js - NUEVO
const prowlarrCache = new Map();
const PROWLARR_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

async function fetchProwlarrStreams(params) {
  const cacheKey = `${params.type}|${params.resolvedItemId}|${params.season}|${params.episode}`;
  const cached = prowlarrCache.get(cacheKey);
  if (cached && Date.now() - cached.at < PROWLARR_CACHE_TTL_MS) {
    return cached.result;
  }

  const result = await _actualFetchProwlarr(params);
  prowlarrCache.set(cacheKey, { result, at: Date.now() });
  return result;
}
```

### C. Cache de manifiestos de catalogo (backend)

Actualmente 5 minutos. Subir a 15 minutos ya que los cataalogos no cambian tan seguido:

```javascript
// lib/catalog/fetcher.js
// ANTES:
manifestCache.set(cacheKey, { payload, expiresAt: now + 5 * 60 * 1000 });

// PROPUESTA:
manifestCache.set(cacheKey, { payload, expiresAt: now + 15 * 60 * 1000 });
```

### D. Cache de disponibilidad mejorado (frontend)

El cache actual es en memoria y se pierde al recargar. Persistir en sessionStorage:

```typescript
// web/src/lib/availability-cache.ts - MEJORA
// Al flush del batch, guardar en sessionStorage
function persistToSession() {
  const entries: [string, boolean][] = [];
  for (const [key, value] of cache.entries()) {
    entries.push([key, value]);
  }
  try {
    sessionStorage.setItem("streams_avail_cache", JSON.stringify(entries));
  } catch { /* full */ }
}

// Al iniciar, cargar de sessionStorage
function loadFromSession() {
  try {
    const raw = sessionStorage.getItem("streams_avail_cache");
    if (!raw) return;
    const entries: [string, boolean][] = JSON.parse(raw);
    for (const [key, value] of entries) {
      cache.set(key, value);
    }
  } catch { /* corrupt */ }
}

loadFromSession(); // Al cargar el modulo
```

### E. Cache de metadata TMDB (backend)

Agregar cache de resultados TMDB que actualmente no se cachean:

```javascript
// lib/tmdb/client.js - NUEVO cache
const tmdbCache = new Map();
const TMDB_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

async function fetchTmdb(path, params) {
  const cacheKey = `${path}|${JSON.stringify(params)}`;
  const cached = tmdbCache.get(cacheKey);
  if (cached && Date.now() - cached.at < TMDB_CACHE_TTL_MS) {
    return cached.payload;
  }
  const payload = await _actualFetchTmdb(path, params);
  tmdbCache.set(cacheKey, { payload, at: Date.now() });

  // Limitar tamano del cache
  if (tmdbCache.size > 500) {
    const oldest = [...tmdbCache.entries()]
      .sort((a, b) => a[1].at - b[1].at)
      .slice(0, 100);
    for (const [key] of oldest) tmdbCache.delete(key);
  }

  return payload;
}
```

---

## 5. Prefetch de episodios (series)

### Concepto

Cuando el usuario esta viendo T1E03, **pre-buscar streams para T1E04** en background para que cuando termine el episodio y pase al siguiente, la reproduccion sea casi instantanea.

### Implementacion Backend

```javascript
// lib/routes/playback.js - NUEVO endpoint
// POST /api/playback/prefetch-next
app.post("/api/playback/prefetch-next", async (req, res) => {
  const { type, itemId, season, episode, audioPreference, originalLanguage } = req.body;

  // Solo para series
  if (type !== "series") return res.json({ prefetched: false });

  const nextEpisode = Number(episode) + 1;

  // Buscar streams para el proximo episodio en background
  // (no bloquea la respuesta)
  setImmediate(async () => {
    try {
      const audioSelection = parseAudioSelection(req);
      const aggregated = await fetchAggregatedStreams({
        type, itemId,
        season: String(season),
        episode: String(nextEpisode)
      });
      const candidates = buildCandidatesFromResults(aggregated.results, audioSelection);
      const ordered = orderCandidatesForPlayback(candidates, "auto").slice(0, 3);

      // Guardar en cache de preflight
      const cacheKey = buildPreflightCacheKey({
        type, itemId,
        season: String(season),
        episode: String(nextEpisode),
        quality: "auto",
        maxCandidates: 3,
        audioPreference,
        originalLanguage
      });
      playbackPreflightCache.set(cacheKey, {
        candidates: ordered,
        cachedAt: Date.now()
      });
    } catch {
      // Silencioso - es prefetch, no critico
    }
  });

  res.json({ prefetched: true, nextEpisode });
});
```

### Implementacion Frontend

```typescript
// web/src/views/WatchPage.tsx - NUEVO
// Cuando el video supera el 70% de progreso, prefetch del siguiente episodio
useEffect(() => {
  if (!isSeries || !metaDetails) return;

  const video = videoRef.current;
  if (!video) return;

  function checkProgress() {
    if (!video || video.duration <= 0) return;
    const progress = video.currentTime / video.duration;

    if (progress >= 0.70 && !prefetchedRef.current) {
      prefetchedRef.current = true;
      // Buscar si hay episodio siguiente
      const nextEp = episodeList.find(e =>
        e.season === season && e.episode === episode + 1
      );
      if (nextEp) {
        void prefetchNextEpisode({
          type: "series",
          itemId: decodedItemId,
          season,
          episode: episode + 1,
          audioPreference,
          originalLanguage
        });
      }
    }
  }

  video.addEventListener("timeupdate", checkProgress);
  return () => video.removeEventListener("timeupdate", checkProgress);
}, [isSeries, season, episode, episodeList]);
```

### Pre-crear sesion de torrent del siguiente episodio

Ir un paso mas alla: no solo buscar streams, sino empezar a descargar el torrent:

```javascript
// Cuando el prefetch encuentra un candidato con magnet:
// Crear la sesion de playback pero sin empezar HLS
// Asi los metadatos del torrent ya estan listos

async function prefetchTorrentSession(candidate) {
  const session = await createPlaybackSession({
    magnet: candidate.magnet,
    infoHash: candidate.infoHash,
    displayName: candidate.displayName,
    trackers: candidate.trackers,
    fileIdx: candidate.fileIdx,
    providerId: candidate.providerId,
    sourceKey: candidate.sourceKey,
    season: candidate.season,
    episode: candidate.episode
  });
  // La sesion se crea, WebTorrent conecta peers y descarga metadata
  // Cuando el usuario cambie de episodio, la sesion ya existe
  // y createPlaybackSession() la va a reusar (sourceKey match)
  return session;
}
```

---

## 6. Prefetch de favoritos

### Concepto

Cuando el usuario agrega algo a favoritos o "Para ver mas tarde", hacer un pre-scan de streams disponibles en background para que cuando quiera verlo, ya sepamos donde encontrarlo.

### Implementacion

```javascript
// Backend: POST /api/playback/warm-cache
// Se llama cuando se agrega a favoritos
app.post("/api/playback/warm-cache", async (req, res) => {
  const items = req.body.items; // Array de { type, itemId }

  res.json({ queued: items.length });

  // Procesar en background, de a uno para no saturar
  for (const item of items.slice(0, 5)) {
    try {
      await fetchAggregatedStreams({
        type: item.type,
        itemId: item.itemId
      });
      // El resultado queda en cache de Prowlarr y preflight
    } catch {
      // Silencioso
    }
    // Esperar 2s entre items para no saturar proveedores
    await new Promise(r => setTimeout(r, 2000));
  }
});
```

### Frontend: "Continue Watching" pre-warm

Cuando se carga el HomePage, pre-cachear streams para los items de "Seguir viendo":

```typescript
// web/src/views/HomePage.tsx
useEffect(() => {
  const continueWatching = getContinueWatching();
  if (!continueWatching.length) return;

  // Pre-warm los primeros 3 items
  const items = continueWatching.slice(0, 3).map(entry => ({
    type: entry.type,
    itemId: entry.itemId
  }));

  void warmStreamCache(items).catch(() => {});
}, []);
```

---

## 7. Optimizacion WebTorrent

### A. Aumentar conexiones

```env
# ANTES:
PLAYBACK_MAX_CONNS=36

# PROPUESTA:
PLAYBACK_MAX_CONNS=55    # Mas peers = mas velocidad de descarga
```

### B. Priorizar piezas iniciales del archivo

WebTorrent ya hace esto parcialmente, pero podemos reforzarlo:

```javascript
// lib/playback/sessions.js - En torrent "ready"
torrent.on("ready", () => {
  const file = pickTorrentFile(torrent, ...);
  if (file) {
    // Priorizar las primeras piezas para inicio rapido
    file.select();  // Ya lo hace WebTorrent pero reforzar

    // Deseleccionar todos los archivos que no necesitamos
    for (const otherFile of torrent.files) {
      if (otherFile !== file) {
        otherFile.deselect();
      }
    }
  }
});
```

### C. Aumentar sesiones simultaneas para prefetch

```env
# ANTES:
PLAYBACK_MAX_SESSIONS=5

# PROPUESTA:
PLAYBACK_MAX_SESSIONS=8    # Necesitamos mas para prefetch de episodios
```

### D. Detectar codec antes de intentar reproduccion directa

Evitar intentar reproducir un .mp4 con HEVC que el navegador no soporta:

```javascript
// lib/playback/files.js - NUEVO
function isLikelyHevc(fileName) {
  const name = String(fileName || "").toLowerCase();
  return /\b(hevc|h\.?265|x\.?265|10bit)\b/.test(name);
}

// En sessions.js, forzar HLS si el archivo parece HEVC
if (isLikelyHevc(file.name) || shouldUseHlsForFileName(...)) {
  session.streamKind = "hls";
  // ...
}
```

---

## 8. Live TV - Buffer y reconexion

### A. Configuracion HLS.js especifica para Live TV

La configuracion actual es la misma para VOD y Live. Crear config optimizada para live:

```typescript
// useHlsPlayer.ts - parametro mode
function createHlsConfig(mode: "vod" | "live") {
  const base = {
    enableWorker: true,
    lowLatencyMode: mode === "live",
    backBufferLength: mode === "live" ? 15 : 30,
    startPosition: -1,
    maxBufferHole: mode === "live" ? 3 : 2.5,
    fragLoadingMaxRetry: mode === "live" ? 12 : 6,
    fragLoadingRetryDelay: mode === "live" ? 500 : 800,
  };

  if (mode === "live") {
    return {
      ...base,
      maxBufferLength: 20,           // Menos buffer para live (ahorra memoria)
      maxMaxBufferLength: 40,
      liveSyncDurationCount: 3,       // Mas cerca del live edge
      liveMaxLatencyDurationCount: 6,
      liveBackBufferLength: 10,       // Minimo back buffer
      // Reconexion agresiva
      manifestLoadingMaxRetry: 30,
      manifestLoadingRetryDelay: 500,
      levelLoadingMaxRetry: 20,
      levelLoadingRetryDelay: 500,
    };
  }

  return {
    ...base,
    maxBufferLength: 45,
    maxMaxBufferLength: 90,
    liveSyncDurationCount: 4,
    liveMaxLatencyDurationCount: 8,
  };
}
```

### B. Auto-reconexion en Live TV

Cuando un canal de live falla, intentar reconectar automaticamente:

```typescript
// LiveTvPage.tsx - NUEVO
const reconnectAttemptsRef = useRef(0);
const MAX_RECONNECT_ATTEMPTS = 5;

useEffect(() => {
  if (playerState !== "error" || !selectedChannel) return;

  if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) return;

  const delay = 2000 + reconnectAttemptsRef.current * 1500; // 2s, 3.5s, 5s, 6.5s, 8s
  const timeout = setTimeout(() => {
    reconnectAttemptsRef.current += 1;
    // Forzar re-carga del canal
    lastPlaybackKeyRef.current = "";
    setPlayerState("loading");
  }, delay);

  return () => clearTimeout(timeout);
}, [playerState, selectedChannel]);

// Resetear contador al cambiar de canal o al reproducir exitosamente
useEffect(() => {
  if (playerState === "playing") {
    reconnectAttemptsRef.current = 0;
  }
}, [playerState]);
```

### C. Pre-buffer del canal siguiente/anterior

Cuando el usuario esta viendo un canal, pre-conectar (HEAD request) a los 2 canales adyacentes para verificar que estan vivos:

```typescript
// LiveTvPage.tsx - Ping de canales adyacentes
useEffect(() => {
  if (!selectedChannelId || !channels.length) return;

  const idx = channels.findIndex(ch => ch.id === selectedChannelId);
  const adjacent = [
    channels[idx - 1],
    channels[idx + 1]
  ].filter(Boolean);

  // Ping para "calentar" la conexion
  for (const ch of adjacent) {
    const probeUrl = `/api/live-tv/channels/${encodeURIComponent(ch.id)}/probe`;
    void fetch(probeUrl, { method: "HEAD" }).catch(() => {});
  }
}, [selectedChannelId, channels]);
```

---

## 9. Resumen de cambios

### Impacto estimado en tiempos

| Accion | Antes | Despues | Mejora |
|--------|-------|---------|--------|
| Inicio HLS (transcode) | ~36s | ~12s | -24s |
| Cambio de episodio (con prefetch) | ~8-15s | ~1-3s | -80% |
| Busqueda de streams (con cache Prowlarr) | ~12s | ~0s (hit) | -100% |
| Reconexion Live TV | Manual | Auto 2-8s | Automatico |
| Continue Watching (con pre-warm) | ~8-15s | ~3-5s | -60% |

### Archivos a modificar

#### Backend
| Archivo | Cambio |
|---------|--------|
| `.env` | HLS_SEGMENT=4, READY_SEGMENTS=3, CRF=26, MAX_CONNS=55, MAX_SESSIONS=8 |
| `lib/playback/hls.js` | Segmentos de 4s, 3 segmentos ready |
| `lib/playback/sessions.js` | Deselect archivos no-video, deteccion HEVC |
| `lib/playback/files.js` | Funcion isLikelyHevc() |
| `lib/prowlarr/client.js` | Cache de resultados Prowlarr (10 min) |
| `lib/catalog/fetcher.js` | Cache manifiestos 5min → 15min |
| `lib/routes/playback.js` | TTL cache por tipo, endpoint prefetch-next, warm-cache |
| `lib/tmdb/client.js` | Cache TMDB (30 min) |

#### Frontend
| Archivo | Cambio |
|---------|--------|
| `web/src/hooks/useHlsPlayer.ts` | Config separada VOD/Live, buffer reducido |
| `web/src/views/WatchPage.tsx` | Prefetch al 70%, controles custom |
| `web/src/views/LiveTvPage.tsx` | Auto-reconexion, pre-probe canales, config live |
| `web/src/views/HomePage.tsx` | Pre-warm Continue Watching |
| `web/src/lib/availability-cache.ts` | Persistir en sessionStorage |
| `web/src/api.ts` | Nuevos endpoints prefetch-next, warm-cache |

#### Nuevos archivos (opcionales)
| Archivo | Proposito |
|---------|-----------|
| `web/src/components/CustomPlayerControls.tsx` | Controles de video custom para D-pad |

### Prioridad de implementacion

**Fase 1 - Alto impacto, bajo esfuerzo** (hacer ya)
1. Cambiar .env: HLS segments 4s, ready 3, CRF 26
2. Optimizar HLS.js config (backBuffer, retries)
3. Cache Prowlarr 10 min
4. Cache preflight 5 min para series

**Fase 2 - Prefetch** (siguiente)
5. Prefetch episodio siguiente al 70%
6. Pre-warm Continue Watching
7. Deteccion HEVC → forzar HLS

**Fase 3 - Live TV**
8. Config HLS separada para live
9. Auto-reconexion de canales
10. Pre-probe canales adyacentes

**Fase 4 - Reproductor** (si se necesita)
11. Evaluar media-chrome para controles TV
12. Controles custom con D-pad
13. Cache disponibilidad en sessionStorage

---

## Notas tecnicas

- **Memoria en Smart TVs**: Las TVs tienen 1-2GB RAM total. El back buffer de 90s consumia ~50-80MB innecesariamente. Reducirlo a 30s (VOD) y 15s (Live) ahorra RAM significativa.
- **WebTorrent en TV**: El rendimiento de WebTorrent depende de WebRTC, que funciona bien en Android TV / Tizen pero puede ser limitado en WebOS (LG). Si WebTorrent no funciona bien, priorizar candidatos con `directUrl` sobre `magnet` en el scoring.
- **ffmpeg**: El preset `ultrafast` ya es el mas rapido. Subir CRF es la unica otra palanca sin cambiar a encoding por GPU (que no esta disponible en server local tipico).
- **Sesiones de prefetch**: Las sesiones pre-creadas se auto-eliminan a los 30min (TTL). Si el usuario no llega a ver el episodio, no hay leak.
