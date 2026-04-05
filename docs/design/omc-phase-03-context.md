# Phase 3: Review and Merge Cockpit - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** User discussion + `docs/design/factory-mode-ralph-gsd.md`

<domain>
## Phase Boundary

This phase makes review, merge packets, and explicit merge decisions native OMC runtime concepts.

The scope is:

- a dedicated review cockpit for plans that reach `Review`
- merge-packet generation backed by OMC attempts, evidence, and worktree state
- explicit review decisions such as approve, resume loop, and send back to planning
- explicit merge approval and merge execution from OMC
- conflict-aware merge handling inside the OMC review posture

This phase should produce a control surface where a human can review one completed or blocked `PLAN.md`, inspect the evidence and merge packet, choose the right next action, and land the work without dropping into ad hoc session-driven workflows.

This phase does **not** include:

- default automatic merge
- automatic state-jumping repair after merge failure
- a rich embedded conflict editor inside OMC-client
- automatic planning bootstrap or planning creation flows
- cross-plan global review queue orchestration

</domain>

<decisions>
## Implementation Decisions

### Review cockpit shape
- Phase 3 should use a **hybrid review posture**.
- Existing plan detail remains the runtime overview and history surface.
- A new dedicated review cockpit route should handle human review, merge packet inspection, and merge/reopen decisions.
- OMC should not force all runtime detail into the review cockpit; the plan page remains the long-running execution home.

### Merge packet posture
- Merge packet presentation should be **decision-first**, not diff-first.
- The top of the review cockpit should emphasize:
  - review verdict posture
  - blockers and warnings
  - required checks summary
  - target/source branch and worktree identity
  - attempt count
  - changed-files summary
- Diff summary, evidence timeline, and lower-level artifacts should stay available below the fold for deeper inspection.

### Review decisions and reopen semantics
- `Review` should expose two explicit reopen-style actions rather than one ambiguous reopen button.
- `Resume loop` means the plan remains valid and should re-enter autonomous execution, returning the card to `Running`.
- `Back to planning` means the plan/checklist/acceptance needs human revision first, returning the card to `Planning`.
- Review approval and merge approval remain distinct actions; approving the review does not implicitly perform the merge.

### Merge failure handling
- Ordinary merge failures should remain in `Review` and be represented as `merge-blocked`, not automatically jump the card back to `Running`.
- OMC should surface merge failure as an operator decision point with explicit next actions such as:
  - `Retry merge`
  - `Take over`
  - `Resume loop`
  - `Back to planning`
- Merge failure should not silently weaken the human review gate by auto-deciding a repair path.

### Conflict handling
- Merge conflicts are a special case of merge-blocked state: `merge-blocked: conflict`.
- Conflict handling should stay inside the `Review` posture rather than moving the card to a different board column.
- When conflicts are detected, the review cockpit should surface:
  - a clear conflict warning
  - the conflict file list
  - source/target branch context
  - worktree/session identity
- The primary action for conflicts should be `Resolve conflicts`, which reuses the existing takeover/session path on the same worktree.
- OMC should not automatically resume the Ralph loop or auto-fall back to `Running` just because the merge hit conflicts.

### the agent's Discretion
- Exact route structure and naming for the review cockpit.
- Exact visual hierarchy of review summary, merge packet, diff summary, and evidence sections.
- Exact badge names for merge-blocked, conflict, approved, and ready-to-merge states.
- Exact policy for which merge-state fields are elevated into top-level badges versus secondary metadata.

</decisions>

<specifics>
## Specific Ideas

- The review cockpit should feel like an operator decision surface, not another generic detail page.
- Humans should be able to answer "Can I merge this?" within the first screenful.
- Conflict handling should feel urgent and guided, but still explicit and operator-controlled.
- Merge packet should compress Ralph loop history into a merge-ready story: what changed, what passed, what still worries the system.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and phase definition
- `docs/design/factory-mode-ralph-gsd.md` — primary OMC design document covering review posture, merge packet expectations, human gate policy, and suggested Phase 3 APIs
- `docs/design/omc-phase-01-context.md` — locked Phase 1 decisions for board model, execution posture, and markdown-first planning
- `docs/design/omc-phase-02-context.md` — locked Phase 2 decisions for loop orchestration, retry policy, takeover, and evidence posture
- `docs/design/omc-phase-03-context.md` — locked Phase 3 decisions for review cockpit, merge packet hierarchy, reopen semantics, and conflict handling

### OMC planning mirror
- `docs/design/omc-planning-seed/ROADMAP.md` — official Phase 3 scope statement
- `docs/design/omc-planning-seed/REQUIREMENTS.md` — requirements `OMC-05` and `OMC-06`
- `docs/design/omc-planning-seed/STATE.md` — current repo-mirror execution state showing Phase 2 complete and Phase 3 ready for discuss/plan
- `docs/design/omc-planning-seed/03-CONTEXT.md` — mirror copy of this Phase 3 context for repo-local planning consumption

### Existing platform context
- `README.md` — package boundaries and overall HOPI runtime model
- `hub/README.md` — backend/API/realtime capabilities to reuse for review and merge operations
- `web/README.md` — existing route and frontend patterns to borrow selectively for cockpit navigation

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `OMC-client/src/routes/programs/plan.tsx` already works as an execution-first runtime overview and should remain the main runtime home while Phase 3 adds a dedicated review cockpit.
- `OMC-client/src/components/AttemptInspector.tsx` already exposes context packs, evidence, changed files, and stop reasons; the review cockpit can reuse this evidence posture rather than inventing a second inspection model.
- `hub/src/web/routes/omc.ts` already owns OMC plan control endpoints and is the natural place to add review approval, reopen, merge packet, and merge approval routes.
- `hub/src/sync/omc/runtimeStore.ts` already persists `reviewRequired` and `mergeApprovedAt`, giving Phase 3 a natural persistence seam for review/merge state.
- `hub/src/web/routes/tasks.ts` already contains mature worktree merge orchestration, merge-state checks, and merge error handling that can be adapted instead of reimplemented from scratch.
- `hub/src/sync/projectScripts.ts` and `hub/src/sync/rpcGateway.ts` already expose merge script and git merge primitives usable by OMC merge approval flows.
- `cli/src/modules/common/handlers/git.ts` already provides git merge and merge-state RPC handlers that OMC can stand on.

### Established Patterns
- HOPI already distinguishes busy, blocked, approval-pending, succeeded, and canceled runtime states for merge-like actions; OMC should borrow that operational clarity rather than inventing opaque merge statuses.
- OMC already treats `Review` as a board column and richer runtime meaning as metadata and actions, not new columns.
- Existing task merge UX favors explicit operator actions after blocked states; Phase 3 should preserve that explicitness in OMC.

### Integration Points
- New OMC review cockpit route in `OMC-client`
- New OMC review/merge endpoints in `hub/src/web/routes/omc.ts`
- Merge packet builder that combines OMC runtime state, evidence, and git/worktree state
- Reuse of existing worktree merge and git-state checks from task/worktree flows
- Review/merge SSE updates for cockpit freshness and board badge updates

</code_context>

<deferred>
## Deferred Ideas

- Default auto-merge after review approval
- Automatically jumping merge failures back into repair mode without human choice
- Embedded in-OMC conflict editor or terminal
- Cross-plan review queue management and bulk review flows

</deferred>

---
*Phase: 03-review-and-merge-cockpit*
*Context gathered: 2026-03-30*
