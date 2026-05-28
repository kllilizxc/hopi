---
phase: 01-merge-action-runtime
plan: 01
subsystem: runtime
tags: [sqlite, session-link, merge-runtime]
requires: []
provides:
  - Durable merge runtime task state in shared + hub storage
  - Deterministic task-to-session relink helpers with best-usable-session resolution
  - Regression coverage for merge runtime persistence and relink invariants
affects: [merge-action-runtime, task-session-flow, merge-ui]
tech-stack:
  added: []
  patterns: [task-backed merge runtime, backlink session recovery, preserve merge markers on relink]
key-files:
  created: [hub/src/sync/sessionTaskLink.test.ts]
  modified:
    - shared/src/schemas.ts
    - hub/src/store/tasks.ts
    - hub/src/sync/sessionTaskLink.ts
    - hub/src/sync/sessionCache.ts
key-decisions:
  - "Store merge runtime on the task record so status survives reconnects and relinks."
  - "Treat session metadata backlinks as a second source of truth when task.activeSessionId drifts."
  - "Preserve completed merge markers when relinking stale sessions after resume."
patterns-established:
  - "Task/session relinks update both task.activeSessionId and session metadata together."
  - "Merge runtime follows the active session id instead of being cleared on relink."
requirements-completed: [ACTION-01, ACTION-02, ACTION-03]
duration: 42min
completed: 2026-03-07
---

# Phase 1 Plan 01 Summary

**Durable task-backed merge runtime with deterministic session relink resolution and regression coverage across store/cache flows**

## Performance

- **Duration:** 42 min
- **Started:** 2026-03-07T16:10:00+08:00
- **Completed:** 2026-03-07T17:08:00+08:00
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- Added durable merge runtime fields to shared schemas and SQLite task persistence.
- Centralized task/session relink behavior so task state, session metadata, and merge runtime stay coherent.
- Added focused regression coverage for store migration, relink preservation, and best-usable-session recovery.

## Task Commits

1. **Task 1: Add durable merge runtime state to task persistence** - `86a3ebb` (`feat`)
2. **Task 2: Centralize best-usable-session resolution and relink behavior** - `405d78a` (`feat`)
3. **Task 3: Lock regression coverage around durable runtime and linkage** - `81b22f0` (`test`)

## Files Created/Modified
- `shared/src/schemas.ts` - Adds task merge runtime schema, status vocabulary, and task field exposure.
- `hub/src/store/tasks.ts` - Persists merge runtime JSON, normalizes runtime fields, and preserves merge markers on relink.
- `hub/src/store/taskStore.ts` - Exposes merge runtime create/update typing in the hub store wrapper.
- `hub/src/sync/sessionTaskLink.ts` - Adds relink helpers and best-usable-session resolution for task-linked sessions.
- `hub/src/sync/sessionCache.ts` - Preserves task backlink metadata when sessions merge.
- `hub/src/store/tasks.test.ts` - Covers runtime normalization and session-id sync on relink.
- `hub/src/store/schemaMigration.test.ts` - Covers merge runtime migration safety.
- `hub/src/sync/sessionCache.test.ts` - Covers relink preservation across session merges.
- `hub/src/sync/sessionTaskLink.test.ts` - Covers relink helper + metadata-backlink recovery.

## Decisions Made
- Kept merge runtime on `tasks.merge_runtime` rather than introducing a separate runtime table in Phase 1.
- Allowed backlink session metadata to recover task/session drift before Wave 2 rewires the merge entry flow.
- Preserved prior merge result markers on stale-session resume/relink so already-merged tasks do not regress to null state.

## Deviations from Plan

- Added `hub/src/sync/sessionTaskLink.test.ts` instead of only extending route tests because the new relink helper needed a narrow deterministic unit surface.

## Issues Encountered

- Existing merge route code already expected relink/session-resolution helpers that were not yet present in `hub/src/sync/sessionTaskLink.ts`; implemented the helper surface first so later wave work can build on a compiling runtime contract.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Wave 2 can now route Merge through one best-usable-session resolver and keep merge state stable across stale-session resume or backlink relink.
Route-level work is still pending in `hub/src/web/routes/tasks.ts` and associated route tests.

## Self-Check

- `bun run typecheck:hub` ✓
- `bun run test:hub` ✓
- Merge runtime persists, relinks, and survives session merges in automated coverage ✓

---
*Phase: 01-merge-action-runtime*
*Completed: 2026-03-07*
