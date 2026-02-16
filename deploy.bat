@echo off
chcp 65001 >nul 2>&1
title Streams MVP - Deploy completo
color 0B

echo ==========================================
echo   STREAMS MVP - DEPLOY COMPLETO
echo ==========================================
echo.

:: Ir al directorio del script
cd /d "%~dp0"

:: ----- 1. Docker: Prowlarr -----
echo [1/4] Levantando Docker (Prowlarr)...
where docker >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo   AVISO: Docker no encontrado, saltando Prowlarr.
    echo   Instalar Docker Desktop si queres Prowlarr.
) else (
    docker compose up -d
    if %ERRORLEVEL% equ 0 (
        echo   Prowlarr levantado en http://localhost:9696
    ) else (
        echo   AVISO: Fallo al levantar Docker. Asegurate que Docker Desktop este corriendo.
    )
)
echo.

:: ----- 2. Dependencias -----
echo [2/4] Instalando dependencias...
call npm install
if %ERRORLEVEL% neq 0 (
    echo   ERROR: Fallo npm install del servidor.
    pause
    exit /b 1
)
call npm install --prefix web
if %ERRORLEVEL% neq 0 (
    echo   ERROR: Fallo npm install del frontend.
    pause
    exit /b 1
)
echo   Dependencias instaladas OK.
echo.

:: ----- 3. Build frontend -----
echo [3/4] Compilando frontend...
call npm run build:web
if %ERRORLEVEL% neq 0 (
    echo   ERROR: Fallo el build del frontend.
    pause
    exit /b 1
)
echo   Frontend compilado OK.
echo.

:: ----- 4. .env -----
echo [4/4] Verificando .env...
if not exist .env (
    copy .env.example .env >nul
    echo   .env creado desde .env.example
    echo   IMPORTANTE: Editar .env con tus claves antes de iniciar!
    echo.
    echo   Abriendo .env para editar...
    notepad .env
    pause
) else (
    echo   .env ya existe, OK.
)
echo.

echo ==========================================
echo   DEPLOY COMPLETO!
echo.
echo   Para iniciar el servidor ejecutar:
echo     start.bat
echo.
echo   O directamente:
echo     npm start
echo ==========================================
pause
