---
phase: 1
slug: merge-action-runtime
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| **Quick run command** | `bun run test:hub` |
| **Full suite command** | `bun run test && bun typecheck` |
| **Estimated runtime** | ~60-180 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bun run test:hub`
- **After every plan wave:** Run `bun run test && bun typecheck`
- **Before `$gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-xx-xx | TBD | TBD | MERGE-01 / ACTION-* | route+ui | `bun run test:hub` | ❌ W0 | ⬜ pending |
| 01-xx-xx | TBD | TBD | ACTION-01 / ACTION-02 | integration | `bun run test && bun typecheck` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Add or update focused hub tests for merge runtime state transitions and handoff rules
- [ ] Add or update focused web tests for compact merge status / conversation kickoff behavior if web test infra is present
- [ ] Replace placeholder task rows above with actual plan/task mapping after PLAN.md files exist

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Merge feels like normal conversation flow | MERGE-01, MERGE-03 | Product feel depends on transcript/UX cohesion | Start a task chat, trigger Merge, verify kickoff appears as ordinary chat/message flow |
| Remote reload/reconnect preserves runtime state | ACTION-01, ACTION-02 | Cross-surface continuity is easiest to validate end-to-end manually at first | Trigger queued/running merge state, refresh/reopen UI, confirm compact state persists |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
