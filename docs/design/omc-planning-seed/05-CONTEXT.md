# Phase 5: Guided Planning Flow - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** User walkthrough of the ideal OMC journey after Phase 4, using `/Users/realizer/Code/PersonalQuant` as the concrete repo example

<domain>
## Phase Boundary

This phase closes the gap between a repo-local planning seed and the first real OMC plan cards.

The scope is:

- continue from Phase 4 bootstrap without dropping the user to manual CLI-only steps
- let the user trigger the next planning actions from inside OMC after seed creation
- guide the repo from:
  - attached repo
  - seed scaffold present
  - zero `PLAN.md` cards
  - to at least the first executable `PLAN.md` card
- show planning progress, outcome, and failures as product-visible state
- return the user to the normal plan board once plan cards exist

This phase should remove the current gap where OMC says “next run `$gsd-discuss-phase 1` and `$gsd-plan-phase 1` manually” but does not help the user do that from the product.

This phase does **not** include:

- a rich markdown planning editor
- auto-starting Ralph execution immediately after plans are generated
- arbitrary full-project planning for every future phase
- remote repo attach or cloud planning runners
- replacing GSD markdown artifacts with a database-backed planning model

</domain>

<decisions>
## Implementation Decisions

### Bootstrap continuation posture
- Phase 5 should make the post-seed state actionable inside OMC, not CLI-only.
- The user should not need to leave OMC just to move from planning seed to the first executable plan cards.
- The product should still keep a planning-first posture; execution starts only after cards exist and the user chooses to run them.

### Guided flow shape
- Phase 5 should introduce a **guided planning flow** after seed creation.
- The flow should feel like one product path, not a bag of disconnected docs.
- Internally it may still map to distinct GSD steps such as discuss and plan, but the OMC surface should present them as a coherent continuation of bootstrap.
- OMC should make it legible which sub-step is running and which one is next.

### Input weight
- The planning-continuation input should stay lightweight.
- OMC should collect only the minimum user guidance needed to start the first planning pass:
  - what the product/repo is for
  - what the first working slice should accomplish
- Phase 5 should not turn into a full PRD authoring workflow.

### Result handoff
- When the first `PLAN.md` files appear, OMC should refresh back into the normal board automatically.
- The user should not need to re-attach the repo, reload manually, or switch mental models.
- If planning generation fails, OMC should show clear failure state and the relevant planning artifacts/logs rather than silently leaving the user on the empty panel.

### the agent's Discretion
- Exact bootstrap-flow wording and button labels
- Exact shape of the lightweight planning brief
- Whether the guided planning UI exposes discuss and plan as two visible steps or one primary “continue bootstrap” flow with sub-status
- Exact presentation of planning-run logs and failure details

</decisions>

<specifics>
## Specific Ideas

- The concrete example is still `/Users/realizer/Code/PersonalQuant`.
- The target feeling is:
  - attach repo
  - create planning seed
  - continue bootstrap from OMC
  - answer a small amount of intent-setting input
  - see the first `PLAN.md` cards appear
- The user explicitly called out that “Create planning seed only adds planning files,” which means the next phase must solve that product gap directly.
- OMC should feel like “repo in, first plan out,” not “repo in, now go use the terminal.”

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and prior phase decisions
- `docs/design/factory-mode-ralph-gsd.md` — primary OMC design document and long-term product posture
- `docs/design/omc-phase-04-context.md` — locked Phase 4 decisions for attach/bootstrap and planning-first empty states
- `docs/design/omc-planning-seed/04-03-SUMMARY.md` — what Phase 4 actually delivered and where the remaining gap starts

### OMC planning mirror
- `docs/design/omc-planning-seed/ROADMAP.md` — roadmap with Phase 5 added after Phase 4 completion
- `docs/design/omc-planning-seed/REQUIREMENTS.md` — requirements including new guided-planning expectations
- `docs/design/omc-planning-seed/STATE.md` — repo-mirror state after Phase 4 completion and Phase 5 context capture
- `docs/design/omc-planning-seed/05-CONTEXT.md` — mirror copy of this context for repo-local planning consumption

### Existing code context
- `OMC-client/src/components/PlanningBootstrapPanel.tsx` — current post-seed planning-first panel that needs real continuation actions
- `OMC-client/src/components/PlanBoard.tsx` — current board/empty-state handoff surface
- `OMC-client/src/routes/programs/index.tsx` — program entry surface now that attach exists
- `OMC-client/src/router.tsx` — board vs registry route flow
- `hub/src/web/routes/omc.ts` — current attach/bootstrap APIs and natural place for planning-continuation APIs
- `hub/src/sync/omc/programBootstrap.ts` — current repo-local planning seed writer

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `PlanningBootstrapPanel.tsx` already owns the planning-missing and post-seed posture, so Phase 5 should extend that surface rather than invent a third bootstrap screen.
- `PlanBoard.tsx` already flips between board mode and bootstrap mode based on whether any `PLAN.md` cards exist.
- `omc.ts` already has the attach/bootstrap route cluster and can grow planning-continuation endpoints beside it.

### Established Patterns
- Planning truth remains markdown-first; guided planning must still write normal `.planning/*` artifacts.
- OMC already has runtime/evidence/review primitives; Phase 5 should reuse that operator mentality for planning progress instead of inventing a hidden background job.
- Phase 4 intentionally stopped before creating `PLAN.md`, so Phase 5 should pick up exactly at that seam.

### Integration Points
- new OMC API routes for continuing bootstrap into discuss/plan
- a thin planning-run state model surfaced in OMC
- automatic handoff from bootstrap panel to board once `PLAN.md` files exist

</code_context>

<deferred>
## Deferred Ideas

- Full markdown planning editor
- Rich PRD authoring inside OMC
- Auto-starting loops immediately after plan generation
- Remote/cloud planning execution
- Multi-phase roadmap authoring from the UI

</deferred>

---
*Phase: 05-guided-planning-flow*
*Context gathered: 2026-03-30*
