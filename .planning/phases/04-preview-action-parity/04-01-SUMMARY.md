---
phase: 04-preview-action-parity
plan: 01
subsystem: shared-hub-web
tags: [preview-runtime, store-contract, api-surface]
requires: []
provides:
  - Durable task-backed previewRuntime contract across shared, store, route, and API seams
  - SQLite `preview_runtime` migration plus round-trip coverage for persisted task state
  - Preview route contract coverage for ready, blocked, and stopped runtime outcomes
affects: [preview-runtime, task-store, preview-route]
tech-stack:
  added: []
  patterns: [durable task-backed runtime, relink-safe session sync, route-contract-first preview state]
key-files:
  created:
    - .planning/phases/04-preview-action-parity/04-01-SUMMARY.md
  modified:
    - shared/src/schemas.ts
    - shared/src/types.ts
    - hub/src/store/index.ts
    - hub/src/store/types.ts
    - hub/src/store/taskStore.ts
    - hub/src/store/tasks.ts
    - hub/src/store/tasks.test.ts
    - hub/src/store/schemaMigration.test.ts
    - hub/src/sync/sessionTaskLink.ts
    - hub/src/sync/sessionTaskLink.test.ts
    - hub/src/web/routes/tasks.ts
    - hub/src/web/routes/tasks.preview.test.ts
    - web/src/api/client.ts
    - web/src/types/api.ts
key-decisions:
  - "Land a compact previewRuntime contract now and keep it close to mergeRuntime instead of jumping early to a generic action framework."
  - "Treat live preview process state as telemetry; persisted previewRuntime is the durable source of truth for task and route consumers."
patterns-established:
  - "Preview start, get, and stop routes now persist and return the same previewRuntime shape the task record stores."
  - "Session relink and drift repair now keep previewRuntime.sessionId aligned with the active task session."
requirements-completed: [PREVIEW-01, PREVIEW-03]
completed: 2026-03-08
---

# Phase 4 Plan 01 Summary

**Durable previewRuntime contract across shared, store, route, and API seams**

## Accomplishments
- Added a task-backed `previewRuntime` schema and type contract so Preview state survives refresh, reconnect, relink, and later retry work.
- Added the SQLite `preview_runtime` migration plus store plumbing for durable round-trips in persisted task state.
- Kept relink and session-drift sync updating `previewRuntime.sessionId` so active session changes do not orphan Preview state.
- Updated preview start, get, and stop routes to persist and return `previewRuntime` alongside live preview process data.
- Added focused regressions for store round-trips, migration safety, session-link sync, and ready/blocked/stopped preview route responses.

## Files Created/Modified
- `shared/src/schemas.ts` - adds the shared durable `previewRuntime` schema contract.
- `shared/src/types.ts` - exposes the typed preview runtime surface to consumers.
- `hub/src/store/index.ts` - wires the preview runtime migration into store setup.
- `hub/src/store/types.ts` - updates store-layer task shapes for persisted preview state.
- `hub/src/store/taskStore.ts` - threads preview runtime through task store read/write helpers.
- `hub/src/store/tasks.ts` - persists preview runtime on task records.
- `hub/src/store/tasks.test.ts` - covers preview runtime store round-trips.
- `hub/src/store/schemaMigration.test.ts` - covers safe migration to the new `preview_runtime` column.
- `hub/src/sync/sessionTaskLink.ts` - keeps `previewRuntime.sessionId` aligned during relink or drift repair.
- `hub/src/sync/sessionTaskLink.test.ts` - verifies relink/session sync behavior for preview runtime.
- `hub/src/web/routes/tasks.ts` - persists and returns preview runtime from preview start/get/stop routes.
- `hub/src/web/routes/tasks.preview.test.ts` - locks the ready/blocked/stopped preview route contract.
- `web/src/api/client.ts` - carries the durable preview runtime response shape through the client.
- `web/src/types/api.ts` - exposes the preview runtime API contract to web callers.

## Decisions Made
- Keep the Preview runtime vocabulary close to Merge runtime so later parity work can reuse concepts without introducing Phase 6 early.
- Use task-backed preview runtime as the durable contract and keep live preview process data as supplemental telemetry.

## Validation
- `bun test hub/src/store/tasks.test.ts hub/src/store/schemaMigration.test.ts hub/src/sync/sessionTaskLink.test.ts hub/src/web/routes/tasks.preview.test.ts` ✓
- `bun run typecheck:hub` ✓
- `bun run typecheck:web` ✓
- `bun run test:hub` ✓

## Next Phase Readiness
- Plan 04-02 can now add retry fingerprinting, blocker summaries, and late-crash loop control on top of one durable preview runtime contract.

---
*Phase: 04-preview-action-parity*
*Completed: 2026-03-08*
