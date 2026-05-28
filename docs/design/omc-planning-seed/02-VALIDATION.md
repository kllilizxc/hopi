---
phase: 02
slug: loop-orchestration
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-30
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Bun test + Vitest + TypeScript strict checks |
| **Config file** | `hopi/package.json` root scripts plus package-local TS/build config |
| **Quick run command** | `cd hopi && bun run test:hub && bun run typecheck:hub && bun run typecheck:omc` |
| **Full suite command** | `cd hopi && bun run typecheck && bun run test && bun run build` |
| **Estimated runtime** | ~180-300 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd hopi && bun run test:hub && bun run typecheck:hub`
- **After every frontend-touching task:** Also run `cd hopi && bun run typecheck:omc && bun run build:omc`
- **After every plan wave:** Run `cd hopi && bun run typecheck && bun run test`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 300 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 1 | OMC-04 | runtime adapter seam + shared typing | `cd hopi && bun run test:hub && bun run typecheck:hub` | ✅ | ⬜ pending |
| 02-01-02 | 01 | 1 | OMC-05 | structured completion parsing + fallback termination | `cd hopi && bun run test:hub && bun run typecheck:hub` | ✅ | ⬜ pending |
| 02-02-01 | 02 | 2 | OMC-02, OMC-03, OMC-06 | loop-policy transitions, markdown-backed next-attempt context, and review escalation | `cd hopi && bun run test:hub && bun run typecheck:hub` | ✅ | ⬜ pending |
| 02-02-02 | 02 | 2 | OMC-05 | changed-file / diff-summary evidence harvesting | `cd hopi && bun run test:hub && bun run typecheck:hub` | ✅ | ⬜ pending |
| 02-03-01 | 03 | 3 | OMC-05, OMC-06 | control-plane plan detail and board actions | `cd hopi && bun run typecheck:omc && bun run build:omc` | ✅ | ⬜ pending |
| 02-03-02 | 03 | 3 | OMC-06 | takeover deep-link and attempt inspection UX | `cd hopi && bun run typecheck:omc && bun run build:omc` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ mixed/manual companion required*

---

## Wave 0 Requirements

- [x] Existing hub/session message ingress can be extended for OMC completion parsing without new infrastructure.
- [x] Existing git RPCs already support status and diff-summary collection for system-grounded evidence.
- [x] Existing OMC runtime store already has loop counters and review flags that Phase 2 policy can build on.
- [x] Existing HOPI session routes can serve as takeover target without building a new embedded session console.
- [x] No new test framework installation is required for this phase.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Structured completion triggers automatic follow-up behavior correctly | OMC-04, OMC-05 | The async control-plane feel depends on end-to-end session timing, not just unit tests | Start one plan, send or produce a valid completion payload, confirm OMC updates the attempt and triggers the correct next state |
| Next attempts continue to reflect current markdown planning state | OMC-03 | The loop must stay markdown-first even after runtime state becomes richer | Edit the active plan markdown between attempts, trigger the next attempt, and confirm the refreshed context pack reflects the updated planning file rather than a stale DB-only snapshot |
| `blocked` work escalates to `Review` without blind retry | OMC-06 | Product correctness is about escalation posture, not just enum values | Simulate a blocked attempt, confirm plan moves into `Review` and does not auto-start another attempt |
| Takeover hands off into the existing HOPI session UI cleanly | OMC-06 | This is cross-app navigation and user-flow behavior | From an OMC plan in review/takeover state, click the takeover/open-session action and confirm the existing session UI opens the correct session |
| Board and plan detail update live during autonomous retries | OMC-05 | Autonomous loop progress is easy to miss if the UI only refreshes after local mutations | Start a plan, let it auto-spawn a follow-up attempt, and confirm board/detail counters and statuses update without manual reload |
| Attempt inspector remains readable with richer evidence | OMC-05 | The UX constraint is “control plane, not raw log dump” | Open an attempt with diff summary + termination reason + checks and confirm the page is still scannable and execution-first |

---

## Validation Sign-Off

- [x] All intended plan areas have automated coverage paths or explicit manual companions
- [x] Sampling continuity: no plan wave depends solely on manual verification
- [x] Wave 0 covers all required references
- [x] No watch-mode flags
- [x] Feedback latency < 300s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
