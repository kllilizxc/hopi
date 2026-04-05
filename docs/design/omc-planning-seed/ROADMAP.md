# Roadmap: HOPI OMC

## Overview

This roadmap starts a new GSD workspace for the OMC product direction.

The first milestone establishes a runnable thin slice for native `Ralph loop + GSD` orchestration using HOPI's existing runtime infrastructure. Later phases deepen loop automation, review controls, and merge workflows.

## Redesign Note

On 2026-04-05, the prototype direction was explicitly reset around a **message-driven operator shell**. The earlier board-first Phase 1 work remains useful historical context, but the current repo-mirror planning reopens Phase 1 with new plans centered on:

- operator topic threads
- a real inbox + active-thread message surface
- main-canvas demotion from action surface to context surface

The historical Phase 2-5 entries below are retained as archive context for the earlier board-first line; they are not automatically treated as valid next steps for the new redesign track.

## Phases

**Phase Numbering:**
- This is a fresh workspace and a fresh roadmap
- Phase numbering starts again at `1`

- [ ] **Phase 1: OMC Foundation** - Rebuild the prototype around a message-driven operator shell with topic threads, assistant-ui-backed conversation, and a context-only main canvas
- [x] **Phase 2: Loop Orchestration** - Add richer Ralph loop control, repeated attempt policy, context-pack execution plumbing, and takeover/review transitions
- [x] **Phase 3: Review and Merge Cockpit** - Add merge packet generation, review tooling, and explicit approve/reopen flows for completed plans
- [x] **Phase 4: Program Bootstrap and Planning Attach** - Attach local repos like `PersonalQuant`, bootstrap missing planning, and remove the current empty-state dead end
- [x] **Phase 5: Guided Planning Flow** - Turn post-seed bootstrap into an in-product path from planning scaffold to the first executable plan cards

## Phase Details

### Phase 1: OMC Foundation
**Goal**: Ship the first runnable message-driven OMC operator shell where the right rail is the primary decision surface and the main canvas is contextual support.
**Depends on**: None
**Requirements**: [OMC-14, OMC-15, OMC-16, OMC-17, OMC-18, OMC-19, OMC-20]
**Success Criteria** (what must be TRUE):
  1. The right rail behaves like a real message app inbox plus active-thread conversation surface.
  2. Threads are topic-based and support both quick actions and freeform replies.
  3. Thread lifecycle is explicit and stable: `pending`, `in-progress`, `waiting`, `silent`, `resolved`.
  4. Dashboard, goal, and execution views stop owning the primary intervention controls.
  5. The active-thread surface reuses HOPI chat foundations instead of staying fully bespoke.
**Plans**: 3 plans

Plans:
- [ ] 01-01: Define operator thread domain and lifecycle
- [ ] 01-02: Build assistant-ui inbox and active-thread surface
- [ ] 01-03: Demote the canvas to context and wire thread handoff

### Phase 2: Loop Orchestration
**Goal**: Turn the single-attempt thin slice into a real within-plan Ralph loop with retry policy, deterministic context packs, and human escalation paths.
**Depends on**: Phase 1
**Requirements**: [OMC-02, OMC-03, OMC-04, OMC-05, OMC-06]
**Plans**: 3 plans

Plans:
- [x] 02-01: Add runtime adapter seam and normalized attempt-outcome ingestion
- [x] 02-02: Build loop policy engine, retry/review transitions, and system evidence harvesting
- [x] 02-03: Surface live loop control, takeover, and review state in OMC-client

### Phase 3: Review and Merge Cockpit
**Goal**: Make review, merge packets, and explicit merge decisions native parts of the OMC runtime.
**Depends on**: Phase 2
**Requirements**: [OMC-05, OMC-06]
**Plans**: 3 plans

Plans:
- [x] 03-01: Add review/merge contracts, merge packet builder, and review APIs
- [x] 03-02: Implement merge approval execution plus merge-blocked/conflict handling
- [x] 03-03: Build the OMC review cockpit and live review/merge control UX

### Phase 4: Program Bootstrap and Planning Attach
**Goal**: Let OMC attach an arbitrary local git repo, detect or create its planning root, and guide the user into a planning-first flow instead of a dead-end empty board.
**Depends on**: Phase 3
**Requirements**: [OMC-03, OMC-07, OMC-08, OMC-09, OMC-10]
**Success Criteria** (what must be TRUE):
  1. A user can attach a local git repo such as `/Users/realizer/Code/PersonalQuant` as an OMC program.
  2. OMC can detect an existing `.planning` tree for that repo without relying on global env vars.
  3. If planning is missing, OMC offers explicit actions to attach existing planning or create a minimal seed.
  4. Creating a seed writes a minimal markdown planning scaffold inside the attached repo, not a hidden external workspace.
  5. After attach/bootstrap, the user lands in a planning-first posture rather than accidentally starting execution.
**Plans**: 3 plans

Plans:
- [x] 04-01: Add backend attach/bootstrap contracts, validation, and repo-local planning seed writer
- [x] 04-02: Build local repo attach UX and safe program selection in OMC-client
- [x] 04-03: Replace planning-missing dead end with planning-first bootstrap guidance

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. OMC Foundation | 0/3 | Replanned | 2026-04-05 |
| 2. Loop Orchestration | 3/3 | Historical | 2026-03-30 |
| 3. Review and Merge Cockpit | 3/3 | Historical | 2026-03-30 |
| 4. Program Bootstrap and Planning Attach | 3/3 | Historical | 2026-03-30 |
| 5. Guided Planning Flow | 3/3 | Historical | 2026-03-30 |

### Phase 5: Guided Planning Flow
**Goal**: Turn the post-seed bootstrap state into a guided, in-product planning continuation that produces the first real `PLAN.md` cards.
**Depends on**: Phase 4
**Requirements**: [OMC-03, OMC-07, OMC-10, OMC-11, OMC-12, OMC-13]
**Success Criteria** (what must be TRUE):
  1. A user can continue from planning seed to guided planning without leaving OMC for manual CLI-only steps.
  2. OMC surfaces planning progress and failures clearly while the guided planning flow runs.
  3. The first executable `PLAN.md` cards appear through the product flow, not only through manual out-of-band commands.
  4. Once those plans exist, OMC hands back to the normal plan board automatically.
**Plans**: 3 plans

Plans:
- [x] 05-01: Add guided-planning runtime contracts, persistence, and realtime events
- [x] 05-02: Implement guided-planning orchestration from brief to first plan cards
- [x] 05-03: Build guided-planning UX and automatic board handoff in OMC-client
