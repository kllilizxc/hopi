# Roadmap: HOPI

## Overview

This roadmap evolves HOPI's existing project script and task-session system into a merge-first, conversation-native action runtime. The path is intentionally coarse: first unify action triggering and state around the task conversation, then ship the self-healing merge loop inside the workspace sandbox, then harden verification and retry behavior so merge results are trustworthy before extending the same model to Preview and Init.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions if needed later

- [ ] **Phase 1: Merge Action Runtime** - Attach Merge to the linked task conversation with durable, replayable action state
- [ ] **Phase 2: Self-Healing Merge Loop** - Run project merge flow in normal tool calls and let the agent inspect, fix, and retry in-session
- [ ] **Phase 3: Verified Completion & Recovery Control** - Prevent false success and blind loops with repo-truth verification and blocker discipline

## Phase Details

### Phase 1: Merge Action Runtime
**Goal**: Merge becomes a first-class action inside the linked task conversation instead of a detached opaque workflow.
**Depends on**: Nothing (first phase)
**Requirements**: [MERGE-01, MERGE-03, ACTION-01, ACTION-02, ACTION-03]
**Success Criteria** (what must be TRUE):
  1. User can click Merge and see the action start in the existing task/session context.
  2. Merge status survives refresh/reconnect and remains visible across HOPI surfaces.
  3. The product exposes clear action states for queued/running/blocked/succeeded behavior.
  4. Merge no longer feels like a detached backend-only workflow from the user's perspective.
**Plans**: 1/3 plans executed

Plans:
- [x] 01-01: Define canonical merge action contracts, state vocabulary, and persistence model (completed 2026-03-07)
- [ ] 01-02: Route Merge trigger into the linked task conversation/session flow
- [ ] 01-03: Surface durable action status and replay across web/task views

### Phase 2: Self-Healing Merge Loop
**Goal**: The agent executes the merge workflow inside normal tool-call flow, sees failures, applies repo-local fixes, and retries in the same session.
**Depends on**: Phase 1
**Requirements**: [MERGE-02, MERGE-04, MERGE-05, REPAIR-01, REPAIR-02, REPAIR-03, REPAIR-05]
**Success Criteria** (what must be TRUE):
  1. First merge attempt runs `.hopi/merge.sh` from the correct project root inside the workspace sandbox.
  2. When merge fails, the agent can see the actual tool-call result and inspect git/worktree state before retrying.
  3. The agent can repair `.hopi/merge.sh` or other workspace files and retry within the same task session.
  4. Automatic recovery stops only when a real blocker requires human judgment or out-of-sandbox work.
**Plans**: 3 plans

Plans:
- [ ] 02-01: Dispatch merge requests as structured in-session action prompts with normal tool semantics
- [ ] 02-02: Implement agent-visible inspect/fix/retry loop for merge and script failures
- [ ] 02-03: Enforce workspace-sandbox boundaries and explicit blocker handoff behavior

### Phase 3: Verified Completion & Recovery Control
**Goal**: Merge outcomes become trustworthy through post-run verification, loop control, and clear blocker summaries.
**Depends on**: Phase 2
**Requirements**: [REPAIR-04, VERIFY-01, VERIFY-02, VERIFY-03]
**Success Criteria** (what must be TRUE):
  1. HOPI marks a task merged only after actual git truth confirms the target contains the intended changes.
  2. A clean script exit alone cannot produce a false-success merge state.
  3. Repeated identical failures do not spin forever; the system detects loops and stops with a useful blocker summary.
  4. When automation cannot finish the merge, the user sees the exact manual next step.
**Plans**: 3 plans

Plans:
- [ ] 03-01: Add repo-truth verification before merge completion state changes
- [ ] 03-02: Add retry fingerprinting and loop-stopping logic for repeated failures
- [ ] 03-03: Polish blocked/success summaries and task merge metadata updates

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Merge Action Runtime | 1/3 | In Progress | - |
| 2. Self-Healing Merge Loop | 0/3 | Not started | - |
| 3. Verified Completion & Recovery Control | 0/3 | Not started | - |
