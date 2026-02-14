# Plan: Fixes del Pipeline de Playback (Pelis/Series)

## Problemas identificados

1. **Idioma incorrecto** — `"und"` y `"multi"` reciben bonus alto cuando preferencia es "original"
2. **Lento encontrar origen** — validación secuencial, directos malos primero, timeouts largos
3. **Cambio de episodio roto** — limpia playback pero NO auto-reproduce el nuevo episodio
4. **Prioridades desordenadas** — directos siempre van antes que torrents sin importar score

---

## Fix 1: Idioma — Penalizar `und`/`multi` cuando preferencia es "original"

**Archivo:** `lib/playback/candidates.js`

**Cambio en `getAudioPriorityOrder` (línea 26-42):**

Cuando la preferencia es "original" y hay un idioma original conocido, `und` y `multi` deben ir DESPUÉS del idioma original y del inglés, no antes. Actualmente:

```js
// ANTES (mal): original=ja → ["ja", "en", "und", "multi", "es-419", "es"]
// und en posición 2 → bonus +26, casi igual que el original
```

Cambiar a:

```js
// DESPUÉS (bien): original=ja → ["ja", "en", "es-419", "es", "multi", "und"]
// und en posición 5 → bonus 0, no compite con idioma real
```

La idea: `und` y `multi` solo son buenos cuando NO sabemos el idioma original o cuando la preferencia es español.

**Cambio en `languageScoreAdjustment` (línea 129-137):**

Reducir el spread para que el idioma no sea tan dominante vs seeders:
- Rank 0: +40 (era +56)
- Rank 1: +28 (era +40)
- Rank 2: +16 (era +26)
- Rank 3: +8 (era +14)
- Rank 4: +2 (era +6)
- Rank >= 6: -80 (era -120) — menos castigo para no descartar todo

---

## Fix 2: Velocidad — Validación más inteligente

**Archivo:** `lib/routes/playback.js`

### 2a. No separar directos y torrents — ordenar por score unificado

En `POST /api/playback/auto` (línea 734-735), eliminar la separación forzada de directos primero. En vez de eso, iterar `orderedWithPreferred` en orden de score unificado y validar cada candidato según su tipo (probe si es directo, sesión si es torrent).

### 2b. Early termination más agresivo

- Si encontramos un candidato validado con score > umbral razonable, parar inmediatamente
- Reducir `maxDirectProbeCandidates` de 6 a 3 en modo auto
- Reducir `initialFallbackAttempts` de 3 a 2 en modo auto
- Si el primer candidato (mejor score) es torrent con >10 seeders y webFriendly, probarlo primero sin esperar a probar todos los directos

### 2c. Timeout de probe más corto

- Reducir `probeTimeoutMs` default de 5000 a 3500 desde el frontend
- Reducir `waitReadyMs` de 36000 a 20000 desde el frontend

---

## Fix 3: Auto-play al cambiar episodio

**Archivo:** `web/src/views/WatchPage.tsx`

**Cambio en el useEffect de línea 381-400:**

Después de limpiar el playback, iniciar automáticamente la reproducción del nuevo episodio:

```tsx
useEffect(() => {
  const key = `${type}|${decodedItemId}|${season}|${episode}`;
  if (!decodedItemId) return;
  if (autoLoadKeyRef.current === key) return;
  autoLoadKeyRef.current = key;

  const isFirstLoad = !hasPlaybackStarted; // ← NUEVO: detectar si es primera carga

  beginPlaybackAttempt();
  preferredSourceKeyRef.current = "";
  resetValidatedQualities();
  void clearActivePlayback(true);
  setActionError(null);

  // NUEVO: Si ya se había iniciado playback antes (cambio de episodio),
  // auto-reproducir el nuevo episodio
  if (!isFirstLoad) {
    const attemptId = beginPlaybackAttempt();
    void playWithBackendAuto("auto", true, attemptId).catch((err) => {
      setActionError(err instanceof Error ? err.message : "No hay video disponible.");
    });
  }
}, [...]);
```

**Problema:** `hasPlaybackStarted` se resetea en `clearActivePlayback(true)`. Necesitamos capturar el valor ANTES de limpiar.

Solución: usar una ref `hasEverStartedRef` que no se resetea al limpiar, solo al desmontar o cambiar de título (itemId).

---

## Fix 4: Orden unificado — No forzar directos primero

**Archivo:** `lib/playback/candidates.js`

**Cambio en `orderCandidatesForPlayback` (línea 442-478):**

Eliminar la separación final `[...direct, ...torrents]`. El sort ya ordena correctamente por score. La separación destruye ese orden.

Cambiar a simplemente:
```js
return source;
```

Esto permite que un torrent con score alto (idioma correcto, muchos seeders, webFriendly) vaya antes que un directo con score bajo.

**Archivo:** `lib/routes/playback.js`

Adaptar `POST /api/playback/auto` para iterar candidatos en orden unificado en vez de tener dos loops separados (uno para directos, otro para torrents). Un solo loop que decide: si tiene `directUrl` → probe, si tiene `magnet` → crear sesión.

---

## Orden de implementación

| # | Fix | Impacto | Riesgo | Archivos |
|---|-----|---------|--------|----------|
| 1 | Fix 3: Auto-play episodio | Alto | Bajo | WatchPage.tsx |
| 2 | Fix 1: Idioma und/multi | Alto | Bajo | candidates.js |
| 3 | Fix 4: Orden unificado | Alto | Medio | candidates.js |
| 4 | Fix 2: Velocidad | Alto | Medio | playback.js, WatchPage.tsx |

---

## Estado: IMPLEMENTADO

Todos los fixes fueron implementados y verificados (tsc + node require OK).

---

## Verificación

1. **Idioma:** Buscar una película en idioma no-español (ej: japonés). Con preferencia "original", debe elegir la versión original o inglés, NO doblaje español
2. **Velocidad:** Medir tiempo desde click "Reproducir" hasta video visible. Objetivo: < 12s para directos, < 20s para torrents
3. **Episodios:** En una serie, reproducir E01, luego click en E02 → debe auto-reproducir sin necesidad de presionar Play de nuevo
4. **Prioridades:** Un torrent 1080p con 80 seeders en idioma correcto debe ganarle a un directo 720p con idioma incorrecto
