---
phase: 04
slug: program-bootstrap-and-planning-attach
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-30
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test + Vitest + TypeScript strict checks |
| **Config file** | `package.json` root scripts plus package-local TS/build config |
| **Quick run command** | `cd hopi && bun test hub/src/web/routes/omc.test.ts && bun run typecheck:hub && bun run typecheck:omc` |
| **Full suite command** | `cd hopi && bun run typecheck && bun run test && bun run build` |
| **Estimated runtime** | ~180-360 seconds |

**Baseline note:** `cd hopi && bun run test:hub` still has two unrelated historical failures in `hub/src/web/routes/tasks.start-session.test.ts`, so Phase 4 should gate on targeted OMC route tests plus typechecks/builds until that baseline is repaired.

---

## Sampling Rate

- **After every backend attach/bootstrap task:** Run `cd hopi && bun test hub/src/web/routes/omc.test.ts && bun run typecheck:hub`
- **After every shared-contract task:** Also run `cd hopi && bun run typecheck`
- **After every frontend attach/bootstrap task:** Run `cd hopi && bun run typecheck:omc && bun run build:omc`
- **After every plan wave:** Run `cd hopi && bun test hub/src/web/routes/omc.test.ts && bun run typecheck`
- **Before `$gsd-verify-work`:** Attempt full suite and call out unrelated baseline failures explicitly if still present
- **Max feedback latency:** 360 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | OMC-09, OMC-10 | shared/backend attach-bootstrap contracts | `cd hopi && bun run typecheck` | ✅ | ⬜ pending |
| 04-01-02 | 01 | 1 | OMC-09, OMC-10 | attach/seed routes + repo validation | `cd hopi && bun test hub/src/web/routes/omc.test.ts && bun run typecheck:hub` | ✅ | ⬜ pending |
| 04-02-01 | 02 | 2 | OMC-09 | OMC attach form + program navigation | `cd hopi && bun run typecheck:omc && bun run build:omc` | ✅ | ⬜ pending |
| 04-02-02 | 02 | 2 | OMC-09, OMC-10 | client helpers for attach/bootstrap APIs | `cd hopi && bun run typecheck:omc && bun run build:omc` | ✅ | ⬜ pending |
| 04-03-01 | 03 | 3 | OMC-03, OMC-07, OMC-10 | planning-missing action panel | `cd hopi && bun run typecheck:omc && bun run build:omc` | ✅ | ⬜ pending |
| 04-03-02 | 03 | 3 | OMC-10 | planning seed follow-through guidance | `cd hopi && bun run typecheck:omc && bun run build:omc` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ mixed/manual companion required*

---

## Wave 0 Requirements

- [x] Existing OMC runtime already persists `Program` records with `repoRoot` and `planningRoot`.
- [x] Existing OMC route tests already create temp repos and markdown planning fixtures.
- [x] Existing planning-root detection utility already exists in `hub/src/sync/omc/programPaths.ts`.
- [x] Existing OMC UI already shows the exact planning-missing dead end that Phase 4 needs to replace.
- [x] No new test framework installation is required for this phase.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Attaching `/Users/realizer/Code/PersonalQuant` creates a real selectable program | OMC-09 | Real-user repo attach is an integration journey, not just one route response | Attach the repo from OMC, confirm it appears in Programs, and confirm the selected program shows the new repo root |
| Missing planning state offers explicit attach/seed actions instead of env-var-only guidance | OMC-10 | This is product posture and wording, not just API correctness | Open a repo with no `.planning` and confirm both `Attach existing planning` and `Create planning seed` are visible |
| Seed creation is planning-first rather than execution-first | OMC-07, OMC-10 | This is about UI hierarchy and operator expectations | Create a seed, then confirm the next screen emphasizes files and next planning steps rather than `Start plan` |
| Seed files are written inside the repo at `.planning/*` | OMC-03, OMC-10 | This must be confirmed against the real filesystem | After creating a seed, inspect the repo and confirm `.planning/PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`, and `phases/01-bootstrap/01-CONTEXT.md` exist |

---

## Validation Sign-Off

- [x] All intended plan areas have automated coverage paths or explicit manual companions
- [x] Sampling continuity: no plan wave depends solely on manual verification
- [x] Wave 0 covers all required references
- [x] No watch-mode flags
- [x] Feedback latency < 360s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
