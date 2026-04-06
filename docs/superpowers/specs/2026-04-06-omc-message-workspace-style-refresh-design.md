# OMC Message Workspace Style Refresh

Date: 2026-04-06
Status: Approved in terminal, proceeding to implementation
Scope: `omc-prototype/` message workspace styling and light structural polish
Related:
- `docs/superpowers/specs/2026-04-05-omc-message-detail-redesign-design.md`
- `docs/superpowers/plans/2026-04-06-omc-message-workspace-style-refresh.md`

## Summary

Refresh the `omc-prototype` message workspace so it reads as a misty, premium chat workspace instead of a stack of ordinary white cards.

Approved direction:

- focus area is the message workspace only
- chosen product feel is `chat workspace`
- chosen visual direction is `A. 轻盈玻璃聊天台`
- chosen intensity is `A1. 雾感更强`
- inbox and detail share the same glass language
- final layout strategy is `misty shell + slightly anchored conversation core`

This is a styling and hierarchy refresh. It does not change message ranking, store behavior, thread logic, or runtime wiring.

## Problem

Current message workspace already has the right information model, but the visual system spends too much weight on generic white panels:

1. Inbox rows feel like normal utility cards instead of a calm pre-room for the active conversation.
2. Detail view is structurally correct, but the workspace does not feel like one coherent chat surface.
3. The briefing header, message viewport, quick actions, and composer all read as adjacent parts instead of one coordinated workspace.
4. The current neutral white surfaces flatten the desired contrast between ambient shell and conversational core.

## Goals

- Keep the existing message-detail information hierarchy.
- Make inbox and detail feel like one premium, misty-glass workspace.
- Preserve a strong chat feeling without sacrificing legibility.
- Use the conversation area and composer dock as the main readability anchors.
- Keep the prototype calm, light, operational, and visually restrained.

## Non-Goals

- No changes to `usePrototypeStore`, thread sorting, message sending, or fake data.
- No new product features.
- No heavy enterprise control-room styling.
- No broad redesign of dashboard, goal, or execution pages.

## Visual Thesis

`misty glass chat workspace; quiet shell outside, softly anchored conversation core inside`

Material and energy:

- outer shell: translucent, airy, low-contrast glass
- inner conversation core: still glass, but 5 to 10 percent more solid
- user bubble: deep green, silky, readable, gently luminous
- briefing blocks: suspended glass notes, not hard cards

## Layout Direction

### Inbox Rail

- Keep the current single-rail composition.
- Convert inbox rows into soft glass strips with subtle active emphasis.
- Unread indicator becomes a haloed signal point, not just a flat dot.
- Avoid strong green fills on active states; prefer slightly brighter glass + clearer edge.

### Detail Workspace

- Keep title, status, chips, briefing, conversation, and composer in the same order.
- Reduce the feeling of separate card stacks.
- Detail shell should read as a continuous workspace with internal zones.

### Briefing Header

- Keep context chips.
- Keep two briefing blocks:
  - `为什么现在需要你`
  - `执行动作`
- Both blocks remain visually important, but softer and mistier than the current version.
- `执行动作` gets a subtle warm lift, not a warning-card look.

### Conversation Core

- Add one stronger inner surface around the transcript area.
- The conversation core should be visibly more stable than the outer shell, but still part of the same material system.
- Agent bubbles stay light and glassy.
- User bubbles remain the strongest dark anchor in the thread.

### Action Dock

- Quick actions move closer to the composer.
- Suggested actions read as assistant prompts, not toolbar controls.
- Composer becomes a complete glass dock with an inset input channel.

## Responsiveness

- Desktop rail stays sticky and calm.
- Mobile drawer keeps the same material language.
- Chips and quick actions wrap naturally.
- Composer collapses to single-column send layout under narrow widths.
- Bubble width remains comfortable on small screens; do not let any bubble become full width unless required.

## Motion

Restrained only:

- hover lift on inbox rows and action pills
- subtle shadow and border strengthening on active states
- no scale-jitter or ornamental transforms

## Accessibility

- preserve visible focus states
- keep text contrast above current light-mode baseline
- do not rely on color alone for unread / active / status states
- keep heading order intact

## Acceptance Criteria

- Inbox and detail both visually read as glass surfaces, not standard white cards.
- Detail view feels like one workspace with a clear conversational center.
- `为什么现在需要你` and `执行动作` remain immediately scannable.
- Quick actions and composer feel docked together.
- User bubbles remain the strongest action/response anchor.
- Existing message workspace tests are updated or expanded to cover the refreshed structure where needed.

## Execution Note

The normal brainstorming flow would pause for written-spec review. The user explicitly approved the recommended direction in terminal and asked to proceed directly, so implementation continues immediately from this approved spec.
