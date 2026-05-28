---
phase: 06-shared-action-runtime-consolidation
plan: 01
subsystem: shared-hub-runtime
tags: [runtime-envelope, persistence, relink]
requires: []
provides:
  - Shared runtime envelope for Merge, Preview, and Init
  - Shared hub normalization + relink helpers for built-in action runtimes
  - Typed API/runtime alignment across shared, hub, and web
affects: [shared-contracts, hub-store, session-relink, route-runtime-builders]
tech-stack:
  added: []
  patterns: [shared runtime envelope, hub runtime helper, relink-safe runtime session sync]
key-files:
  created:
    - hub/src/utils/taskActionRuntime.ts
  modified:
    - shared/src/schemas.ts
    - shared/src/types.ts
    - hub/src/store/tasks.ts
    - hub/src/sync/sessionTaskLink.ts
    - hub/src/web/routes/tasks.ts
    - hub/src/sync/taskSessionService.ts
    - web/src/types/api.ts
key-decisions:
  - "Keep user-facing action labels specific while collapsing the durable runtime envelope internally."
  - "Use one shared hub helper layer for parse/normalize/build/session-sync rather than preserving three parallel runtime helper stacks."
  - "Preserve Preview-specific terminal states and action-specific success words on top of the shared envelope."
patterns-established:
  - "Store persistence, route/service runtime builders, and session relink now consume one shared runtime helper path."
  - "Shared runtime types export a base envelope plus action-specific status unions instead of three hand-maintained field copies."
requirements-completed: [ACTION-04]
duration: single-session
completed: 2026-03-09
---

# Phase 6 Plan 01 Summary

**Merge, Preview, and Init now share one durable runtime envelope across shared, hub, and web layers**

## Accomplishments
- Added `TaskActionRuntimeEnvelope` and shared runtime-schema factory in `shared/src/schemas.ts` so common session/timestamp/retry/blocker fields have one source of truth.
- Created `hub/src/utils/taskActionRuntime.ts` to centralize runtime parsing, normalization, build rules, meaningful-change checks, and session relink updates.
- Refactored task store persistence and session relink code to reuse shared runtime helpers instead of per-action normalization copies.
- Moved Merge/Preview/Init runtime builder logic in routes/services onto the shared helper layer without flattening action-specific terminal states.
- Kept web API typing aligned by re-exporting the shared runtime envelope/core status types through `web/src/types/api.ts`.

## Verification
- `bun run test:hub -- taskSessionService.test.ts tasks.merge-script.test.ts tasks.preview.test.ts tasks.start-session.test.ts` ✓
- `bun run typecheck:hub` ✓
- `bun run typecheck:web` ✓

## Notes
- No user-visible generic action model introduced.
- Existing action-specific labels and terminal semantics remain intact on top of the shared internal contract.
