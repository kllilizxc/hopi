# Phase 4: Program Bootstrap and Planning Attach - Context

**Gathered:** 2026-03-30
**Status:** Ready for planning
**Source:** User discussion + `docs/design/factory-mode-ralph-gsd.md` + real local repo example `/Users/realizer/Code/PersonalQuant`

<domain>
## Phase Boundary

This phase makes OMC usable on arbitrary local repos instead of only the hub repo.

The scope is:

- attach a local git repo as an OMC program by explicit absolute path
- detect a usable markdown planning tree for that repo
- when planning is missing, offer explicit empty-state actions to:
  - attach an existing planning root
  - create a minimal planning seed
- write that planning seed inside the attached repo at `.planning/*`
- route the user into a planning-first posture after attach/bootstrap

This phase should remove the current dead end where OMC loads a repo, finds no plans, and can only tell the user to set an env var manually.

This phase does **not** include:

- a rich planning editor
- auto-running full GSD discuss/plan flows from the UI
- remote repo attach (GitHub, cloud providers, SSH URLs)
- multi-repo program families
- automatic loop start immediately after bootstrap

</domain>

<decisions>
## Implementation Decisions

### Program attach posture
- Phase 4 should add **explicit local program attach**.
- The first supported input is an absolute local repo path such as `/Users/realizer/Code/PersonalQuant`.
- Phase 4 should only support **local git repos**, not arbitrary directories.
- OMC should stop assuming the hub repo is the only meaningful program.

### Missing planning behavior
- Missing planning is not an error-only state anymore.
- The empty state should expose two explicit actions:
  - `Attach existing planning`
  - `Create planning seed`
- OMC should detect planning automatically first; these actions appear only when detection fails or the user wants to override it.

### Planning seed weight
- The planning seed should be **minimal**, not a hidden mega-bootstrap.
- The first generated files should be:
  - `.planning/PROJECT.md`
  - `.planning/REQUIREMENTS.md`
  - `.planning/ROADMAP.md`
  - `.planning/STATE.md`
  - `.planning/phases/01-bootstrap/01-CONTEXT.md`
- Phase 4 should not auto-generate detailed `PLAN.md` files yet.
- Phase 4 should not auto-run discuss/plan agents immediately after creating the seed.

### Planning location
- When OMC creates a seed, it should write planning **inside the attached repo** at `.planning/*`.
- Phase 4 should not hide planning in a separate copied workspace for this flow.
- Existing external planning roots can still be attached explicitly, but the recommended path is repo-local `.planning`.

### Post-bootstrap posture
- After attach or seed creation, OMC should land the user in a **planning-first** posture.
- The next screen should emphasize planning files and next-step guidance, not execution controls.
- Users should not accidentally start a Ralph loop on a repo that only just got seeded.

### the agent's Discretion
- Exact attach form layout and how path validation errors are presented.
- Exact wording of the planning-empty-state guidance and bootstrap CTA labels.
- Exact contents of the initial `01-bootstrap/01-CONTEXT.md` scaffold.
- Exact route structure for a “new program” or “attach repo” surface.

</decisions>

<specifics>
## Specific Ideas

- `/Users/realizer/Code/PersonalQuant` is the concrete example driving this phase:
  - it is a valid local git repo
  - it currently has no `.planning`
  - OMC today can point at it conceptually, but cannot actually bootstrap it from the UI
- The user wants the system to feel practical: pick a repo, attach it, create just enough planning, then move into the normal GSD flow.
- The product should feel less like “set env vars and edit files manually” and more like “attach repo, seed planning, continue.”

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and phase definition
- `docs/design/factory-mode-ralph-gsd.md` — primary OMC design document covering markdown-first planning, `Program` identity, and the control-plane posture
- `docs/design/omc-phase-03-context.md` — latest locked decisions for review/merge posture so Phase 4 does not regress the current OMC control surface
- `docs/design/omc-phase-04-context.md` — locked Phase 4 decisions for local repo attach, planning bootstrap, and post-bootstrap posture

### OMC planning mirror
- `docs/design/omc-planning-seed/ROADMAP.md` — official Phase 4 scope statement
- `docs/design/omc-planning-seed/REQUIREMENTS.md` — requirements `OMC-03`, `OMC-07`, `OMC-08`, `OMC-09`, and `OMC-10`
- `docs/design/omc-planning-seed/STATE.md` — repo-mirror execution state after Phase 3 completion and Phase 4 discussion
- `docs/design/omc-planning-seed/04-CONTEXT.md` — mirror copy of this context for repo-local planning consumption

### Existing code context
- `hub/src/web/routes/omc.ts` — current default-program behavior and the natural place to add attach/bootstrap APIs
- `hub/src/sync/omc/programPaths.ts` — current planning-root detection rules that must be extended beyond env-var fallback posture
- `hub/src/sync/omc/runtimeStore.ts` — durable program records already exist and can store multiple attached repos
- `OMC-client/src/routes/programs/index.tsx` — current program entry route that will need a visible attach/bootstrap affordance
- `OMC-client/src/components/PlanBoard.tsx` — current empty state that exposes the attach/bootstrap gap

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `hub/src/sync/omc/runtimeStore.ts` already persists `Program` records with `repoRoot` and `planningRoot`, so Phase 4 can add explicit attached programs without inventing a new persistence model.
- `hub/src/sync/omc/programPaths.ts` already encapsulates planning-root detection and can become the shared resolver for attach/bootstrap flows.
- `hub/src/web/routes/omc.ts` already owns default-program creation and OMC APIs; attach/bootstrap endpoints belong there.
- `OMC-client/src/routes/programs/index.tsx` already has a program list shell, making it the natural place for an `Attach local repo` entry point.
- `OMC-client/src/components/PlanBoard.tsx` already renders a planning-missing empty state; Phase 4 can evolve that dead end into actionable attach/bootstrap choices.

### Established Patterns
- OMC already keeps planning truth in markdown and runtime truth in DB; bootstrap should create files, not invent a DB-only planning mode.
- OMC already treats `Program` as the top-level object; external repo attach should expand that model rather than bypass it.
- Current OMC route structure is execution-first; Phase 4 should intentionally add a planning-first posture after attach/bootstrap instead of overloading the running-plan views.

### Integration Points
- new OMC API routes for attaching local repos and creating/bootstrapping planning
- repo/path validation in hub before creating a new `Program`
- repo-local `.planning` seed writer in hub
- program selection and attach UI in `OMC-client`
- improved empty-state flows when no planning exists for the selected program

</code_context>

<deferred>
## Deferred Ideas

- Automatic end-to-end GSD discuss/plan workflow from the UI
- Remote repo import from GitHub or hosted git providers
- Managing multiple repos inside one OMC `Program`
- Rich markdown planning editor
- Generating full `PLAN.md` files automatically during seed creation

</deferred>

---
*Phase: 04-program-bootstrap-and-planning-attach*
*Context gathered: 2026-03-30*
