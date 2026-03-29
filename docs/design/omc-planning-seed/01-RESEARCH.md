# Phase 1: OMC Foundation - Research

**Researched:** 2026-03-29
**Domain:** Brownfield introduction of a new `Ralph loop + GSD` product mode beside HOPI's existing session-first web app
**Confidence:** HIGH for repo-grounded integration seams, package/build constraints, and plan slicing; MEDIUM for the exact first-pass OMC runtime schema names until implementation starts

<research_summary>
## Summary

HOPI already has most of the runtime substrate OMC needs: SQLite-backed persistence, hub REST + SSE plumbing, worktree-aware tasks/projects, Codex runtime integration, and a browser client architecture built on TanStack Router/Query. What it does **not** have is the right product model or frontend/build shape for a native `Ralph loop + GSD` control plane.

The most important brownfield fact is this: **HOPI currently assumes one frontend app and one `web/dist` bundle**. `hub/src/web/server.ts`, the root `package.json` scripts, the embedded asset generator, and the single-exe build all point to the existing `web/` package only. That means Phase 1 cannot be planned as "just add a few routes" if `OMC-client/` is truly a new frontend subproject. The phase must explicitly create the second frontend package and the serving/build plumbing for `/omc`.

The safest Phase 1 shape is therefore:

1. add a new OMC runtime/domain layer in `shared/` + `hub/`,
2. add a markdown-first planning indexer that reads `.planning/phases/**/*PLAN.md`,
3. add a Codex-first manual plan-start path with visible attempt/evidence state,
4. add `OMC-client/` as a separate frontend package,
5. teach the hub and build system to serve that second frontend under `/omc`.

This preserves the user decision that OMC is a second product mode, not a cosmetic fork of the current `projects` view.
</research_summary>

<repo_findings>
## Repo Findings

### HOPI already has strong runtime substrate for OMC
- `hopi/hub/src/web/server.ts` already provides the authenticated API shell, SSE events, and static app serving patterns OMC can reuse.
- `hopi/hub/src/store/index.ts` shows the current SQLite store is already the canonical persistence layer for sessions, projects, workspaces, and tasks. Phase 1 can add OMC runtime tables/projections here without introducing new infra.
- `hopi/cli/src/codex/runCodex.ts` confirms Codex is already a first-class runtime with permission-mode sync, session lifecycle hooks, and worktree-aware working directories.
- Existing file/search/diff/worktree primitives mean OMC does not need to invent new machine-side execution infrastructure in Phase 1.

### Current orchestration model is close, but at the wrong abstraction level
- `hopi/shared/src/schemas.ts` already models `Project`, `Workspace`, `Task`, worktree metadata, and action runtimes. This is useful substrate, but not the same thing as OMC's target objects (`Program`, `PlanRuntime`, `LoopRun`, `Attempt`, `Evidence`).
- `hopi/hub/src/sync/workflowStrategy.ts` shows HOPI already has a thin built-in `gsd` workflow profile, but it only maps task transitions like `discuss`, `plan`, `execute`, `verify`; it is not a native Ralph loop engine.
- `hopi/hub/src/sync/autoRunScheduler.ts` proves there is already project/task auto-run scheduling logic, but it is task/session-centric and keyed to the current `planned -> in_progress -> in_review` model. Phase 1 should **not** force OMC into this scheduler; manual plan start is the safer first slice.

### Existing web architecture is reusable, but the current app is session-first
- `hopi/web/src/router.tsx` and `hopi/web/README.md` show one TanStack Router app whose primary object is the session, with projects/tasks layered on later.
- Current route architecture can be reused as a reference for query/mutation patterns, auth, and mobile-safe route structure.
- But the current app shell is still fundamentally built around `/sessions` and `/projects`, not `/programs`, `/plans`, `/attempts`, and `/review`.

### The second frontend package is a real build-time concern, not a naming detail
- Root scripts in `hopi/package.json` only build `web` today: `build:web`, `dev:web`, and `build:single-exe` all assume a single frontend app.
- `hopi/hub/src/web/server.ts` only discovers one `web/dist` directory and serves it as the catch-all browser app.
- `hopi/hub/scripts/generate-embedded-web-assets.ts` and `hopi/hub/src/web/embeddedAssets.ts` embed only one web asset manifest today.
- Therefore, if Phase 1 creates `OMC-client/` as a real second package, it must also plan:
  - workspace package registration,
  - dev/build scripts for OMC,
  - hub static serving rules for `/omc`,
  - embedded-asset generation and single-exe support for the second app.

### Markdown-first planning is a good fit, but workspace-relative paths matter
- The new OMC workspace uses `.planning/` at the workspace root and the repo worktree under `hopi/`.
- That means all repo references used by future planners/executors must resolve as `hopi/...`, not repo-root-relative bare paths like `hub/src/...`.
- The planning indexer should therefore parse workspace-root `.planning`, but emit repo file references that point into `hopi/...`.

### Phase 1 naturally decomposes into four implementation seams
Repo inspection strongly suggests four clean seams:
- `shared/` — OMC schemas, event payloads, and typed response contracts
- `hub/` — planning indexer, runtime store, loop control endpoints, SSE events, and static serving for `/omc`
- `cli/` or hub/CLI seam — Codex attempt launch/integration contract for manual plan start
- `OMC-client/` — board, plan detail, attempt inspector, thin planning actions

This lines up well with the product boundary and reduces the chance of one giant mixed task workbench refactor.
</repo_findings>

<architecture_recommendation>
## Architecture Recommendation

### Recommended Phase 1 architecture
Use a **parallel product-mode architecture**, not a projection layered onto the current task board.

Concretely:
- keep the current HOPI stack as infrastructure,
- add a new OMC domain layer in `shared/` and `hub/`,
- add `OMC-client/` as a second frontend package,
- serve that frontend from the existing hub under `/omc`.

### Recommended serving/build posture
Treat `OMC-client/` as a sibling to `web/`, not a subfolder inside `web/`.

Safer path:
1. register `OMC-client` in the root workspace,
2. add `dev:omc` and `build:omc`,
3. update hub static serving so `/omc` maps to OMC assets while `/` continues serving the session app,
4. then update embedded-asset generation and single-exe build to include both apps.

This is heavier than adding routes inside `web/`, but it honors the product decision that OMC is not just another tab.

### Recommended runtime shape for Phase 1
Phase 1 should **not** build the full long-term orchestration graph yet.

Best thin-slice model:
- `Program` — one primary repo/machine/workspace family
- `PlanRuntime` — runtime view for one `PLAN.md`
- `Attempt` — one manual fresh-context execution run
- `Evidence` — attached validation/check output

This is enough to render the board, start one plan, and inspect the first attempt without prematurely building a full scheduler.

### Recommended plan-indexing shape
The planning indexer should remain a read model builder:
- source of truth: `.planning/phases/**/*PLAN.md`
- card identity: plan path / plan key
- phase grouping from parent phase directory
- parsed fields: title, summary, checklist counts, first open item, file timestamps
- runtime column assignment from DB, not from markdown prose guessing

### Recommended frontend posture
Plan detail should be execution-first:
- top: runtime summary, attempts, evidence, primary actions
- bottom: parsed plan, file refs, thin edit/open-file actions

This fits the OMC control-plane goal and avoids turning Phase 1 into a markdown editor project.
</architecture_recommendation>

<plan_recommendation>
## Recommended 3-Plan Split

### Plan 01-01 — Seed OMC domain model and hub-side runtime APIs/events
Focus: shared/hub runtime foundation for OMC.

Include:
- OMC runtime schemas/events/contracts in `hopi/shared/src/`
- initial SQLite/store support in `hopi/hub/src/store/`
- hub route namespace for `/api/omc/*`
- runtime state for program / plan runtime / attempt / evidence
- first manual plan-start endpoint contract

Why first:
- the board and plan detail need typed data contracts before the new client can exist meaningfully
- attempt inspection and SSE updates need a durable runtime source of truth

### Plan 01-02 — Build planning indexer plus phase-grouped OMC board
Focus: parsing `.planning` into OMC read models and rendering the first board.

Include:
- markdown-first planning indexer in hub
- board/list/detail read APIs
- SSE/query invalidation shape for OMC runtime updates
- `OMC-client/` package scaffold, routing shell, and phase-grouped board UI
- board semantics: `Planning`, `Running`, `Review`, `Done`

Why second:
- after runtime contracts exist, the next visible proof is that OMC can read real GSD plans as cards
- it also forces the second frontend package and `/omc` serving path to become real

### Plan 01-03 — Add plan detail, manual plan start, and attempt/evidence inspection
Focus: the first runnable Ralph-shaped interaction.

Include:
- execution-first plan detail page
- manual start action for one plan
- first Codex attempt launch/integration path
- attempt inspector and evidence presentation
- thin planning actions (`open file`, minimal patch flow hooks if trivial)

Why third:
- this is the first point where OMC stops being a read-only shell
- it proves the user-facing promise of `1 plan -> 1 loop -> 1 attempt`
</plan_recommendation>

<validation_architecture>
## Validation Architecture

### What needs verification
- the new OMC schemas and store/runtime routes typecheck cleanly across shared/hub/web
- the planning indexer correctly parses real `.planning/phases/**/*PLAN.md` files
- the hub can serve a second frontend app under `/omc` without regressing the existing web shell
- manual plan start produces a durable attempt record and inspectable evidence
- `OMC-client/` can render board + plan detail from real API data

### Best validation layers
- type safety:
  - `bun run typecheck`
- hub/store/route coverage:
  - `bun run test:hub`
- OMC-client route/component coverage once package exists:
  - package-local tests, plus root script integration when available
- build/hosting coverage:
  - `bun run build`
  - single-app and dual-app static serving checks in hub

### Suggested phase gate
- `bun run typecheck`
- `bun run test:hub`
- frontend package checks for `OMC-client` once created
- a manual smoke path:
  1. load `/omc`
  2. see parsed plan cards
  3. open a plan
  4. trigger manual plan start
  5. see attempt and evidence appear

### Important validation gap to plan for
Because Phase 1 introduces a second frontend package, build/test validation must include static-serving and embedded-asset behavior, not just React route tests.
</validation_architecture>

<risks>
## Risks and Pitfalls

### Pitfall 1: creating `OMC-client/` in name only
If the plan adds OMC routes inside `web/` while pretending there is a new subproject, the architecture will drift from the locked product decision immediately.

### Pitfall 2: forgetting hub/build coupling
If the plan creates a second frontend package but ignores `hub/src/web/server.ts`, root scripts, and embedded-asset generation, `/omc` will not actually be shippable.

### Pitfall 3: reusing current task state as canonical OMC state
`TaskStatus` and `workflowPhase` are useful references, but Phase 1 should not let them become the canonical OMC state machine.

### Pitfall 4: implementing a board before a runtime contract
If the board lands first with mocked or ad hoc data, the product will immediately drift from the attempt/evidence model OMC is supposed to expose.

### Pitfall 5: overbuilding the scheduler too early
Manual plan start is enough for Phase 1. Pulling auto-selection and retry policy into this phase would slow delivery and muddy the product boundary.

### Pitfall 6: path confusion inside the new workspace
The repo lives under `hopi/` in this workspace. Plans, research, and future executor prompts need to reference repo files with that prefix or downstream agents will read the wrong files.
</risks>

<sources>
## Sources

### Primary
- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/phases/01-omc-foundation/01-CONTEXT.md`
- `.planning/codebase/STRUCTURE.md`
- `.planning/codebase/STACK.md`
- `.planning/codebase/INTEGRATIONS.md`
- `.planning/codebase/CONCERNS.md`
- `hopi/AGENTS.md`
- `hopi/README.md`
- `hopi/cli/README.md`
- `hopi/hub/README.md`
- `hopi/web/README.md`
- `hopi/package.json`
- `hopi/shared/src/schemas.ts`
- `hopi/cli/src/codex/runCodex.ts`
- `hopi/hub/src/store/index.ts`
- `hopi/hub/src/sync/workflowStrategy.ts`
- `hopi/hub/src/sync/autoRunScheduler.ts`
- `hopi/hub/src/web/server.ts`
- `hopi/hub/src/web/embeddedAssets.ts`
- `hopi/docs/design/factory-mode-ralph-gsd.md`
- `hopi/docs/design/omc-phase-01-context.md`

### Notes
- Research based on direct repo inspection and the newly created OMC workspace.
- The most important Phase 1 implementation constraint is dual-frontend serving/build support for the new `OMC-client/` package.
</sources>
