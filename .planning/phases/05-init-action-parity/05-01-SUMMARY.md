---
phase: 05-init-action-parity
plan: 01
subsystem: api
tags: [init-runtime, task-store, task-start]
requires: []
provides:
  - Durable `task.initRuntime` schema, persistence, migration, and relink-safe normalization
  - Shared session-start seam separating session spawn, init runtime updates, and later kickoff continuation
  - Typed task/start-session payload exposure for init runtime consumers
affects: [init-runtime, start-session, auto-run]
tech-stack:
  added: []
  patterns: [durable init runtime, session-start seam, relink-safe runtime persistence]
key-files:
  created:
    - hub/src/web/routes/tasks.start-session.test.ts
  modified:
    - shared/src/schemas.ts
    - shared/src/types.ts
    - hub/src/store/index.ts
    - hub/src/store/types.ts
    - hub/src/store/tasks.ts
    - hub/src/store/taskStore.ts
    - hub/src/store/tasks.test.ts
    - hub/src/store/schemaMigration.test.ts
    - hub/src/sync/sessionTaskLink.ts
    - hub/src/sync/taskSessionService.ts
    - hub/src/sync/autoRunScheduler.ts
    - hub/src/web/routes/tasks.ts
    - web/src/types/api.ts
key-decisions:
  - "Keep init runtime init-specific for this milestone instead of forcing the deferred generic action manifest."
  - "Treat session spawn success and init success as separate outcomes so repair work can stay inside the started session."
  - "Make manual start-session and auto-run converge on one task-session orchestration seam before layering retry logic."
patterns-established:
  - "Task persistence now round-trips durable init runtime state with the same timestamp/retry/note vocabulary used by other action runtimes."
  - "Session relink flows update `initRuntime.sessionId` the same way merge/preview runtimes already normalize linked sessions."
requirements-completed: [INIT-01, INIT-03]
duration: multi-session
completed: 2026-03-08
---

# Phase 5 Plan 01 Summary

**Durable init runtime persisted on tasks, threaded through session start seams, and exposed as typed API state**

## Performance

- **Duration:** multi-session
- **Started:** carried from earlier Phase 5 execution work
- **Completed:** 2026-03-08
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments
- Added `task.initRuntime` to shared schemas and task persistence with retry count, failure fingerprint, blocker summary, timestamps, and init-specific statuses.
- Bumped hub schema to persist `init_runtime`, added migration coverage, and normalized runtime session ids during relink.
- Split task session start into clearer stages so later plans could keep the spawned session alive while init repairs or blocks.
- Exposed typed init runtime through task payloads and start-session responses for later web parity work.

## Task Commits

1. **Implementation + validation completed in workspace state** - no git commit created in this turn

## Files Created/Modified
- `shared/src/schemas.ts` - defines durable `TaskInitRuntime` and status vocabulary.
- `shared/src/types.ts` - re-exports init runtime types for hub/web consumers.
- `hub/src/store/index.ts` - adds schema v11 and `init_runtime` migration path.
- `hub/src/store/tasks.ts` - persists, parses, and normalizes durable init runtime state.
- `hub/src/store/taskStore.ts` - threads init runtime through task updates.
- `hub/src/store/tasks.test.ts` - covers init runtime round-trip and relink handling.
- `hub/src/store/schemaMigration.test.ts` - locks v10→v11 init runtime migration.
- `hub/src/sync/sessionTaskLink.ts` - keeps init runtime session ids aligned after relink.
- `hub/src/sync/taskSessionService.ts` - introduces the explicit session-start/init/kickoff seam.
- `hub/src/sync/autoRunScheduler.ts` - starts using the shared init seam instead of route-local bootstrap assumptions.
- `hub/src/web/routes/tasks.ts` - returns task/session start results from the shared service.
- `hub/src/web/routes/tasks.start-session.test.ts` - route-level coverage for task session start behavior.
- `web/src/types/api.ts` - types start-session payloads with durable init runtime support.

## Decisions Made
- Deferred the generic action registry; init now borrows the proven merge/preview runtime shape without adding another framework layer.
- Chose task-backed runtime state as the source of truth so refresh/reconnect and linked-session repair could share one contract.
- Kept the start-session route thin and moved durable init logic into `taskSessionService` for reuse by auto-run.

## Deviations from Plan

- Added `hub/src/store/taskStore.ts` and `hub/src/sync/sessionTaskLink.ts` updates beyond the initial artifact list because durable runtime persistence was not safe without relink-aware normalization end to end.

## Issues Encountered

- Existing task persistence only normalized merge/preview runtime session ids; init needed the same treatment before relinked sessions would stay coherent.
- The original start-session response shape mixed route concerns with service concerns, so the service contract had to become task/session-centric before later retry work could stay clean.

## User Setup Required

None - no external configuration required.

## Next Phase Readiness

Plan 01 leaves one stable durable init runtime contract in place. Plan 02 can now focus on transcript-visible direct-run, retry, and blocker behavior without reopening storage or API shape questions.

## Self-Check

- `bun run typecheck:hub` ✓
- `bun run typecheck:web` ✓
- `bun run test:hub` ✓
- Manual start-session / auto-run product-feel check deferred to final Phase 5 companion smoke pass

---
*Phase: 05-init-action-parity*
*Completed: 2026-03-08*
