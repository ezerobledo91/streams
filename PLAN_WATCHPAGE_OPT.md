# Plan de Optimización — WatchPage

## Problemas Detectados (por prioridad)

### P0 — Controles bloqueados / no cancelable
- Los botones de calidad, alternativas y episodios usan `disabled={isPreparingPlayback}`
- Si el backend tarda 90s buscando, la UI queda congelada
- No hay forma de cancelar un intento en curso
- En TV remoto, las flechas funcionan pero los Enter/click no responden

### P1 — Cambio de calidad re-busca todo desde cero
- `handleQualityClick` → `playWithBackendAuto` → `startAutoPlayback` (POST /api/playback/auto)
- Destruye la sesión torrent activa antes de buscar una nueva
- Timeout del ciclo: hasta 90 segundos
- Las `alternatives` ya validadas del primer playback no se reutilizan

### P2 — "Seguir viendo" no retoma la misma fuente
- Resume la posición temporal (seek) pero busca un stream nuevo
- `preferredSourceKey` existe pero se resetea en `""` al cambiar episodio/contenido
- No hay persistencia de la fuente que funcionó

### P3 — Audio MKV sin fallback
- Browser (Chrome) no soporta `video.audioTracks` API para MKV
- M3U VOD puede servir MKV que el browser no puede reproducir
- No hay transcode fallback para streams directos (solo para torrents)

### P4 — Navegación TV incompleta
- Zonas header/player/sidebar no cubren menú de calidad cuando está `disabled`
- No hay forma de interrumpir/cancelar con el remoto (Escape solo navega a "/")

---

## Solución por Problema

### Fix P0 — Hacer cancelable el playback + desbloquear controles

**Principio**: Los controles NUNCA deben quedar deshabilitados. El usuario siempre puede cambiar de opinión.

**Cambios en WatchPage.tsx**:

1. Eliminar `disabled={isPreparingPlayback}` de:
   - Botones de calidad
   - Botones de alternativas
   - Selector de temporada
   - Botones de episodios

2. En su lugar: si el usuario interactúa durante la carga, cancelar el intento actual:
   - `beginPlaybackAttempt()` ya incrementa un contador → los intentos viejos se auto-cancelan via `assertPlaybackAttemptActive`
   - Solo necesitamos llamar `beginPlaybackAttempt()` antes de iniciar la nueva acción (ya lo hace `handleQualityClick` y `handleStartPlayback`)

3. Agregar botón "Cancelar" visible durante la carga:
   - Aparece cuando `isPreparingPlayback === true`
   - Click → `beginPlaybackAttempt()` + `clearActivePlayback(true)` + `setIsPreparingPlayback(false)`
   - En TV: mapeado a tecla Escape cuando hay playback en curso

4. Agregar AbortController al fetch de `startAutoPlayback`:
   - Pasar `signal` al fetch para cancelar la request HTTP al servidor
   - Evita que el servidor siga procesando torrents que ya no interesan

**Cambios en api.ts**:
- `startAutoPlayback` acepta `signal?: AbortSignal` opcional
- Se pasa al `apiFetch` interno

**Archivos**: `web/src/views/WatchPage.tsx`, `web/src/api.ts`

---

### Fix P1 — Reutilizar alternatives para cambio de calidad

**Principio**: Si ya tenemos fuentes validadas, usarlas antes de buscar nuevas.

**Lógica nueva en handleQualityClick**:

```
1. Si hay alternatives validadas:
   a. Buscar en alternatives una que matchee la calidad pedida
   b. Si hay match → handlePlayAlternative(match) (ya implementado, funciona)
   c. Si no hay match → fallback a playWithBackendAuto (como hoy)
2. Si no hay alternatives → playWithBackendAuto (como hoy)
```

**También**: Cuando el usuario elige una alternativa, guardar su `sourceKey` en `preferredSourceKeyRef` para que futuros cambios de calidad del mismo contenido prioricen esa fuente.

**Archivos**: `web/src/views/WatchPage.tsx` (solo frontend, ~15 líneas)

---

### Fix P2 — Persistir la fuente que funcionó para "seguir viendo"

**Principio**: Si un stream funcionó, recordarlo para la próxima vez.

**Cambios**:

1. En `playResolvedPayload`, después de `setPlayerReady(true)`:
   - Guardar `payload.chosen.sourceKey` en `preferredSourceKeyRef.current`
   - Persistir en localStorage: `streams_last_source|{type}|{itemId}` = sourceKey

2. Al montar WatchPage, si hay entrada en "seguir viendo":
   - Leer sourceKey de localStorage
   - Asignar a `preferredSourceKeyRef.current`
   - El backend ya respeta `preferredSourceKey` (lo pone primero en la lista de candidatos)

3. Resultado: la próxima vez que entres al mismo contenido, el backend prueba primero la fuente que ya funcionó → conexión más rápida.

**Archivos**: `web/src/views/WatchPage.tsx` (~10 líneas)

---

### Fix P3 — Fallback MKV para M3U VOD

**Principio**: Si el browser no puede reproducir el MKV directo, intentar otra fuente o informar al usuario.

**Cambios**:

1. En `useHlsPlayer.ts`, en el handler de error de video:
   - Si `activeChosenCandidate?.fileExtension === "mkv"` y el video tiene error:
   - Dispara `onRuntimeFailure("Formato MKV no soportado por este navegador")`
   - El mensaje le indica al usuario que debe elegir otra fuente

2. En el backend `playback.js`, en `probeDirectStream`:
   - Para M3U VOD con Content-Type `video/x-matroska`: marcar el candidato con `mkv: true`
   - En la selección final: si hay un candidato no-MKV disponible, preferirlo sobre MKV
   - Solo usar MKV si no hay alternativa

**Archivos**: `lib/routes/playback.js` (~5 líneas), mensaje de error informativo

---

### Fix P4 — Mejorar navegación TV

**Cambios en el keyboard handler de WatchPage**:

1. **Escape durante carga**: Si `isPreparingPlayback`, Escape cancela el intento en vez de navegar a "/"
   ```
   case "Escape":
     if (isPreparingPlayback) { cancelarIntento(); break; }
     navigate("/");
     break;
   ```

2. **No bloquear flechas en sidebar**: Quitar el `disabled` permite que los botones reciban click incluso durante la carga (ya cubierto por Fix P0).

3. **Feedback visual mejorado**: El botón "Cancelar" aparece como un overlay accesible con el D-pad (parte de la zona player, foco automático).

**Archivos**: `web/src/views/WatchPage.tsx` (dentro del keyboard handler existente)

---

## Orden de Implementación

1. **Fix P0** (cancelable + desbloquear) — Es la base para los demás
2. **Fix P1** (reutilizar alternatives) — Depende de P0 (controles desbloqueados)
3. **Fix P2** (persistir fuente) — Independiente
4. **Fix P4** (nav TV) — Depende de P0
5. **Fix P3** (MKV fallback) — Independiente, menor impacto

## Archivos Afectados

| Archivo | Cambios |
|---------|---------|
| `web/src/views/WatchPage.tsx` | P0, P1, P2, P4 |
| `web/src/api.ts` | P0 (AbortSignal) |
| `lib/routes/playback.js` | P3 (preferir no-MKV) |

## Lo que NO se toca

- Pipeline de resolución de streams (backend) — funciona bien
- useHlsPlayer — ya tiene reintentos robustos
- useSubtitleSelection — funciona correctamente
- useMetaDetails — funciona correctamente
- Sessions/torrent — sin cambios
