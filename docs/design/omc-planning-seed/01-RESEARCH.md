# Phase 1: OMC Foundation - Research

**Researched:** 2026-04-05
**Domain:** Message-driven operator shell for the OMC prototype
**Confidence:** HIGH for reuse boundaries inside this repo; MEDIUM for the exact assistant-ui extraction shape until implementation starts

<research_summary>
## Summary

The new Phase 1 should **not** continue the earlier board-first OMC foundation work. The repo now contains a clearer direction: OMC should behave like an operator inbox plus active-thread chat surface, with the left canvas acting as context only.

The strongest brownfield finding is that HOPI already has a solid chat stack in `web/`:

- `@assistant-ui/react`
- `@assistant-ui/react-markdown`
- a message runtime adapter
- a robust thread viewport
- a mature composer
- markdown rendering

So the best Phase 1 shape is **not** to keep extending the bespoke `omc-prototype` message panel. Instead:

1. define a first-class thread/message/lifecycle domain in the prototype store,
2. add a slim OMC-local assistant-ui runtime bridge,
3. rebuild the right rail as `Inbox + Active Thread`,
4. then strip primary decision controls out of the main canvas and make it context-first.

That gives the user the chat-app flexibility they asked for, while staying close to real product infrastructure instead of building a second fake chat system.
</research_summary>

<repo_findings>
## Repo Findings

### Existing HOPI chat foundation is already strong
- [web/package.json](/Users/realizer/Code/hopi/web/package.json) already includes `@assistant-ui/react` and `@assistant-ui/react-markdown`.
- [web/src/lib/assistant-runtime.ts](/Users/realizer/Code/hopi/web/src/lib/assistant-runtime.ts) already shows the key seam we need: app-specific messages can be converted into assistant-ui `ThreadMessageLike` records and driven through `useExternalStoreRuntime`.
- [web/src/components/AssistantChat/HappyThread.tsx](/Users/realizer/Code/hopi/web/src/components/AssistantChat/HappyThread.tsx) already solves thread viewport behavior, loading skeletons, scroll behavior, and chat rendering posture.
- [web/src/components/AssistantChat/HappyComposer.tsx](/Users/realizer/Code/hopi/web/src/components/AssistantChat/HappyComposer.tsx) already solves a lot of composer-level concerns such as drafts, key handling, and input management.
- [web/src/components/MarkdownRenderer.tsx](/Users/realizer/Code/hopi/web/src/components/MarkdownRenderer.tsx) already gives a repo-native markdown rendering seam for richer Agent messages.

### The current prototype message panel is architecturally too bespoke
- [omc-prototype/src/components/MessagePanel.tsx](/Users/realizer/Code/hopi/omc-prototype/src/components/MessagePanel.tsx) currently derives `ThreadSeed` view objects inside the component itself, so thread identity is ephemeral and coupled to render-time page context.
- The panel currently mixes:
  - route parsing
  - thread derivation
  - inbox grouping
  - conversation rendering
  - quick actions
  - freeform composer
  into one file.
- Current thread membership is still shaped by the left-side route context, which conflicts with the newly locked product rule that the message panel is the primary operator surface.

### Current prototype state is too shallow for a scalable inbox
- [omc-prototype/src/prototype/types.ts](/Users/realizer/Code/hopi/omc-prototype/src/prototype/types.ts) defines `PrototypeChatMessage`, but messages only carry `id`, `role`, `body`, `goalId`, and `threadId`.
- There is no first-class thread object, no lifecycle state, no unread marker, no stable created/updated timestamps, and no thread-level context record.
- [omc-prototype/src/prototype/store.tsx](/Users/realizer/Code/hopi/omc-prototype/src/prototype/store.tsx) stores chat as one flat array and caps it globally, which means one busy thread can crowd out another thread’s history.
- The current reducer is good enough as a mock behavior engine, but not yet as a durable thread model.

### Router shell is already the right seam
- [omc-prototype/src/router.tsx](/Users/realizer/Code/hopi/omc-prototype/src/router.tsx) already has the core shell we want:
  - left content area
  - right message rail
- That means Phase 1 does not need a routing rethink. It needs a better right rail and cleaner separation of concerns between the left canvas and the message surface.

### Main-canvas surfaces still own actions that should move to chat
- [omc-prototype/src/components/DashboardPanels.tsx](/Users/realizer/Code/hopi/omc-prototype/src/components/DashboardPanels.tsx) and related goal/execution pages still carry approval/risk/direction controls or control-adjacent patterns.
- Those controls now conflict with the locked context:
  - the main canvas should explain
  - the message panel should decide

</repo_findings>

<architecture_recommendation>
## Architecture Recommendation

### Recommended foundation
Use a **hybrid architecture**:

- custom inbox model and domain state owned by OMC
- assistant-ui owned active-thread conversation pane

That means:
- do **not** treat assistant-ui as the inbox framework
- do treat assistant-ui as the conversation runtime/rendering/composer framework

### Recommended runtime seam
Create an OMC-local runtime adapter similar in spirit to [web/src/lib/assistant-runtime.ts](/Users/realizer/Code/hopi/web/src/lib/assistant-runtime.ts):

- `OperatorThread` and `OperatorMessage` stay OMC domain objects
- a converter maps the active thread’s messages into assistant-ui messages
- the active thread pane is wrapped in an `AssistantRuntimeProvider`

This keeps the product-specific inbox state separate from the generic conversation rendering layer.

### Recommended thread model
Create first-class types for:

- `OperatorThread`
- `OperatorMessage`
- `ThreadLifecycleState`
- `QuickAction`
- `ThreadContextRef`

Thread identity should be topic-based, not route-based and not object-id-based alone.

Recommended thread types:
- `status`
- `approval`
- `risk`
- `direction`

### Recommended ownership split
- `prototype/store` owns:
  - thread creation
  - lifecycle transitions
  - quick-action results
  - thread reopening
  - goal/risk/approval derived effects
- `MessagePanel` owns:
  - inbox list composition
  - active thread rendering
  - message composer wiring
- left-side screens own:
  - context
  - navigation to relevant threads
  - no primary decision buttons

### Recommended styling/reuse posture
- Reuse patterns from `web` chat stack, not the exact components wholesale.
- Avoid importing `SessionChat` or `HappyThread` directly into `omc-prototype`; they are tied to broader app/runtime context and Tailwind-heavy styling assumptions.
- Prefer a slim local port:
  - assistant-ui runtime hookup
  - markdown renderer
  - minimal message bubble components
  - one composer

</architecture_recommendation>

<plan_recommendation>
## Recommended 3-Plan Split

### Plan 01-01 — Define operator thread domain and lifecycle
Focus: replace the current ad hoc thread derivation with first-class thread/message/lifecycle state.

Include:
- thread domain types
- per-thread message storage
- thread selectors and default-thread selection
- first-message contract generation
- lifecycle transitions: `pending / in-progress / waiting / silent / resolved`

Why first:
- every later UI decision depends on correct thread identity and lifecycle
- extending the current render-time `ThreadSeed` model would lock in the wrong architecture

### Plan 01-02 — Build the assistant-ui inbox and active-thread surface
Focus: replace the bespoke right rail with a scalable inbox + real chat conversation pane.

Include:
- add `@assistant-ui/react` and markdown deps to `omc-prototype`
- add an OMC-local thread runtime adapter
- build inbox sections for unresolved / handled / silent threads
- build one active-thread conversation pane with one composer
- thread-specific quick actions and markdown-capable Agent messages

Why second:
- once the thread model is correct, the largest UI rewrite can happen on top of a stable state seam

### Plan 01-03 — Demote the canvas to context and wire thread handoff
Focus: remove duplicated decision controls from the left canvas and make all real intervention happen in the message surface.

Include:
- remove primary approval/risk/direction controls from main views
- replace them with thread links / focus affordances
- surface thread status as metadata only
- ensure unresolved threads always outrank passive overview threads
- add basic mobile drawer behavior for the message surface

Why third:
- this cleanup is only safe after the replacement message surface exists

</plan_recommendation>

<validation_architecture>
## Validation Architecture

### What needs verification
- thread model is first-class and no longer derived ad hoc inside the message panel
- one active thread uses a normal chat composer and markdown-capable messages
- quick actions and freeform replies both update thread state and visible conversation
- main-canvas controls no longer duplicate thread actions
- unresolved threads win default selection over passive overview/status threads

### Best validation layers
- package type safety:
  - `bun run typecheck:omc-prototype`
- package build safety:
  - `bun run build:omc-prototype`
- manual behavior checks:
  1. open the prototype
  2. see unresolved threads listed separately from handled/silent
  3. open a thread and respond through quick action
  4. open a thread and respond through freeform text
  5. confirm lifecycle changes are visible
  6. confirm main pages no longer own the decision

### Important validation gap to plan for
There are currently no web tests for `omc-prototype`, so Phase 1 should expect manual behavior verification to remain important unless a light component test harness is added.

</validation_architecture>

<risks>
## Risks and Pitfalls

### Pitfall 1: continuing to retrofit the current MessagePanel
This preserves the wrong ownership boundary and makes thread identity depend on render-time page context.

### Pitfall 2: direct wholesale reuse of SessionChat
This would drag in session-first assumptions, broader runtime wiring, and styling baggage that the prototype does not need.

### Pitfall 3: keeping one global flat message log
This prevents stable thread history and will make a busy thread crowd out other intervention topics.

### Pitfall 4: using assistant-ui as the inbox model
assistant-ui is a strong conversation surface, but OMC still needs a custom topic inbox with domain-specific thread grouping and lifecycle behavior.

### Pitfall 5: leaving actions on the canvas during the transition
That will keep the product in an ambiguous state where the user never learns that the chat surface is the primary operator channel.

</risks>

<sources>
## Sources

### Primary repo sources
- [docs/design/omc-phase-01-context.md](/Users/realizer/Code/hopi/docs/design/omc-phase-01-context.md)
- [docs/design/omc-planning-seed/01-CONTEXT.md](/Users/realizer/Code/hopi/docs/design/omc-planning-seed/01-CONTEXT.md)
- [docs/design/factory-mode-ralph-gsd.md](/Users/realizer/Code/hopi/docs/design/factory-mode-ralph-gsd.md)
- [web/package.json](/Users/realizer/Code/hopi/web/package.json)
- [web/src/lib/assistant-runtime.ts](/Users/realizer/Code/hopi/web/src/lib/assistant-runtime.ts)
- [web/src/components/AssistantChat/HappyThread.tsx](/Users/realizer/Code/hopi/web/src/components/AssistantChat/HappyThread.tsx)
- [web/src/components/AssistantChat/HappyComposer.tsx](/Users/realizer/Code/hopi/web/src/components/AssistantChat/HappyComposer.tsx)
- [web/src/components/MarkdownRenderer.tsx](/Users/realizer/Code/hopi/web/src/components/MarkdownRenderer.tsx)
- [web/src/components/SessionChat.tsx](/Users/realizer/Code/hopi/web/src/components/SessionChat.tsx)
- [omc-prototype/src/components/MessagePanel.tsx](/Users/realizer/Code/hopi/omc-prototype/src/components/MessagePanel.tsx)
- [omc-prototype/src/prototype/store.tsx](/Users/realizer/Code/hopi/omc-prototype/src/prototype/store.tsx)
- [omc-prototype/src/prototype/types.ts](/Users/realizer/Code/hopi/omc-prototype/src/prototype/types.ts)
- [omc-prototype/src/router.tsx](/Users/realizer/Code/hopi/omc-prototype/src/router.tsx)

### External product references
- [assistant-ui thread docs](https://www.assistant-ui.com/docs/ui/thread)
- [assistant-ui context/runtime docs](https://www.assistant-ui.com/docs/guides/context-api)

</sources>
