# Roadmap: HOPI OMC

## Overview

This roadmap starts a new GSD workspace for the OMC product direction.

The first milestone establishes a runnable thin slice for native `Ralph loop + GSD` orchestration using HOPI's existing runtime infrastructure. Later phases deepen loop automation, review controls, and merge workflows.

## Phases

**Phase Numbering:**
- This is a fresh workspace and a fresh roadmap
- Phase numbering starts again at `1`

- [ ] **Phase 1: OMC Foundation** - Create the first runnable OMC thin slice with markdown planning index, plan board, manual loop start, and attempt visibility
- [ ] **Phase 2: Loop Orchestration** - Add richer Ralph loop control, repeated attempt policy, context-pack execution plumbing, and takeover/review transitions
- [ ] **Phase 3: Review and Merge Cockpit** - Add merge packet generation, review tooling, and explicit approve/reopen flows for completed plans

## Phase Details

### Phase 1: OMC Foundation
**Goal**: Ship the first runnable OMC control plane that can read plans, display them as execution cards, and manually run a single plan attempt.
**Depends on**: None
**Requirements**: [OMC-01, OMC-02, OMC-03, OMC-04, OMC-05, OMC-07, OMC-08]
**Success Criteria** (what must be TRUE):
  1. A new `OMC-client/` subproject exists and is clearly separated from the current `web/` product shell.
  2. OMC can parse markdown `PLAN.md` files and render them as phase-grouped cards.
  3. A user can manually start one plan loop and observe the resulting attempt.
  4. Attempt history and evidence are visible as first-class runtime data.
  5. Plan detail is execution-first rather than document-first.
**Plans**: 3 plans

Plans:
- [ ] 01-01: Seed OMC domain model and hub-side runtime APIs/events
- [ ] 01-02: Build planning indexer plus phase-grouped OMC board
- [ ] 01-03: Add plan detail, manual plan start, and attempt/evidence inspection

### Phase 2: Loop Orchestration
**Goal**: Turn the single-attempt thin slice into a real within-plan Ralph loop with retry policy, deterministic context packs, and human escalation paths.
**Depends on**: Phase 1
**Requirements**: [OMC-02, OMC-03, OMC-04, OMC-05, OMC-06]

### Phase 3: Review and Merge Cockpit
**Goal**: Make review, merge packets, and explicit merge decisions native parts of the OMC runtime.
**Depends on**: Phase 2
**Requirements**: [OMC-05, OMC-06]

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. OMC Foundation | 0/3 | Not started | - |
| 2. Loop Orchestration | 0/0 | Not started | - |
| 3. Review and Merge Cockpit | 0/0 | Not started | - |
