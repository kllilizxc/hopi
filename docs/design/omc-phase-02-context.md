# Phase 2: Loop Orchestration - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning
**Source:** User discussion + `docs/design/factory-mode-ralph-gsd.md`

<domain>
## Phase Boundary

This phase turns the current OMC single-attempt thin slice into a real within-plan Ralph loop.

The scope is:

- repeated attempt execution inside the same `PLAN.md`
- deterministic attempt completion handling
- richer loop state transitions and retry policy handling
- stronger context-pack plumbing between attempts
- better attempt/evidence capture for retry and review
- explicit human takeover and resume-loop transitions

This phase should produce a system where one started plan can autonomously advance through multiple fresh attempts until it completes, blocks, hits retry limits, or is taken over by a human.

This phase does **not** include:

- automatic next-plan scheduling across multiple plans
- automatic merge
- embedded session/chat/terminal UI inside OMC-client
- multi-agent or multi-vendor orchestration UX
- replacing markdown planning truth with a structured planning store

</domain>

<decisions>
## Implementation Decisions

### Attempt completion contract
- Attempt completion is driven primarily by a **structured agent completion message**.
- The structured completion payload must include: `status`, `summary`, `changedFiles`, `checks`, and `nextSuggestedStep`.
- An attempt ends only when either:
  - the agent emits a valid structured completion message, or
  - the system detects a terminal runtime condition such as session exit, prompt dispatch failure, runner/machine loss, or explicit user cancel.
- OMC should **not** rely on idle timeout or manual "mark finished" confirmation to decide that an autonomous attempt is complete.

### Runtime abstraction
- Phase 2 remains **Codex-first**, but not `Codex`-locked.
- OMC loop orchestration must target a runtime adapter / wrapper abstraction rather than hard-coding the orchestration model to `codex exec`.
- `Codex` is the first and default runtime adapter implementation.
- Attempt lifecycle, context-pack contract, evidence model, and loop policy remain OMC-owned abstractions rather than vendor-specific ones.

### Loop policy and status transitions
- `progressed` should automatically trigger the next fresh attempt when:
  - the plan still has open checklist work,
  - the loop has not hit the total-attempt cap,
  - the run has not been escalated to review,
  - and runtime prerequisites are still available.
- `blocked` should move the plan directly into `Review`.
- `failed` should retry automatically until the already-decided policy escalates:
  - escalate after `3` consecutive failures,
  - stop after `5` total attempts in the same loop run.
- `completed` should always move into `Review`, never directly to merge.
- `canceled` should stop autonomous execution without auto-retrying; the plan can later be resumed manually.

### Human takeover and resume
- Human takeover should default to **reusing the current attempt session** when that session is still available.
- If the current session is unavailable, takeover should reuse the same plan worktree/branch and create a fresh human session there.
- During takeover, the plan stays in `Review`; takeover is represented through runtime metadata and actions rather than a new board column.
- OMC-client should initially deep-link takeover into the existing HOPI session UI rather than embed a new in-OMC session console.
- When returning from human intervention to autonomous execution, OMC should create a **new fresh autonomous attempt** under the **same loop run**.

### Attempt memory and evidence
- The next attempt inherits only a **minimal memory pack**:
  - `status`
  - `summary`
  - `failureFingerprint`
  - `changedFiles`
  - `checks`
  - `nextSuggestedStep`
- OMC should keep retry memory intentionally small; it should not pass full chat history, full logs, or full diffs into the next attempt.
- Evidence collected for review and debugging should include:
  - structured completion summary
  - checks result
  - changed files
  - lightweight diff summary
  - termination reason
- `changedFiles` and diff summaries should be **system-collected first**, with agent-reported values used as supporting data rather than the only source of truth.
- `failureFingerprint` should be **agent-first, system-fallback**:
  - use the agent-provided fingerprint when present,
  - otherwise derive a normalized fallback from runtime/check outcomes such as `checks-failed`, `prompt-dispatch`, `runner-offline`, `session-exited`, or `missing-signal`.

### the agent's Discretion
- Exact internal naming of the runtime adapter interface and adapter implementations.
- Exact shape of diff summaries and evidence payload objects, as long as they stay lightweight and review-friendly.
- Exact UI wording and badge treatment for takeover, paused loop, and runtime failure states.
- Exact mechanism for extracting changed files and git summaries from the current worktree/session.

</decisions>

<specifics>
## Specific Ideas

- Phase 2 should make the OMC runtime feel unmistakably Ralph-shaped: fresh attempt, structured completion, policy evaluation, then either next attempt or escalation.
- Automatic continuation belongs only on the `progressed` path; blocked work should be surfaced to the human quickly rather than retried blindly.
- Review and takeover should feel like explicit control-plane actions, not hidden session rescue paths.
- OMC-client should stay focused on orchestration and inspection; the existing HOPI session UI can continue to handle deep interactive agent control for now.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and phase definition
- `docs/design/factory-mode-ralph-gsd.md` — primary OMC design document covering Ralph loop posture, board model, runtime abstractions, and v1/v2 constraints
- `docs/design/omc-phase-01-context.md` — locked Phase 1 decisions that Phase 2 builds on
- `docs/design/omc-phase-02-context.md` — locked Phase 2 decisions for loop orchestration, runtime abstraction, retry flow, and takeover behavior

### OMC planning mirror
- `docs/design/omc-planning-seed/ROADMAP.md` — OMC roadmap and official Phase 2 scope statement
- `docs/design/omc-planning-seed/REQUIREMENTS.md` — requirements `OMC-02` through `OMC-06`
- `docs/design/omc-planning-seed/02-CONTEXT.md` — mirror copy of this Phase 2 context for repo-local planning consumption

### Existing platform context
- `README.md` — HOPI product framing and package boundaries
- `cli/README.md` — CLI/runtime integration boundaries relevant to agent adapters
- `hub/README.md` — backend/API/realtime capabilities available to OMC runtime orchestration
- `web/README.md` — existing HOPI session UI and route patterns relevant to takeover deep-linking

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `hub/src/sync/omc/attemptRunner.ts` already owns plan start, session spawn, worktree reuse, and first-attempt setup; it is the natural seam for promoting single-attempt flow into multi-attempt loop orchestration.
- `hub/src/sync/omc/contextPackBuilder.ts` already defines a deterministic context pack with previous-attempt memory, operating rules, and output contract scaffolding.
- `hub/src/sync/omc/runtimeStore.ts` already persists `attemptCount`, `consecutiveFailureCount`, `currentLoopRunId`, `reviewRequired`, attempts, and evidence; Phase 2 can deepen orchestration behavior without inventing a new persistence model.
- `hub/src/sync/omc/evidenceCollector.ts` already provides a normalized way to append evidence entries and broadcast realtime events.
- `hub/src/web/routes/omc.ts` already exposes plan detail, attempt detail, and manual start endpoints that can be expanded into loop-control endpoints.
- `OMC-client/src/routes/programs/plan.tsx` and `OMC-client/src/components/AttemptInspector.tsx` already provide an execution-first surface that can absorb loop status, retry, takeover, and resume actions.
- Existing HOPI session routes under `web/src/routes/sessions/` can act as the first takeover target instead of building a new embedded session surface inside OMC-client.

### Established Patterns
- OMC already treats attempts and evidence as first-class runtime records rather than hidden chat/session internals.
- Current OMC board columns are intentionally few: `Planning`, `Running`, `Review`, `Done`; Phase 2 should keep that low-column posture and express richer states through metadata, badges, and actions.
- HOPI already has mature session control primitives; OMC should compose them rather than duplicate a full session shell inside its own frontend.

### Integration Points
- Runtime adapter layer around current attempt execution flow
- Session/message parsing to detect structured attempt completion
- Git/worktree inspection for changed-file and diff-summary evidence
- OMC plan detail actions for retry, takeover, resume, and review transitions
- Realtime updates for loop state, attempt completion, and review escalation

</code_context>

<deferred>
## Deferred Ideas

- Automatic next-plan scheduler across the board
- Automatic merge after review/evidence passes
- Embedded OMC-native chat/terminal/session console
- Full multi-vendor runtime management UI beyond the adapter seam
- Heavyweight evidence analysis, long-log mining, or full diff archival in context packs

</deferred>

---
*Phase: 02-loop-orchestration*
*Context gathered: 2026-03-29*
