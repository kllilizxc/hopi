---
phase: 05-init-action-parity
plan: 02
subsystem: hub
tags: [init-retry, transcript-runtime, auto-run]
requires:
  - 05-01
provides:
  - Direct init script attempt with transcript-visible CLI-style result messages
  - Same-session repair prompt, bounded retry, and repeated-blocker stop behavior
  - Manual start-session and auto-run parity on blocked init handling
affects: [init-runtime, auto-run, task-transcript]
tech-stack:
  added: []
  patterns: [direct-run-first action attempt, same-session repair loop, durable blocker fingerprinting]
key-files:
  created: []
  modified:
    - hub/src/sync/taskSessionService.ts
    - hub/src/sync/autoRunScheduler.ts
    - hub/src/web/routes/tasks.ts
    - hub/src/sync/projectScripts.ts
    - hub/src/sync/taskSessionService.test.ts
    - hub/src/web/routes/tasks.start-session.test.ts
    - hub/src/sync/autoRunScheduler.test.ts
    - web/src/types/api.ts
key-decisions:
  - "Run the repo-owned init script directly first and only ask the agent to repair after the CLI result is already visible in-thread."
  - "Return blocked init as a successful session start so the linked session stays alive for repair and follow-up work."
  - "Use the same blocker fingerprint reason across direct failure and retry failure so repeated blockers stop cleanly."
patterns-established:
  - "Init now matches Merge/Preview discipline: direct tool call first, transcript message next, repair prompt only after failure."
  - "Blocked init preserves retry count, fingerprint, manual next step, and linked session continuity inside task-backed runtime state."
requirements-completed: [INIT-01, INIT-02, INIT-03]
duration: multi-session
completed: 2026-03-08
---

# Phase 5 Plan 02 Summary

**Transcript-visible init execution, same-session repair/retry, and blocker parity across manual start-session and auto-run**

## Performance

- **Duration:** multi-session
- **Started:** carried from earlier Phase 5 execution work
- **Completed:** 2026-03-08
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments
- First init attempt now runs the repo script directly and appends CLI-style success/failure output into the session transcript before any repair prompt begins.
- Failed init keeps the spawned session linked, sends one in-session repair prompt, waits for the session to become runnable again, and retries once inside the same session.
- Repeated blockers now persist retry count, fingerprint, blocker summary, and exact manual next step in durable `task.initRuntime`.
- Auto-run scheduler now follows the same blocker contract as manual start-session instead of quietly counting blocked init as started task work.

## Task Commits

1. **Implementation + validation completed in workspace state** - no git commit created in this turn

## Files Created/Modified
- `hub/src/sync/taskSessionService.ts` - owns transcript result messages, repair prompt flow, bounded retry, blocker persistence, and kickoff gating.
- `hub/src/sync/autoRunScheduler.ts` - stops treating blocked init as started work and shares the same service/runtime contract.
- `hub/src/web/routes/tasks.ts` - returns blocked init as durable task state on a successful session start response.
- `hub/src/sync/projectScripts.ts` - remains the repo-script resolution seam used by the direct init attempt.
- `hub/src/sync/taskSessionService.test.ts` - covers retry-then-block and retry-success ordering.
- `hub/src/web/routes/tasks.start-session.test.ts` - covers route behavior when init fails but the linked session stays alive.
- `hub/src/sync/autoRunScheduler.test.ts` - locks workflow parity for GSD auto-run entry.
- `web/src/types/api.ts` - exposes recovery attempt metadata for web consumers.

## Decisions Made
- Kept the session alive on blocked init and treated that as a successful start-session request because the user now has a real repair context instead of a dead bootstrap failure.
- Reused the same `script_failure` fingerprint reason across direct and retry failures so repeated blockers generate the stronger “same blocker repeated” note.
- Preserved kickoff gating inside the service so no route or scheduler can accidentally continue task work before init succeeds.

## Deviations from Plan

- Route-level `initFailureMode` handling was removed instead of extended; once the shared service handled blocked init correctly, the extra route scheduler branching only duplicated state.
- Added extra hub assertions around message ordering because transcript order is part of the product contract, not just an implementation detail.

## Issues Encountered

- The original route-local recovery code could not preserve session continuity cleanly, so retry/blocker logic had to move deeper into `taskSessionService`.
- Blocked init needed to return `ok: true` from the shared start service; otherwise the route would signal failure even though the correct linked session existed and needed user attention.

## User Setup Required

None - no external configuration required.

## Next Phase Readiness

Plan 02 completes the backend/runtime parity story. Plan 03 can now surface durable init summaries in task and chat UI without inventing any extra init state machine.

## Self-Check

- `bun test hub/src/sync/taskSessionService.test.ts hub/src/web/routes/tasks.start-session.test.ts hub/src/sync/autoRunScheduler.test.ts` ✓
- `bun run typecheck:hub` ✓
- `bun run typecheck:web` ✓
- Transcript ordering + repeated-blocker semantics covered in hub tests ✓

---
*Phase: 05-init-action-parity*
*Completed: 2026-03-08*
