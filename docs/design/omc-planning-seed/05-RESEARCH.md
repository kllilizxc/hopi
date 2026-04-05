# Phase 5: Guided Planning Flow - Research

**Researched:** 2026-03-30
**Domain:** Turning OMC bootstrap from “planning files exist” into “first executable `PLAN.md` cards exist”
**Confidence:** HIGH for the repo-grounded architecture seam and plan decomposition; MEDIUM for the exact prompt contract and job-state naming before implementation

<research_summary>
## Summary

Phase 4 solved repo attach and planning seed creation, but it intentionally stopped before creating any executable `PLAN.md` cards. The most important product gap now is not markdown generation in general; it is the missing **program-level planning continuation runtime** between:

1. attached repo,
2. repo-local seed scaffold,
3. zero plan cards,
4. first real `PLAN.md` files.

The safest Phase 5 shape is:

1. add a program-level guided-planning runtime contract and persistence model,
2. use existing session spawn/send-message infrastructure to run a lightweight planning flow against the attached repo,
3. surface that progress in `PlanningBootstrapPanel` and automatically hand off to the normal board once plan cards appear.

This phase should **not** overload existing plan-attempt runtime directly. OMC attempts are keyed by `planKey`, and Phase 5 happens precisely before any plan key exists. That makes Phase 5 a `Program`-scoped runtime problem, not a `Plan`-scoped runtime problem.
</research_summary>

<repo_findings>
## Repo Findings

### Phase 4 already owns the right bootstrap UI seam
- [`OMC-client/src/components/PlanningBootstrapPanel.tsx`](/Users/realizer/Code/hopi/OMC-client/src/components/PlanningBootstrapPanel.tsx) already handles:
  - missing planning
  - seed creation
  - post-seed planning-first posture
- That makes it the natural home for Phase 5 continuation actions such as:
  - brief input
  - start guided planning
  - retry/cancel
  - session deep-link
  - planning progress and failures
- Phase 5 does not need a brand-new top-level page to get started.

### Current OMC runtime is plan-scoped, which is too late for this phase
- [`hub/src/sync/omc/attemptRunner.ts`](/Users/realizer/Code/hopi/hub/src/sync/omc/attemptRunner.ts), [`hub/src/sync/omc/loopController.ts`](/Users/realizer/Code/hopi/hub/src/sync/omc/loopController.ts), and [`hub/src/sync/omc/loopAutomation.ts`](/Users/realizer/Code/hopi/hub/src/sync/omc/loopAutomation.ts) all assume:
  - `program + plan + runtime`
  - a known `planKey`
  - plan-scoped attempts and evidence
- Guided planning happens before those conditions exist, so reusing this stack directly would force fake plan keys or placeholder cards. That would blur domain semantics.

### Session/runtime substrate is already reusable
- [`hub/src/sync/omc/runtimeAdapter.ts`](/Users/realizer/Code/hopi/hub/src/sync/omc/runtimeAdapter.ts) proves OMC already has the necessary low-level substrate:
  - resolve machine
  - spawn session
  - wait for active
  - apply config
  - dispatch prompt text
- [`hub/src/sync/syncEngine.ts`](/Users/realizer/Code/hopi/hub/src/sync/syncEngine.ts) exposes the session lifecycle methods directly.
- This means Phase 5 can reuse the same control-plane pattern without going through unrelated task/project flows.

### Planning detection already gives the right completion signal
- [`hub/src/sync/omc/programBootstrap.ts`](/Users/realizer/Code/hopi/hub/src/sync/omc/programBootstrap.ts) already has [`inspectOmcPlanningRoot`](/Users/realizer/Code/hopi/hub/src/sync/omc/programBootstrap.ts), which reports:
  - `hasPlanning`
  - `hasPlans`
  - `planCount`
- [`hub/src/sync/omc/planningIndex.ts`](/Users/realizer/Code/hopi/hub/src/sync/omc/planningIndex.ts) already derives cards from real `*-PLAN.md` files.
- That means the Phase 5 success signal can stay very concrete: **planning continuation is done once the repo actually has `PLAN.md` files that planningIndex can parse.**

### Event/SSE architecture is already a good fit for planning-run visibility
- [`hub/src/sync/omc/events.ts`](/Users/realizer/Code/hopi/hub/src/sync/omc/events.ts) and [`OMC-client/src/hooks/useOmcEvents.ts`](/Users/realizer/Code/hopi/OMC-client/src/hooks/useOmcEvents.ts) already carry OMC-specific realtime invalidation.
- Phase 5 can extend this with `program-scoped` guided-planning events without inventing a second realtime transport.
- This strongly favors a first-class persisted planning-run state rather than a hidden fire-and-forget mutation.

### The user’s complaint maps directly to a product-state gap
- Current product flow for `/Users/realizer/Code/PersonalQuant` now reaches:
  - attach repo
  - seed planning
  - view scaffold files
- But it still stops before:
  - capturing a small planning brief
  - running the first planning continuation step
  - surfacing progress/failure
  - showing the first cards
- That means Phase 5 is not a cosmetic tweak; it needs a real backend/frontend control loop around planning continuation.
</repo_findings>

<architecture_recommendation>
## Architecture Recommendation

### Recommended model: Program-level guided planning run

Introduce a **program-scoped planning runtime** that is separate from plan attempts.

Recommended core object:
- `OmcProgramPlanningRun`

Recommended fields:
- `id`
- `programId`
- `namespace`
- `status`
  - `idle | collecting_input | running | completed | failed | canceled`
- `stage`
  - `brief | discuss | plan | handoff`
- `sessionId`
- `summary`
- `error`
- `brief`
- `createdAt`
- `updatedAt`
- `completedAt`

Recommended reasoning:
- no fake `planKey`
- consistent with current `Program`-level bootstrap posture
- enough state to drive UI and SSE
- can later grow into richer guided planning without throwing away Phase 5 work

### Recommended execution approach

Use a thin planning-run controller that:

1. accepts a lightweight planning brief from OMC,
2. spawns a normal agent session in the attached repo,
3. dispatches a deterministic guided-planning prompt,
4. watches for structured completion and/or resulting `PLAN.md` emergence,
5. marks the planning run complete once real plan cards exist.

Recommended runtime shape:
- `Codex-first`, but keep the adapter seam consistent with OMC runtime philosophy
- session deep-link always available
- structured completion preferred, filesystem/result inspection as fallback

### Recommended prompt posture

The prompt should not ask the user additional questions in-session.

Instead, OMC should gather a small brief up front, then the planning-run prompt should say, in effect:
- read the seeded `.planning/*` files
- use the brief as the product intent source
- produce or update context as needed
- generate the first executable phase plans in standard markdown form
- stop once real `PLAN.md` files exist and summarize what changed

This avoids a nested, fragile TUI-style question flow inside the planning run itself.

### Recommended completion criteria

Primary success criterion:
- `inspectOmcPlanningRoot(program.planningRoot).hasPlans === true`

Secondary success signals:
- structured completion summary from the session
- planning evidence showing which files were created/updated
- optional list of generated `PLAN.md` paths

Failure criteria:
- session dies before completion
- structured failure summary
- no plan cards produced after a completed run

</architecture_recommendation>

<plan_recommendation>
## Recommended Plan Decomposition

### Plan 05-01 — Add guided-planning runtime contracts, persistence, and realtime events
Focus: make post-seed planning continuation a first-class OMC runtime concept.

Include:
- shared schemas/types for program-level planning runs and planning briefs
- store/runtime persistence for planning-run state
- OMC events/SSE payloads for planning-run updates
- base route contracts for reading planning-run state

Why first:
- every later UI/backend flow depends on typed state and visible progress
- Phase 5 needs a canonical place to store planning continuation lifecycle

### Plan 05-02 — Implement guided-planning orchestration on the hub
Focus: turn a lightweight brief into a real repo-local planning run.

Include:
- planning-run controller/service
- Codex-first planning runtime adapter
- guided-planning prompt builder
- start / cancel / retry routes
- tests for success, failure, and first-plan emergence

Why second:
- this is the core behavior change
- it reuses current session substrate while staying separate from plan attempts

### Plan 05-03 — Build OMC-client guided planning UX and automatic board handoff
Focus: make post-seed bootstrap actionable and visible in the product.

Include:
- lightweight planning brief UI in `PlanningBootstrapPanel`
- live planning-run progress and failure display
- session deep-link / retry / cancel actions
- automatic switch back to normal board once cards exist

Why third:
- frontend depends on planning-run contracts and backend orchestration
- this plan finishes the user-visible product gap identified in the walkthrough

</plan_recommendation>

<validation_architecture>
## Validation Architecture

### What needs verification
- OMC can start a program-level guided planning run from the bootstrap panel
- the run can drive a real session in the attached repo
- the system persists and surfaces planning-run progress/failure
- the first `PLAN.md` files cause the board to stop showing bootstrap state
- the user can recover from failure without leaving OMC

### Best validation layers
- shared/hub type safety:
  - `bun run typecheck`
  - `bun run typecheck:hub`
- focused OMC backend tests:
  - `bun test hub/src/web/routes/omc.test.ts hub/src/sync/omc/*.test.ts`
- OMC-client validation:
  - `bun run typecheck:omc`
  - `bun run build:omc`
- manual smoke:
  1. attach `/Users/realizer/Code/PersonalQuant`
  2. create planning seed
  3. start guided planning from OMC
  4. observe progress and session link
  5. confirm real `PLAN.md` files appear
  6. confirm board flips from bootstrap mode to plan-card mode

</validation_architecture>

<risks>
## Risks and Pitfalls

### Pitfall 1: forcing Phase 5 into plan-attempt runtime
If guided planning is modeled as a fake plan attempt, OMC will blur the line between “planning continuation” and “executing a plan.” That makes the state model harder to reason about and likely pollutes board semantics.

### Pitfall 2: embedding a nested interactive discuss flow
If the planning continuation relies on in-session question loops, the UX will become brittle and hard to recover. Phase 5 should prefer a lightweight pre-collected brief and a deterministic planning-run prompt.

### Pitfall 3: declaring success before cards really exist
The product gap is only solved once real `PLAN.md` files appear. A run that merely edits `PROJECT.md` or `ROADMAP.md` but produces no cards should not be treated as success.

### Pitfall 4: switching to execution posture too early
Even after plans appear, OMC should hand back to the board, not auto-run loops. Guided planning ends when executable cards exist, not when execution begins.

### Pitfall 5: hiding planning-run failures
If the guided planning flow fails and OMC quietly falls back to the same bootstrap panel, the user will relive the exact confusion that triggered this phase.

</risks>

<sources>
## Sources

### Primary
- `docs/design/factory-mode-ralph-gsd.md`
- `docs/design/omc-phase-04-context.md`
- `docs/design/omc-planning-seed/04-03-SUMMARY.md`
- `docs/design/omc-planning-seed/05-CONTEXT.md`
- `docs/design/omc-planning-seed/REQUIREMENTS.md`
- `docs/design/omc-planning-seed/STATE.md`
- `AGENTS.md`
- `OMC-client/src/components/PlanningBootstrapPanel.tsx`
- `OMC-client/src/components/PlanBoard.tsx`
- `OMC-client/src/router.tsx`
- `hub/src/web/routes/omc.ts`
- `hub/src/sync/omc/programBootstrap.ts`
- `hub/src/sync/omc/attemptRunner.ts`
- `hub/src/sync/omc/runtimeAdapter.ts`
- `hub/src/sync/omc/loopAutomation.ts`
- `hub/src/sync/syncEngine.ts`
</sources>
