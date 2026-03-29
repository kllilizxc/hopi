# Phase 1: OMC Foundation - Context

**Gathered:** 2026-03-29
**Status:** Ready for planning
**Source:** User discussion + `docs/design/factory-mode-ralph-gsd.md`

<domain>
## Phase Boundary

This phase creates the first runnable `OMC` thin slice as a new GSD workspace and product surface.

The scope is:

- a new `OMC-client/` frontend subproject
- the minimum hub-side OMC schemas, APIs, and realtime events
- markdown-first planning indexing from `.planning/phases/**/*PLAN.md`
- a phase-grouped board where `1 card = 1 PLAN.md`
- a plan detail page focused on loop execution state
- manual start of one plan loop
- first-attempt / evidence visibility

This phase should produce a system that can actually run one plan-oriented loop, not just a read-only board.

This phase does **not** include:

- automatic scheduler-driven plan selection
- automatic merge
- multi-repo orchestration
- a heavy planning editor
- compatibility projections back into the legacy `projects` kanban

</domain>

<decisions>
## Implementation Decisions

### Workspace and product boundary
- This work starts in a **new GSD workspace**, not by continuing the current `.planning` milestone.
- The new frontend subproject is named `OMC-client/`.
- OMC is treated as a second product mode, not a thin extension of the current `projects` UI.
- Existing HOPI runtime pieces should be reused as infrastructure, but OMC gets its own product model and route surface.

### Execution unit and board model
- The primary board card is `1 PLAN.md`.
- `phase` is used for grouping / swimlanes / filtering, not as the primary execution card.
- `1 loop run = 1 PLAN`.
- `1 attempt = advance the current smallest step inside that plan`.
- `1 PLAN = 1 worktree`.

### Phase 1 delivery shape
- Phase 1 must be **runnable**, not read-only.
- Loop triggering is manual in Phase 1: user selects a plan and starts it explicitly.
- Phase 1 should stop after proving `1 plan -> 1 loop -> 1 attempt` with visible runtime state.
- Automatic scheduling is deferred until later phases.

### Plan detail posture
- Plan detail is execution-first.
- The top of the screen should emphasize runtime status, attempts, evidence, and primary actions.
- Parsed plan content and file references should remain visible, but secondary to the execution controls.

### Planning and authoring strategy
- Planning source of truth stays in markdown.
- OMC-client should support only the thinnest planning edits in Phase 1.
- Preferred editing flows are: open file, small patch, re-parse.
- Phase 1 should not introduce a structured planning editor or markdown/database sync engine.

### Review and merge posture
- Human review remains the default gate.
- Automatic merge is explicitly out of scope for Phase 1.
- Review can be informed by agent summaries and evidence, but final approval remains human.

### the agent's Discretion
- Exact naming of internal runtime types and route groups.
- Exact visual design of the board and inspector, as long as execution state stays primary.
- Exact shape of the first-attempt output contract, as long as attempts remain inspectable and evidence-backed.

</decisions>

<specifics>
## Specific Ideas

- The product should feel like a control plane for a one-person software company, not a generic task board.
- The board should stay legible with few columns: `Planning`, `Running`, `Review`, `Done`.
- `Ready` should not be a top-level column in Phase 1; it can be card metadata inside `Planning`.
- Attempt history should be visible and first-class rather than hidden behind chat/session internals.
- The runtime should be clearly Ralph-shaped: deterministic context pack, fresh attempt, evidence collection, policy evaluation.

</specifics>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Product and phase definition
- `docs/design/factory-mode-ralph-gsd.md` — primary design document for OMC, Ralph loop, GSD integration, board model, runtime concepts, and v1 constraints
- `docs/design/omc-phase-01-context.md` — current phase boundary and locked Phase 1 decisions

### Existing platform context
- `README.md` — HOPI product framing and package-level overview
- `cli/README.md` — CLI/runtime integration boundaries relevant to Codex execution
- `hub/README.md` — backend/API/realtime capabilities to reuse
- `web/README.md` — existing web architecture and route patterns to reuse selectively

### Codebase maps
- `.planning/codebase/STRUCTURE.md` — package layout and likely integration points
- `.planning/codebase/STACK.md` — runtime/framework/tooling constraints
- `.planning/codebase/INTEGRATIONS.md` — key cross-package integration seams

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `hub/src/web/` already provides REST routing, auth, and server composition patterns suitable for a new `/omc` surface.
- `hub/src/sse/` and existing realtime pathways can carry OMC plan/runtime updates without inventing another transport.
- `hub/src/store/` and SQLite-backed persistence patterns are already good enough for first OMC runtime records.
- `cli/src/codex/` already gives a brownfield seam for Codex-first runtime integration.
- `web/src/router.tsx`, TanStack Router usage, and query/mutation patterns are reusable reference points even though OMC gets a new frontend subproject.
- Existing file/search/diff/worktree primitives in HOPI reduce the amount of new orchestration infrastructure Phase 1 needs.

### Established Patterns
- HOPI is local-first, runtime-heavy, and already comfortable with session transport plus hub-side persistence.
- Existing product surfaces are session-first; OMC must deliberately avoid inheriting that mental model as its primary object model.
- Current task/project surfaces show that status-heavy boards can become noisy when too many semantic states become columns.

### Integration Points
- New hub route namespace for `/omc`
- New shared schemas/events for OMC runtime objects
- Codex attempt runner integration in CLI/hub seam
- Planning indexer that reads markdown files and exposes parsed board/detail data
- Human review / merge gate built on top of existing git/worktree capabilities

</code_context>

<deferred>
## Deferred Ideas

- Automatic plan scheduling and policy-driven next-plan selection
- Automatic merge once evidence passes
- Multi-repo orchestration
- Rich planning editor or structured planning graph
- Legacy task/project compatibility views for OMC runtime objects

</deferred>

---
*Phase: 01-omc-foundation*
*Context gathered: 2026-03-29*
