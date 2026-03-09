---
phase: 05-init-action-parity
plan: 03
subsystem: web
tags: [init-ui, task-chat, react-query]
requires:
  - 05-01
  - 05-02
provides:
  - Durable init runtime summaries in task workbench and task chat
  - Cache-aware start-session mutation updates for task/session re-entry
  - Focused web regression coverage for init cache updates and durable rehydrate behavior
affects: [task-workbench, task-chat, task-cache]
tech-stack:
  added: []
  patterns: [task-backed init summary, cache-aware start-session mutation, durable re-entry helper]
key-files:
  created:
    - web/src/lib/task-init-runtime.ts
    - web/src/hooks/mutations/useStartTaskSession.test.tsx
    - web/src/components/SessionChat.test.tsx
  modified:
    - web/src/hooks/mutations/useStartTaskSession.ts
    - web/src/routes/projects/task-workbench.tsx
    - web/src/components/AssistantChat/HappyThread.tsx
    - web/src/components/SessionChat.tsx
key-decisions:
  - "Mirror the existing Merge/Preview status card style instead of inventing a special init-only presentation."
  - "Use durable `task.initRuntime` as the primary source of truth and keep local mutation logic limited to cache updates."
  - "Keep the success path low-noise with one compact summary card while still surviving refresh and re-entry."
patterns-established:
  - "Task workbench and session chat now render the same init summary vocabulary from one shared helper."
  - "Start-session mutation patches task/task-list caches immediately, then session/message queries revalidate linked session state."
requirements-completed: [INIT-02, INIT-03]
duration: multi-session
completed: 2026-03-08
---

# Phase 5 Plan 03 Summary

**Durable init runtime summaries now rehydrate in task workbench and chat with cache-aware start-session updates**

## Performance

- **Duration:** multi-session
- **Started:** carried from earlier Phase 5 execution work
- **Completed:** 2026-03-08
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments
- Added a shared init-runtime summary helper so running, waiting, retrying, blocked, and succeeded states render from durable task data.
- Updated `useStartTaskSession()` to write returned task state back into task/task-list caches immediately and invalidate both old and new linked session caches when relinking.
- Surfaced compact init status cards in both the task workbench sidebar and the task-aware chat thread using the same Merge/Preview visual weight.
- Added focused web coverage for cache updates and durable re-entry so init status no longer depends on rereading transcript history.

## Task Commits

1. **Implementation + validation completed in workspace state** - no git commit created in this turn

## Files Created/Modified
- `web/src/lib/task-init-runtime.ts` - centralizes durable init summary + session-visibility helpers.
- `web/src/hooks/mutations/useStartTaskSession.ts` - patches task caches from start-session responses and revalidates relinked session/message queries.
- `web/src/routes/projects/task-workbench.tsx` - shows durable init summary in the task sessions panel.
- `web/src/components/AssistantChat/HappyThread.tsx` - renders init summary cards with the same compact status card chrome already used for merge/preview.
- `web/src/components/SessionChat.tsx` - derives init summary visibility from linked task state and passes it into the chat thread surface.
- `web/src/hooks/mutations/useStartTaskSession.test.tsx` - covers task cache patching and relink invalidation.
- `web/src/components/SessionChat.test.tsx` - covers blocked, running, and succeeded init summary rehydrate behavior.

## Decisions Made
- Kept `task.initRuntime` as the durable truth and avoided building any separate local init state machine in the web layer.
- Reused the same status-card chrome for init so Merge, Preview, and Init feel like one product flow.
- Limited chat visibility to the currently linked task session so stale init cards do not bleed into unrelated sessions.

## Deviations from Plan

- Added `web/src/lib/task-init-runtime.ts` as a shared helper so task workbench and chat did not duplicate summary wording or visibility rules.
- Focused the UI regression coverage on task cache + durable summary helpers rather than trying to mount the full assistant runtime stack in one heavy component test.

## Issues Encountered

- `bun test` accidentally invoked Bun’s runner instead of Vitest for browser-style web tests; validation switched back to `bun run test` so jsdom-backed hooks/components ran correctly.
- `HappyThread` needed a small generic status-card abstraction before init could share the same compact UI treatment as merge/preview.

## User Setup Required

None - no external configuration required.

## Next Phase Readiness

Phase 5 is complete. Phase 6 can now consolidate Merge, Preview, and Init into one shared runtime contract from a stable backend and stable UI baseline.
A real browser smoke pass is still recommended for refresh/reconnect feel, but durable task-backed re-entry is now covered by web tests.

## Self-Check

- `bun run typecheck:web` ✓
- `bun run test:web` ✓
- Cache patch + relink invalidation coverage added in `web/src/hooks/mutations/useStartTaskSession.test.tsx` ✓
- Durable task/chat summary rehydrate coverage added in `web/src/components/SessionChat.test.tsx` ✓

---
*Phase: 05-init-action-parity*
*Completed: 2026-03-08*
