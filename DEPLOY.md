# Deploy en nueva PC

## Requisitos previos

- **Node.js** v18+ (descargar de https://nodejs.org/)
- **ffmpeg** (instalar con `choco install ffmpeg` o descargar de https://ffmpeg.org/)
- **Docker Desktop** (para Prowlarr - descargar de https://docker.com/products/docker-desktop)
- **Git** (para clonar el repo)

---

## Deploy rapido (3 pasos)

### 1. Clonar el repo

```bash
git clone <url-del-repo> streams
cd streams
```

### 2. Ejecutar deploy

Doble click en **`deploy.bat`** o desde terminal:

```cmd
deploy.bat
```

Esto automaticamente:
- Levanta Prowlarr en Docker (`docker compose up -d`)
- Instala dependencias (`npm install` servidor + frontend)
- Compila el frontend (`npm run build:web`)
- Crea `.env` desde `.env.example` si no existe (y lo abre para editar)

### 3. Iniciar el servidor

Doble click en **`start.bat`** o:

```cmd
start.bat
```

Listo. Abrir http://localhost:8787

---

## Scripts disponibles

| Script | Que hace |
|--------|----------|
| **`deploy.bat`** | Deploy completo: Docker + dependencias + build + .env |
| **`start.bat`** | Inicia el servidor (y Docker si esta disponible) |
| **`update.bat`** | Actualiza: git pull + npm install + build |

---

## Configurar .env

El `deploy.bat` crea el `.env` automaticamente. Editar con tus claves:

```env
# OBLIGATORIO
TMDB_BEARER_TOKEN=tu-clave-aqui
TMDB_API_READ_ACCESS_TOKEN=tu-token-aqui

# Subtitulos (opcional)
OPEN_SUBTITLES_API_KEY=tu-clave-aqui

# ffmpeg (si no esta en PATH, poner ruta completa)
FFMPEG_PATH=ffmpeg

# Prowlarr (obtener API key de http://localhost:9696 > Settings > General)
PROWLARR_API_KEY=tu-api-key-aqui

# Optimizado para 30 Mbps
PLAYBACK_HLS_MAX_HEIGHT=480
PLAYBACK_HLS_CRF=30
PLAYBACK_HLS_PRESET=ultrafast
PLAYBACK_MAX_SESSIONS=4
LIVE_TV_FORCE_TRANSCODE=true
```

---

## Prowlarr (primera vez)

Despues de ejecutar `deploy.bat`, Prowlarr queda corriendo en http://localhost:9696

1. Abrir http://localhost:9696
2. Crear usuario/password
3. Ir a **Settings > General** → copiar **API Key**
4. Pegar en `.env` como `PROWLARR_API_KEY`
5. Agregar indexers: **Indexers > Add** (1337x, YTS, RARBG, etc.)

---

## Acceso desde otros dispositivos

Todos los dispositivos (TV, celular, proyector) deben estar en la misma red.

Abrir: `http://IP-DE-LA-PC:8787`

Para ver la IP: ejecutar `ipconfig` y buscar "IPv4 Address".

---

## Inicio automatico con Windows

Para que arranque solo al prender la PC:

1. `Win+R` → escribir `shell:startup` → Enter
2. Copiar un acceso directo de `start.bat` ahi dentro

Cada vez que prendas la PC, el server y Prowlarr arrancan solos.

---

## Ancho de banda: 30 Mbps

**Sobra.** Con la config de 480p + CRF 30:

| Uso | Consumo |
|-----|---------|
| 1 TV con Live TV | ~1 Mbps |
| 1 celular con pelicula | ~1 Mbps |
| Total tipico | ~2 Mbps de 30 |

Si en el futuro mejoras la conexion, subir `PLAYBACK_HLS_MAX_HEIGHT=720` o `1080` en `.env`.

---

## Troubleshooting

| Problema | Solucion |
|----------|----------|
| "ffmpeg not found" | Verificar `FFMPEG_PATH` en `.env` |
| No carga peliculas | Verificar `TMDB_BEARER_TOKEN` en `.env` |
| Live TV sin canales | Verificar que `./lists/` tenga archivos `.m3u` |
| No se ve desde TV | Verificar misma red WiFi + IP correcta |
| Docker no levanta | Abrir Docker Desktop primero, despues `deploy.bat` |
| Video se traba | Bajar `PLAYBACK_HLS_MAX_HEIGHT` a 360 |
