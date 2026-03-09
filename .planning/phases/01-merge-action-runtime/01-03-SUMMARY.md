---
phase: 01-merge-action-runtime
plan: 03
subsystem: web
tags: [web-ui, durable-runtime, task-chat]
requires:
  - 01-01
  - 01-02
provides:
  - Durable merge runtime status rendered from task-backed state in the task chat surface
  - Merge cancel and retry affordances wired to the Phase 1 runtime contract
  - Regression coverage for kickoff-state cache behavior and cancel cache updates
affects: [merge-ui, task-chat, task-sse]
tech-stack:
  added: []
  patterns: [task-backed action summary, optimistic runtime cache patch, task-plus-session rehydrate]
key-files:
  created:
    - web/src/hooks/mutations/useMergeTaskWorktree.test.tsx
  modified:
    - web/src/components/SessionChat.tsx
    - web/src/components/AssistantChat/HappyThread.tsx
    - web/src/hooks/mutations/useMergeTaskWorktree.ts
    - web/src/api/client.ts
    - web/src/types/api.ts
key-decisions:
  - "Treat task.mergeRuntime as the compact UI source of truth and keep detailed execution output in the transcript."
  - "Reuse the same merge action button as the cancel-or-retry affordance instead of adding a separate action panel."
  - "Fix optimistic cache updates so kickoff statuses never mark the task finished before merge actually completes."
patterns-established:
  - "Task chat now rehydrates merge state from durable task data on first render and refetches merge eligibility when session busy flags change."
  - "Merge start and cancel mutations patch task caches with runtime status, then rely on task invalidation plus SSE for authoritative replay."
requirements-completed: [MERGE-03, ACTION-02]
duration: 24min
completed: 2026-03-07
---

# Phase 1 Plan 03 Summary

**Durable merge runtime status, replay, and cancel-or-retry controls on the task chat surface**

## Performance

- **Duration:** 24 min
- **Started:** 2026-03-07T17:46:00+08:00
- **Completed:** 2026-03-07T18:10:16+08:00
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Replaced local-only merge event pills with compact durable runtime status rendered from `task.mergeRuntime`.
- Wired Merge to switch between start, cancel, and retry behavior based on durable runtime state while keeping detailed output inside normal conversation messages.
- Added client typing plus cache-update logic for merge cancel and kickoff statuses so task/task-list state stays coherent across refresh and reconnect.
- Added focused web regression coverage to lock the kickoff-state cache behavior and cancel cache path.

## Task Commits

1. **Implementation + validation completed in workspace state** - no git commit created in this turn

## Files Created/Modified
- `web/src/components/SessionChat.tsx` - derives merge status from durable task runtime, adds cancel-or-retry behavior, refetches merge eligibility on session-state changes, and subscribes to task updates in chat.
- `web/src/components/AssistantChat/HappyThread.tsx` - renders compact durable merge status instead of ephemeral merge event rows.
- `web/src/hooks/mutations/useMergeTaskWorktree.ts` - adds cancel mutation support, fixes kickoff cache semantics, and stops optimistic false-finished transitions for queued/running responses.
- `web/src/hooks/mutations/useMergeTaskWorktree.test.tsx` - covers kickoff runtime caching and cancel cache updates.
- `web/src/api/client.ts` - adds the merge cancel client method.
- `web/src/types/api.ts` - tightens merge kickoff response typing and adds merge cancel response typing.

## Decisions Made
- Kept the detailed merge narrative in the conversation thread and reserved the web chrome for a short durable status summary.
- Treated queued, waiting, approval-pending, running, and retrying as active runtime states rather than terminal skip cases.
- Let task-backed runtime status drive refresh/reconnect rehydration instead of preserving local merge event arrays.

## Deviations from Plan

- Added a targeted mutation test file because the old optimistic cache logic could incorrectly mark kickoff-only responses as finished.

## Issues Encountered

- The existing web merge mutation still assumed the backend response meant final merge completion; fixing that optimistic path was required before the durable UI could be trustworthy.
- Chat-level merge availability can go stale when session thinking or approval state changes, so Plan 03 adds explicit merge-state refetch on those session transitions.

## User Setup Required

None - no external configuration required.

## Next Phase Readiness

Phase 1 is complete. Phase 2 can now focus on the in-session self-healing merge loop without first inventing more UI-only runtime state.
The compact web status already survives refresh through durable task data; a live browser smoke check is still recommended before relying on it during heavier merge recovery work.

## Self-Check

- `bun run typecheck:web` ✓
- `bun run test:web` ✓
- Browser-level refresh/reconnect smoke test not run in CLI; durable rehydrate path now comes from task fetch plus task/task-session SSE ✓

---
*Phase: 01-merge-action-runtime*
*Completed: 2026-03-07*
