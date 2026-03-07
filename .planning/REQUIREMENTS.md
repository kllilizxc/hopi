# Requirements: HOPI

**Defined:** 2026-03-07
**Core Value:** Project actions should feel as flexible and self-correcting as normal agent work: agent sees tool output, adapts, fixes, retries.

## v1 Requirements

Requirements for the merge-first iteration. Each maps to roadmap phases.

### Merge Flow

- [ ] **MERGE-01**: User can trigger Merge for a task and keep execution in the linked task conversation/session
- [ ] **MERGE-02**: First merge attempt runs the project's repo-owned merge workflow from `.hopi/merge.sh` inside the workspace sandbox
- [ ] **MERGE-03**: Merge execution uses normal agent tool-call semantics rather than a hidden backend-only workflow
- [ ] **MERGE-04**: Agent can inspect current git/worktree state after a failed merge attempt before deciding next steps
- [ ] **MERGE-05**: Agent can retry merge within the same session after applying fixes inside the workspace

### Repair Loop

- [ ] **REPAIR-01**: Agent receives merge tool-call success/failure from real stdout/stderr or equivalent tool output visible in normal agent flow
- [ ] **REPAIR-02**: Agent can edit `.hopi/merge.sh` when script issues are the cause of merge failure
- [ ] **REPAIR-03**: Agent can edit other workspace files when resolving merge blockers requires repo-local fixes
- [ ] **REPAIR-04**: System prevents blind retry loops by distinguishing new progress from repeated identical failure states
- [ ] **REPAIR-05**: System stops automatic recovery only when a real blocker requires human judgment or work outside the workspace sandbox

### Action State

- [ ] **ACTION-01**: Merge action status persists across reloads/reconnects and remains visible across HOPI remote surfaces
- [ ] **ACTION-02**: User can see concise in-product status for merge attempts, retries, success, and blocked states
- [ ] **ACTION-03**: Merge action stays attached to the task/session context instead of creating a detached opaque workflow

### Verification

- [ ] **VERIFY-01**: System verifies actual git merge outcome before marking the task/worktree as merged
- [ ] **VERIFY-02**: System does not report success only because a script exited with code 0
- [ ] **VERIFY-03**: When merge cannot complete automatically, user receives a clear blocker summary and required manual next step

## v2 Requirements

Deferred until merge-first flow is trusted.

### Additional Actions

- **PREVIEW-01**: Preview action uses the same conversation-native repair/retry runtime as Merge
- **INIT-01**: Init action uses the same conversation-native runtime instead of a special pre-kickoff path
- **ACTION-04**: Project can define additional custom actions beyond init/merge/preview on the same runtime envelope

### Script Contract

- **SCRIPT-01**: Project scripts can declare optional metadata or health checks to reduce drift and speed recovery
- **SCRIPT-02**: System can surface script drift/self-test guidance before a user-triggered action fails

## Out of Scope

| Feature | Reason |
|---------|--------|
| Preview parity in merge-first v1 | Keep first slice focused on proving the merge loop end-to-end |
| Init parity in merge-first v1 | Defer until the core action runtime is trusted |
| Universal built-in merge workflow replacing repo scripts | Repos are too customized; project policy should stay in-repo |
| Fully generic action framework on day one | Overbuild risk before merge-first reliability is proven |
| Hidden backend retries invisible to the agent | Conflicts with the core product direction and reduces trust |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MERGE-01 | Phase 1 | Pending |
| MERGE-02 | Phase 2 | Pending |
| MERGE-03 | Phase 1 | Pending |
| MERGE-04 | Phase 2 | Pending |
| MERGE-05 | Phase 2 | Pending |
| REPAIR-01 | Phase 2 | Pending |
| REPAIR-02 | Phase 2 | Pending |
| REPAIR-03 | Phase 2 | Pending |
| REPAIR-04 | Phase 3 | Pending |
| REPAIR-05 | Phase 2 | Pending |
| ACTION-01 | Phase 1 | Pending |
| ACTION-02 | Phase 1 | Pending |
| ACTION-03 | Phase 1 | Pending |
| VERIFY-01 | Phase 3 | Pending |
| VERIFY-02 | Phase 3 | Pending |
| VERIFY-03 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0

---
*Requirements defined: 2026-03-07*
*Last updated: 2026-03-07 after roadmap draft*
