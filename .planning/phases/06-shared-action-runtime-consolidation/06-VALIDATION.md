---
phase: 06
slug: shared-action-runtime-consolidation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-09
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest + TypeScript strict checks |
| **Config file** | Root `package.json` scripts + package-local Vitest/TS config |
| **Quick run command** | `bun run test:hub && bun run typecheck:hub && bun run typecheck:web` |
| **Full suite command** | `bun run test:hub && bun run typecheck:hub && bun run typecheck:web && bun run test:web` |
| **Estimated runtime** | ~60-180 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test:hub && bun run typecheck:hub && bun run typecheck:web`; add `bun run test:web` whenever web summaries/mutations/control surfaces change
- **After every plan wave:** Run `bun run test:hub && bun run typecheck:hub && bun run typecheck:web && bun run test:web`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | ACTION-04 | shared/schema/runtime contract | `bun run test:hub && bun run typecheck:hub && bun run typecheck:web` | ✅ | ✅ green |
| 06-01-02 | 01 | 1 | ACTION-04 | store/relink/runtime updater consolidation | `bun run test:hub && bun run typecheck:hub` | ✅ | ✅ green |
| 06-01-03 | 01 | 1 | ACTION-04 | typed API/runtime exposure consistency | `bun run typecheck:web` | ✅ | ✅ green |
| 06-02-01 | 02 | 2 | ACTION-05 | transcript/result grammar consolidation | `bun run test:hub` | ✅ | ✅ green |
| 06-02-02 | 02 | 2 | ACTION-06 | busy-session deferral and auto-run parity | `bun run test:hub && bun run typecheck:hub` | ✅ | ✅ green |
| 06-02-03 | 02 | 2 | ACTION-04, ACTION-05 | shared web summary/control surface behavior | `bun run typecheck:web && bun run test:web` | ✅ | ✅ green |
| 06-03-01 | 03 | 3 | ACTION-04 | extension seam cleanup without behavior regression | `bun run test:hub && bun run typecheck:hub && bun run typecheck:web` | ✅ | ✅ green |
| 06-03-02 | 03 | 3 | ACTION-05, ACTION-06 | docs/helper cleanup with full action parity intact | `bun run test:hub && bun run typecheck:hub && bun run typecheck:web && bun run test:web` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ mixed/manual companion required*

---

## Wave 0 Requirements

- [x] Existing infrastructure already covers shared/runtime schema, hub route/service, and web hook/component tests.
- [x] Root commands exist for `bun run test:hub`, `bun run typecheck:hub`, `bun run typecheck:web`, and `bun run test:web`.
- [x] Prior phases already established focused hub/web regression anchors for Merge, Preview, and Init behavior.
- [x] No new framework installation or test harness setup required.

---

## Execution Notes

- Final automated gate run on 2026-03-09: `bun run test:hub && bun run typecheck:hub && bun run typecheck:web && bun run test:web` ✅
- Shared hub helper seams now live in `hub/src/utils/taskActionRuntime.ts` and `hub/src/utils/taskActionFlow.ts`.
- Shared web helper seams now live in `web/src/lib/task-action-runtime.ts` and `web/src/hooks/mutations/taskActionCache.ts`.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Action labels stay specific while runtime grammar becomes shared | ACTION-04, ACTION-05 | Product feel and wording quality matter | Trigger Merge, Preview, and Init from the web UI; confirm users still see action-specific titles/buttons while cards/transcript structure feel consistent |
| Busy-session queueing feels the same across actions | ACTION-06 | Timing/feel is easier to confirm end-to-end manually | Put the linked session into thinking/approval-pending states, trigger each action, and confirm it visibly queues then auto-runs without an extra manual prompt |
| Shared transcript wording remains compact and CLI-style | ACTION-05 | Thread readability is qualitative | Trigger direct success and direct failure paths for all three actions; confirm result messages feel like the same product grammar without becoming overly generic |
| Future-extension seams do not leak a half-built generic action UI | ACTION-04 | Scope discipline is a product concern | Review task/session UI after consolidation and confirm there is no user-visible generic “Action” system introduced in this phase |

---

## Validation Sign-Off

- [x] All tasks have automated verify or existing infrastructure coverage
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all required references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-09
