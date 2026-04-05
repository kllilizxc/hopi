# Phase 5: Guided Planning Flow - Validation

**Prepared:** 2026-03-30
**Phase:** 05-guided-planning-flow

## Requirements Coverage

### OMC-03 Markdown-first planning
- Covered by `05-02`
- Guided planning must produce standard `.planning/*` artifacts and real `PLAN.md` files rather than a DB-only planning mode.

### OMC-07 Thin editing posture
- Covered by `05-03`
- The user input remains a lightweight planning brief, not a full planning editor.

### OMC-10 Planning bootstrap
- Extended by `05-02` and `05-03`
- After bootstrap exists, the product can continue from seed to actual plan emergence.

### OMC-11 Guided planning continuation
- Covered directly by `05-01`, `05-02`, and `05-03`
- Program-level planning runtime, orchestration, and UI actions all contribute to this requirement.

### OMC-12 Planning-run visibility
- Covered by `05-01`, `05-02`, and `05-03`
- Persistence, events, backend outcomes, and frontend progress/failure display all contribute here.

### OMC-13 Plan emergence handoff
- Covered by `05-02` and `05-03`
- Backend checks for real plan emergence and frontend automatic handoff together satisfy this requirement.

## Plan Responsibilities

### 05-01
- defines shared guided-planning runtime contracts
- adds durable runtime persistence
- exposes read-side planning-run state

### 05-02
- implements guided-planning orchestration
- turns brief input into a real session-backed planning run
- recognizes first-plan emergence as success

### 05-03
- exposes guided-planning actions in OMC-client
- shows live progress/failure
- hands the user back to the board automatically

## Verification Gates

Before marking the phase complete:

- `bun run typecheck`
- `bun run typecheck:hub`
- `bun run typecheck:omc`
- `bun run build:omc`
- `bun test hub/src/web/routes/omc.test.ts hub/src/sync/omc/*.test.ts`
- manual smoke on `/Users/realizer/Code/PersonalQuant`:
  1. attach repo
  2. create planning seed
  3. start guided planning from OMC
  4. observe progress/failure state
  5. confirm first `PLAN.md` cards appear
  6. confirm board switches from bootstrap mode to normal cards

## Risks To Watch During Execution

- guided planning accidentally reusing plan-attempt runtime and muddying semantics
- nested interactive prompts making the flow brittle
- “completed” state without actual `PLAN.md` files
- UI hiding failures and silently returning to the same bootstrap panel
