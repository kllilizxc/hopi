---
phase: 01-omc-foundation
plan: 02
subsystem: ui
tags: [omc-prototype, assistant-ui, inbox, thread-panel]
requires:
  - phase: 01-omc-foundation
    provides: thread domain and lifecycle
provides:
  - assistant-style active thread conversation surface
  - inbox list with lifecycle buckets and handled collapse
  - per-thread composer and quick action surface
affects: [01-03, router, message-panel]
tech-stack:
  added: [@assistant-ui/react, @assistant-ui/react-markdown, remark-gfm]
  patterns:
    - "thin inbox shell around assistant-ui thread runtime"
    - "active thread conversation separated from inbox selection"
key-files:
  created:
    - /Users/realizer/Code/hopi/omc-prototype/src/components/operator/ThreadInbox.tsx
    - /Users/realizer/Code/hopi/omc-prototype/src/components/operator/ThreadConversation.tsx
    - /Users/realizer/Code/hopi/omc-prototype/src/components/operator/ThreadHeader.tsx
    - /Users/realizer/Code/hopi/omc-prototype/src/components/operator/ThreadQuickActions.tsx
    - /Users/realizer/Code/hopi/omc-prototype/src/components/MarkdownRenderer.tsx
    - /Users/realizer/Code/hopi/omc-prototype/src/lib/omcAssistantRuntime.ts
  modified:
    - /Users/realizer/Code/hopi/omc-prototype/src/components/MessagePanel.tsx
    - /Users/realizer/Code/hopi/omc-prototype/src/index.css
key-decisions:
  - "assistant-ui handles message/composer runtime; inbox list and thread metadata stay custom."
  - "Each operator topic is a selectable thread, not an inline expandable card."
patterns-established:
  - "Right rail = inbox on top, active thread below."
  - "Thread header always shows refs before freeform chatting starts."
requirements-completed: [OMC-14, OMC-15, OMC-16]
duration: 40min
completed: 2026-04-05
---

# Phase 1 Plan 02 Summary

**The right rail now behaves like an operator inbox with a real active conversation surface instead of a stack of bespoke cards**

## Performance

- **Duration:** 40 min
- **Completed:** 2026-04-05
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Replaced the old custom message-card panel with an inbox + active-thread shell.
- Reused `assistant-ui` for message rendering, markdown, composer behavior, and thread scrolling.
- Added lifecycle buckets (`待处理 / 等你回复 / 进行中 / 已处理`) and handled-thread collapse in the inbox.

## Files Created/Modified

- `/Users/realizer/Code/hopi/omc-prototype/src/components/operator/ThreadInbox.tsx` - inbox list and lifecycle buckets.
- `/Users/realizer/Code/hopi/omc-prototype/src/components/operator/ThreadConversation.tsx` - active thread conversation shell.
- `/Users/realizer/Code/hopi/omc-prototype/src/components/operator/ThreadHeader.tsx` - structured refs and status header.
- `/Users/realizer/Code/hopi/omc-prototype/src/components/operator/ThreadQuickActions.tsx` - thread-local quick actions.
- `/Users/realizer/Code/hopi/omc-prototype/src/components/MarkdownRenderer.tsx` - markdown rendering bridge for assistant-ui.
- `/Users/realizer/Code/hopi/omc-prototype/src/lib/omcAssistantRuntime.ts` - converts mock thread messages into assistant-ui runtime messages.
- `/Users/realizer/Code/hopi/omc-prototype/src/components/MessagePanel.tsx` - new inbox + active-thread composition.
- `/Users/realizer/Code/hopi/omc-prototype/src/index.css` - operator-shell styling for the new rail.

## Decisions Made

- Passive status threads live in the inbox but do not outrank unresolved intervention threads.
- Thread-specific quick actions remain inside the conversation pane, not in the inbox list row.
- Thread ordering is biased by current page context so goal/stream-related threads float up while staying in one inbox.

## Deviations from Plan

None - plan executed as intended.

## Issues Encountered

- Assistant-ui composer props differed from the earlier custom textarea assumptions; the composer was adjusted to use supported `submitOnEnter` / `maxRows` behavior.

## User Setup Required

None.

## Next Phase Readiness

- The operator shell is ready to become the single intervention surface.
- Main-canvas actions can now be demoted into thread handoff affordances instead of being deleted outright.
