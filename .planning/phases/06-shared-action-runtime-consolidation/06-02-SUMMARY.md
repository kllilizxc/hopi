---
phase: 06-shared-action-runtime-consolidation
plan: 02
subsystem: hub-web-action-grammar
tags: [transcript-grammar, runnable-gates, cache-updates]
requires:
  - 06-01
provides:
  - Shared runnable-session gate and repeated-blocker phrasing for built-in actions
  - Shared web status-summary helpers for Merge, Preview, and Init
  - Shared task/session cache update helpers for action mutations
affects: [task-routes, init-service, session-chat, mutation-cache]
tech-stack:
  added: []
  patterns: [shared action flow helper, shared web status grammar, shared mutation cache helper]
key-files:
  created:
    - hub/src/utils/taskActionFlow.ts
    - web/src/lib/task-action-runtime.ts
    - web/src/hooks/mutations/taskActionCache.ts
  modified:
    - hub/src/web/routes/tasks.ts
    - hub/src/sync/taskSessionService.ts
    - hub/src/sync/taskSessionService.test.ts
    - web/src/components/AssistantChat/HappyThread.tsx
    - web/src/components/SessionChat.tsx
    - web/src/components/SessionChat.test.tsx
    - web/src/lib/task-init-runtime.ts
    - web/src/hooks/mutations/useMergeTaskWorktree.ts
    - web/src/hooks/mutations/useTaskPreview.ts
    - web/src/hooks/mutations/useStartTaskSession.ts
key-decisions:
  - "Share flow/copy/cache helpers under action-specific adapters instead of inventing one generic action UI."
  - "Normalize busy-session gating around one runnable-session helper and keep action-specific queued/approval text on top."
  - "Move web runtime summaries and runtime equality checks into one shared helper so refresh/re-entry stays consistent."
patterns-established:
  - "Merge, Preview, and Init now reuse the same repeated-blocker phrasing and command-report formatting helpers."
  - "Web mutations patch task/task-list/session caches through one shared helper instead of repeating query-cache loops per action."
requirements-completed: [ACTION-05, ACTION-06]
duration: single-session
completed: 2026-03-09
---

# Phase 6 Plan 02 Summary

**Built-in actions now share one product grammar for runnable gating, status summaries, and cache updates**

## Accomplishments
- Added `hub/src/utils/taskActionFlow.ts` for shared runnable-session polling, queue/approval phrasing, repeated-blocker notes, and CLI-style command report lines.
- Refactored Merge and Init to use the shared runnable gate; added init coverage that proves retries wait for approval requests to clear before continuing.
- Added `web/src/lib/task-action-runtime.ts` so Merge/Preview/Init status cards and runtime equality checks come from one helper layer.
- Added `web/src/hooks/mutations/taskActionCache.ts` so Merge, Preview, and Init mutations share task/session cache patch + invalidation behavior.
- Kept action names visible and specific in chat/task UI while making the underlying status grammar and cache semantics consistent.

## Verification
- `bun run test:hub -- taskSessionService.test.ts tasks.merge-script.test.ts tasks.preview.test.ts tasks.start-session.test.ts` ✓
- `bun run typecheck:hub` ✓
- `bun run typecheck:web` ✓
- `bun run test:web -- SessionChat.test.tsx useMergeTaskWorktree.test.tsx useTaskPreview.test.tsx useStartTaskSession.test.tsx` ✓

## Notes
- Shared `StatusCard` chrome remains the visible anchor; only helper ownership and grammar beneath it changed.
- Queue/approval-pending behavior stays action-specific in wording, but now follows one shared busy-session discipline.
