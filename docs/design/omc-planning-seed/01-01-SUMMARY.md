---
phase: 01-omc-foundation
plan: 01
subsystem: ui
tags: [omc-prototype, operator-threads, mock-runtime, inbox]
requires: []
provides:
  - first-class operator thread types and lifecycle model
  - derived thread builder with structured first Agent messages
  - store-backed thread/message state instead of flat chat log
affects: [01-02, 01-03, message-panel, goal-canvas]
tech-stack:
  added: [vitest]
  patterns:
    - "topic thread as primary operator unit"
    - "thread refs carry goal/stream/phase/plan/impact context"
key-files:
  created:
    - /Users/realizer/Code/hopi/omc-prototype/src/prototype/threads.ts
    - /Users/realizer/Code/hopi/omc-prototype/src/prototype/threadSelectors.ts
    - /Users/realizer/Code/hopi/omc-prototype/src/prototype/threads.test.ts
  modified:
    - /Users/realizer/Code/hopi/omc-prototype/src/prototype/types.ts
    - /Users/realizer/Code/hopi/omc-prototype/src/prototype/store.tsx
    - /Users/realizer/Code/hopi/omc-prototype/package.json
key-decisions:
  - "Unread state belongs to explicit user thread selection, not automatic default activation."
  - "One operator thread equals one intervention topic, not one goal and not one raw message."
patterns-established:
  - "All new operator topics originate from derived snapshot + thread seeds."
  - "Structured first Agent message follows fixed sections: status, background, why now, suggested action, freeform invite, refs."
requirements-completed: [OMC-11, OMC-12, OMC-13]
duration: 50min
completed: 2026-04-05
---

# Phase 1 Plan 01 Summary

**Operator topics became first-class data with lifecycle, context refs, structured opening messages, and per-thread message storage**

## Performance

- **Duration:** 50 min
- **Completed:** 2026-04-05
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments

- Replaced the old flat chat log model with typed operator threads, thread refs, quick actions, and per-thread messages.
- Added derived thread generation for `status`, `approval`, `risk`, and `direction` topics from the mock scenario snapshot.
- Added Vitest coverage for first-message contract, default thread selection, and resolved-thread reopening.

## Files Created/Modified

- `/Users/realizer/Code/hopi/omc-prototype/src/prototype/threads.ts` - builds operator threads and syncs them into store state.
- `/Users/realizer/Code/hopi/omc-prototype/src/prototype/threadSelectors.ts` - shared selectors for related-thread handoff from the canvas.
- `/Users/realizer/Code/hopi/omc-prototype/src/prototype/threads.test.ts` - regression coverage for thread behavior.
- `/Users/realizer/Code/hopi/omc-prototype/src/prototype/types.ts` - new thread/message/action contracts.
- `/Users/realizer/Code/hopi/omc-prototype/src/prototype/store.tsx` - store refactor from flat chat to thread/message maps.
- `/Users/realizer/Code/hopi/omc-prototype/package.json` - test script and prototype-local dependencies.

## Decisions Made

- Resolved threads can reopen as `pending` when the same topic becomes active again.
- Auto-selected threads stay unread until the user explicitly focuses them.
- Quick actions dispatch through thread operations instead of direct canvas buttons.

## Deviations from Plan

None - plan executed as intended.

## Issues Encountered

- `bun install` could not update lock state in this sandbox because Bun tempdir writes were denied. Existing workspace packages were sufficient for local `typecheck/test/build`.

## User Setup Required

None.

## Next Phase Readiness

- Thread domain is ready for assistant-style rendering and inbox UX.
- Store now exposes `threads`, `activeThread`, and `messagesByThread` for the operator shell.
