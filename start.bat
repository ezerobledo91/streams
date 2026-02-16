@echo off
chcp 65001 >nul 2>&1
title Streams MVP - Server
color 0A

cd /d "%~dp0"

:: Verificar que .env existe
if not exist .env (
    echo ERROR: No existe .env - Ejecutar deploy.bat primero.
    pause
    exit /b 1
)

:: Levantar Docker si esta disponible (por si Prowlarr no esta corriendo)
where docker >nul 2>&1
if %ERRORLEVEL% equ 0 (
    docker compose up -d >nul 2>&1
)

echo ==========================================
echo   STREAMS MVP - Iniciando servidor...
echo   Ctrl+C para detener
echo ==========================================
echo.

node server.js
pause
