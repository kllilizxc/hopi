# Phase 4: Program Bootstrap and Planning Attach - Research

**Researched:** 2026-03-30
**Domain:** Turning OMC from a single hard-coded repo shell into a local-repo attach and planning-bootstrap control plane
**Confidence:** HIGH for repo-grounded attach/bootstrap seams and targeted validation strategy; MEDIUM for the exact route and component names until implementation begins

<research_summary>
## Summary

Phase 3 finished the loop, review, and merge story inside one hard-coded OMC program. Phase 4 does **not** need new Ralph-loop semantics. It needs a **program bootstrap layer** that makes OMC usable on arbitrary local repos such as `/Users/realizer/Code/PersonalQuant`.

The most important brownfield fact is this: **the persistence model is already ready for multiple OMC programs, but the product entry path is still hard-coded to the hub repo.** `OmcRuntimeStore` already stores `Program` records with `repoRoot` and `planningRoot`, but `hub/src/web/routes/omc.ts` always upserts one default program based on `resolveRepoRoot()`. On the frontend, `OMC-client/src/routes/programs/index.tsx` auto-jumps into the first program and `PlanBoard.tsx` can only show a passive “No plans found yet” message.

That means the safest Phase 4 shape is:

1. add explicit attach/bootstrap backend contracts and temp-directory tests,
2. add program attach UX and client helpers,
3. upgrade the planning-missing empty state into an actionable planning-first bootstrap surface.

This stays tightly aligned to the locked Phase 4 context: local git repos only, minimal repo-local `.planning` seed, explicit attach/seed actions, and no automatic loop start.
</research_summary>

<repo_findings>
## Repo Findings

### Program persistence already supports multiple attached repos
- `hub/src/sync/omc/runtimeStore.ts` already persists `Program` rows with:
  - `id`
  - `name`
  - `repoRoot`
  - `planningRoot`
  - branch metadata
- This means Phase 4 does **not** need a new table to represent attached repos.
- The main missing piece is product/API flow for creating and selecting those program records.

### OMC currently hard-codes one default program to the hub repo
- `hub/src/web/routes/omc.ts` uses `ensureDefaultProgram()` and `resolveRepoRoot()` to create `omc-default`.
- That path always resolves to the repo containing the running hub.
- Even if `planningRoot` is overridden, `repoRoot` still points at the hub repo, which is why an external repo like `PersonalQuant` cannot yet be used correctly as an execution target.

### Planning-root detection is already factored, but only as a resolver
- `hub/src/sync/omc/programPaths.ts` already knows how to detect planning from:
  - explicit env override
  - sibling `.planning`
  - home GSD workspace
  - repo-local `.planning`
- Phase 4 can build on this utility instead of inventing planning detection from scratch.
- What is missing is:
  - explicit user attach of `repoRoot`
  - explicit user override of `planningRoot`
  - a seed writer when detection fails

### The current OMC UI already exposes the exact bootstrap gap
- `OMC-client/src/routes/programs/index.tsx` auto-navigates to the first program and has no attach affordance.
- `OMC-client/src/components/PlanBoard.tsx` shows:
  - `No plans found yet`
  - guidance to check the planning root or set `HOPI_OMC_PLANNING_ROOT`
- That proves the right Phase 4 UX move is not a full redesign; it is to turn this dead-end empty state into explicit attach/bootstrap actions.

### OMC tests already use temp repos and markdown planning fixtures
- `hub/src/web/routes/omc.test.ts` already creates temp repo roots and planning directories with `mkdtempSync`, `mkdirSync`, and `writeFileSync`.
- `hub/src/sync/omc/loopController.test.ts` follows the same pattern.
- Phase 4 can therefore validate attach/bootstrap with focused temp-fixture tests instead of relying on real user repos.

### Existing project/workspace routes provide useful path-normalization patterns
- `hub/src/web/routes/projects.ts` already:
  - trims paths
  - rejects duplicates
  - persists path-based records
- Phase 4 should reuse that validation posture for repo attach, while keeping the OMC program model separate from project/workspace models.

### File-writing infrastructure is simple enough for a repo-local planning seed
- The repo already writes small scaffolds and test fixtures in several places using direct Node fs utilities.
- For Phase 4, a small hub-side planning seed writer is sufficient:
  - create `.planning/`
  - create `phases/01-bootstrap/`
  - write a minimal set of markdown files
- No external service or worker is needed for this step.
</repo_findings>

<plan_recommendation>
## Recommended Plan Decomposition

### Plan 04-01 — Add backend attach/bootstrap contracts, validation, and repo-local planning seed writer
Focus: make attached programs and planning bootstrap explicit OMC backend capabilities.

Include:
- shared request/response schemas for:
  - attach local repo
  - attach planning root
  - create planning seed
- hub-side repo validation:
  - absolute path
  - local git repo
  - duplicate repo detection
- repo-local planning seed writer
- OMC routes and focused tests for attach/bootstrap flows

Why first:
- every frontend change depends on real attach/bootstrap APIs
- the product cannot truthfully guide the user until backend attach/bootstrap semantics are stable

### Plan 04-02 — Add program attach UX and client helpers in OMC-client
Focus: let users add a real local repo such as `PersonalQuant` from the UI.

Include:
- OMC client helpers for attach/bootstrap APIs
- Programs page attach affordance
- attach form/modal with path input and validation feedback
- sane multi-program selection behavior instead of always assuming one default program

Why second:
- after backend APIs exist, the first operator win is simply attaching a repo
- this unlocks the concrete `PersonalQuant` journey before polishing planning-empty flows

### Plan 04-03 — Replace the planning-missing dead end with planning-first attach/bootstrap guidance
Focus: make the empty board actionable and intentionally planning-first.

Include:
- action-oriented planning-empty state
- explicit CTAs:
  - `Attach existing planning`
  - `Create planning seed`
- post-seed guidance that shows generated files and next steps
- no accidental loop-start path immediately after bootstrap

Why third:
- the planning-empty UX depends on both backend bootstrap APIs and client attach plumbing
- it finishes the user journey from “repo exists but has no planning” to “repo is ready for GSD planning”
</plan_recommendation>

<validation_architecture>
## Validation Architecture

### What needs verification
- OMC can attach a local git repo as a new `Program`
- OMC rejects invalid repo inputs cleanly
- OMC can attach an existing planning root distinct from the default resolver path
- OMC can create a minimal `.planning/*` seed inside the repo
- Programs UI can add a new repo and navigate into it
- planning-missing state becomes actionable and planning-first

### Best validation layers
- targeted hub route tests:
  - `cd hopi && bun test hub/src/web/routes/omc.test.ts`
- hub/shared type safety:
  - `cd hopi && bun run typecheck:hub`
  - `cd hopi && bun run typecheck`
- OMC-client safety:
  - `cd hopi && bun run typecheck:omc`
  - `cd hopi && bun run build:omc`

### Suggested phase gate
- `cd hopi && bun test hub/src/web/routes/omc.test.ts && bun run typecheck`
- `cd hopi && bun run typecheck:omc && bun run build:omc`
- manual smoke path:
  1. attach `/Users/realizer/Code/PersonalQuant`,
  2. observe planning-missing state,
  3. create planning seed,
  4. confirm repo-local `.planning/*` files exist,
  5. confirm OMC lands in planning-first guidance instead of execution controls.
</validation_architecture>

<risks>
## Risks and Pitfalls

### Pitfall 1: attaching a repo path without actually rebinding `repoRoot`
If Phase 4 only changes `planningRoot` but leaves `repoRoot` pointed at the hub repo, the UI will look correct while execution still targets the wrong repository.

### Pitfall 2: hiding bootstrap state inside env vars or implicit fallbacks
The whole point of Phase 4 is to remove the “set env vars manually” dead end. Product attach/bootstrap must be explicit and inspectable.

### Pitfall 3: over-building the planning seed
If the seed tries to auto-create full plans, run GSD agents, or infer too much, this phase will sprawl. The user explicitly wants the thinnest practical bootstrap.

### Pitfall 4: treating attach/bootstrap as execution-ready
A freshly seeded repo is not ready for Ralph loops yet. If the UI keeps execution controls front-and-center right after bootstrap, the product posture will stay confusing.

### Pitfall 5: ignoring multi-program UX now that attach exists
Once multiple repo-backed programs can exist, the current “always navigate to the first program” behavior becomes brittle and can hide the newly attached repo.
</risks>

<sources>
## Sources

### Primary
- `docs/design/factory-mode-ralph-gsd.md`
- `docs/design/omc-phase-04-context.md`
- `docs/design/omc-planning-seed/ROADMAP.md`
- `docs/design/omc-planning-seed/REQUIREMENTS.md`
- `docs/design/omc-planning-seed/STATE.md`
- `docs/design/omc-planning-seed/04-CONTEXT.md`
- `AGENTS.md`
- `hub/src/web/routes/omc.ts`
- `hub/src/sync/omc/programPaths.ts`
- `hub/src/sync/omc/runtimeStore.ts`
- `hub/src/web/routes/omc.test.ts`
- `OMC-client/src/routes/programs/index.tsx`
- `OMC-client/src/components/PlanBoard.tsx`
- `shared/src/schemas.ts`
</sources>
