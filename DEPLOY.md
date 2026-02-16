# Deploy en nueva PC

## Requisitos de la nueva PC

| Componente | Minimo | Recomendado |
|-----------|--------|-------------|
| **OS** | Windows 10/11, Linux, macOS | Windows 11 |
| **CPU** | 4 cores | 6+ cores (el transcode HLS usa CPU) |
| **RAM** | 4 GB | 8 GB |
| **Disco** | 10 GB libres | 20+ GB (cache HLS + torrents temporales) |
| **Node.js** | v18+ | v20 LTS |
| **ffmpeg** | Requerido | Ultima version estable |
| **Docker** | Opcional (solo para Prowlarr) | Docker Desktop |

---

## Paso a paso

### 1. Clonar el repositorio

```bash
git clone <url-del-repo> streams
cd streams
```

### 2. Instalar Node.js

Descargar desde https://nodejs.org/ (version 20 LTS recomendada).

Verificar:
```bash
node -v   # debe ser >= 18
npm -v
```

### 3. Instalar ffmpeg

**Windows (con Chocolatey):**
```powershell
choco install ffmpeg
```

**Windows (manual):**
1. Descargar desde https://ffmpeg.org/download.html (build "essentials")
2. Extraer en `C:\ffmpeg`
3. Agregar `C:\ffmpeg\bin` al PATH del sistema

**Linux:**
```bash
sudo apt install ffmpeg
```

Verificar:
```bash
ffmpeg -version
```

### 4. Instalar dependencias y compilar

```bash
npm install
npm install --prefix web
npm run build:web
```

O usar el script automatico:

**Windows (PowerShell):**
```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
```

**Linux/Mac:**
```bash
bash scripts/setup.sh
```

### 5. Configurar variables de entorno

```bash
cp .env.example .env
```

Editar `.env` con los valores reales:

```env
# OBLIGATORIO - clave de TMDB para buscar peliculas/series
TMDB_BEARER_TOKEN=42ea3665a87929cd34156d90d7eea87e

# OBLIGATORIO - token de lectura de TMDB
TMDB_API_READ_ACCESS_TOKEN=eyJhbGciOiJIUzI1NiJ9...

# Subtitulos (opcional pero recomendado)
OPEN_SUBTITLES_API_KEY=HPxgUZ4AYzJ1LkLwmoGxOsmPHmCaL42y

# Ruta a ffmpeg (si no esta en PATH, poner ruta completa)
# Windows con choco: C:\ProgramData\chocolatey\bin\ffmpeg.exe
# Si esta en PATH: ffmpeg
FFMPEG_PATH=ffmpeg

# Listas M3U - dejar vacio para usar las del repo (./lists/)
LIVE_TV_LISTS_DIR=

# Prowlarr (ver paso 6)
PROWLARR_ENABLED=true
PROWLARR_URL=http://localhost:9696
PROWLARR_API_KEY=   # se obtiene despues de levantar Prowlarr

# Configuracion optimizada para 30 Mbps
PLAYBACK_HLS_MAX_HEIGHT=480
PLAYBACK_HLS_CRF=30
PLAYBACK_HLS_PRESET=ultrafast
PLAYBACK_HLS_SEGMENT_SECONDS=2
PLAYBACK_HLS_READY_SEGMENTS=2
PLAYBACK_MAX_SESSIONS=4
PLAYBACK_MAX_CONNS=36
PLAYBACK_SESSION_TTL_MS=600000
LIVE_TV_FORCE_TRANSCODE=true
```

### 6. Prowlarr (opcional, mejora la busqueda de torrents)

**Con Docker:**
```bash
docker compose up -d
```

Esto levanta Prowlarr en http://localhost:9696

1. Abrir http://localhost:9696
2. Configurar usuario/password en el primer inicio
3. Ir a **Settings > General** y copiar la **API Key**
4. Pegarla en `.env` como `PROWLARR_API_KEY`
5. En Prowlarr, agregar indexers (1337x, RARBG, YTS, etc.)

**Sin Docker (instalacion directa):**
Descargar desde https://prowlarr.com/ e instalar como servicio.

### 7. Iniciar el servidor

```bash
npm start
```

El servidor arranca en:
- Local: http://localhost:8787
- Red local: http://IP-DE-LA-PC:8787

### 8. Verificar que funciona

1. Abrir http://localhost:8787 en el browser
2. Buscar una pelicula para verificar TMDB
3. Entrar a Live TV para verificar los canales
4. Reproducir un canal para verificar ffmpeg

---

## Acceso desde otros dispositivos (TV, celular, proyector)

Todos los dispositivos deben estar en la **misma red WiFi/LAN**.

Abrir en el browser del dispositivo:
```
http://IP-DE-LA-PC:8787
```

Para encontrar la IP de la PC nueva, ejecutar:
- **Windows:** `ipconfig` (buscar "IPv4 Address")
- **Linux:** `ip addr` o `hostname -I`

Ejemplo: si la IP es `192.168.1.50`, abrir `http://192.168.1.50:8787`

---

## Iniciar automaticamente con Windows

Para que el server arranque al prender la PC:

### Opcion A: Tarea programada (recomendada)

1. Abrir **Programador de tareas** (Task Scheduler)
2. Crear tarea basica:
   - Nombre: `Streams Server`
   - Desencadenador: "Al iniciar sesion"
   - Accion: "Iniciar programa"
   - Programa: `node`
   - Argumentos: `server.js`
   - Iniciar en: `C:\ruta\al\repo\streams`
3. En propiedades avanzadas: marcar "Ejecutar con privilegios mas altos"

### Opcion B: Script bat en Inicio

Crear archivo `start-streams.bat`:
```bat
@echo off
cd /d C:\ruta\al\repo\streams
node server.js
```

Poner acceso directo en `shell:startup` (Win+R → `shell:startup`).

---

## Ancho de banda: 30 Mbps subida/bajada

### Va a andar? Si, sobra.

Calculo de consumo por tipo de stream:

| Tipo | Bitrate tipico | Streams simultaneos con 30 Mbps |
|------|---------------|-------------------------------|
| **Live TV (proxy directo)** | 2-5 Mbps | 6-15 streams |
| **Live TV (transcode 480p)** | ~0.8 Mbps | 30+ streams |
| **Peliculas HLS (480p, CRF 30)** | ~0.5-1 Mbps | 15-30 streams |
| **Peliculas HLS (720p, CRF 23)** | ~1.5-3 Mbps | 10-20 streams |
| **Torrent descarga** | Variable | Depende de seeders |

### Escenario tipico en tu casa:

- 1 TV viendo Live TV (transcode 480p) = **~1 Mbps**
- 1 celular viendo una peli (HLS 480p) = **~1 Mbps**
- Total = **~2 Mbps** de los 30 disponibles

**El cuello de botella NO es tu red local** (que es 100+ Mbps), sino:
1. La **bajada de Internet** para descargar el torrent/stream fuente
2. La **CPU** para transcodificar (ffmpeg con `ultrafast` minimiza esto)

### Configuracion optimizada para 30 Mbps

Ya esta en el `.env` de arriba, pero lo importante:

```env
PLAYBACK_HLS_MAX_HEIGHT=480      # No transcodificar a mas de 480p (ahorra CPU y ancho de banda)
PLAYBACK_HLS_CRF=30              # Compresion alta (archivos mas chicos, calidad aceptable en TV)
PLAYBACK_HLS_PRESET=ultrafast    # Minimo uso de CPU
PLAYBACK_MAX_SESSIONS=4          # Maximo 4 transcodes simultaneos
LIVE_TV_FORCE_TRANSCODE=true     # Transcodificar Live TV (mas estable que proxy directo)
```

Si los clientes tienen mejor conexion (ej: 100 Mbps), igual van a recibir el stream a la calidad que transcodifica el server (480p). Si en el futuro mejoras la conexion del server, podes subir `PLAYBACK_HLS_MAX_HEIGHT=720` o `1080`.

---

## Actualizaciones futuras

Cuando hagas cambios en el codigo:

```bash
cd streams
git pull
npm install
npm run build:web
# Reiniciar el server (Ctrl+C y npm start)
```

---

## Estructura de archivos importantes

```
streams/
├── server.js              # Servidor principal
├── .env                   # Configuracion (NO se sube a git)
├── .env.example           # Plantilla de configuracion
├── docker-compose.yml     # Docker para Prowlarr
├── package.json           # Dependencias
├── lists/                 # Listas M3U de canales de TV
│   ├── argentina.m3u
│   ├── deportes.m3u
│   ├── noticias.m3u
│   └── ...
├── config/                # Datos de la app (se generan solos)
│   ├── prowlarr/          # Datos de Prowlarr (Docker)
│   ├── playback-hls/      # Cache HLS temporal (se limpia solo)
│   ├── live-tv-preferences.json
│   ├── stream-reliability.json
│   └── ...
├── lib/                   # Logica del servidor
├── web/                   # Frontend (React)
│   ├── src/               # Codigo fuente
│   └── dist/              # Build compilado
├── scripts/
│   ├── setup.sh           # Setup para Linux/Mac
│   └── setup.ps1          # Setup para Windows
└── DEPLOY.md              # Este archivo
```

---

## Troubleshooting

| Problema | Solucion |
|----------|----------|
| "ffmpeg not found" | Verificar `FFMPEG_PATH` en `.env` o agregar al PATH |
| No carga peliculas | Verificar `TMDB_BEARER_TOKEN` en `.env` |
| Live TV sin canales | Verificar que `./lists/` tenga archivos `.m3u` |
| No se ve desde TV/celular | Verificar que estan en la misma red y usar IP correcta |
| Cache HLS llena el disco | Se limpia sola cada 2 min, pero podes bajar `PLAYBACK_MAX_SESSIONS` |
| Prowlarr no conecta | Verificar que Docker esta corriendo: `docker ps` |
| Video se traba | Bajar `PLAYBACK_HLS_MAX_HEIGHT` a 360, subir `PLAYBACK_HLS_CRF` a 32 |
