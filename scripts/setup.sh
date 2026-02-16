#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Setup script para Streams MVP
# Ejecutar en la nueva PC despues de clonar el repositorio
# =============================================================================

echo "=========================================="
echo "  Streams MVP - Setup"
echo "=========================================="

# --- 1. Verificar Node.js ---
echo ""
echo "[1/5] Verificando Node.js..."
if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v)
  echo "  Node.js encontrado: $NODE_VERSION"
  # Chequear version minima 18
  MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
  if [ "$MAJOR" -lt 18 ]; then
    echo "  ADVERTENCIA: Se requiere Node.js >= 18. Tenes $NODE_VERSION"
    echo "  Instalar desde: https://nodejs.org/"
  fi
else
  echo "  Node.js NO encontrado."
  echo "  Instalar desde: https://nodejs.org/ (version 18 o superior)"
  echo "  O con nvm: nvm install 18"
fi

# --- 2. Verificar ffmpeg ---
echo ""
echo "[2/5] Verificando ffmpeg..."
if command -v ffmpeg &>/dev/null; then
  FFMPEG_VERSION=$(ffmpeg -version 2>&1 | head -1)
  echo "  ffmpeg encontrado: $FFMPEG_VERSION"
else
  echo "  ffmpeg NO encontrado."
  echo "  Instalar:"
  echo "    Windows (choco): choco install ffmpeg"
  echo "    Windows (scoop): scoop install ffmpeg"
  echo "    Linux (apt):     sudo apt install ffmpeg"
  echo "    Linux (snap):    sudo snap install ffmpeg"
  echo "    macOS (brew):    brew install ffmpeg"
fi

# --- 3. Verificar Docker (para Prowlarr) ---
echo ""
echo "[3/5] Verificando Docker (opcional, para Prowlarr)..."
if command -v docker &>/dev/null; then
  DOCKER_VERSION=$(docker --version)
  echo "  Docker encontrado: $DOCKER_VERSION"

  if command -v docker-compose &>/dev/null || docker compose version &>/dev/null 2>&1; then
    echo "  Docker Compose disponible."
    echo "  Para levantar Prowlarr: docker compose up -d"
  else
    echo "  Docker Compose NO encontrado. Instalar Docker Desktop."
  fi
else
  echo "  Docker NO encontrado (opcional)."
  echo "  Prowlarr se puede instalar sin Docker desde: https://prowlarr.com/"
  echo "  O instalar Docker Desktop: https://docker.com/products/docker-desktop"
fi

# --- 4. Instalar dependencias npm ---
echo ""
echo "[4/5] Instalando dependencias..."
if command -v npm &>/dev/null; then
  echo "  Instalando dependencias del servidor..."
  npm install
  echo "  Instalando dependencias del frontend..."
  npm install --prefix web
  echo "  Compilando frontend..."
  npm run build:web
else
  echo "  npm no encontrado. Instalar Node.js primero."
fi

# --- 5. Configurar .env ---
echo ""
echo "[5/5] Verificando archivo .env..."
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  .env creado desde .env.example"
  echo "  IMPORTANTE: Editar .env con tus claves:"
  echo "    - TMDB_BEARER_TOKEN (obtener de https://www.themoviedb.org/settings/api)"
  echo "    - PROWLARR_API_KEY (obtener de Prowlarr > Settings > General)"
  echo "    - FFMPEG_PATH (ruta a ffmpeg si no esta en PATH)"
  echo "    - LIVE_TV_LISTS_DIR (ruta a las listas M3U, por defecto usa ./lists/)"
else
  echo "  .env ya existe, no se sobreescribe."
fi

echo ""
echo "=========================================="
echo "  Setup completado!"
echo ""
echo "  Pasos siguientes:"
echo "  1. Editar .env con tus claves de API"
echo "  2. (Opcional) Levantar Prowlarr: docker compose up -d"
echo "  3. Iniciar servidor: npm start"
echo "  4. Abrir en el browser: http://localhost:8787"
echo "=========================================="
