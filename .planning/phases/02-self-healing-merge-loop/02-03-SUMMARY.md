---
phase: 02-self-healing-merge-loop
plan: 03
subsystem: hub
tags: [merge-runtime, sandbox-boundary, cleanup]
requires:
  - 02-01
  - 02-02
provides:
  - Removal of hidden backend-only merge helpers that bypassed transcript-visible tool calls
  - Explicit sandbox/manual-blocker guidance for merge handoff behavior
  - Regression coverage against opaque backend retry fallback
affects: [task-merge-route, merge-runtime, blocker-handoff]
tech-stack:
  added: []
  patterns: [single canonical merge path, sandbox-only recovery boundary]
key-files:
  created: []
  modified:
    - hub/src/web/routes/tasks.ts
    - hub/src/web/routes/tasks.merge-script.test.ts
key-decisions:
  - "Delete hidden merge-script/conflict/autoretry helpers instead of leaving a tempting alternate execution path behind."
  - "Treat manual judgment and out-of-sandbox work as the only reasons to stop automatic recovery."
patterns-established:
  - "The linked task conversation route is now the only canonical Merge runtime path in hub code."
  - "Focused regression tests assert that retryable blocked states do not call backend merge or shell helpers behind the transcript."
requirements-completed: [REPAIR-05]
completed: 2026-03-07
---

# Phase 2 Plan 03 Summary

**Sandbox-only recovery boundary and cleanup of opaque merge fallback paths**

## Accomplishments
- Removed the legacy hidden merge-script, conflict auto-resolution, and background retry helpers from `hub/src/web/routes/tasks.ts` so Merge no longer has an attractive backend-only execution path.
- Tightened blocked-note wording around session inactivity, merge-state check failures, and still-mergeable outcomes so the next manual step stays explicit.
- Added regression assertions that blocked retry states do not invoke hidden `gitMergeWorktree()` or `runBash()` helpers behind the user's back.

## Files Created/Modified
- `hub/src/web/routes/tasks.ts` - removes dead backend merge helpers and keeps blocker messaging aligned with the conversation-native runtime.
- `hub/src/web/routes/tasks.merge-script.test.ts` - verifies the route stays blocked-with-guidance and never falls back to hidden backend retries.

## Decisions Made
- Keep shared command-building knowledge in `projectScripts.ts`, but do not use hidden script execution as the canonical merge path.
- Prefer deletion over fencing for dead helper paths to reduce future drift back toward opaque automation.

## Validation
- `bun run typecheck:hub` ✓
- `bun run test:hub` ✓

## Notes
- Existing merge error tests still pass without route-specific rewrites, which confirms the cleanup did not regress Phase 1 runtime behavior.
- No git commit created in this turn; implementation remains in workspace state.

---
*Phase: 02-self-healing-merge-loop*
*Completed: 2026-03-07*
