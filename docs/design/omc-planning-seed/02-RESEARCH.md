# Phase 2: Loop Orchestration - Research

**Researched:** 2026-03-30
**Domain:** Brownfield evolution of OMC from a single manual attempt into a true within-plan Ralph loop
**Confidence:** HIGH for repo-grounded orchestration seams, loop-policy storage, session takeover reuse, and git-based evidence collection; MEDIUM for the exact final file/module names until implementation starts

<research_summary>
## Summary

Phase 1 already built the hardest prerequisite for Phase 2: OMC now has a native plan-oriented runtime model instead of hiding everything inside task/session UI. The codebase already persists plan runtimes, attempts, and evidence; it already starts one Codex-backed attempt; and it already renders execution-first plan/attempt surfaces. Phase 2 therefore does **not** need new platform infrastructure. It needs an orchestration layer.

The most important brownfield fact is this: **all of the signal paths needed for a Ralph loop already exist, but they are disconnected from OMC policy.** Session messages enter through `hub/src/socket/handlers/cli/sessionHandlers.ts`, session liveness changes already flow through CLI handlers and `SyncEngine`, attempts already store `attemptCount`, `consecutiveFailureCount`, `reviewRequired`, and `currentLoopRunId`, and git diff/status RPCs already exist for session/worktree inspection. The safest fit is an event-driven OMC loop subscriber on the hub event bus rather than route-local orchestration or UI polling. That means the safest Phase 2 shape is:

1. add a runtime-adapter seam so OMC orchestration is not hard-coded to Codex,
2. normalize attempt outcomes from structured agent completion messages plus terminal runtime failures,
3. add an event-driven OMC loop automation/controller that decides retry / review / done transitions,
4. collect lightweight system evidence (changed files, diff summary, termination reason),
5. expose review/takeover/resume actions in OMC-client while deep-linking to the existing HOPI session UI and subscribing to loop updates live.

This keeps the phase tightly aligned to the locked Phase 2 context: real Ralph loop behavior within one plan, human review still explicit, and no premature embedded terminal or multi-plan scheduler.
</research_summary>

<repo_findings>
## Repo Findings

### OMC already has the right persistence model for loop orchestration
- `hopi/hub/src/sync/omc/runtimeStore.ts` already persists:
  - per-plan board/runtime state,
  - `attemptCount`,
  - `consecutiveFailureCount`,
  - `currentLoopRunId`,
  - `reviewRequired`,
  - attempt records,
  - evidence records.
- This means Phase 2 can deepen orchestration behavior without inventing another store or replacing the current OMC model.

### Attempt start is real, but completion handling is still missing
- `hopi/hub/src/sync/omc/attemptRunner.ts` already:
  - selects a machine,
  - spawns a session,
  - reuses a plan worktree when present,
  - builds a deterministic context pack,
  - sends it into Codex,
  - marks the plan as `Running`.
- But it currently stops there; no service yet turns later session output into `progressed`, `blocked`, `completed`, or `failed` attempt outcomes.

### The completion-signal seam already exists in session message ingress
- `hopi/hub/src/socket/handlers/cli/sessionHandlers.ts` is the first normalized path where agent messages enter the hub.
- It already:
  - parses the incoming payload,
  - stores it in `messages`,
  - emits a `message-received` realtime event.
- That makes it the most natural brownfield seam for an OMC completion parser or for emitting a hook that an OMC loop controller can subscribe to.
- `hopi/shared/src/messages.ts` already exposes role-wrapper helpers that can reduce message-shape branching when parsing structured completion payloads.
- `TaskAutomation` already proves that hub-side subscriber automation is an established pattern; OMC should follow that style instead of inventing route-local orchestration.

### Session lifecycle and takeover reuse are already platform strengths
- Attempts already store `sessionId`.
- `SyncEngine.resumeSession` and the existing session-first web product already know how to reopen and continue a session.
- `web/src/routes/sessions/terminal.tsx` and related session routes provide a complete human-control surface that OMC can deep-link to instead of rebuilding chat/terminal UI in this phase.

### System-collected evidence is feasible with existing git RPCs
- `SyncEngine` already exposes `getGitStatus`, `getGitDiffNumstat`, and `getGitDiffFile`, each with session-aware RPC and machine fallback.
- `hub/src/web/routes/git.ts` shows these are already stable platform capabilities.
- `hub/src/web/routes/tasks.ts` already captures a lightweight diff snapshot after worktree merge using `getGitDiffNumstat`.
- That gives Phase 2 a clear brownfield pattern for collecting changed-file summaries and diff evidence without scraping chat output.

### OMC UI already has an execution-first shell worth extending
- `OMC-client/src/routes/programs/plan.tsx` already treats runtime control as the top section.
- `OMC-client/src/components/AttemptInspector.tsx` already exposes:
  - context pack,
  - changed files,
  - evidence,
  - checks,
  - timeline.
- Phase 2 can therefore focus on richer loop controls and review/takeover visibility instead of redesigning the whole OMC IA.
- But `OMC-client` does not yet subscribe to SSE or realtime invalidation, so autonomous follow-up attempts would currently be invisible until manual refresh. Phase 2 should add OMC-side live update handling.

### The adapter boundary matters now, not later
- Phase 1 is currently Codex-shaped in `attemptRunner.ts`.
- The locked Phase 2 decision says OMC must remain Codex-first but not Codex-only.
- Therefore the runtime adapter seam should be introduced before deeper loop-policy logic grows around direct Codex assumptions.
</repo_findings>

<plan_recommendation>
## Recommended Plan Decomposition

### Plan 02-01 — Add runtime adapter and loop-automation foundation
Focus: make OMC understand when an autonomous attempt is finished and route that signal into an event-driven OMC automation layer.

Include:
- runtime adapter interface/wrapper owned by OMC
- first `Codex` runtime adapter implementation
- structured completion payload parsing
- runtime/system fallback termination handling
- an OMC loop automation subscriber wired into existing hub events

Why first:
- nothing else in Phase 2 works until OMC can deterministically tell when an attempt ended and what the result was
- this is also where the Codex-first but not Codex-only decision should be made concrete

### Plan 02-02 — Build loop policy engine and system evidence harvesting
Focus: take normalized attempt outcomes and drive real Ralph loop transitions.

Include:
- loop policy evaluation for `progressed`, `blocked`, `failed`, `completed`, `canceled`
- retry budget / failure budget handling
- automatic next-attempt triggering when the policy allows it
- system-collected changed-file and diff-summary evidence
- loop-control endpoints for retry/resume/takeover/review actions

Why second:
- once attempt outcomes are normalized, OMC can finally behave like a loop rather than a one-shot launcher
- evidence harvesting belongs here because retry/review policy depends on reliable attempt artifacts

### Plan 02-03 — Surface live loop control, takeover, and review state in OMC-client
Focus: make the new orchestration model legible and operable from the OMC UI.

Include:
- richer runtime badges and loop state in plan detail / board
- action hierarchy for `Take over`, `Resume loop`, `Open session`, `Retry`
- attempt inspector additions for termination reason, diff summary, and retry memory
- takeover deep-link into existing HOPI session routes

Why third:
- it depends on the backend/runtime semantics being real first
- this plan converts the new orchestration engine into a usable control plane
</plan_recommendation>

<validation_architecture>
## Validation Architecture

### What needs verification
- OMC can parse a structured attempt completion payload from stored session messages
- runtime/system failure paths mark attempts and plan runtimes consistently
- loop policy correctly decides auto-continue vs review escalation vs done
- changed files and diff summaries can be gathered from the session/worktree without relying only on agent self-report
- takeover/resume actions remain legible and do not require a new embedded terminal UI

### Best validation layers
- hub/runtime unit and route coverage:
  - `cd hopi && bun run test:hub`
- shared/hub type safety:
  - `cd hopi && bun run typecheck:hub`
- OMC-client route/build validation:
  - `cd hopi && bun run typecheck:omc`
  - `cd hopi && bun run build:omc`

### Suggested phase gate
- `cd hopi && bun run test:hub`
- `cd hopi && bun run typecheck:hub`
- `cd hopi && bun run typecheck:omc`
- `cd hopi && bun run build:omc`
- manual smoke path:
  1. start one plan loop,
  2. observe one attempt complete with structured status,
  3. observe either auto-next-attempt or review escalation,
  4. deep-link into takeover session,
  5. return to OMC and resume the loop.

### Important validation gap to plan for
The core behavior here is state-machine correctness across async session events. Phase 2 should therefore include focused hub tests that simulate:
- message arrival,
- session end,
- failure escalation,
- and auto-triggered follow-up attempts.
</validation_architecture>

<risks>
## Risks and Pitfalls

### Pitfall 1: parsing completion output too loosely
If OMC tries to infer completion from vague natural-language responses or idle timeouts, the loop will be noisy and brittle immediately.

### Pitfall 2: baking Codex assumptions into the orchestration core
If the loop controller knows too much about `codex exec` specifics, Phase 2 will violate the locked adapter decision and make later runtime support expensive.

### Pitfall 3: letting retry memory grow without discipline
If each next attempt inherits full logs or entire diffs, context packs will bloat and loop quality will degrade.

### Pitfall 4: treating `blocked` like `failed`
The user explicitly wants blocked work to escalate to humans; retrying blocked work like transient failure would create empty loops.

### Pitfall 5: rebuilding session UI inside OMC too early
The existing HOPI session UI is already strong. Trying to rebuild chat/terminal inside OMC in this phase would burn scope without improving the loop engine itself.

### Pitfall 6: collecting evidence only from agent self-report
The codebase already has git inspection RPCs. Ignoring them would miss the chance to ground evidence in real worktree state.
</risks>

<sources>
## Sources

### Primary
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/phases/01-omc-foundation/01-CONTEXT.md`
- `.planning/phases/02-loop-orchestration/02-CONTEXT.md`
- `hopi/AGENTS.md`
- `hopi/README.md`
- `hopi/cli/README.md`
- `hopi/hub/README.md`
- `hopi/web/README.md`
- `hopi/docs/design/factory-mode-ralph-gsd.md`
- `hopi/docs/design/omc-phase-01-context.md`
- `hopi/docs/design/omc-phase-02-context.md`
- `hopi/hub/src/sync/omc/attemptRunner.ts`
- `hopi/hub/src/sync/omc/contextPackBuilder.ts`
- `hopi/hub/src/sync/omc/runtimeStore.ts`
- `hopi/hub/src/sync/omc/evidenceCollector.ts`
- `hopi/hub/src/web/routes/omc.ts`
- `hopi/hub/src/web/routes/git.ts`
- `hopi/hub/src/web/routes/tasks.ts`
- `hopi/hub/src/socket/handlers/cli/sessionHandlers.ts`
- `hopi/hub/src/sync/messageService.ts`
- `hopi/hub/src/sync/syncEngine.ts`
- `hopi/shared/src/messages.ts`
- `hopi/OMC-client/src/routes/programs/plan.tsx`
- `hopi/OMC-client/src/components/AttemptInspector.tsx`
- `hopi/web/src/hooks/useSSE.ts`
- `hopi/web/src/routes/sessions/terminal.tsx`

### Notes
- Research performed by direct repo inspection against the repo-local OMC planning mirror because the external GSD workspace is not writable in this sandbox.
- The main Phase 2 engineering leverage comes from reconnecting already-existing hub/session/git primitives to OMC policy, not from inventing new infrastructure.
</sources>
