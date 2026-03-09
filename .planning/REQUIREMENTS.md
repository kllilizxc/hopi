# Requirements: HOPI

**Defined:** 2026-03-08
**Core Value:** Project actions should feel as flexible and self-correcting as normal agent work: agent sees tool output, adapts, fixes, retries.

## v1.1 Requirements

Requirements for the Preview/Init parity milestone. Each maps to roadmap phases 4-6.

### Preview

- [ ] **PREVIEW-01**: User can click Preview and have HOPI auto-run the repo-local preview start path directly in the linked task session before any agent repair prompt
- [ ] **PREVIEW-02**: When direct preview start fails or the preview crashes shortly after start, the agent receives transcript-visible CLI output and can repair or retry in the same session
- [ ] **PREVIEW-03**: Preview action exposes durable running, retrying, blocked, ready, and stopped state across task and thread surfaces
- [ ] **PREVIEW-04**: Preview recovery stops on repeated identical blockers or real out-of-sandbox needs and shows the exact manual next step

### Init

- [ ] **INIT-01**: Task init runs through the same conversation-native action runtime instead of a special hidden pre-kickoff path
- [ ] **INIT-02**: Init failures keep the started session alive, append CLI-style transcript output into the thread, and let the agent repair or retry before continuing task work
- [ ] **INIT-03**: Init action exposes durable running, retrying, blocked, and succeeded state consistent with Merge and Preview

### Action Runtime

- [ ] **ACTION-04**: Merge, Preview, and Init share one durable action-state contract for direct-run, retry, cancel, blocker, and success summaries
- [ ] **ACTION-05**: Action-triggered tool results appear in the session thread in a consistent CLI-style transcript format across Merge, Preview, and Init
- [ ] **ACTION-06**: Busy linked sessions defer the first direct action run until the session is idle, then auto-run without forcing the user through an extra manual chat step

## v2 Requirements

Deferred until action parity is trusted.

### Custom Actions

- **ACTION-07**: Project can define additional custom actions beyond Init, Merge, and Preview on the same runtime envelope
- **SCRIPT-01**: Project scripts can declare optional metadata or health checks to reduce drift and speed recovery
- **SCRIPT-02**: System can surface script drift or self-test guidance before a user-triggered action fails

## Out of Scope

| Feature | Reason |
|---------|--------|
| Generic action manifest framework | Defer until the three built-in actions share one stable contract |
| Repo script health-check protocol | Useful follow-on work, but not required to prove parity |
| New preview hosting or deployment flows | Not part of the action-runtime consistency problem |
| Non-workspace automation or hidden backend retries | Conflicts with the product direction and trust model |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PREVIEW-01 | Phase 4 | Pending |
| PREVIEW-02 | Phase 4 | Pending |
| PREVIEW-03 | Phase 4 | Pending |
| PREVIEW-04 | Phase 4 | Pending |
| INIT-01 | Phase 5 | Pending |
| INIT-02 | Phase 5 | Pending |
| INIT-03 | Phase 5 | Pending |
| ACTION-04 | Phase 6 | Pending |
| ACTION-05 | Phase 6 | Pending |
| ACTION-06 | Phase 6 | Pending |

**Coverage:**
- v1.1 requirements: 10 total
- Mapped to phases: 10
- Unmapped: 0

---
*Requirements defined: 2026-03-08*
*Last updated: 2026-03-08 after v1.1 milestone kickoff*
