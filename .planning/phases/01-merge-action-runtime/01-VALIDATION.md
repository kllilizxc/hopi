---
phase: 1
slug: merge-action-runtime
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-07
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest via Bun workspaces |
| **Config file** | `package.json` scripts + per-package Vitest config where present |
| **Quick run command** | Hub: `bun run test:hub` · Web: `bun run typecheck:web` |
| **Full suite command** | `bun run test && bun typecheck` |
| **Estimated runtime** | ~60-180 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test:hub` for hub-touching tasks, or `bun run typecheck:web` for web-only tasks
- **After every plan wave:** Run `bun run test && bun typecheck`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | ACTION-01, ACTION-02 | hub/store schema | `bun run typecheck:hub` | ✅ | ⬜ pending |
| 01-01-02 | 01 | 1 | ACTION-03 | hub/session-link | `bun run test:hub` | ✅ | ⬜ pending |
| 01-01-03 | 01 | 1 | ACTION-01, ACTION-02, ACTION-03 | hub regression | `bun run test:hub && bun run typecheck:hub` | ✅ | ⬜ pending |
| 01-02-01 | 02 | 2 | MERGE-01, MERGE-03 | route kickoff | `bun run test:hub` | ✅ | ⬜ pending |
| 01-02-02 | 02 | 2 | MERGE-01, ACTION-03 | handoff, queue, cancel | `bun run test:hub` | ✅ | ⬜ pending |
| 01-02-03 | 02 | 2 | MERGE-03, ACTION-03 | message injection | `bun run test:hub` | ✅ | ⬜ pending |
| 01-03-01 | 03 | 3 | ACTION-01 | web query/render | `bun run typecheck:web` | ✅ | ⬜ pending |
| 01-03-02 | 03 | 3 | ACTION-02 | web status/cancel | `bun run typecheck:web` | ✅ | ⬜ pending |
| 01-03-03 | 03 | 3 | ACTION-01, ACTION-02 | web rehydrate + manual | `bun run typecheck:web` | ⚠️ mixed | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] Existing hub Vitest coverage is present for route, store, and session-runtime work
- [x] Existing web typecheck path is present for UI/runtime work
- [x] Manual refresh or reconnect checks are documented for behavior without stable web automation

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Merge feels like normal conversation flow | MERGE-01, MERGE-03 | Product feel depends on transcript or UX cohesion | Trigger Merge from a task chat and verify the kickoff appears as an ordinary in-thread request with CLI or tool-call-style detail |
| Runtime status survives remote refresh or reconnect | ACTION-01, ACTION-02 | Cross-surface continuity is easiest to validate end-to-end manually first | Start queued or running merge state, refresh or reopen task chat, confirm compact status remains visible |
| Handoff note stays concise when relinking or starting sessions | ACTION-03 | Wording and placement are UX-sensitive | Trigger no-session and stale-session cases, verify only one short note appears before merge continues |

---

## Validation Sign-Off

- [x] All tasks have automated verify or documented manual companion
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all missing infrastructure references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-07
