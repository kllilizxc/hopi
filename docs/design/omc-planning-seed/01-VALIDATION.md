---
phase: 01
slug: omc-foundation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-29
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test + Vitest + TypeScript strict checks |
| **Config file** | `hopi/package.json` root scripts plus package-local Vitest/TS config |
| **Quick run command** | `cd hopi && bun run test:hub && bun run typecheck:hub && bun run typecheck:web` |
| **Full suite command** | `cd hopi && bun run typecheck && bun run test` |
| **Estimated runtime** | ~120-240 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd hopi && bun run test:hub && bun run typecheck:hub && bun run typecheck:web`
- **After every plan wave:** Run `cd hopi && bun run typecheck && bun run test`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 240 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | OMC-01, OMC-04 | hub/shared schema + route contract | `cd hopi && bun run test:hub && bun run typecheck:hub` | ✅ | ⬜ pending |
| 01-01-02 | 01 | 1 | OMC-05, OMC-08 | runtime persistence + attempt/evidence storage | `cd hopi && bun run test:hub && bun run typecheck:hub` | ✅ | ⬜ pending |
| 01-02-01 | 02 | 2 | OMC-02, OMC-03 | planning indexer and board data shaping | `cd hopi && bun run test:hub && bun run typecheck:hub && bun run typecheck:web` | ✅ | ⬜ pending |
| 01-02-02 | 02 | 2 | OMC-01 | second frontend package build/serve wiring | `cd hopi && bun run build` | ✅ | ⬜ pending |
| 01-03-01 | 03 | 3 | OMC-04, OMC-05 | manual plan start and attempt inspection | `cd hopi && bun run test:hub && bun run typecheck:hub && bun run typecheck:web` | ✅ | ⬜ pending |
| 01-03-02 | 03 | 3 | OMC-07 | plan detail and thin planning actions | `cd hopi && bun run typecheck:web` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ mixed/manual companion required*

---

## Wave 0 Requirements

- [x] Existing infrastructure already covers hub route tests and strict TS checks.
- [x] Existing frontend test/tooling patterns in `web/` can be copied into `OMC-client/`.
- [x] Root build/test scripts already exist in `hopi/package.json`; Phase 1 only needs to extend them for the second frontend package.
- [x] No new test framework installation is required for this phase.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `/omc` serves the new client without regressing the existing app | OMC-01 | Static serving and route fallback behavior are easiest to confirm end-to-end | Build the repo, run the hub, open `/` and `/omc`, confirm each app loads the correct shell |
| Board correctly reflects real markdown plans | OMC-02, OMC-03 | Product correctness depends on legible plan grouping and metadata, not just API shape | Seed sample `PLAN.md` files, load the board, confirm phase grouping, checklist counts, and first-open-item summary are correct |
| Manual plan start produces an inspectable attempt flow | OMC-04, OMC-05 | The user-facing control-plane feel needs an end-to-end smoke check | Start one plan from OMC, confirm runtime moves into `Running`, then inspect the attempt detail and evidence surfaces |
| Plan detail remains execution-first | OMC-07 | Layout priority is a product decision, not just a component test | Open a plan detail screen and confirm runtime/actions are visually primary over markdown content |

---

## Validation Sign-Off

- [x] All intended plan areas have automated coverage paths or explicit manual companions
- [x] Sampling continuity: no plan wave depends solely on manual verification
- [x] Wave 0 covers all required references
- [x] No watch-mode flags
- [x] Feedback latency < 240s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
