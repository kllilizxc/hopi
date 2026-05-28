# OMC Message Detail Redesign

Date: 2026-04-05
Status: Draft for review
Scope: `omc-prototype/` message detail styling and hierarchy refresh
Related: `docs/superpowers/specs/2026-04-05-omc-message-operator-shell-design.md`

## Summary

Redesign the message detail view in `omc-prototype` so the right-side workspace reads as a calm operator chat surface with a stronger briefing header.

Approved direction:

- conversation-first layout
- stronger information hierarchy than current UI
- higher visual polish second
- more chat feeling only after hierarchy is fixed
- top section uses a two-layer briefing header
- first screen includes:
  - title
  - status
  - related goal / stream / phase context
  - why operator attention is needed now
  - explicit execution action

This is a focused refinement of thread detail presentation, not a redesign of the broader operator shell model.

## Problem

Current message detail UI in `omc-prototype` has three issues:

1. Header hierarchy weak

   Title, status, context, and action hints read like loose fragments instead of a clear top-down briefing.

2. Detail surface under-shaped

   The conversation body, quick actions, and composer do not feel like one coherent work area. The page reads as stacked parts rather than a single operator workflow.

3. Polished but not directed

   The styling is already soft and clean, but the visual weight is spent on surface blur and cards rather than on telling the operator:

   - what this thread is
   - why it needs attention now
   - what action to take next

## Goals

- Make thread detail readable in one quick scan
- Let the conversation body become the primary workspace
- Add a briefing header that answers:
  - what this topic is
  - where it belongs
  - why attention is needed now
  - what the operator can do next
- Improve perceived quality through spacing, rhythm, and contrast, not through extra chrome
- Preserve current prototype tone: calm, light, operational

## Non-Goals

- Rework inbox grouping or lifecycle logic
- Change the underlying thread store or fake data model
- Redesign the whole page shell outside the message detail surface
- Turn the detail area into a heavy enterprise inspector
- Introduce production chat features such as typing indicators, attachments, or read receipts

## Approved Product Direction

### Priority Order

User priority order:

1. stronger information hierarchy
2. better visual quality
3. slightly stronger chat feeling

### Chosen Frame

Chosen direction: `Briefing Header + Dense Conversation`

Why:

- best match for conversation-first behavior
- gives the operator clear context before reading the transcript
- keeps the top area informative without pushing the chat too far down

Rejected alternatives:

- tighter single-strip summary: cleaner, but too light on hierarchy
- inspector-style detail panel: informative, but too static and less conversational

## Layout Design

Thread detail remains a single-column right-side panel, but reorganized into four layers:

1. title layer
2. briefing layer
3. conversation layer
4. action layer

### 1. Title Layer

Purpose: identify the thread immediately.

Contains:

- back affordance
- thread title
- updated time
- status badge

Rules:

- title is the loudest text in the panel
- updated time remains secondary
- status stays visible without dominating the header

### 2. Briefing Layer

Purpose: compress non-chat context into a readable decision preface.

Contains two sublayers:

#### Context Strip

Compact chips or tags for:

- goal
- stream
- phase or plan context when available

Rules:

- scan-friendly
- low visual weight
- no chip pile explosion
- show only the minimum context needed for this thread

#### Decision Summary

Two stacked blocks:

1. `为什么现在需要你`
2. `执行动作`

Rules:

- `为什么现在需要你` explains urgency or decision pressure
- `执行动作` says what the operator should do next in direct language
- these must not be merged into one paragraph
- `执行动作` must feel more actionable than descriptive

### 3. Conversation Layer

Purpose: become the main work area immediately after the briefing.

Rules:

- no repeated report-card framing above the transcript
- messages feel like a conversation, not a dashboard card stack
- first visible agent message should align with the briefing, not restate all of it

### 4. Action Layer

Purpose: give the operator one stable response zone.

Contains:

- quick actions
- composer
- send button

Rules:

- quick actions sit close to the composer, not floating mid-page
- composer feels docked to the bottom of the work area
- free-form input remains first-class

## Visual Language

Visual thesis:

`quiet operator workspace; soft glass shell outside, firmer structured paper inside`

The current prototype already has soft backgrounds and blur. The redesign should keep that atmosphere, but move clarity inside the panel through stronger inner structure.

### Surface Strategy

- outer message panel can stay soft and translucent
- inner briefing and conversation surfaces should feel more solid
- reduce the sense of “everything is the same white card”

### Hierarchy Strategy

- use spacing and contrast before adding more borders
- give each layer one dominant job
- avoid decorative chrome around routine UI

### Color Semantics

- neutral white / soft gray for standard context
- calm green tint for `为什么现在需要你`
- soft warm tint for `执行动作`
- dark user bubble retained for contrast and conversational orientation

No extra accent colors beyond the existing green and warning family.

## Component-Level Design

### `MessageWorkspace`

Owns panel-level header row.

Changes:

- selected thread mode gives the title layer more room
- desktop header feels less like a list-toolbar remnant
- back affordance remains, but visually lighter than the title

### `ThreadHeader`

Expands from a tiny metadata strip into a real briefing header.

New responsibilities:

- render context chips
- render `为什么现在需要你`
- render `执行动作`
- gracefully omit missing fields without breaking layout

Important rule:

If context is incomplete, the component degrades by dropping optional chips first, then rendering minimal briefing blocks.

### `ThreadConversation`

Retains current runtime wiring, but changes presentation.

Changes:

- message area gets better vertical rhythm
- agent and user bubbles become more deliberate in width, padding, and radius
- quick actions move closer to the composer
- composer becomes a stronger bottom dock

No new message behavior required in this phase.

## Message Presentation Rules

### Agent Messages

- white or near-white bubble
- light border
- slightly larger line-height for readability
- stable max width
- avoid oversized empty margins

### User Messages

- dark bubble stays
- width slightly tighter than current implementation
- preserve high contrast
- shape should mirror agent bubble rhythm, not look like a separate system

### System Messages

- visually reduced
- centered or lightly separated
- clearly not equivalent to operator/agent conversation turns

## Quick Actions and Composer

### Quick Actions

Quick actions should read as suggested next moves, not generic buttons.

Design rules:

- compact pill format
- low border weight
- primary suggestion can use accent tone
- placement immediately above or adjacent to composer region

### Composer

Composer should feel like the bottom anchor of the panel.

Design rules:

- stronger spacing from transcript
- softer but clearer field outline
- send button more definite than current UI
- maintain support for multiline input without making the dock bulky

## Responsive Behavior

Desktop and narrow-screen ordering stays consistent:

1. title
2. context strip
3. why now
4. execution action
5. conversation
6. quick actions
7. composer

Rules:

- context chips wrap naturally
- briefing blocks stack vertically
- conversation height remains prioritized over decorative spacing
- drawer mode should preserve the same visual language, not become a separate mobile design

## Content Contract

For the redesign to work, thread detail content should follow this reading order:

1. identify topic
2. locate topic in system context
3. understand why attention is needed now
4. understand the next expected action
5. review or continue the conversation

This means the UI must not force the operator to infer action from the transcript alone.

## Implementation Notes

Primary files:

- `omc-prototype/src/components/operator/MessageWorkspace.tsx`
- `omc-prototype/src/components/operator/ThreadHeader.tsx`
- `omc-prototype/src/components/operator/ThreadConversation.tsx`
- `omc-prototype/src/index.css`

Possible supporting test updates:

- `omc-prototype/src/components/operator/MessageWorkspace.test.tsx`

Implementation should prefer structural class changes and CSS rebalancing over introducing extra wrapper complexity unless needed for hierarchy.

## Error Handling

Prototype-level handling only:

- missing context fields: omit specific tags or briefing rows cleanly
- long text in `为什么现在需要你` or `执行动作`: wrap without breaking header rhythm
- no quick actions: composer still feels complete on its own

## Testing

### Structural

- selected thread detail still renders from `MessageWorkspace`
- back button behavior unchanged
- conversation still renders correct message count / thread content

### Content Hierarchy

- selected thread view shows title and updated time
- context strip renders related metadata when present
- briefing header separates “why now” from “execution action”
- quick actions remain visually attached to the composer region, not drifting into the middle of the thread

### Responsive / Visual Review

- desktop right rail still fits within current page shell
- narrow drawer layout does not collapse the briefing into unreadable single-line content
- conversation remains visually dominant after the larger header is introduced

## Risks

- header grows too tall and steals too much space from the conversation
- context chips become cluttered as more metadata gets added later
- action block becomes too verbose and starts reading like another report
- quick actions still feel detached if spacing is not tuned carefully

## Acceptance Criteria

- operator can identify thread topic, status, and system context in one scan
- operator can tell why attention is needed now without reading the full transcript
- operator can see the expected next move without guessing
- conversation feels like the main workspace, not an afterthought under metadata
- visual polish improves through better hierarchy, spacing, and emphasis rather than extra decoration
