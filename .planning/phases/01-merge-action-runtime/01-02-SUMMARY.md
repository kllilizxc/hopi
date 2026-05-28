---
phase: 01-merge-action-runtime
plan: 02
subsystem: runtime
tags: [merge-route, session-handoff, conversation-runtime]
requires:
  - 01-01
provides:
  - Merge kickoff routed into the linked task conversation instead of direct backend merge execution
  - Auto-start, relink, resume, queued, approval-pending, and cancel semantics on durable task merge runtime
  - Regression coverage for merge kickoff, handoff notes, correlated ready monitoring, and cancel flow
affects: [merge-action-runtime, task-session-flow, web-task-actions]
tech-stack:
  added: []
  patterns: [conversation-native action kickoff, prompt-localId ready correlation, task-backed cancel contract]
key-files:
  created: []
  modified:
    - hub/src/web/routes/tasks.ts
    - hub/src/sync/taskSessionService.ts
    - hub/src/web/routes/tasks.workflow.test.ts
    - hub/src/web/routes/tasks.merge-error.test.ts
    - hub/src/web/routes/tasks.merge-script.test.ts
    - hub/src/sync/taskSessionService.test.ts
key-decisions:
  - "Send Merge as a normal session message and monitor the correlated ready event instead of executing merge RPCs directly from the route."
  - "Allow Merge to auto-start a fresh worktree session with kickoff suppressed so the first visible prompt is the merge request itself."
  - "Persist queued, approval-pending, running, blocked, succeeded, and canceled merge runtime states on the task record and expose cancel as a real backend route."
patterns-established:
  - "Merge click now uses normal session messaging with a short handoff note only when HOPI had to auto-start, resume, or relink first."
  - "Prompt localIds become the durable correlation handle for monitoring merge completion after the agent finishes its turn."
requirements-completed: [MERGE-01, MERGE-03, ACTION-03]
duration: 39min
completed: 2026-03-07
---

# Phase 1 Plan 02 Summary

**Conversation-native merge kickoff with durable queue, handoff, and cancel semantics on the task runtime**

## Performance

- **Duration:** 39 min
- **Started:** 2026-03-07T17:08:00+08:00
- **Completed:** 2026-03-07T17:46:41+08:00
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Replaced the detached merge entry path with a prompt-driven conversation kickoff that uses the best usable linked session.
- Added auto-start and kickoff suppression so a fresh merge session starts cleanly and the first visible message is the merge request.
- Added durable queued, approval-pending, running, blocked, succeeded, and canceled task merge runtime transitions with a cancel endpoint.
- Added regression coverage for auto-start, stale-session resume, backlink relink, queued/approval flow, ready-event success, and blocked completion.

## Task Commits

1. **Task 1–3 implementation: route merge through the task conversation runtime** - `4741684` (`feat`)
2. **Task 1–3 regression coverage: handoff, queue, monitor, and cancel paths** - `4af9c11` (`test`)

## Files Created/Modified
- `hub/src/web/routes/tasks.ts` - Replaces direct merge execution with conversation kickoff, ready monitoring, durable runtime transitions, and cancel route.
- `hub/src/sync/taskSessionService.ts` - Adds kickoff control so merge auto-start can skip or customize the first prompt cleanly.
- `hub/src/sync/taskSessionService.test.ts` - Covers custom and skipped kickoff behavior.
- `hub/src/web/routes/tasks.workflow.test.ts` - Covers merge auto-start into the conversation flow.
- `hub/src/web/routes/tasks.merge-error.test.ts` - Covers stale-session resume, backlink relink, queued state, approval-pending state, and cancel behavior.
- `hub/src/web/routes/tasks.merge-script.test.ts` - Covers correlated ready-event success and blocked outcomes for merge prompts.

## Decisions Made
- Kept merge execution inside ordinary conversation messaging and let the agent choose `.hopi/merge.sh` or normal CLI/git tools inside the sandbox.
- Used prompt localIds plus assistant ready events as the lightweight runtime monitor instead of inventing a parallel merge worker subsystem.
- Kept merge-state gating conservative by treating any active durable merge runtime as busy until the monitor resolves it.

## Deviations from Plan

- Combined the three plan tasks into one implementation commit and one regression commit because the new route/runtime contract spans the same brownfield surfaces.

## Issues Encountered

- The old route tests were tightly coupled to detached merge RPC behavior, so they were rewritten around the new conversation-runtime contract.
- `startSessionFromTask()` needed explicit kickoff control so Merge auto-start would not leak the generic task kickoff into the conversation before the merge request.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Wave 3 can now read durable task merge runtime instead of ephemeral chat-only merge state and surface it cleanly in the web/task UI.
The merge action already starts inside the task conversation and now exposes a backend cancel contract for the UI layer to call.

## Self-Check

- `bun run typecheck:hub` ✓
- `bun run test:hub` ✓
- Merge click now enters the linked conversation, survives stale-session handoff cases, and exposes queued/approval/cancel runtime coverage ✓

---
*Phase: 01-merge-action-runtime*
*Completed: 2026-03-07*
