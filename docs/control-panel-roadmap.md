# Control Panel Roadmap (Observability, Cache, Provider Health)

## Goal
Build a basic but solid control panel to understand and tune playback decisions end-to-end:
- Where backend searched (addon vs prowlarr)
- Which providers are available or failing
- Which providers are excluded by previous failures (circuit breaker)
- Why each stream candidate was accepted or rejected
- How cache is affecting startup speed and stability

## What we already have
Current APIs already expose useful signals:
- `GET /api/sources`: configured providers (catalog/stream/subtitle)
- `GET /api/streams`: aggregated stream providers + per-provider result
- `GET /api/streams/reliability`: reliability summary and penalties
- `POST /api/streams/reliability/reset`: reset provider/source reliability state
- `GET /api/playback/attempts`: playback attempt log (events by provider/session)
- `POST /api/playback/auto`: final selection response (`mode`, `streamKind`, `selectedQuality`, `availableQualities`)

## Main gaps
1. No single trace id for a full autoplay decision.
2. No unified event schema for provider query -> candidate validation -> final selection.
3. Cache behavior is implicit (hard to inspect hit/miss and TTL impact).
4. No provider operations view (up/down, excluded, breaker until, last success).
5. No admin endpoints focused on panel UX.

## Roadmap

### Phase 1 - Structured Observability (high priority)
Implement structured JSON events with correlation ids.

Required fields for every event:
- `timestamp`
- `requestId` (one id per `POST /api/playback/auto`)
- `sessionId` (if any)
- `event`
- `providerId`
- `sourceKind` (`addon` | `prowlarr`)
- `item` (`type`, `itemId`, `season`, `episode`)
- `durationMs`
- `status`
- `reason` (when failed/rejected)

Suggested events:
- `streams.resolve.start`
- `provider.query.start`
- `provider.query.ok`
- `provider.query.error`
- `provider.query.skipped.circuit_open`
- `candidate.rank.generated`
- `candidate.validate.direct.ok`
- `candidate.validate.direct.fail`
- `candidate.validate.session.ok`
- `candidate.validate.session.fail`
- `playback.selected`
- `playback.no_candidate`

Storage:
- append-only NDJSON file: `logs/playback-events.ndjson`
- keep in-memory ring buffer for fast panel queries

### Phase 2 - Caching strategy (high priority)
Add explicit caches with counters and TTLs.

1. Aggregated streams cache
- Key: `type|itemId|season|episode|activeProvidersHash`
- Value: payload from `fetchAggregatedStreams`
- TTL: 20-60s (short, burst-friendly)
- Benefit: avoid repeated addon/prowlarr calls during retries and quality switches

2. Direct probe cache
- Key: direct URL
- Value: `{ ok, reason, contentType, checkedAt }`
- TTL: 3-5 min
- Benefit: avoid repeated URL probe calls for same direct candidate

3. Session readiness cache (optional)
- Key: `sourceKey|fileIdx`
- Value: recent ready session metadata
- TTL: 1-3 min
- Benefit: faster replay when user retries same title/quality quickly

4. Provider manifest/status cache
- Cache provider health snapshot used by control panel

Expose cache stats endpoint:
- `GET /api/admin/cache/stats`
  - per-cache: size, hits, misses, ttl, evictions

### Phase 3 - Provider health + exclusion controls
Create provider operations model.

Provider status model (panel row):
- `providerId`
- `providerName`
- `sourceKind` (`addon` | `prowlarr`)
- `configured` (from sources)
- `active` (manual toggle)
- `circuitOpen` (from reliability)
- `breakerUntil`
- `lastSuccessAt`
- `lastErrorAt`
- `errorRate1h`
- `avgLatencyMs1h`
- `excludedReason` (`manual_disabled`, `circuit_open`, `timeout_rate`, etc.)

Suggested admin endpoints:
- `GET /api/admin/providers/status`
- `POST /api/admin/providers/:id/enable`
- `POST /api/admin/providers/:id/disable`
- `POST /api/admin/providers/:id/unexclude`
- `GET /api/admin/providers/:id/events?limit=...`

Persistence:
- `config/provider-overrides.json` for manual enable/disable/exclude

### Phase 4 - Playback decision inspector (panel)
Build UI pages:

1. Provider Dashboard
- up/down status, breaker state, latency, success rate
- manual enable/disable actions

2. Request Trace Explorer
- list autoplay requests by `requestId`
- timeline per request: provider query -> candidate validation -> final selection

3. Candidate Decision Table
- candidate list with score and rejection reason
- columns: provider, resolution, webFriendly, seeders, size, streamKind result, reason

4. Cache Monitor
- hit/miss graphs, TTL health, eviction trends

### Phase 5 - Auto tuning and test loop
Add regression checks and tuning loop.

Smoke suite (scriptable):
- run N known titles (mix of direct, session/direct, session/hls)
- capture startup time, success/failure, selected quality, selected streamKind
- compare against baseline before deploy

Target KPIs:
- startup success rate
- median time-to-first-frame
- % `streamKind=direct` for auto mode
- % fallback to HLS
- provider timeout rate

## Minimal implementation plan (next iterations)
1. Add `requestId` and structured events in playback + streams service.
2. Add stream aggregation cache + direct probe cache.
3. Add `GET /api/admin/providers/status` + `GET /api/admin/cache/stats`.
4. Build first panel screen (Provider Dashboard).
5. Add Trace Explorer using requestId.

## Notes for current behavior
- `GET http://localhost:5173/api/playback/auto` returns app HTML in dev proxy context.
- Use `POST /api/playback/auto` with JSON payload for real playback decisions.
- In auto mode, backend should prioritize faster stable native/direct playback over slower high-resolution HLS where possible.
