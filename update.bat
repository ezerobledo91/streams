@echo off
chcp 65001 >nul 2>&1
title Streams MVP - Actualizar
color 0E

cd /d "%~dp0"

echo ==========================================
echo   STREAMS MVP - Actualizando...
echo ==========================================
echo.

echo [1/3] Bajando cambios del repo...
git pull
echo.

echo [2/3] Actualizando dependencias...
call npm install
call npm install --prefix web
echo.

echo [3/3] Recompilando frontend...
call npm run build:web
echo.

echo ==========================================
echo   Actualizado! Reiniciar el server:
echo     start.bat
echo ==========================================
pause
