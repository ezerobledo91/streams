# =============================================================================
# Setup script para Streams MVP (Windows PowerShell)
# Ejecutar: powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# =============================================================================

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  Streams MVP - Setup (Windows)"           -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# --- 1. Node.js ---
Write-Host "`n[1/5] Verificando Node.js..." -ForegroundColor Yellow
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $ver = & node -v
    Write-Host "  Node.js encontrado: $ver" -ForegroundColor Green
    $major = [int]($ver -replace 'v','').Split('.')[0]
    if ($major -lt 18) {
        Write-Host "  ADVERTENCIA: Se requiere Node.js >= 18" -ForegroundColor Red
    }
} else {
    Write-Host "  Node.js NO encontrado." -ForegroundColor Red
    Write-Host "  Instalar desde: https://nodejs.org/" -ForegroundColor White
}

# --- 2. ffmpeg ---
Write-Host "`n[2/5] Verificando ffmpeg..." -ForegroundColor Yellow
$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpeg) {
    Write-Host "  ffmpeg encontrado: $($ffmpeg.Source)" -ForegroundColor Green
} else {
    Write-Host "  ffmpeg NO encontrado." -ForegroundColor Red
    Write-Host "  Instalar con: choco install ffmpeg" -ForegroundColor White
    Write-Host "  O descargar de: https://ffmpeg.org/download.html" -ForegroundColor White
}

# --- 3. Docker ---
Write-Host "`n[3/5] Verificando Docker (opcional, para Prowlarr)..." -ForegroundColor Yellow
$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
    $dver = & docker --version
    Write-Host "  Docker encontrado: $dver" -ForegroundColor Green
    Write-Host "  Para levantar Prowlarr: docker compose up -d" -ForegroundColor White
} else {
    Write-Host "  Docker NO encontrado (opcional)." -ForegroundColor White
    Write-Host "  Instalar Docker Desktop: https://docker.com/products/docker-desktop" -ForegroundColor White
}

# --- 4. npm install ---
Write-Host "`n[4/5] Instalando dependencias..." -ForegroundColor Yellow
$npm = Get-Command npm -ErrorAction SilentlyContinue
if ($npm) {
    Write-Host "  Instalando dependencias del servidor..."
    & npm install
    Write-Host "  Instalando dependencias del frontend..."
    & npm install --prefix web
    Write-Host "  Compilando frontend..."
    & npm run build:web
} else {
    Write-Host "  npm no encontrado. Instalar Node.js primero." -ForegroundColor Red
}

# --- 5. .env ---
Write-Host "`n[5/5] Verificando archivo .env..." -ForegroundColor Yellow
if (-not (Test-Path .env)) {
    Copy-Item .env.example .env
    Write-Host "  .env creado desde .env.example" -ForegroundColor Green
    Write-Host "  IMPORTANTE: Editar .env con tus claves:" -ForegroundColor Yellow
    Write-Host "    - TMDB_BEARER_TOKEN" -ForegroundColor White
    Write-Host "    - PROWLARR_API_KEY" -ForegroundColor White
    Write-Host "    - FFMPEG_PATH (si no esta en PATH)" -ForegroundColor White
} else {
    Write-Host "  .env ya existe, no se sobreescribe." -ForegroundColor Green
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  Setup completado!" -ForegroundColor Green
Write-Host ""
Write-Host "  Pasos siguientes:"
Write-Host "  1. Editar .env con tus claves de API"
Write-Host "  2. (Opcional) Prowlarr: docker compose up -d"
Write-Host "  3. Iniciar servidor: npm start"
Write-Host "  4. Abrir: http://localhost:8787"
Write-Host "==========================================" -ForegroundColor Cyan
