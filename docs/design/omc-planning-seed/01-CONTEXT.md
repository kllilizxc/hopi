# Phase 1: OMC Foundation - Context

**Gathered:** 2026-04-05
**Status:** Ready for planning
**Source:** User discussion on redesigning OMC around a message-driven operator panel

<domain>
## Phase Boundary

This context **supersedes the earlier 2026-03-29 board-first Phase 1 assumptions** for the current OMC prototype redesign.

This phase establishes the first **message-driven operator shell** for OMC.

The scope is:

- redesign the OMC interaction model around a right-side message panel that behaves like a real chat app
- move all operator decisions, confirmations, clarifications, and custom guidance into that message panel
- keep the main canvas as contextual read-only support for goals, strategy, execution streams, and plan drilldown
- define scalable thread, message, and state-lifecycle rules so the panel remains usable when many issues accumulate
- reuse third-party chat primitives and existing HOPI chat building blocks wherever possible instead of continuing the bespoke prototype panel

This phase should produce a prototype shell where the user can:

- see the system state on the main canvas
- receive every interruption-worthy topic as a message thread
- act through quick actions or freeform chat in that thread
- continue asking follow-up questions in the same thread
- trust that thread state reflects whether the system still needs intervention

This phase does **not** include:

- real hub/runtime integration
- replacing markdown planning truth
- rebuilding the entire left-side strategy/goal surfaces
- multi-agent mailbox orchestration
- notifications, push delivery, or mobile-native message sync
- attachments, voice, or rich multimodal chat features

</domain>

<decisions>
## Implementation Decisions

### Product posture
- The message panel is the **primary operator control surface** for OMC.
- The main canvas is for understanding system state; the message panel is for deciding, guiding, and questioning.
- Main-content controls for approvals, risks, route changes, and ad hoc guidance should be removed or reduced to read-only context.
- Anything that truly needs the user's intervention should appear in the message panel first, not as a scattered button elsewhere in the UI.

### Shell layout
- Desktop uses a fixed right-side message panel rather than a floating modal or bottom drawer.
- Recommended desktop width is roughly `420-480px`.
- Mobile should collapse the message experience into a dedicated full-screen drawer/sheet rather than trying to keep a narrow side rail.
- The default opened thread should be the **highest-priority unresolved thread**, not a passive overview/status thread.

### Thread model
- A thread is **one operator-relevant topic**, not one raw message and not one generic domain object.
- Thread types should be modeled around intervention topics:
  - `status`
  - `approval`
  - `risk`
  - `direction`
  - follow-up conversation inside the same thread
- The system should avoid creating a new thread for every new bubble; follow-up discussion about the same decision stays inside the original thread.
- Goal-, stream-, and plan-level context should be attached to threads as metadata, not used as the thread identity itself.

### First Agent message contract
- Every newly opened thread starts with one structured Agent message.
- That first message must include, in compact form:
  - current status
  - relevant background
  - why the system is interrupting now
  - recommended actions
  - an explicit invitation to reply in freeform text
- Approval threads must also say:
  - what happens if the user confirms
  - what happens if the user defers
- Risk threads must also say:
  - what happens if the system continues silently
  - what happens if the user asks to tighten/suppress/change direction
- The message should always show associated context chips or metadata for:
  - related goal
  - related execution stream
  - related phase/plan when applicable
  - current impact scope

### Interaction model
- Every actionable thread must support **both**:
  - quick actions
  - freeform user input
- Quick actions are for common high-confidence responses such as:
  - confirm
  - defer
  - continue silently
  - tighten scope
  - maintain route
  - accelerate
- Freeform input is a first-class control path, not a note field.
- The user must be able to ask arbitrary questions in-thread, such as:
  - why this surfaced now
  - what happens next
  - what evidence supports the recommendation
  - how the instruction changes current execution
- Each thread uses one normal chat composer for the active thread; the product should not render a separate input box under every bubble.

### Thread lifecycle and state transitions
- Message-level state stays lightweight:
  - sent
  - read
  - failed
  - action-applied
- The main lifecycle belongs to the **thread**, with these states:
  - `pending`
  - `in-progress`
  - `waiting`
  - `silent`
  - `resolved`
- State semantics:
  - `pending`: new topic needs user intervention
  - `in-progress`: user has responded; system is acting on the instruction
  - `waiting`: the system came back with a new concrete question in the same thread
  - `silent`: user explicitly deferred or suppressed the issue
  - `resolved`: the decision loop is closed and no further intervention is required
- Reading a thread does **not** resolve it.
- A thread moves back to `pending` when new evidence or a changed situation invalidates the old decision.
- Unread/read should remain a secondary marker; it must not be confused with resolved/unresolved.

### Main-canvas / message-panel split
- The main canvas should keep:
  - goal portfolio
  - strategy
  - execution streams
  - phase/plan drilldown
  - current system posture
- The main canvas should not own primary action buttons for:
  - approvals
  - risk handling
  - route changes
  - custom guidance
- The message panel is the single place where the user confirms, defers, instructs, or questions.
- Main-canvas components may link to a thread or highlight that a topic exists, but should not duplicate its primary controls.

### Third-party and reuse posture
- The redesign should prefer third-party and existing HOPI chat infrastructure over extending the bespoke prototype panel.
- Preferred foundation:
  - `@assistant-ui/react`
  - `@assistant-ui/react-markdown`
- The project should reuse existing HOPI chat building blocks where sensible, especially:
  - thread viewport behavior
  - composer behavior
  - markdown rendering
  - message presentation patterns
- The product should still build a **custom thin inbox layer** for:
  - thread list
  - thread grouping
  - thread metadata
  - intervention-state badges
  - context chips / quick-action rails
- The current fully bespoke prototype message shell should not be treated as the long-term architecture.

### the agent's Discretion
- Exact visual styling of the inbox and conversation panels.
- Exact badge labels for thread state, as long as the state machine above is preserved.
- Exact thread grouping labels in the inbox, as long as unresolved vs handled vs silent remains legible.
- Exact message-bubble styling and iconography.
- Whether handled threads are collapsed by default behind one section or split into `resolved` and `silent`.
- Whether the active thread header includes extra metadata rows or compact chips.

</decisions>

<specifics>
## Specific Ideas

- The user wants the product to feel like a real messaging app, not a dashboard covered in action cards.
- Anything that needs confirmation should appear as a message from the Agent in a shared message stream.
- The first Agent message should explain:
  - current state
  - background
  - what needs confirmation
  - convenient action buttons
- The user must also be able to keep talking to the Agent in natural language to get more context or give custom instructions.
- The user explicitly rejected:
  - one input box per message
  - action-heavy cards spread through the main canvas
  - a message system that does not scale when many issues appear
  - controls that look like they change state but do not meaningfully affect the scenario

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product direction
- `docs/design/factory-mode-ralph-gsd.md` — long-term OMC product direction and operator-shell context
- `docs/design/omc-phase-01-context.md` — canonical Phase 1 redesign context; use this instead of the earlier board-first assumptions
- `docs/design/omc-planning-seed/01-CONTEXT.md` — repo-local mirror of the same redesign context

### Existing HOPI chat stack to reuse
- `web/package.json` — confirms `@assistant-ui/react` and `@assistant-ui/react-markdown` are already first-party dependencies in HOPI
- `web/src/components/AssistantChat/HappyThread.tsx` — existing thread viewport, scroll, status, and message-shell patterns
- `web/src/components/AssistantChat/HappyComposer.tsx` — existing composer behavior, draft handling, and interaction patterns
- `web/src/components/MarkdownRenderer.tsx` — existing markdown rendering layer for chat content
- `web/src/components/SessionChat.tsx` — how the current product composes runtime + thread + composer into one chat surface

### Current prototype code to replace or absorb
- `omc-prototype/src/components/MessagePanel.tsx` — current bespoke message panel to be rethought around the new thread/inbox contract
- `omc-prototype/src/prototype/store.tsx` — current mock interaction engine and thread/message state
- `omc-prototype/src/prototype/types.ts` — current prototype state types that need to grow a proper thread model
- `omc-prototype/src/router.tsx` — current main/side-panel shell composition

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `web/src/components/AssistantChat/HappyThread.tsx` already solves core thread-viewport problems such as scrolling, incremental loading, skeletons, and thread message rendering.
- `web/src/components/AssistantChat/HappyComposer.tsx` already contains a mature composer with drafts, keyboard behavior, and input-state handling.
- `web/src/components/MarkdownRenderer.tsx` already wraps `@assistant-ui/react-markdown` for consistent message-body rendering.
- `web/src/components/SessionChat.tsx` shows how HOPI composes thread runtime, assistant-ui runtime, and supporting controls into one integrated surface.

### Established Patterns
- HOPI already uses assistant-ui primitives in the main product, so adopting them in OMC reduces technology sprawl.
- The current prototype already has a mock state engine capable of driving approvals, risks, routes, and reactions; the redesign can preserve the mock engine while replacing the UI shell.
- The user consistently prefers minimal main screens and wants real control to live in the conversation surface instead of scattered action cards.

### Integration Points
- `omc-prototype/src/router.tsx` is the natural shell seam for a stronger right-side inbox + active-thread layout.
- `omc-prototype/src/prototype/store.tsx` is the natural seam for introducing explicit thread lifecycle and per-thread chat state.
- Existing goal/risk/approval data in the prototype can be transformed into thread seeds rather than rendered as independent action cards.
- Existing left-side screens should remain as contextual read surfaces that can link into the message thread currently asking for action.

</code_context>

<deferred>
## Deferred Ideas

- Multi-agent or multi-person shared inbox behavior
- Push notifications or external delivery channels for unresolved threads
- Attachments, voice, or multimodal message content
- Rich evidence viewers embedded directly in the message thread
- Full mobile-native message experience polish beyond the basic drawer/sheet posture

</deferred>

---
*Phase: 01-omc-foundation*
*Context gathered: 2026-04-05*
