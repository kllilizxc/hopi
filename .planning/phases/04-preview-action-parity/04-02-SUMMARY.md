---
phase: 04-preview-action-parity
plan: 02
subsystem: hub
tags: [preview-runtime, direct-run-first, blocker-control]
requires:
  - .planning/phases/04-preview-action-parity/04-01-SUMMARY.md
provides:
  - Busy-session preview deferral with durable queued or approval-pending runtime plus auto-run once the linked session becomes runnable
  - Durable preview retry counts, failure fingerprints, repeated-blocker summaries, and bounded late-crash self-heal control
  - Preview cancel-before-ready semantics that stop deferred or monitor work without adding chat overhead to the success path
affects: [preview-route, preview-runtime, preview-tests]
tech-stack:
  added: []
  patterns: [deferred direct kickoff, durable blocker fingerprinting, bounded self-heal loop]
key-files:
  created:
    - .planning/phases/04-preview-action-parity/04-02-SUMMARY.md
  modified:
    - hub/src/web/routes/tasks.ts
    - hub/src/web/routes/tasks.preview.test.ts
key-decisions:
  - "Queue Preview clicks as durable runtime state when the linked session is thinking or waiting on approval, then auto-run the same direct attempt later instead of jumping straight into agent chat."
  - "Persist preview retry count and failure fingerprint through waiting and ready states so late crashes can stop on repeated blockers instead of looping forever."
patterns-established:
  - "Preview now follows Merge-style direct-run-first behavior: low-noise success path, transcript-visible failure path, repair only after direct failure."
  - "Preview stop now distinguishes cancel-before-ready from stop-after-ready and tears down queued/monitor work accordingly."
requirements-completed: [PREVIEW-01, PREVIEW-02, PREVIEW-04]
completed: 2026-03-08
---

# Phase 4 Plan 02 Summary

**Preview direct-run parity: queued auto-start, durable blocker control, cancel-before-ready**

## Accomplishments
- Added durable queued and approval-pending Preview runtime states so busy linked sessions defer the direct preview attempt instead of immediately spilling into agent chat.
- Auto-runs the same repo-local preview start once the linked session becomes runnable, keeping the clean success path as one direct tool call plus a short transcript result.
- Persists preview retry counts and failure fingerprints through repair and late-crash flows so repeated identical blockers stop with one exact manual next step instead of retrying forever.
- Split Preview stop behavior into cancel-before-ready vs stop-after-ready so queued or pre-ready work can be canceled without pretending a ready preview was stopped.
- Added focused regressions for queued auto-run, approval auto-run, repeated blocker detection, retry count persistence, and queued cancel behavior.

## Files Created/Modified
- `hub/src/web/routes/tasks.ts` - adds Preview busy-session deferral, durable retry and blocker control, bounded late-crash repair handling, and cancel-before-ready stop behavior.
- `hub/src/web/routes/tasks.preview.test.ts` - covers queued auto-run, approval auto-run, repeated blocker notes, retry count persistence, and queued cancel behavior.
- `.planning/phases/04-preview-action-parity/04-02-SUMMARY.md` - records Plan 04-02 outcomes and validation.

## Decisions Made
- Treat queued or approval-pending Preview clicks as durable task runtime state and let background orchestration auto-run the same direct preview attempt later.
- Keep failure fingerprint memory alive through waiting and ready runtime states so late crashes can recognize the same blocker and stop cleanly.
- Keep Preview stop conservative: cancel queued or pre-ready work, but reserve `stopped` for previews that actually reached ready-state stop handling.

## Validation
- `bun test hub/src/web/routes/tasks.preview.test.ts` ✓
- `bun run typecheck:hub` ✓
- `bun run test:hub` ✓

## Next Phase Readiness
- Plan 04-03 can now replace local web Preview state with durable `task.previewRuntime`, reuse the new queued or blocked or canceled contract, and add retry or stop controls on top.

---
*Phase: 04-preview-action-parity*
*Completed: 2026-03-08*
