# OMC Message Workspace Style Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh the `omc-prototype` message workspace so inbox and detail share one misty-glass chat-workspace system with a slightly more solid conversation core.

**Architecture:** Keep the current store, routing, and assistant runtime intact. Adjust component markup only where it improves visual grouping, then drive the experience mainly through focused CSS changes in the existing message-workspace selectors.

**Tech Stack:** React 19, TypeScript, `@assistant-ui/react`, Vitest, Testing Library, Vite, Bun

---

## File Map

- `omc-prototype/src/components/MessagePanel.tsx`
  Preserve wiring; only touch if class boundaries need minor adjustment.
- `omc-prototype/src/components/operator/MessageWorkspace.tsx`
  Workspace shell, detail header frame, inbox/detail body grouping.
- `omc-prototype/src/components/operator/ThreadHeader.tsx`
  Briefing chips and two-block summary surface.
- `omc-prototype/src/components/operator/ThreadInbox.tsx`
  Inbox row grouping and active-state hooks.
- `omc-prototype/src/components/operator/ThreadConversation.tsx`
  Conversation core wrapper and dock structure.
- `omc-prototype/src/components/operator/ThreadQuickActions.tsx`
  Suggested-action label and pill positioning.
- `omc-prototype/src/index.css`
  Main visual refresh: shell, rows, header, bubbles, dock, responsive behavior.
- `omc-prototype/src/components/operator/MessageWorkspace.test.tsx`
  Protect inbox/detail shell behavior.
- `omc-prototype/src/components/operator/ThreadHeader.test.tsx`
  Protect briefing structure.
- `omc-prototype/src/components/operator/ThreadConversation.test.tsx`
  Protect conversation-core and dock structure.

## Task 1: Lock structural expectations with failing tests

**Files:**
- Modify: `omc-prototype/src/components/operator/MessageWorkspace.test.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadHeader.test.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadConversation.test.tsx`

- [ ] Add or adjust tests so they assert the refreshed structural contract:
  - detail mode renders one workspace shell plus back button, title, status, and detail body
  - thread header renders chips plus separate `为什么现在需要你` and `执行动作` blocks
  - thread conversation renders a dedicated conversation core plus a dock containing quick actions and composer
- [ ] Run targeted tests first and confirm at least one assertion fails before implementation:
  - `cd /Users/realizer/Code/hopi/omc-prototype`
  - `TMPDIR=/tmp bun run test -- src/components/operator/MessageWorkspace.test.tsx src/components/operator/ThreadHeader.test.tsx src/components/operator/ThreadConversation.test.tsx`

## Task 2: Refresh workspace markup with minimal structural changes

**Files:**
- Modify: `omc-prototype/src/components/operator/MessageWorkspace.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadHeader.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadConversation.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadQuickActions.tsx`

- [ ] Keep behavior intact while adding only the wrappers/classes needed for:
  - a more unified detail shell
  - a dedicated conversation-core container
  - a tighter quick-actions/composer dock
  - optional micro-copy hooks for the refreshed tone
- [ ] Re-run the three component tests and confirm they pass before moving to CSS.

## Task 3: Apply the misty-glass visual system

**Files:**
- Modify: `omc-prototype/src/index.css`
- Modify: `omc-prototype/src/components/operator/ThreadInbox.tsx` if selectors need light class hooks

- [ ] Rework the message-workspace selectors so:
  - outer shell becomes more translucent and atmospheric
  - inbox rows become softer glass strips with calmer active states
  - briefing blocks become misty suspended notes
  - conversation area gains a slightly more solid inner core
  - user bubbles remain dark green anchors
  - quick actions and composer feel docked together
- [ ] Preserve focus states, readable contrast, and mobile wrapping behavior.
- [ ] Run the three component tests again after CSS and any DOM changes.

## Task 4: Verify the prototype build surface

**Files:**
- Modify only if verification exposes issues

- [ ] Run targeted checks:
  - `cd /Users/realizer/Code/hopi/omc-prototype`
  - `TMPDIR=/tmp bun run test -- src/components/operator/MessageWorkspace.test.tsx src/components/operator/ThreadHeader.test.tsx src/components/operator/ThreadConversation.test.tsx`
  - `bun run typecheck`
  - `bun run build`
- [ ] Fix any regressions introduced by the refresh.

## Self-Review

- Spec coverage: inbox rail, detail workspace, briefing, conversation core, dock, responsiveness, and accessibility all map to Tasks 1-4.
- Placeholder scan: no TBD sections remain.
- Type consistency: all tasks keep the current `OperatorThread` and assistant-runtime boundaries intact.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-06-omc-message-workspace-style-refresh.md`.

Two execution options:

1. Subagent-Driven (recommended) - dispatch a fresh subagent per task, review between tasks
2. Inline Execution - execute tasks in this session with checkpoints

User already requested direct inline execution, so proceed inline in this session.
