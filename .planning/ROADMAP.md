# Roadmap: HOPI

## Overview

Phases 1-3 shipped the merge-first conversation-native action runtime. This roadmap continues numbering for the next milestone: bring Preview and Init up to the same product bar, then consolidate the shared action contract so Merge, Preview, and Init behave like one coherent runtime.

## Phases

**Phase Numbering:**
- Integer phases continue from prior milestone work
- Phases 1-3 completed in v1.0
- This milestone starts at Phase 4

- [x] **Phase 4: Preview Action Parity** - Make Preview feel like Merge: direct session tool call first, transcript-visible repair loop, durable runtime state
- [x] **Phase 5: Init Action Parity** - Turn Init into a first-class in-session action runtime instead of a special pre-kickoff path
- [x] **Phase 6: Shared Action Runtime Consolidation** - Unify action-state contracts, transcript patterns, and control surfaces across Merge, Preview, and Init

## Phase Details

### Phase 4: Preview Action Parity
**Goal**: Preview becomes a direct-run-first, conversation-native action with the same repair and blocker discipline as Merge.
**Depends on**: Phase 3
**Requirements**: [PREVIEW-01, PREVIEW-02, PREVIEW-03, PREVIEW-04]
**Success Criteria** (what must be TRUE):
  1. Clicking Preview auto-runs the project preview path directly in the linked session whenever the session is idle.
  2. Direct preview failures and early crashes append transcript-visible results into the thread before the agent repair loop continues.
  3. Preview retries stop on repeated identical blockers or real out-of-sandbox needs with a clear manual next step.
  4. Preview status remains durable and understandable across task and conversation surfaces.
**Plans**: 3 plans

Plans:
- [x] 04-01: Route Preview trigger through the merge-style direct-run action scaffold
- [x] 04-02: Add preview retry fingerprinting, blocker summaries, and late-crash loop control
- [x] 04-03: Surface durable preview runtime status, cancel, and retry UX across web/task views

### Phase 5: Init Action Parity
**Goal**: Init runs as an observable action inside the task session instead of a hidden bootstrap branch.
**Depends on**: Phase 4
**Requirements**: [INIT-01, INIT-02, INIT-03]
**Success Criteria** (what must be TRUE):
  1. Init execution is represented as a typed action run tied to the task session, not just a route-local preflight step.
  2. Failed init attempts keep the session alive, preserve the CLI transcript in-thread, and let the agent repair/retry before task work proceeds.
  3. Init uses the same durable runtime vocabulary as Merge and Preview for running, retrying, blocked, and succeeded states.
  4. Starting a task session no longer feels like a separate automation system from the rest of HOPI actions.
**Plans**: 3 plans

Plans:
- [x] 05-01: Promote init execution into an explicit action runtime during session start
- [x] 05-02: Reuse transcript-led repair, retry, and blocker handling for init failures
- [x] 05-03: Surface durable init runtime state and summaries across task/session views

### Phase 6: Shared Action Runtime Consolidation
**Goal**: Merge, Preview, and Init share one coherent action runtime contract and UI story.
**Depends on**: Phase 5
**Requirements**: [ACTION-04, ACTION-05, ACTION-06]
**Success Criteria** (what must be TRUE):
  1. Merge, Preview, and Init use the same action-state model for direct-run, retry, cancel, blocked, and success cases.
  2. CLI-style transcript messages for action attempts are consistent across all three built-in actions.
  3. Busy-session deferral and auto-resume semantics behave consistently instead of being action-specific special cases.
  4. The codebase is ready for future custom actions without forcing a generic framework into this milestone.
**Plans**: 3 plans

Plans:
- [x] 06-01: Consolidate shared action runtime contracts and persisted state across hub/web/shared
- [x] 06-02: Normalize task/thread control surfaces for cancel, retry, and blocker summaries
- [x] 06-03: Clean extension seams and docs for future repo-defined actions without shipping the generic framework yet

## Progress

**Execution Order:**
Phases execute in numeric order: 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 4. Preview Action Parity | 3/3 | Completed | 2026-03-08 |
| 5. Init Action Parity | 3/3 | Completed | 2026-03-08 |
| 6. Shared Action Runtime Consolidation | 3/3 | Completed | 2026-03-09 |
