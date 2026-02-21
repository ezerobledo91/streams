Plan: Integración Clasificador M3U en Streams App

 Contexto

 Las listas M3U remotas (fuxxion, rey-premium) se descargan y cachean en streams/config/live-tv-cache/. Actualmente la
 app filtra el contenido usando solo patrones de URL (/movie/, /series/) para separar lo "live" del VOD, lo que no
 funciona bien con Xtream porque todas las URLs tienen el mismo formato host:port/user/pass/stream_id.

 El objetivo es:
 1. Clasificar por group-title (mucho más preciso) en 4 buckets: TV, Eventos, 24/7, OnDemand
 2. TV + Eventos + 24/7 → alimentan el módulo Live TV (con secciones separadas en UI)
 3. OnDemand (VOD) → se indexa en memoria y actúa como primera fuente en Watch Page antes de addons/Prowlarr

 ---
 Arquitectura Resultante

 Al cargar listas M3U remotas:
   each entry → classifyGroupTitle(groupTitle)
        ├── 'tv'        → liveTvState.channels    (como hoy)
        ├── 'eventos'   → eventosState.channels   (NUEVO)
        ├── '247'       → marathonState.channels  (NUEVO)
        └── 'ondemand'  → vodState.entries → buildVodIndex()  (NUEVO)

 Watch Page request:
   resolveStreamRequest() → título TMDB
   ├── [inmediato] searchVodIndex(título, {season, episode}) → candidatos directUrl
   └── [paralelo]  addons Stremio + Prowlarr (como hoy)

 UI nueva:
   ├── 📺 Live TV  → liveTvState (sin cambios)
   ├── ⚽ Eventos  → eventosState (nueva página)
   ├── 🔄 24/7     → marathonState (nueva página)
   └── 🎬 Watch   → VOD de M3U primero, luego addons/torrents

 ---
 Archivos Críticos

 En streams/:

 - lib/state.js — estado global, agregar eventosState, marathonState, vodState
 - lib/live-tv/manager.js — cargar y bucketear por clasificador (reemplaza filtro por URL)
 - lib/live-tv/parser.js — sin cambios mayores
 - lib/live-tv/remote-sources.js — sin cambios (ya descarga y cachea)
 - lib/streams/service.js — agregar M3U VOD como fuente prioritaria
 - lib/routes/live-tv.js — sin cambios (sirve liveTvState, sin cambios)
 - lib/routes/index.js — registrar nuevas rutas

 Nuevos en streams/:

 - lib/live-tv/classifier.js — reglas group-title (portado desde classify.js en iptv-processor)
 - lib/live-tv/vod-index.js — índice en memoria + búsqueda fuzzy
 - lib/routes/eventos.js — endpoints API para sección Eventos
 - lib/routes/247.js — endpoints API para sección 24/7
 - web/src/views/EventosPage.tsx — UI Eventos (similar a LiveTvPage)
 - web/src/views/Page247.tsx — UI 24/7 (similar a LiveTvPage)

 ---
 Pasos de Implementación

 Paso 1 — lib/live-tv/classifier.js (NUEVO)

 Portar las reglas de classify.js del iptv-processor  C:\Users\ezerr\OneDrive\Escritorio\Ezequiel\apps\listas m3u\iptv-processor-nodejs  como función pura:
 // Retorna: 'tv' | 'eventos' | '247' | 'ondemand'
 function classifyGroupTitle(groupTitle) { ... }
 module.exports = { classifyGroupTitle };
 Mismas reglas en el mismo orden (eventos primero, luego 24/7, luego ondemand, TV catch-all).

 Paso 2 — lib/state.js (MODIFICAR)

 Agregar tres nuevos objetos de estado junto a liveTvState:
 const eventosState = {
   loadedAt: null, channels: [], channelById: new Map(), categories: []
 };
 const marathonState = {  // 24/7
   loadedAt: null, channels: [], channelById: new Map(), categories: []
 };
 const vodState = {
   loadedAt: null, entries: [], byTitle: new Map(), byEpisode: new Map(), totalCount: 0
 };
 Exportarlos junto con los existentes.

 Paso 3 — lib/live-tv/manager.js (MODIFICAR)

 Reemplazar el filtro detectIptvContentType(url) por classifyGroupTitle(groupTitle).

 Nueva función loadAllFromDisk() que reemplaza loadLiveTvFromDisk():
 1. Parsea todos los M3U (local + remote, sin filtro de URL)
 2. Para cada canal, llama classifyGroupTitle(channel.groupTitle)
 3. Distribuye en 4 arrays según clasificación
 4. Popula liveTvState, eventosState, marathonState
 5. Para VOD: llama buildVodIndex(vodEntries) → popula vodState
 6. Mantiene retrocompatibilidad: loadLiveTvFromDisk() puede llamar al nuevo

 Paso 4 — lib/live-tv/vod-index.js (NUEVO)

 Índice en memoria para búsqueda de VOD:

 Estructura de cada VodEntry:
 {
   name, streamUrl, groupTitle, logo, sourceFile,
   // extraídos del nombre:
   normalizedTitle,  // "breaking bad"
   season,           // 1 | null
   episode,          // 1 | null
   year,             // 1972 | null
   quality           // "1080p" | "720p" | null
 }

 Funciones:
 - buildVodIndex(entries) → puebla vodState.byTitle y vodState.byEpisode
 - searchVodIndex(title, { season, episode, type }) → retorna VodEntry[] ordenados por calidad

 Algoritmo de indexado:
 normalizedTitle = normalize("Breaking Bad T01E01 (720p)") → "breaking bad"
 extraer S/E del nombre con regex: /[sStT](\d+)[eExX](\d+)/
 vodState.byTitle.set("breaking bad", [...])
 vodState.byEpisode.set("breaking bad:s1e1", [...])

 Algoritmo de búsqueda:
 1. Normalizar title (input del TMDB) → "breaking bad"
 2. Si season + episode: buscar en byEpisode["breaking bad:s1e1"]
 3. Si solo título: buscar en byTitle["breaking bad"]
 4. Fallback: substring search sobre normalizedTitle de todos los entries
 5. Convertir cada match a candidato con directUrl

 Paso 5 — lib/streams/service.js (MODIFICAR)

 Agregar M3U VOD como fuente prioritaria:

 async function fetchAggregatedStreams({ type, itemId, season, episode }) {
   const resolved = await resolveStreamRequest(...);

   // [INMEDIATO] M3U VOD local — sin red, en memoria
   const vodCandidates = searchVodIndex(resolved.resolvedTitle, {
     season, episode, type
   });

   // [PARALELO] Pipeline existente (addons + Prowlarr) — sin cambios
   const [addonResults, prowlarrResult] = await Promise.all([
     addonPromise, prowlarrPromise
   ]);

   // VOD entries se insertan como provider con id: 'm3u-vod'
   const m3uVodResult = vodCandidates.length > 0 ? {
     provider: { id: 'm3u-vod', name: 'M3U VOD', baseUrl: null },
     ok: true,
     streams: vodCandidates.map(entryToStream)  // formato Stremio-compatible
   } : null;

   const rawResults = [
     ...(m3uVodResult ? [m3uVodResult] : []),
     ...(prowlarrResult ? [prowlarrResult] : []),
     ...addonResults
   ];
   // resto sin cambios...
 }

 La función entryToStream(entry) mapea un VodEntry al formato de stream del pipeline (con directUrl, title,
 behaviorHints.videoSize).

 Paso 6 — lib/routes/eventos.js y lib/routes/247.js (NUEVOS)

 Endpoints idénticos en estructura a live-tv.js pero leyendo de eventosState / marathonState:
 - GET /api/eventos/status
 - GET /api/eventos/categories
 - GET /api/eventos/channels?category=&query=&page=&limit=
 - GET /api/eventos/channels/:id
 - GET /api/eventos/channels/:id/stream (redirige al proxy existente de live-tv)

 (Misma API shape para 24/7 con prefijo /api/247/)

 El streaming real se maneja reusando el proxy/transcode de live-tv.js — no duplicar esa lógica.

 Paso 7 — lib/routes/index.js (MODIFICAR)

 Registrar las dos nuevas rutas.

 Paso 8 — Frontend: EventosPage.tsx y Page247.tsx (NUEVOS)

 Basados en LiveTvPage.tsx (72KB) — misma estructura de componentes:
 - Mismos hooks (useChannelList, usePlayback)
 - Mismas props, diferente apiPrefix (/api/eventos / /api/247)
 - Consideración: extraer lógica común de LiveTvPage a un componente/hook reutilizable si es razonable

 Paso 9 — Routing frontend (MODIFICAR)

 Agregar rutas en App.tsx o donde se defina el router:
 /eventos  → EventosPage
 /247      → Page247
 Actualizar navegación con los nuevos links.

 ---
 Consideraciones Técnicas

 Performance del índice VOD:
 - ~270k entradas totales entre fuxxion + rey-premium
 - Construir el Map en background tras la descarga (no bloquear startup)
 - Búsqueda byEpisode es O(1) para series con S/E conocido
 - Fallback substring es O(n) pero <150ms esperado con 270k entries

 Extracción de título/episodio del nombre M3U:
 - Patrones regex para S/E: [sStT](\d+)[eExX](\d+), (\d+)x(\d+), T(\d+)E(\d+)
 - Limpiar calidad del título: \(4K\), \(1080p\), \(HD\), \(e\), \(M\)
 - Limpiar indicadores: (DUAL AUDIO), [Completo], (CAM), [CAST]
 - Extraer año: \((\d{4})\)

 Streaming VOD:
 - Las URLs Xtream VOD (host:port/user/pass/stream_id.ts) ya son soportadas
 por el proxy existente de Live TV — sin cambios necesarios en el proxy
 - Se registran como directUrl candidates en el pipeline de playback.js
 - El sistema de probing existente ya maneja este tipo de URLs

 Compatibilidad hacia atrás:
 - liveTvState y sus endpoints /api/live-tv/* no cambian
 - loadLiveTvFromDisk() mantiene su firma; internamente usa el nuevo clasificador
 - activeSource: "local" | "remote" | "all" sigue funcionando igual

 ---
 Verificación

 1. npm start en streams/ → startup sin errores, logs muestran conteos de 4 buckets
 2. GET /api/live-tv/channels → solo canales TV (sin VOD ni eventos)
 3. GET /api/eventos/channels → solo eventos en vivo (PPV, deportes, ligas)
 4. GET /api/247/channels → solo canales 24/7 (maratones, repeticiones)
 5. Watch Page → buscar una serie conocida → aparecen candidatos M3U VOD antes que torrents
 6. Watch Page → reproducir un stream M3U → funciona via proxy existente
 7. Reload de listas remotas → re-clasifica y re-indexa automáticamente
╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌


AJUSTES GENERALES
- HOVER O MOVIMIENTOS CON CONTROL REMOTO FLECHAS , OPCIONES Y ENTER EN TV. La app se comporta mal. hay que andar reiniciando la pantalla para que funciinen los movimientos de la flecham en pc funciina mejor pero en tv no. Hay luares todavía en la UI que no se pueden seleccionar con el ccontrol remoto (osea como si fueran las fechas de la pc aparte de que me oarece qeu tenemos problemas de cache porque por ahi en pc me muestra parate vienas de la ui.)
- Cambio de menu general  modo tv o desktop comoo si fuenaa barra fija menu hamb, abre fuera un offcanvas o drawer para que los iconos de los menu esten verticales en una barra lateral si se abre se despleguen las categorías correspondientes. Aparte de debemos agregar como categoría de filtrado en ese menu aparte de abrir por ejemplo peliculas submenu children todas las categoías o ver por plataforma osea filtrar por platafroma a la cual pertenece o hoy en día muestra ese video. 
- Guardado de canal seleccionado en local storage para no tener que volver a cambiar cada vez que se cierra la app, o mejor guardar por usuario en el JSON correspondiente de config.  Home tambien debe mostrar recomencaciones por plataforma como el menu general o filtros. Se entiende? 
-  Mejorar UI /UX tv online para mostrar categorías de canales y sleccion de canales. Podemos armar algo mejor, mantener favoritos etc. 

---

PLAN EJECUTIVO - AJUSTES GENERALES (V1)

Objetivo general
- Estabilizar experiencia TV (control remoto + foco + cache), redisenar navegacion principal y mejorar UX de Live TV sin perder favoritos ni compatibilidad actual.

Alcance
- Web app (frontend React + rutas API necesarias).
- Persistencia por usuario para preferencias de TV.
- No se cambia pipeline core de streams salvo donde impacte foco/UX/persistencia.

No alcance (esta fase)
- Reescritura completa del player.
- Nuevo backend de recomendaciones ML.

Fase 0 - Baseline tecnico (1-2 dias)
- Levantar matriz de repro por dispositivo:
  - PC navegador, Android TV, WebOS/Tizen (si aplica), Chromecast with Google TV.
- Capturar rutas de fallo de foco/remote:
  - Elementos no seleccionables.
  - Bloqueos de navegacion (flechas no responden).
  - Estados que requieren "reinicio de pantalla".
- Revisar cache real:
  - index.html stale, assets stale, service worker residual.
- Entregable:
  - Documento de issues priorizados (P0/P1/P2) + checklist de validacion.

Fase 0.5 - Auditoria de cardinalidad de canales Live TV (P0) (1-2 dias)
- Objetivo:
  - Validar que la app no este ocultando variantes legitimas de una misma senal (ej: TELEFE) por dedupe agresivo.
- Verificar pipeline completo:
  - Conteo crudo por bucket (tv/eventos/247/ondemand) al parsear M3U.
  - Conteo luego de dedupe por URL.
  - Conteo luego de dedupe por nombre/categoria.
  - Conteo final expuesto al frontend (incluyendo filtros `webOnly`, ocultos y favoritos).
- Agregar metricas de diagnostico:
  - Top grupos colapsados por nombre con cantidad descartada.
  - Limite configurable de variantes por nombre (`LIVE_TV_MAX_NAME_VARIANTS`).
- Criterios de aceptacion:
  - Si en listas hay N variantes validas de un canal, la app conserva hasta el limite configurado.
  - `/api/live-tv/status` informa diagnostico de dedupe para auditar diferencias.
  - Caso de prueba manual: buscar "Telefe" y verificar que aparezcan variantes esperadas.
- Estado parcial (implementado):
  - Diagnostico de dedupe en `/api/live-tv/status` (raw buckets, after-url, after-name, top colapsados).
  - Endpoint de auditoria `/api/live-tv/audit?query=telefe` con conteos por seccion:
    - total, webOnly/proxy, ocultos por usuario, visibles por defecto, top nombres y source files.
  - Corregido loader de M3U masivas:
    - se reemplazo `push(...arrayGrande)` por append iterativo para evitar `Maximum call stack size exceeded` y que se descarte una lista completa (caso `rey-premium.m3u`).

Fase 1 - Motor unico de navegacion TV (P0) (3-5 dias)
- Unificar input remoto/teclado/gamepad en un solo controlador de foco:
  - Base en `web/src/hooks/useTvFocusManager.ts`
  - Integrar `web/src/hooks/useTvKeyboard.ts`
  - Integrar `web/src/hooks/useGamepad.ts`
- Estandarizar contrato de elementos navegables:
  - `data-tv-focusable`, `data-tv-group`, `data-tv-action`.
- Crear "focus scopes" por pantalla:
  - Home, Live TV, Watch, Search, Drawer/Menu.
- Corregir zonas hoy no seleccionables:
  - Botones secundarios, chips, menus desplegables, controles overlay.
- Reglas de transicion:
  - `Escape/Backspace` siempre vuelve al scope anterior.
  - Al entrar a pantalla: foco inicial deterministico.
  - Al reabrir drawer: restaura ultimo foco valido.
- Criterios de aceptacion:
  - 100% de acciones principales navegables sin mouse.
  - Sin bloqueos de foco tras 10 minutos de uso continuo.
- Estado parcial (implementado):
  - `LiveTvBucketPage` (Eventos/24-7) con navegacion por scopes (`channels`, `categories`, `controls`, `quality`).
  - Soporte remoto/gamepad en esas vistas y contrato `data-tv-focusable/data-tv-group/data-tv-action`.

Fase 2 - Higiene de cache y consistencia UI (P0) (1-2 dias)
- Asegurar estrategia cache-control:
  - `index.html` no-store.
  - assets hashados immutable.
- Anadir versionado cliente para forzar refresh controlado cuando cambia build.
- Revisar y limpiar rastros de service worker legacy.
- Criterios de aceptacion:
  - Deploy nuevo se refleja en TV y PC sin "UI vieja".
  - Sin necesidad de hard refresh manual.

Fase 3 - Menu general TV/Desktop (P1) (4-6 dias)
- Crear layout shell unico (barra lateral + drawer/hamburguesa):
  - Modo desktop: sidebar fija/colapsable.
  - Modo TV: drawer lateral con navegacion vertical.
- Menu jerarquico:
  - Peliculas -> subcategorias
  - Series -> subcategorias
  - TV en vivo / Eventos / 24-7
  - Favoritos / Buscar
- Filtros por plataforma (source/provider) desde menu:
  - Ej: Netflix, Disney, Prime, HBO, etc. (segun metadata disponible).
- Archivos objetivo:
  - `web/src/routes.tsx`
  - `web/src/views/HomePage.tsx`
  - `web/src/components/*` (nuevo `AppShell`, `SideNav`, `NavDrawer`)
  - `web/src/store/AppStore.tsx` (estado de navegacion/filtros)
- Criterios de aceptacion:
  - Navegacion completa con control remoto.
  - Cambio de categoria/plataforma en <= 2 interacciones.

Fase 4 - Persistencia de canal seleccionado y preferencias TV (P1) (2-3 dias)
- Persistencia por usuario (preferido) con fallback localStorage:
  - ultimo canal por seccion (`live-tv`, `eventos`, `247`).
  - estado de transcode/calidad por usuario (si aplica).
- Extender modelo de usuario:
  - `lib/user-store.js` agregar `preferences.tv`.
- Nuevos endpoints:
  - GET/POST `/api/users/:username/preferences/tv`
- Integrar en frontend:
  - `LiveTvPage`, `EventosPage`, `Page247`.
- Criterios de aceptacion:
  - Cerrar/abrir app restaura canal y contexto de seccion.
- Estado parcial (implementado):
  - Persistencia de ultimo canal por seccion en `localStorage`:
    - `streams_last_channel_live_tv`
    - `streams_last_channel_eventos`
    - `streams_last_channel_247`

Fase 5 - Recomendaciones y filtros por plataforma en Home (P1) (3-5 dias)
- Exponer facet de plataforma en catalogo (source/provider).
- Anadir railes/filtros por plataforma en Home.
- Mantener compatibilidad con busqueda actual.
- Archivos objetivo:
  - `lib/routes/catalog.js` (si requiere facet/filter server-side)
  - `web/src/api.ts`
  - `web/src/views/HomePage.tsx`
  - `web/src/components/CategoryRail.tsx`
- Criterios de aceptacion:
  - Home permite filtrar por plataforma sin romper genero/categoria.

Fase 6 - Mejora UX de TV online (P1) (3-5 dias)
- Rediseno panel de canales:
  - categorias mas visibles,
  - acceso rapido a favoritos,
  - agrupacion variante/canal clara,
  - feedback de estado (playing/buffering/error) mas legible.
- Optimizacion para TV:
  - targets mas grandes,
  - contraste/legibilidad,
  - animaciones minimas y estables.
- Criterios de aceptacion:
  - Tiempo para cambiar canal <= 2 pasos promedio.
  - Usuario puede operar 100% sin teclado fisico.

Fase 7 - QA, rollout y observabilidad (P0/P1) (2-3 dias)
- Suite de smoke tests e2e (teclado remoto simulado):
  - rutas clave + foco + reproduccion basica.
- Telemetria minima:
  - eventos de foco invalido, error de reproduccion, fallback de navegacion.
- Rollout por feature flags:
  - `tv_nav_v2`, `app_shell_v2`, `tv_prefs_user`.

Orden recomendado de ejecucion (sprints)
1. Sprint A: Fase 0 + Fase 1 + Fase 2
2. Sprint B: Fase 3
3. Sprint C: Fase 4 + Fase 5
4. Sprint D: Fase 6 + Fase 7

Riesgos principales
- Duplicacion de logica de foco entre vistas grandes.
- Regresiones de reproduccion al tocar overlays/controles.
- Diferencias de keycodes entre marcas de TV.

Mitigaciones
- Unico controlador de foco central.
- Feature flags por modulo.
- Checklist cross-device antes de merge.

Definicion de terminado (DoD)
- Navegacion remota estable en todas las vistas principales.
- Menu lateral unificado funcionando en TV y desktop.
- Canal seleccionado y preferencias persisten por usuario.
- Home con filtros/recomendaciones por plataforma.
- Sin issues P0 abiertos en matriz de dispositivos.
