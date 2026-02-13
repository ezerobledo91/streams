# Streams React MVP

Demo personal con frontend React para navegar catalogo y reproducir por addons.

## Arquitectura actual

- **Frontend**: React + React Router (`/` dashboard, `/watch/:type/:itemId` reproduccion, `/live-tv` TV en vivo).
- **Catalogo**: TMDB (si hay credenciales) + addons de catalogo como fallback.
- **Streams**: addons de streams (torrents, m3u, etc) + Prowlarr opcional para indexers propios.
- **Subtitulos**: archivos del torrent + addons de subtitulos (`/api/subtitles`) + proxy a VTT (`/api/subtitles/proxy`).
- **Fallback externo de subtitulos (opcional)**:
  - OpenSubtitles oficial si defines `OPEN_SUBTITLES_API_KEY`.
  - SubDL si defines `SUBDL_API_KEY`.
- **Player**:
  - peliculas: autoplay de la mejor opcion
  - series: no autoplay (cambio manual de episodio/calidad)
- **Motor torrent backend**: las sesiones torrent se resuelven en Node (`/api/playback/sessions`) para evitar limitaciones WebRTC del navegador.
- **Compatibilidad web ampliada**: si el archivo no es reproducible nativamente (ej. MKV/AVI), backend genera HLS con `ffmpeg` y sirve `m3u8` para PWA (mobile/Android TV).
- **Store**: estado global liviano (categoria, query, fuentes, item seleccionado).

## Configuracion de fuentes (JSON)

La app usa dos archivos:

- `config/catalog-manifests.json`
- `config/stream-manifests.json`
- `config/subtitles-manifes.json` (tambien se acepta `subtitles-manifests.json`)

Formato:

```json
{
  "providers": [
    {
      "id": "cinemeta",
      "name": "Cinemeta",
      "manifestUrl": "https://v3-cinemeta.strem.io/manifest.json",
      "active": true,
      "priority": 100,
      "categories": ["movie", "series", "tv"]
    }
  ]
}
```

Notas:

- `manifestUrl` es obligatorio.
- `priority` mayor = mayor prioridad.
- `categories` es opcional; si no se define, se considera para todas.
- Puedes editar los JSON y luego usar el boton **Recargar fuentes JSON** en la UI.

## Variables de entorno

La app carga `.env` automaticamente usando `dotenv`.

Ejemplo (`.env`):

```env
PORT=8787
TMDB_BEARER_TOKEN=tu_token
TMDB_API_KEY=
TMDB_LANGUAGE=es-ES
LIVE_TV_LISTS_DIR=
SUBDL_API_KEY=
OPEN_SUBTITLES_API_KEY=
OPEN_SUBTITLES_USER_AGENT=streams_app v1.0
SUBTITLE_LANGS=ES
PROWLARR_ENABLED=true
PROWLARR_URL=http://localhost:9696
PROWLARR_API_KEY=
RELIABILITY_MIN_SAMPLES=3
RELIABILITY_CIRCUIT_THRESHOLD=4
RELIABILITY_CIRCUIT_BASE_MS=900000
RELIABILITY_MAX_SOURCES_PER_PROVIDER=1800
PLAYBACK_MAX_SESSIONS=5
PLAYBACK_MAX_CONNS=36
PLAYBACK_ATTEMPT_LOG_LIMIT=500
PLAYBACK_HLS_ENABLED=true
PLAYBACK_HLS_FORCE=false
PLAYBACK_HLS_START_TIMEOUT_MS=120000
PLAYBACK_HLS_STALL_MS=60000
PLAYBACK_HLS_STALL_MIN_SPEED_BPS=20000
PLAYBACK_HLS_SEGMENT_SECONDS=6
PLAYBACK_HLS_CRF=23
PLAYBACK_HLS_VIDEO_MAXRATE_KBPS=0
PLAYBACK_HLS_READY_SEGMENTS=6
PLAYBACK_HLS_PRESET=ultrafast
PLAYBACK_HLS_MAX_HEIGHT=1080
PLAYBACK_HLS_DIR=
FFMPEG_PATH=ffmpeg
SUBTITLE_PROVIDER_TIMEOUT_MS=8000
SUBTITLE_PROVIDER_REDIRECT_TIMEOUT_MS=3500
```

Con TMDB configurado:

- peliculas/series usan catalogo TMDB primero
- ids `tmdb:movie:123` / `tmdb:tv:456` se convierten automaticamente a `imdb tt...` para consultar streams

Con Prowlarr configurado:

- `/api/streams` agrega resultados desde Prowlarr junto con los addons.
- si necesitas desactivarlo temporalmente: `PROWLARR_ENABLED=false`.
- el ranking aprende con exito/fallo real de reproduccion y activa circuit-breaker temporal por provider inestable.

Requisito para HLS/transcode:
- instalar `ffmpeg` en el servidor y dejarlo accesible en PATH (o configurar `FFMPEG_PATH`).

## Ejecutar

```bash
npm install
npm run setup:web
npm run dev
```

o

```bash
npm run setup:web
npm run build
npm start
```

Desarrollo:
- frontend: `http://localhost:5173`
- api: `http://localhost:8787`

Produccion local:
- `http://localhost:8787` (Express sirve `web/dist`)

## Flujo de uso

1. Elegir categoria y usar busqueda/filtros del dashboard.
2. Entrar a un titulo desde los carruseles.
3. En peliculas, la app intenta autoplay.
4. En series, elegir temporada/episodio y luego calidad para reproducir.
5. Seleccionar subtitulo por opcion en el selector.
6. Para TV en vivo, entrar a `/live-tv`, elegir categoria/canal y reproducir stream M3U directo.

## Endpoints principales

- `GET /api/sources`
- `POST /api/sources/reload`
- `GET /api/catalog/browse?category=movie|series|tv&query=...`
- `GET /api/streams?type=...&itemId=...&season=...&episode=...`
- `GET /api/streams/reliability?limit=20`
- `POST /api/streams/reliability/reset` (opcional `providerId`, `sourceKey`)
- `GET /api/playback/attempts?limit=120&providerId=torrentio&sessionId=...`
- `GET /api/subtitles?type=...&itemId=...&season=...&episode=...`
- `GET /api/subtitles/proxy?url=...&ext=.srt|.vtt|.zip`
- `GET /api/subtitles/opensubtitles/file/:fileId?ext=.srt|.vtt|.zip`
- `GET /api/meta/details?type=...&itemId=...&season=...&episode=...`
- `GET /api/tmdb/status`
- `POST /api/playback/preflight` (precarga de calidades funcionales + recomendacion)
- `POST /api/playback/auto` (`quality=auto|4k|1080p|720p|sd`)
- `POST /api/playback/metrics` (TTFQ/TTFF y estado desde cliente)
- `POST /api/playback/sessions` (opcional `waitReadyMs` para esperar transicion a `ready|error`)
- `GET /api/playback/sessions/:id/status` (opcional `waitMs`, `knownStatus`, `knownHlsStatus`, `knownSegments`)
- `GET /api/playback/sessions/:id/stream`
- `GET /api/playback/sessions/:id/hls/:asset`
- `GET /api/live-tv/status`
- `POST /api/live-tv/reload`
- `GET /api/live-tv/categories`
- `GET /api/live-tv/channels?category=...&query=...`
- `GET /api/live-tv/channels/:id/stream`

Notas:
- Para autoplay usar `POST /api/playback/auto` con JSON; `GET /api/playback/auto` no es endpoint valido.
- Flujo recomendado en frontend: `preflight` al abrir la vista para poblar calidades y luego `auto`/playback usando `preferredSourceKey`.

## Roadmap operativo

- Control panel + observabilidad + cache: **pendiente**.
  - roadmap de implementacion: `docs/control-panel-roadmap.md`
  - estado actual: aun no existen endpoints/admin UI de panel (`/api/admin/*`).
