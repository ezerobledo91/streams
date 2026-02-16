# Plan de Optimizacion - Streams PWA para Smart TV

> Documento generado: 2026-02-14
> Objetivo: Optimizar la app para uso como PWA en Smart TVs con control remoto

---

## INDICE

1. [Proveedores Torrent / Prowlarr](#1-proveedores-torrent--prowlarr)
2. [Estrategia de Velocidad y Alternativas](#2-estrategia-de-velocidad-y-alternativas)
3. [Refuerzo de Preferencia de Idioma Latino](#3-refuerzo-de-preferencia-de-idioma-latino)
4. [Navegacion TV / D-pad en toda la app](#4-navegacion-tv--d-pad-en-toda-la-app)
5. [Live TV - Fullscreen y Controles](#5-live-tv---fullscreen-y-controles)
6. [Scroll y Overflow en modo TV](#6-scroll-y-overflow-en-modo-tv)
7. [PWA - Service Worker y Offline](#7-pwa---service-worker-y-offline)
8. [Resumen de cambios por archivo](#8-resumen-de-cambios-por-archivo)

---

## 1. Proveedores Torrent / Prowlarr

### Estado actual
- **5 addons activos**: TorrentDB, Comet, Torrentio, MediaFusion, ThePirateBay+
- **Prowlarr**: Habilitado con timeout 12s, max 120 por query, 160 streams totales
- **Trackers publicos**: Solo 5 configurados

### Indexers recomendados para Prowlarr (agregar TODOS los posibles)

Prowlarr soporta indexers publicos sin necesidad de cuentas. Agregar desde la UI de Prowlarr (`http://localhost:9696`):

#### Publicos (sin cuenta - agregar todos)
| Indexer | Tipo | Notas |
|---------|------|-------|
| 1337x | Torrent | Excelente para peliculas/series |
| RARBG (clones) | Torrent | rarbg2.to, rarbgmirror |
| The Pirate Bay | Torrent | Clasico, mucho contenido |
| EZTV | Torrent | Especializado en series TV |
| LimeTorrents | Torrent | Buena variedad |
| TorrentGalaxy | Torrent | Activo, buena comunidad |
| Nyaa | Torrent | Anime japones |
| YTS | Torrent | Peliculas comprimidas, rapido |
| ETTV | Torrent | Series y peliculas |
| Torlock | Torrent | Verificado |
| Glodls | Torrent | General |
| Magnetico | Torrent | DHT crawler |
| Knaben | Torrent | Meta-buscador |
| BTDigg | Torrent | DHT indexer |
| Solidtorrents | Torrent | Agregador moderno |
| iDope | Torrent | Rapido |
| TorrentDownloads | Torrent | Gran catalogo |
| AcademicTorrents | Torrent | Contenido variado |
| Bitsearch | Torrent | Meta-buscador |
| TorrentProject2 | Torrent | Agregador DHT |

#### Privados/Semi-privados (si tenes cuenta)
| Indexer | Tipo | Notas |
|---------|------|-------|
| Cinecalidad | Torrent | Contenido latino/espanol |
| DonTorrent | Torrent | Espanol castellano |
| MejorTorrent | Torrent | Espanol, muy activo |
| EliteTorrent | Torrent | Espanol |
| DivxTotal | Torrent | Espanol |
| Comando404 | Torrent | Latino |
| PasateaTorrent | Torrent | Espanol |
| HDOlimpo | Torrent | Espanol HD |
| Wolfmax4K | Torrent | 4K en espanol |

> **CRITICO para contenido latino**: Los indexers en espanol (Cinecalidad, DonTorrent, MejorTorrent, EliteTorrent, DivxTotal) son los que mas van a mejorar la disponibilidad de audio latino.

### Addons Stremio adicionales recomendados

Agregar en `config/stream-manifests.json`:

```json
{
  "id": "cyberflix",
  "name": "Cyberflix",
  "manifestUrl": "https://cyberflix.elfhosted.com/manifest.json",
  "active": true,
  "priority": 115,
  "categories": ["movie", "series"]
},
{
  "id": "jackett-community",
  "name": "Jackett Community",
  "manifestUrl": "https://jackett-community.elfhosted.com/manifest.json",
  "active": true,
  "priority": 108,
  "categories": ["movie", "series"]
},
{
  "id": "knightcrawler",
  "name": "KnightCrawler",
  "manifestUrl": "https://knightcrawler.elfhosted.com/manifest.json",
  "active": true,
  "priority": 112,
  "categories": ["movie", "series"]
},
{
  "id": "orion",
  "name": "Orion",
  "manifestUrl": "https://orion.elfhosted.com/manifest.json",
  "active": true,
  "priority": 102,
  "categories": ["movie", "series"]
}
```

### Trackers publicos adicionales

Agregar en `lib/config.js` (DEFAULT_PUBLIC_TRACKERS):

```
udp://tracker.opentrackr.org:1337/announce
udp://open.stealth.si:80/announce
udp://tracker.openbittorrent.com:6969/announce
udp://tracker.torrent.eu.org:451/announce
udp://exodus.desync.com:6969/announce
udp://open.demonii.com:1337/announce
udp://tracker.moeking.me:6969/announce
udp://explodie.org:6969/announce
udp://tracker1.bt.moack.co.kr:80/announce
udp://tracker.tiny-vps.com:6969/announce
udp://tracker.theoks.net:6969/announce
udp://tracker-udp.gbitt.info:80/announce
udp://retracker01-msk-virt.corbina.net:80/announce
udp://opentracker.io:6969/announce
udp://new-line.net:6969/announce
udp://bt1.archive.org:6969/announce
```

### Cambios en .env para mayor agresividad

```env
PROWLARR_TIMEOUT_MS=18000        # 12s -> 18s (mas tiempo para indexers lentos)
PROWLARR_MAX_PER_QUERY=200       # 120 -> 200 (mas resultados por query)
PROWLARR_MAX_STREAMS=300         # 160 -> 300 (mas streams totales)
```

---

## 2. Estrategia de Velocidad y Alternativas

### Problema actual
- Se retorna 1 solo candidato al auto-play
- Si falla, el usuario queda sin opciones hasta reintentar manualmente
- El scoring prioriza calidad (resolucion alta, seeders altos) sobre velocidad

### Solucion: Retornar 2-3 alternativas + priorizar velocidad

#### A. Modificar `lib/routes/playback.js` - endpoint `/api/playback/auto`

Actualmente retorna 1 candidato. Cambiar para retornar array de hasta 3:

```javascript
// ANTES: retorna solo el primero que valida
// DESPUES: retorna los top 3 candidatos validados

const maxAlternatives = 3;
const validated = [];

for (const candidate of orderedAuto) {
  if (validated.length >= maxAlternatives) break;
  const isValid = await quickValidateCandidate(candidate);
  if (isValid) validated.push(candidate);
}

// Retornar { candidates: validated } en vez de { candidate: validated[0] }
```

#### B. Modificar scoring en `lib/playback/candidates.js` para priorizar velocidad

El `rankCandidateForAuto()` actual da bonus enorme a URLs directas (+120/+140). Reforzar esto y agregar bonus por tamano chico (= mas rapido de cargar):

```javascript
// CAMBIOS en rankCandidateForAuto():

// 1. Mas bonus por tamano chico (rapido)
const sizeGb = videoSizeBytes / (1024 ** 3);
if (sizeGb > 0 && sizeGb < 1.5) rank += 30;      // NUEVO: archivos chicos = rapido
else if (sizeGb < 3) rank += 15;                    // NUEVO: archivos medianos
rank -= sizeGb * 8;                                  // ERA: sizeGb * 5.5

// 2. Mas bonus por seeders altos (= mas velocidad de descarga)
if (seeders >= 50) rank += 25;                       // NUEVO
else if (seeders >= 20) rank += 15;                  // NUEVO
else if (seeders >= 10) rank += 8;                   // NUEVO

// 3. Reducir peso de resolucion (velocidad > calidad)
// ERA: 2160 -> +9, 1080 -> +7
// NUEVO: 2160 -> +3, 1080 -> +5, 720 -> +7 (invertido! 720p es mas rapido)
if (resolution >= 2160) rank += 3;
else if (resolution >= 1080) rank += 5;
else if (resolution >= 720) rank += 7;
else rank += 4;

// 4. Penalizar archivos grandes mas agresivamente
if (sizeGb > 8) rank -= 40;    // ERA: -26
if (sizeGb > 14) rank -= 60;   // ERA: -42
```

#### C. Frontend: manejar multiples alternativas

En `web/src/views/WatchPage.tsx`, cuando falla el candidato principal:

```typescript
// Estado para alternativas
const [alternatives, setAlternatives] = useState<StreamCandidate[]>([]);
const [currentAlternativeIdx, setCurrentAlternativeIdx] = useState(0);

// Cuando la API retorna multiples candidatos:
// Si el primero falla, auto-intentar el segundo
// Si el segundo falla, auto-intentar el tercero
// Si todos fallan, mostrar error con boton "Reintentar"
```

#### D. Reducir timeout del stream source

En `lib/streams/service.js`:

```env
STREAM_SOURCE_TIMEOUT_MS=4000    # ERA: 5000 (1 segundo menos de espera)
PROWLARR_GRACE_MS=1500           # ERA: 2000 (menos espera para Prowlarr)
```

---

## 3. Refuerzo de Preferencia de Idioma Latino

### Problema actual
- Cuando el usuario selecciona "Espanol latino", muchas veces reproduce contenido en ingles
- La deteccion de idioma depende de que el nombre del torrent incluya "latino", "castellano", etc.
- Si ningun torrent tiene esas keywords, TODOS los candidatos pasan como "sin idioma" y se ignora la preferencia
- El filtro `buildCandidatesFromResults` descarta candidatos no-preferidos SOLO si hay al menos 1 preferido

### Soluciones

#### A. Expandir patrones de deteccion latino (`candidates.js`)

Agregar mas patrones para detectar contenido en espanol:

```javascript
// ACTUAL para es-419:
["latino", "latam", "audio latino", "es-la", "es_419", "hispano", "es-mx", "mexico", "mx"]

// NUEVO para es-419 (agregar):
["latino", "latam", "audio latino", "es-la", "es_419", "hispano", "es-mx",
 "mexico", "mx", "lat", "audio lat", "dual lat", "esp lat",
 "spanish latin", "latin spanish", "latinoamerica",
 "argentina", "ar", "colombia", "co", "chile", "cl", "peru", "pe",
 "audio.latino", "audio_latino", "aud.lat", "spa.lat"]

// ACTUAL para es:
["espanol", "castellano", "spanish", "spa"]

// NUEVO para es (agregar):
["espanol", "castellano", "spanish", "spa", "spanish audio",
 "dual esp", "dual spanish", "audio esp", "spain", "espana",
 "esp", "spa audio", "multi.esp", "multi.spa",
 "multi audio"]   // "multi" generico sugiere que tiene espanol
```

#### B. Tratar "multi" como idioma valido para latino

Si la preferencia es "es", el contenido marcado como "multi" probablemente incluye espanol. Actualmente "multi" esta en posicion 3 del priority. Subirlo:

```javascript
// ANTES (preferencia "es"):
["es-419", "es", "multi", "und", "en"]

// DESPUES:
["es-419", "es", "multi", "und", "en"]
// Pero cambiar languageScoreAdjustment para dar mas puntos a "multi":
// Rank 2 (multi) = +28 en vez de +16
```

#### C. No descartar contenido sin deteccion de idioma

El problema principal: si un torrent se llama "Movie.2024.1080p.WEB-DL" sin ninguna keyword de idioma, `extractCandidateLanguageHints()` retorna un Set vacio, y el candidato se marca como `allowedLanguage: false`.

Solucion: si el Set esta vacio, asumir "und" (undetermined) y tratarlo como potencialmente compatible:

```javascript
// En calculateScore(), si languageHints esta vacio:
if (languageHints.size === 0) {
  // No penalizar con -220, en vez de eso dar una penalizacion menor
  // porque PODRIA ser del idioma correcto
  allowedLanguage = true;  // Marcar como permitido pero con rank bajo
  languageRank = 4;        // Posicion baja pero no excluido
}
```

#### D. Persisitir preferencia de audio del usuario

Actualmente cada vez que el usuario abre WatchPage, `audioPreference` empieza en `"original"`. Cambiar para que persista en localStorage:

```typescript
// web/src/views/WatchPage.tsx
const [audioPreference, setAudioPreference] = useState<AudioPreference>(() => {
  return (localStorage.getItem("streams_audio_pref") as AudioPreference) || "es";
});

// Al cambiar:
function handleAudioChange(value: AudioPreference) {
  setAudioPreference(value);
  localStorage.setItem("streams_audio_pref", value);
}
```

> **CRITICO**: El default deberia ser `"es"` (no `"original"`) si el usuario habla espanol.

---

## 4. Navegacion TV / D-pad en toda la app

### Estado actual
- Solo `LiveTvPage` usa `useTvKeyboard`
- `WatchPage`, `HomePage`, `LoginPage`, `SearchPage`, `CategoryPage` NO tienen navegacion por D-pad
- No hay soporte de gamepad/control remoto Bluetooth
- Los Smart TVs con Android TV / WebOS / Tizen usan D-pad para navegar

### Plan de implementacion

#### A. Crear sistema de focus management global

Nuevo archivo `web/src/hooks/useTvFocusManager.ts`:

```typescript
// Sistema de navegacion espacial:
// - Mantiene referencia al elemento enfocado actual
// - ArrowUp/Down/Left/Right mueve el foco al elemento mas cercano en esa direccion
// - Enter activa el elemento enfocado
// - Back/Escape navega hacia atras

// Elementos "focusables" marcados con data-tv-focusable
// Grupos de navegacion marcados con data-tv-group="rail|grid|list"
// Elemento activo recibe clase .tv-focused
```

#### B. Soporte de Gamepad API (controles remotos Bluetooth)

Nuevo archivo `web/src/hooks/useGamepad.ts`:

```typescript
// Los Smart TVs exponen el control remoto como Gamepad
// Mapear:
// - Stick/D-pad → ArrowUp/Down/Left/Right
// - Boton A/X → Enter (seleccionar)
// - Boton B/Circle → Escape (volver)
// - Bumpers → PageUp/PageDown (scroll rapido)
// - Start → F (fullscreen)

// Usar navigator.getGamepads() con requestAnimationFrame polling
```

#### C. Implementar por pagina

| Pagina | Acciones D-pad |
|--------|---------------|
| **LoginPage** | Flechas: navegar perfiles. Enter: seleccionar. |
| **HomePage** | Flechas: navegar rails horizontales y vertical entre rails. Enter: abrir item. |
| **WatchPage** | Up/Down: volumen (si soportado). Left/Right: seek +-10s. Enter: play/pause. Back: salir. |
| **LiveTvPage** | Up/Down: cambiar canal. Enter: abrir lista. Left/Right: volumen. Back: cerrar lista/salir fullscreen. |
| **SearchPage** | Flechas: navegar resultados. Enter: seleccionar. |
| **CategoryPage** | Flechas: navegar grid. Enter: seleccionar. |

#### D. CSS para modo TV

```css
/* Indicador de foco visible y grande para TV */
[data-tv-focusable]:focus-visible,
.tv-focused {
  outline: 3px solid var(--brand) !important;
  outline-offset: 4px;
  /* Sombra de resplandor para que se vea en TVs con brillo bajo */
  box-shadow: 0 0 0 6px rgba(229, 9, 20, 0.3);
  transition: outline 0.15s, box-shadow 0.15s;
}

/* Escalar ligeramente el elemento enfocado */
.media-tile:focus-visible,
.media-tile.tv-focused {
  transform: scale(1.08);
  z-index: 10;
}
```

#### E. Deteccion automatica de modo TV

```typescript
// Detectar si estamos en una Smart TV
function isTvEnvironment(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return (
    ua.includes("smart-tv") ||
    ua.includes("smarttv") ||
    ua.includes("tizen") ||         // Samsung
    ua.includes("webos") ||          // LG
    ua.includes("android tv") ||     // Android TV
    ua.includes("fire tv") ||        // Amazon
    ua.includes("crkey") ||          // Chromecast
    ua.includes("bravia") ||         // Sony
    window.matchMedia("(pointer: none)").matches ||  // Sin mouse
    window.matchMedia("(hover: none)").matches       // Sin hover
  );
}
```

---

## 5. Live TV - Fullscreen y Controles

### Estado actual
- Live TV no entra en fullscreen automaticamente
- El overlay aparece al hover (inutil en TV sin mouse)
- Los controles estan siempre visibles o se necesita hover

### Cambios requeridos

#### A. Fullscreen automatico en Live TV

```typescript
// Al seleccionar un canal, entrar automaticamente en fullscreen
function handleSelectChannel(channel: LiveTvChannelItem) {
  setSelectedChannelId(channel.id);
  if (isMobile) setShowChannelPanel(false);

  // Auto-fullscreen si estamos en TV o si ya habia canal seleccionado
  if (isTvEnvironment() || document.fullscreenElement) {
    requestAnimationFrame(() => {
      playerShellRef.current?.requestFullscreen?.().catch(() => {});
    });
  }
}

// Al cargar la pagina en modo TV, auto-fullscreen
useEffect(() => {
  if (isTvEnvironment() && selectedChannel && playerState === "playing") {
    playerShellRef.current?.requestFullscreen?.().catch(() => {});
  }
}, [playerState]);
```

#### B. Controles con timeout de inactividad

Logica: "Si no se toca nada, solo video. Si se presiona algo, mostrar controles por 5 segundos."

```typescript
const [controlsVisible, setControlsVisible] = useState(false);
const controlsTimeoutRef = useRef<number>(0);

function showControlsTemporarily() {
  setControlsVisible(true);
  window.clearTimeout(controlsTimeoutRef.current);
  controlsTimeoutRef.current = window.setTimeout(() => {
    setControlsVisible(false);
  }, 5000); // 5 segundos de visibilidad
}

// Cualquier interaccion muestra los controles
useEffect(() => {
  function onAnyInput() { showControlsTemporarily(); }
  window.addEventListener("keydown", onAnyInput);
  window.addEventListener("pointermove", onAnyInput);
  window.addEventListener("pointerdown", onAnyInput);
  return () => {
    window.removeEventListener("keydown", onAnyInput);
    window.removeEventListener("pointermove", onAnyInput);
    window.removeEventListener("pointerdown", onAnyInput);
  };
}, []);
```

#### C. CSS del overlay condicional

```css
/* Por defecto oculto */
.live-tv-overlay-top {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s ease;
}

/* Visible cuando tiene clase o hover */
.live-tv-overlay-top.is-visible,
.live-tv-player-shell:hover .live-tv-overlay-top {
  opacity: 1;
  pointer-events: auto;
}
```

#### D. Lista de canales como overlay sobre el video en fullscreen

Cuando esta en fullscreen y se presiona Enter o el boton "Canales":

```css
/* En fullscreen, el drawer se posiciona sobre el video */
:fullscreen .live-tv-drawer,
::backdrop + .live-tv-drawer {
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 30;
  width: 380px;
  background: rgba(0, 0, 0, 0.92);
  backdrop-filter: blur(20px);
}
```

#### E. Mapeo de controles TV para Live TV

```
Sin presionar nada     → Solo video, controles ocultos
1 toque/tecla          → Mostrar overlay (info canal + botones) por 5s
ArrowUp                → Canal anterior
ArrowDown              → Canal siguiente
Enter                  → Abrir lista de canales (overlay sobre video)
Escape/Back            → Cerrar lista / salir fullscreen
ArrowLeft (en lista)   → Cerrar lista
ArrowRight (en lista)  → No-op
F                      → Toggle fullscreen
```

---

## 6. Scroll y Overflow en modo TV

### Problemas identificados

1. **WatchPage**: Ya bloquea scroll del body, pero el panel de info (`watch-info-panel`) tiene scroll propio que no se navega con D-pad
2. **LiveTvPage drawer**: La lista de canales tiene scroll, pero al navegar con Up/Down solo cambia el canal seleccionado, no hay scroll del propio drawer
3. **HomePage rails**: Los rails horizontales necesitan scroll con Left/Right
4. **Categorias en Live TV**: Scroll horizontal sin manejo de D-pad

### Soluciones

#### A. Scroll programatico en todas las listas

Ya existe en LiveTvPage (auto-scroll al canal activo). Extender a:

```typescript
// Helper reutilizable
function scrollToFocused(container: string, activeSelector: string) {
  requestAnimationFrame(() => {
    const el = document.querySelector(activeSelector);
    el?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  });
}
```

#### B. WatchPage - scroll de info panel con D-pad

```typescript
// Down cuando el foco esta en el panel de info → scroll down
// Up cuando esta al tope → volver al video
```

#### C. HomePage - navegacion de rails

```typescript
// Left/Right → scroll horizontal del rail activo
// Up/Down → cambiar de rail
// Enter → seleccionar item

// Cada MediaCard recibe tabIndex={0} y data-tv-focusable
// El rail wrapper recibe data-tv-group="rail"
```

#### D. Ocultar scrollbars en modo TV

```css
/* En modo TV, los scrollbars no se necesitan */
@media (hover: none) and (pointer: none) {
  ::-webkit-scrollbar { display: none; }
  * { scrollbar-width: none; }
}
```

---

## 7. PWA - Service Worker y Offline

### Estado actual
- `manifest.json` existe y esta configurado correctamente
- NO hay service worker registrado
- Los iconos son SVG (bien, escalables)

### Cambios requeridos

#### A. Registrar service worker en `web/index.html`

```html
<script>
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
  }
</script>
```

#### B. Crear service worker minimo (`web/public/sw.js`)

```javascript
const CACHE_NAME = 'streams-v1';
const PRECACHE = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon-192.svg',
  '/icon-512.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Network-first para API calls
  if (event.request.url.includes('/api/')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }
  // Cache-first para assets estaticos
  event.respondWith(
    caches.match(event.request)
      .then(cached => cached || fetch(event.request))
  );
});
```

#### C. Mejorar manifest.json

```json
{
  "name": "Streams",
  "short_name": "Streams",
  "description": "TV en vivo y streaming",
  "start_url": "/",
  "display": "fullscreen",        // CAMBIAR de "standalone" a "fullscreen"
  "display_override": ["window-controls-overlay", "fullscreen", "standalone"],
  "background_color": "#050505",   // Mas oscuro
  "theme_color": "#050505",        // Coincidir con fondo
  "orientation": "landscape",      // CAMBIAR a landscape para TVs
  "categories": ["entertainment", "video"],
  "launch_handler": {
    "client_mode": "navigate-existing"
  },
  "icons": [
    { "src": "/icon-192.svg", "sizes": "192x192", "type": "image/svg+xml", "purpose": "any maskable" },
    { "src": "/icon-512.svg", "sizes": "512x512", "type": "image/svg+xml", "purpose": "any maskable" }
  ]
}
```

---

## 8. Resumen de cambios por archivo

### Backend

| Archivo | Cambio |
|---------|--------|
| `.env` | Aumentar PROWLARR_TIMEOUT_MS=18000, MAX_PER_QUERY=200, MAX_STREAMS=300 |
| `lib/config.js` | Agregar 11 trackers publicos adicionales |
| `config/stream-manifests.json` | Agregar 4 addons (Cyberflix, Jackett, KnightCrawler, Orion) |
| `lib/playback/candidates.js` | Expandir patrones idioma, cambiar scoring velocidad>calidad, tratar "und" como compatible |
| `lib/routes/playback.js` | Retornar 3 alternativas en `/api/playback/auto` |
| `lib/streams/service.js` | Reducir STREAM_SOURCE_TIMEOUT_MS=4000, PROWLARR_GRACE_MS=1500 |

### Frontend

| Archivo | Cambio |
|---------|--------|
| `web/src/hooks/useTvFocusManager.ts` | NUEVO - Sistema de focus management espacial |
| `web/src/hooks/useGamepad.ts` | NUEVO - Soporte Gamepad API para controles remotos |
| `web/src/hooks/useTvKeyboard.ts` | Agregar Left/Right, PageUp/PageDown |
| `web/src/views/LiveTvPage.tsx` | Auto-fullscreen, controles con timeout, overlay sobre video |
| `web/src/views/WatchPage.tsx` | Persistir audioPreference, manejar 3 alternativas, D-pad nav |
| `web/src/views/HomePage.tsx` | Agregar D-pad nav en rails |
| `web/src/views/LoginPage.tsx` | Agregar D-pad nav en perfiles |
| `web/src/views/SearchPage.tsx` | Agregar D-pad nav en resultados |
| `web/src/views/CategoryPage.tsx` | Agregar D-pad nav en grid |
| `web/src/lib/audio-preferences.ts` | Expandir patrones de deteccion |
| `web/src/styles.css` | Focus rings TV, ocultar scrollbars, overlay condicional |
| `web/src/api.ts` | Actualizar tipos para multiples candidatos |
| `web/src/types.ts` | Agregar StreamCandidate[] en respuesta auto |
| `web/public/manifest.json` | display=fullscreen, orientation=landscape |
| `web/public/sw.js` | NUEVO - Service worker |
| `web/index.html` | Registrar service worker |

### Prowlarr (configuracion externa)

| Accion | Detalle |
|--------|---------|
| Agregar indexers publicos | 1337x, EZTV, YTS, TorrentGalaxy, LimeTorrents, etc. (20+) |
| Agregar indexers espanol | Cinecalidad, DonTorrent, MejorTorrent, EliteTorrent, DivxTotal |
| Verificar conectividad | Testear cada indexer desde Prowlarr UI |

---

## Prioridad de implementacion

### Fase 1 - Critico (hacer primero)
1. Agregar indexers en Prowlarr (configuracion, no codigo)
2. Reforzar deteccion de idioma latino (candidates.js)
3. Persistir preferencia de audio (WatchPage.tsx)
4. Retornar 3 alternativas (playback.js)

### Fase 2 - TV Experience
5. Live TV auto-fullscreen + controles con timeout
6. useTvFocusManager global
7. D-pad en HomePage y WatchPage
8. Gamepad API

### Fase 3 - PWA
9. Service worker
10. Manifest mejorado
11. D-pad en paginas secundarias
12. Ocultar scrollbars en TV

---

## Notas finales

- **Testing**: Probar en el TV real despues de cada fase
- **Performance**: Monitorear que mas indexers no enlentezcan demasiado la busqueda (el grace time de Prowlarr ya lo maneja)
- **Fallback**: Siempre mantener al menos 1 candidato en ingles como ultimo recurso
- **Cache**: Limpiar cache de preflight al cambiar configuracion de idioma
