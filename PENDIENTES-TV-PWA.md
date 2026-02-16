# Estado - Optimización TV / PWA

> Última actualización: 2026-02-15
> Referencia: PLAN-OPTIMIZACION-PWA-TV.md

---

## Estado general

| Fase | Completitud | Notas |
|------|-------------|-------|
| Fase 1 — Crítico (Prowlarr, idioma, alternativas) | **100%** | Todo implementado |
| Fase 2 — TV Experience | **100%** | Focus manager, gamepad, D-pad, auto-fullscreen |
| Fase 3 — PWA | **100%** | SW + manifest implementados |

---

## Todo implementado

### Fase 1
- [x] Prowlarr .env (18000/200/300)
- [x] 16 trackers públicos en config.js
- [x] 9 addons en stream-manifests.json (5 originales + 4 nuevos)
- [x] Patrones de idioma latino expandidos (es-419, es, multi, und)
- [x] Scoring velocidad > calidad (bonus tamaño/seeders)
- [x] 3 alternativas en /api/playback/auto
- [x] Audio preference persistido en localStorage (default "es")
- [x] Stream timeouts reducidos (4000ms, 1500ms)

### Fase 2
- [x] isTvEnvironment() — detección Smart TV (LiveTvPage.tsx)
- [x] Auto-fullscreen en TV al seleccionar canal y al reproducir
- [x] Controles overlay con auto-hide 5s por inactividad
- [x] useTvKeyboard con Up/Down/Left/Right/PageUp/PageDown/Enter/Escape/F
- [x] useTvFocusManager.ts — navegación espacial (rail/grid/list)
- [x] useGamepad.ts — mapeo Gamepad API a eventos teclado
- [x] D-pad en HomePage — navegación entre rails (Up/Down) y cards (Left/Right)
- [x] D-pad en LoginPage — navegación grid de perfiles con Enter para seleccionar
- [x] D-pad en CategoryPage — navegación grid con focus manager
- [x] D-pad en WatchPage — Left/Right seek ±10s, Enter/Space play/pause
- [x] CSS focus rings con var(--brand) + scale en media-tile/login-profile
- [x] Scrollbars ocultos en dispositivos sin hover (hover: none, pointer: none)
- [x] Drawer de canales como overlay absoluto en fullscreen

### Fase 3
- [x] Service Worker (web/public/sw.js) — cache-first assets, network-first API
- [x] Registro SW en index.html
- [x] manifest.json (fullscreen, landscape, #050505, categories, launch_handler)

---

## Archivos creados/modificados

### Hooks nuevos
- `web/src/hooks/useTvFocusManager.ts` — Navegación espacial genérica
- `web/src/hooks/useGamepad.ts` — Gamepad API → keyboard events

### Hooks modificados
- `web/src/hooks/useTvKeyboard.ts` — +Left/Right/PageUp/PageDown

### Páginas modificadas
- `web/src/views/LiveTvPage.tsx` — isTvEnvironment, auto-fullscreen, controls timeout
- `web/src/views/HomePage.tsx` — D-pad rails navigation, useGamepad
- `web/src/views/LoginPage.tsx` — useTvFocusManager grid, useGamepad
- `web/src/views/CategoryPage.tsx` — useTvFocusManager grid, useGamepad
- `web/src/views/WatchPage.tsx` — Keyboard seek/play-pause

### PWA
- `web/public/sw.js` — Service Worker (NUEVO)
- `web/public/manifest.json` — Actualizado fullscreen/landscape
- `web/index.html` — SW registration + theme-color actualizado

### Config
- `config/stream-manifests.json` — +4 addons (Cyberflix, Jackett, KnightCrawler, Orion)

### Estilos
- `web/src/styles.css` — Focus rings TV, scrollbars ocultos, drawer fullscreen overlay

---

## Notas para testing
- Probar en Smart TV real: auto-fullscreen, controles con timeout, D-pad
- Probar gamepad con control Bluetooth
- Verificar que el SW no cachee respuestas de API incorrectamente
- En manifest landscape: verificar que no fuerce orientación en móvil (Chrome ignora "landscape" en móvil)
- Los 4 addons nuevos pueden necesitar verificación de que sus manifests estén activos
