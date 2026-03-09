---
phase: 03-verified-completion-recovery-control
plan: 02
subsystem: hub-web-shared
tags: [merge-loop-control, retry-fingerprint, blocker-detection]
requires:
  - 03-01
provides:
  - Failure fingerprints persisted in task merge runtime state
  - Repeated-blocker detection across direct-run and agent-repair merge attempts
  - Retry-aware runtime states and counts for task/web surfaces
affects: [task-merge-route, merge-runtime-state, web-merge-cache]
tech-stack:
  added: []
  patterns: [fingerprint-before-repeat, bounded retry state, same-blocker stop]
key-files:
  created: []
  modified:
    - shared/src/schemas.ts
    - hub/src/store/tasks.ts
    - hub/src/web/routes/tasks.ts
    - hub/src/web/routes/tasks.merge-script.test.ts
    - web/src/hooks/mutations/useMergeTaskWorktree.ts
    - web/src/types/api.ts
key-decisions:
  - "Persist a compact failure fingerprint on merge runtime state instead of trying to parse full transcript history later."
  - "Treat repeated identical blockers as explicit stop conditions with manual next-step text, not as another opaque retry."
patterns-established:
  - "Retry attempts now carry first-class runtime state (`retrying`, retry counts, fingerprint) across hub and web caches."
  - "Direct script failure and post-agent verification failure both feed the same blocker-fingerprint contract."
requirements-completed: [REPAIR-04]
completed: 2026-03-08
---

# Phase 3 Plan 02 Summary

**Retry fingerprinting and loop-stop control**

## Accomplishments
- Added `failureFingerprint` to task merge runtime state and normalized it through store persistence.
- Fingerprinted direct merge-script failures, verification failures, merge-state failures, and unresolved post-agent merge blockers.
- Reused the stored fingerprint when a retry starts so the runtime can detect same-blocker repeats without replaying transcript history.
- Incremented retry counts on blocked/canceled retry attempts and surfaced `retrying` runtime state through the existing task/web flow.
- Added a regression that proves a blocked merge retry carries `retryCount: 2` and stops on the same verified blocker.

## Validation
- `bun run typecheck:hub` ✓
- `bun run typecheck:web` ✓
- `bun run typecheck:cli` ✓
- `bun run test:hub` ✓
- `bun run test:web` ✓

## Next Phase Readiness
- Plan 03 can focus on final blocker-summary polish and documentation/state completion without reopening the retry contract.

---
*Phase: 03-verified-completion-recovery-control*
*Completed: 2026-03-08*
