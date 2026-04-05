---
phase: 03
slug: review-and-merge-cockpit
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-30
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test + Vitest + TypeScript strict checks |
| **Config file** | `package.json` root scripts plus package-local TS/build config |
| **Quick run command** | `cd hopi && bun test hub/src/web/routes/omc.test.ts hub/src/sync/omc/*.test.ts && bun run typecheck:hub && bun run typecheck:omc` |
| **Full suite command** | `cd hopi && bun run typecheck && bun run test && bun run build` |
| **Estimated runtime** | ~180-360 seconds |

**Baseline note:** `cd hopi && bun run test:hub` currently has two unrelated historical failures in `hub/src/web/routes/tasks.start-session.test.ts`, so Phase 3 should gate on targeted OMC hub suites plus typechecks/builds until that baseline is repaired.

---

## Sampling Rate

- **After every backend review/merge task:** Run `cd hopi && bun test hub/src/web/routes/omc.test.ts hub/src/sync/omc/*.test.ts && bun run typecheck:hub`
- **After every shared-contract task:** Also run `cd hopi && bun run typecheck`
- **After every frontend cockpit task:** Run `cd hopi && bun run typecheck:omc && bun run build:omc`
- **After every plan wave:** Run `cd hopi && bun test hub/src/web/routes/omc.test.ts hub/src/sync/omc/*.test.ts && bun run typecheck`
- **Before `$gsd-verify-work`:** Full suite should be attempted, with unrelated baseline failures called out explicitly if still present
- **Max feedback latency:** 360 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | OMC-05, OMC-06 | shared/runtime review+merge contract | `cd hopi && bun run typecheck` | ✅ | ⬜ pending |
| 03-01-02 | 01 | 1 | OMC-05, OMC-06 | merge packet builder + review APIs | `cd hopi && bun test hub/src/web/routes/omc.test.ts hub/src/sync/omc/*.test.ts && bun run typecheck:hub` | ✅ | ⬜ pending |
| 03-02-01 | 02 | 2 | OMC-06 | merge approval execution + success path | `cd hopi && bun test hub/src/web/routes/omc.test.ts hub/src/sync/omc/*.test.ts && bun run typecheck:hub` | ✅ | ⬜ pending |
| 03-02-02 | 02 | 2 | OMC-05, OMC-06 | merge-blocked and conflict handling | `cd hopi && bun test hub/src/web/routes/omc.test.ts hub/src/sync/omc/*.test.ts && bun run typecheck:hub` | ✅ | ⬜ pending |
| 03-03-01 | 03 | 3 | OMC-05, OMC-06 | review cockpit route + API client helpers | `cd hopi && bun run typecheck:omc && bun run build:omc` | ✅ | ⬜ pending |
| 03-03-02 | 03 | 3 | OMC-05, OMC-06 | decision-first merge packet UX + live review/merge updates | `cd hopi && bun run typecheck:omc && bun run build:omc` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ mixed/manual companion required*

---

## Wave 0 Requirements

- [x] Existing OMC runtime already persists review-required and merge-approved footholds.
- [x] Existing git RPCs already support merge-state checks and actual worktree merge execution.
- [x] Existing task merge flows provide operator-state and blocked/conflict reference patterns.
- [x] Existing OMC UI already has a runtime home suitable for a hybrid review posture.
- [x] No new test framework installation is required for this phase.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Review cockpit answers “Can I merge this?” in the first screenful | OMC-05, OMC-06 | This is product comprehension and hierarchy, not just data presence | Move one plan into `Review`, open the cockpit, and confirm the top section clearly shows blockers/warnings, checks, branch/worktree, attempt count, and changed-files summary before long history |
| Review approval and merge approval stay distinct | OMC-06 | The difference is user-flow semantics, not just timestamps | Approve review, confirm the plan remains in `Review` and becomes merge-ready rather than auto-merging |
| `Resume loop` and `Back to planning` return the plan to different operational states | OMC-06 | The core correctness is operator intent and resulting column/state | From a reviewable plan, trigger each action separately and confirm one returns to `Running` while the other returns to `Planning` |
| Ordinary merge failures stay in `Review` as merge-blocked | OMC-06 | This is about state semantics and operator posture | Simulate a non-conflict merge failure and confirm the card stays in `Review`, shows merge-blocked state, and offers explicit next actions instead of auto-jumping |
| Merge conflicts stay in `Review` and lead into takeover | OMC-06 | Conflict handling crosses merge state, evidence, and session navigation | Simulate a conflict, confirm conflict file list is surfaced, and use `Resolve conflicts` to open the takeover session on the same worktree |
| Successful merge transitions the plan to a done/merged posture | OMC-05, OMC-06 | This is end-to-end state correctness, not just one route response | Complete a merge success path and confirm the plan leaves `Review`, shows merged/done state, and no longer presents merge CTAs |

---

## Validation Sign-Off

- [x] All intended plan areas have automated coverage paths or explicit manual companions
- [x] Sampling continuity: no plan wave depends solely on manual verification
- [x] Wave 0 covers all required references
- [x] No watch-mode flags
- [x] Feedback latency < 360s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
