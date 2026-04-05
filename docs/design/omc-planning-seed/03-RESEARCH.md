# Phase 3: Review and Merge Cockpit - Research

**Researched:** 2026-03-30
**Domain:** Brownfield evolution of OMC from loop orchestration into explicit review, merge-packet, and merge-decision control
**Confidence:** HIGH for repo-grounded review/merge seams, OMC runtime/store changes, and direct git merge reuse; MEDIUM for the final field/module names until implementation starts

<research_summary>
## Summary

Phase 2 already delivered the hardest part of the Ralph side of OMC: the product now has plan runtimes, attempts, evidence, retry policy, takeover, and live updates. Phase 3 therefore does **not** need a new orchestration engine. It needs a **review and landing domain** layered on top of the existing plan runtime.

The most important brownfield fact is this: **HOPI already has the git merge primitives OMC needs, but OMC does not yet have the product contract around them.** `SyncEngine` already exposes `gitMergeWorktreeState` and `gitMergeWorktree`; the task/worktree routes already know how to reason about blocked merges, conflicts, and operator-driven retries; and OMC already persists `reviewRequired` plus `mergeApprovedAt`. What is missing is:

1. an explicit OMC review/merge contract in shared types and runtime storage,
2. a merge-packet builder that compresses plan evidence into one decision surface,
3. review/merge endpoints that stay native to OMC instead of dropping straight into ad hoc task/session flows,
4. a dedicated OMC review cockpit route and client actions,
5. conflict-aware merge handling that stays in `Review` and leads into takeover instead of silently jumping states.

That means the safest Phase 3 shape is:

1. seed review/merge packet contracts and review APIs,
2. implement real merge approval execution plus conflict/block handling through existing git RPCs,
3. surface a decision-first review cockpit in `OMC-client` with live review/merge updates.

This keeps the phase tightly aligned to the locked Phase 3 context: explicit human review, decision-first merge packets, `Resume loop` vs `Back to planning`, and conflict resolution that stays in review posture.
</research_summary>

<repo_findings>
## Repo Findings

### OMC runtime has only the first merge foothold, not a full review/merge domain
- `shared/src/schemas.ts` and `hub/src/sync/omc/runtimeStore.ts` already include:
  - `reviewRequired`
  - `mergeApprovedAt`
- But there is no explicit OMC type or field for:
  - merge packet payload,
  - merge status,
  - merge-blocked reason,
  - conflict details,
  - review approval timestamp distinct from merge approval,
  - review/merge SSE events.
- Phase 3 should therefore start by promoting review/merge concepts to first-class OMC contracts instead of trying to infer them from `reviewRequired` plus evidence text.

### OMC route surface stops at loop control
- `hub/src/web/routes/omc.ts` currently exposes:
  - `start`
  - `retry`
  - `resume`
  - `takeover`
  - `cancel`
  - plan and attempt detail reads
- There are no OMC-native endpoints yet for:
  - review approval,
  - reopening review to running/planning,
  - merge packet retrieval,
  - merge approval / merge retry.
- This makes OMC runtime-visible but not review-operable.

### OMC already has the right execution home for a hybrid review posture
- `OMC-client/src/routes/programs/plan.tsx` is already an execution-first runtime page.
- `OMC-client/src/components/AttemptInspector.tsx` already surfaces context pack, evidence, checks, changed files, and stop reason.
- `OMC-client/src/router.tsx` currently has only:
  - program list
  - board
  - plan detail
  - attempt detail
- That means Phase 3 can add a new dedicated review route without undoing the current IA. The plan page should stay the runtime home; the new cockpit should become the decision surface.

### Direct git merge primitives already exist and fit OMC better than task-specific merge scripts
- `hub/src/sync/rpcGateway.ts` and `hub/src/sync/syncEngine.ts` already expose:
  - `gitMergeWorktreeState`
  - `gitMergeWorktree`
  - `getGitDiffNumstat`
  - `getGitDiffFile`
- `hub/src/web/routes/tasks.ts` already proves the platform knows how to:
  - check whether a worktree can merge,
  - distinguish merge-state failures from true conflicts,
  - treat conflicts as explicit operator work,
  - keep blocked merge flows visible instead of silent.
- OMC should reuse those git RPCs and merge-state patterns directly rather than depending on task/project IDs or legacy merge-script assumptions.

### Existing task merge UX contains operator-state patterns worth borrowing, not copying wholesale
- `web/src/lib/task-action-runtime.ts` already has a stable operational vocabulary for merge-like states:
  - busy
  - blocked
  - approval pending
  - succeeded
  - canceled
- OMC should borrow that clarity for review/merge badges and summaries.
- But OMC should **not** collapse back into the task/session product model; it needs its own plan-level review cockpit and merge packet language.

### OMC live updates need two more event families
- `hub/src/sync/omc/events.ts` currently emits:
  - `omc-program-updated`
  - `omc-plan-runtime-updated`
  - `omc-attempt-added`
  - `omc-attempt-updated`
  - `omc-evidence-added`
- `OMC-client/src/hooks/useOmcEvents.ts` only invalidates for those events.
- Phase 3 needs at least:
  - `omc-review-updated`
  - `omc-merge-updated`
- Without them, review approval, merge readiness, blocked merge state, and merge success will feel stale or mutation-only.

### Conflict handling should stay in Review and reuse takeover on the same worktree
- The locked context says conflicts are not “go back to running” events.
- OMC already stores session linkage per attempt and already deep-links takeover into the existing HOPI session UI.
- That makes conflict handling straightforward in product terms:
  - keep the plan in `Review`,
  - surface `merge-blocked: conflict`,
  - show conflict file list,
  - make `Resolve conflicts` the primary CTA,
  - reuse takeover on the same worktree/session when possible.
</repo_findings>

<plan_recommendation>
## Recommended Plan Decomposition

### Plan 03-01 — Add review/merge contracts, merge packet builder, and review APIs
Focus: make review and merge-packet data first-class OMC concepts before trying to execute a merge.

Include:
- new shared/runtime types for review state, merge state, and merge packet payloads
- runtime store/schema updates for review approval and merge-blocked metadata
- merge-packet builder backed by plan runtime, evidence, and worktree state
- OMC review APIs for:
  - `review/approve`
  - `review/reopen`
  - `merge-packet`
- OMC review/merge SSE events

Why first:
- the UI and merge executor need a stable contract to talk about review and merge state
- merge packet and review APIs are the Phase 3 equivalent of Phase 2’s attempt-outcome contract

### Plan 03-02 — Implement merge approval execution and conflict-aware review handling
Focus: turn review approval into a real merge action using existing git merge primitives, while keeping failures in review posture.

Include:
- a dedicated OMC review/merge controller
- precondition checks before merge approval
- actual merge execution through `gitMergeWorktreeState` and `gitMergeWorktree`
- success handling that marks the plan done/merged
- blocked/conflict handling that keeps the plan in `Review`
- conflict evidence and takeover linkage

Why second:
- merge execution depends on the contracts and review APIs from Plan 03-01
- the user explicitly wants merge failures and conflicts treated as operator decisions, so this logic belongs server-side before UI work grows around it

### Plan 03-03 — Build the review cockpit and decision-first merge UX in OMC-client
Focus: make review and merge decisions feel native in OMC.

Include:
- new review cockpit route
- client methods for review/merge APIs
- decision-first merge packet layout
- review actions:
  - `Approve review`
  - `Approve merge`
  - `Resume loop`
  - `Back to planning`
  - `Retry merge`
  - `Resolve conflicts`
  - `Take over`
- board/detail badges for ready-to-merge, merge-blocked, and conflict
- live invalidation for review/merge events

Why third:
- the cockpit should sit on top of real contracts and real merge behavior, not fake them locally
- this plan converts the new review/merge backend into a true operator experience
</plan_recommendation>

<validation_architecture>
## Validation Architecture

### What needs verification
- OMC can build a merge packet that includes branches, worktree identity, checks summary, changed-files summary, blockers/warnings, and preconditions
- review approval and reopen transitions update runtime state cleanly
- merge approval uses the existing git merge RPCs rather than ad hoc shell behavior
- ordinary merge failures remain in `Review` as merge-blocked states
- conflicts remain in `Review`, surface conflict files, and lead into takeover
- the new review cockpit is decision-first and stays live as review/merge state changes

### Best validation layers
- targeted OMC hub tests:
  - `cd hopi && bun test hub/src/web/routes/omc.test.ts hub/src/sync/omc/*.test.ts`
- hub/shared type safety:
  - `cd hopi && bun run typecheck:hub`
  - `cd hopi && bun run typecheck`
- OMC-client safety:
  - `cd hopi && bun run typecheck:omc`
  - `cd hopi && bun run build:omc`

### Important baseline note
- Full `cd hopi && bun run test:hub` is currently red for two unrelated historical failures in `hub/src/web/routes/tasks.start-session.test.ts`.
- Phase 3 should therefore gate on targeted OMC hub suites plus typechecks/builds until that unrelated baseline is repaired.

### Suggested phase gate
- `cd hopi && bun test hub/src/web/routes/omc.test.ts hub/src/sync/omc/*.test.ts`
- `cd hopi && bun run typecheck`
- `cd hopi && bun run typecheck:omc`
- `cd hopi && bun run build:omc`
- manual smoke path:
  1. move one plan into `Review`,
  2. open the review cockpit,
  3. approve review and inspect merge packet,
  4. attempt a merge success path,
  5. attempt a blocked/conflict path,
  6. resolve conflicts through takeover and return to OMC.

### Important validation gap to plan for
The most important behaviors here are operator-state correctness and merge-state correctness. Phase 3 should therefore include focused hub tests that simulate:
- review approval,
- reopen to `Running`,
- reopen to `Planning`,
- merge success,
- merge-blocked failure,
- merge conflict with conflict file reporting.
</validation_architecture>

<risks>
## Risks and Pitfalls

### Pitfall 1: forcing merge semantics into existing loop-only runtime fields
If Phase 3 tries to encode review/merge state only through `reviewRequired`, `mergeApprovedAt`, and evidence text, the UI will end up inferring too much and the runtime contract will stay brittle.

### Pitfall 2: coupling OMC merge flows to task/project assumptions
The task/worktree merge routes are useful reference implementations, but OMC should not inherit task IDs, task statuses, or project merge-script assumptions that do not fit a plan-level runtime.

### Pitfall 3: letting merge failure silently auto-decide the next path
The user explicitly chose operator-visible `merge-blocked` states. Auto-resuming the loop or auto-taking-over on failure would weaken the review gate immediately.

### Pitfall 4: treating conflicts like generic merge failures
Conflict handling needs its own product language and evidence. If conflict files are not surfaced and `Resolve conflicts` is not a first-class action, the review cockpit will feel blind.

### Pitfall 5: burying the merge verdict under too much timeline detail
The user explicitly wants decision-first review. If the first screenful is mostly attempt history and log detail, the cockpit will fail its core job.

### Pitfall 6: forgetting live review/merge invalidation
Review approval, blocked merge state, and merge success are not local-only mutations. Without dedicated review/merge event invalidation, OMC will feel stale again.
</risks>

<sources>
## Sources

### Primary
- `docs/design/factory-mode-ralph-gsd.md`
- `docs/design/omc-phase-01-context.md`
- `docs/design/omc-phase-02-context.md`
- `docs/design/omc-phase-03-context.md`
- `docs/design/omc-planning-seed/ROADMAP.md`
- `docs/design/omc-planning-seed/REQUIREMENTS.md`
- `docs/design/omc-planning-seed/STATE.md`
- `docs/design/omc-planning-seed/03-CONTEXT.md`
- `AGENTS.md`
- `README.md`
- `hub/README.md`
- `web/README.md`
- `OMC-client/src/router.tsx`
- `OMC-client/src/api/client.tsx`
- `OMC-client/src/routes/programs/plan.tsx`
- `OMC-client/src/hooks/useOmcEvents.ts`
- `OMC-client/src/components/AttemptInspector.tsx`
- `shared/src/schemas.ts`
- `shared/src/types.ts`
- `hub/src/sync/omc/runtimeStore.ts`
- `hub/src/sync/omc/loopController.ts`
- `hub/src/sync/omc/events.ts`
- `hub/src/web/routes/omc.ts`
- `hub/src/web/routes/omc.test.ts`
- `hub/src/sync/rpcGateway.ts`
- `hub/src/sync/syncEngine.ts`
- `hub/src/web/routes/tasks.ts`
- `hub/src/sync/projectScripts.ts`
- `web/src/lib/task-action-runtime.ts`
- `cli/src/modules/common/handlers/git.ts`

### Notes
- Research performed by direct repo inspection against the repo-local OMC planning mirror because the external GSD workspace is not writable in this sandbox.
- The main Phase 3 leverage comes from lifting review/merge into explicit OMC contracts and reusing existing git merge primitives, not from inventing a second merge infrastructure.
</sources>
