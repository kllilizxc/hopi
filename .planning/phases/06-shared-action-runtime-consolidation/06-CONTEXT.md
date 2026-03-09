# Phase 6: Shared Action Runtime Consolidation - Context

**Gathered:** 2026-03-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase consolidates Merge, Preview, and Init so they share one coherent runtime contract and product grammar across hub, shared types, and web surfaces.

The scope is consolidation, normalization, and extension seams — not adding new user capabilities. Merge, Preview, and Init should keep feeling like normal agent conversation flow, while the underlying runtime model becomes shared enough that future repo-defined actions can reuse it later.

This phase does **not** ship a generic custom action framework, a user-visible generic “Action” UI, or new repo capabilities beyond Merge, Preview, and Init.

</domain>

<decisions>
## Implementation Decisions

### User-facing framing
- Keep user-facing action names front-and-center: `Merge`, `Preview`, and `Init` should still read like distinct product actions.
- Consolidation should be mostly under the hood; users should not feel like HOPI suddenly became a generic automation console.
- Shared runtime chrome is good, but the primary label/title should stay action-specific.
- Future custom actions should be prepared mostly through internal seams in this phase, not through a new generic user-facing model yet.

### Shared lifecycle contract
- Use one shared **core lifecycle story** across Merge, Preview, and Init: queued/approval-pending, direct run, waiting, retrying, blocked, and success/terminal state.
- Exact visible states do **not** need to be identical if action-specific end states add clarity.
- Action-specific success words should remain visible where they help: for example Preview can still say `Ready` / `Stopped`, while Merge and Init keep action-native success wording.
- The shared contract should standardize the common envelope first and let each action map a small number of action-specific terminal states on top.

### Transcript style
- Action-triggered tool results should keep the same compact CLI-style transcript shape across Merge, Preview, and Init.
- The first direct repo-owned attempt should always appear in-thread before any repair prompt or hidden retry behavior.
- Success, failure, retry, and blocker transcript messages should follow one shared product grammar: short headline, key command/output context, then the next action.
- Blocked output should stay concise and include the exact manual next step when automation stops.
- Detailed execution stays in normal conversation messages; compact runtime summaries stay in task/chat chrome.

### Busy-session queueing and control behavior
- When the linked session is busy, the first direct action run should visibly queue and then auto-run once the session becomes idle.
- Queueing should not force the user through an extra manual chat step just to begin the direct attempt.
- Queue/approval-pending state should be visible in the same shared runtime vocabulary across actions.
- Cancel should exist when it is meaningful for the action/runtime state, but Phase 6 should not force identical controls where the action semantics differ.
- Auto-resume behavior should stay consistent: if the session becomes runnable, HOPI should perform the queued direct attempt automatically.

### Future extension posture
- Phase 6 should leave clean extension seams for future repo-defined actions, but without shipping the generic custom-action product surface now.
- Shared helpers, contracts, and message builders should be generic enough to reuse later.
- Planning and implementation may keep small action-specific adapters where they preserve clarity, but avoid re-copying the same runtime logic three times.

### Claude's Discretion
- Exact naming of the internal shared runtime types/helpers, as long as the product remains action-specific and the envelope becomes reusable.
- Exact split between shared builders and action-specific adapters in hub/web/shared.
- Exact wording of shared transcript/result templates, as long as they stay compact, CLI-style, and action-first.
- Exact control-surface factoring in web, as long as Merge/Preview/Init keep one product grammar and no rigid fixed workflow is introduced.

</decisions>

<specifics>
## Specific Ideas

- Generic model should stay mostly internal for now; avoid making the current UX feel like “one generic action engine” before custom actions actually ship.
- Recommended direction: **hybrid** — same runtime grammar and shared chrome, but action-specific names and action-specific success words stay visible.
- Preserve the already-proven product rule: direct result first, repair only after failure, blocker notes short and explicit.
- Preserve the project’s core value: actions should feel like normal agent work where the model sees real tool output and decides what to do next.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `shared/src/schemas.ts` already holds three very similar runtime contracts: `TaskMergeRuntimeSchema`, `TaskPreviewRuntimeSchema`, and `TaskInitRuntimeSchema`.
- `hub/src/web/routes/tasks.ts` already contains Merge and Preview runtime builders, queueing, result-message, blocker, and retry patterns that can be normalized.
- `hub/src/sync/taskSessionService.ts` already contains the Init direct-run/result/repair/blocker flow and can become part of the shared runtime layer instead of staying separate.
- `web/src/components/AssistantChat/HappyThread.tsx` already has a shared `StatusCard` chrome used by init/merge/preview summaries.
- `web/src/components/SessionChat.tsx` already proves one chat surface can host all three action summaries, though summary builders are still split.
- `web/src/hooks/mutations/useMergeTaskWorktree.ts`, `web/src/hooks/mutations/useTaskPreview.ts`, and `web/src/hooks/mutations/useStartTaskSession.ts` already show parallel cache-update patterns that can be normalized.

### Established Patterns
- Merge remains the reference runtime model: direct repo-owned attempt first, transcript-visible result, repair only when needed, durable runtime state, and repo-truth completion checks.
- Preview and Init already copied much of the same behavior, but each still has custom builders, status vocabulary, and control seams.
- The web already moved toward one product grammar: same compact status card pattern, durable task-backed summaries, and task/session rehydrate behavior.
- The project explicitly wants flexibility of agent-driven normal tool flow, not a rigid fixed workflow encoded in backend-only automation.

### Integration Points
- Shared runtime contracts/types: `shared/src/schemas.ts`, `shared/src/types.ts`
- Hub runtime orchestration: `hub/src/web/routes/tasks.ts`, `hub/src/sync/taskSessionService.ts`, `hub/src/sync/projectScripts.ts`, `hub/src/sync/autoRunScheduler.ts`
- Task persistence/relink safety: `hub/src/store/tasks.ts`, `hub/src/sync/sessionTaskLink.ts`
- Shared web presentation/control layer: `web/src/components/SessionChat.tsx`, `web/src/components/AssistantChat/HappyThread.tsx`, `web/src/hooks/mutations/*.ts`

### Current Tensions
- Runtime schemas are similar but not unified; Init notably lacks some queueing/cancel-oriented states that Merge/Preview already carry.
- Merge/Preview orchestration lives mostly in route code while Init orchestration lives mostly in `taskSessionService`, making consolidation awkward.
- UI chrome is partly unified, but summary builders, cache patchers, and action controls still duplicate product rules across actions.
- Future custom actions need a reusable envelope, but the current milestone must avoid over-exposing a generic model too early.

</code_context>

<deferred>
## Deferred Ideas

- Fully user-visible generic action model or “Action Center” UI.
- Generic custom action framework / manifests / repo-defined action registry as a shipped product capability.
- Script health checks, manifest validation, and drift self-tests.
- Any new action beyond Merge, Preview, and Init — including the future `ACTION-07` backlog item.

</deferred>

---
*Phase: 06-shared-action-runtime-consolidation*
*Context gathered: 2026-03-09*
