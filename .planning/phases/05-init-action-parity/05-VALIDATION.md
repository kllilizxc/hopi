---
phase: 5
slug: init-action-parity
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-08
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest via Bun workspaces |
| **Config file** | Root `package.json` scripts + package-local Vitest/TS config |
| **Quick run command** | `bun run test:hub` · `bun run typecheck:hub` · `bun run typecheck:web` |
| **Full suite command** | `bun run test:hub && bun run typecheck:hub && bun run typecheck:web && bun run test:web` |
| **Estimated runtime** | ~60-180 seconds |

---

## Sampling Rate

- **After every task commit:** run `bun run test:hub` for init runtime / route changes; add `bun run typecheck:hub` whenever schema/store/task payloads change; add `bun run typecheck:web` for task/chat/UI changes
- **After every plan wave:** run `bun run test:hub && bun run typecheck:hub && bun run typecheck:web`
- **Before `$gsd-verify-work`:** Phase 5 gate must be green on `bun run test:hub && bun run typecheck:hub && bun run typecheck:web && bun run test:web`
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-01-01 | 05-01 | 1 | INIT-01, INIT-03 | shared/schema + store migration for `initRuntime` | `bun run typecheck:hub` | ✅ | ⬜ pending |
| 05-01-02 | 05-01 | 1 | INIT-01 | session-start orchestration split and kickoff gating | `bun run test:hub && bun run typecheck:hub` | ✅ | ⬜ pending |
| 05-01-03 | 05-01 | 1 | INIT-01, INIT-03 | start-session / task payload typed contract | `bun run typecheck:web` | ✅ | ⬜ pending |
| 05-02-01 | 05-02 | 2 | INIT-02 | transcript-visible direct init result and same-session repair prompt | `bun run test:hub` | ✅ | ⬜ pending |
| 05-02-02 | 05-02 | 2 | INIT-02, INIT-03 | retry fingerprint, repeated-blocker stop, exact manual next step | `bun run test:hub && bun run typecheck:hub` | ✅ | ⬜ pending |
| 05-02-03 | 05-02 | 2 | INIT-01, INIT-02 | auto-run scheduler parity with manual start-session failure handling | `bun run test:hub` | ✅ | ⬜ pending |
| 05-03-01 | 05-03 | 3 | INIT-03 | typed web/cache exposure for `initRuntime` | `bun run typecheck:web` | ✅ | ⬜ pending |
| 05-03-02 | 05-03 | 3 | INIT-03 | task/session init summary rendering and cache coherence | `bun run typecheck:web && bun run test:web` | ⚠️ mixed | ⬜ pending |
| 05-03-03 | 05-03 | 3 | INIT-01, INIT-02, INIT-03 | refresh/reconnect visibility + kickoff-timing companion check | `bun run typecheck:web && bun run test:web` | ⚠️ mixed | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ mixed/manual companion required*

---

## Wave 0 Requirements

- [x] Existing init/session-start coverage is present in `hub/src/sync/taskSessionService.test.ts`
- [x] Existing route-level handoff coverage is present in `hub/src/web/routes/tasks.start-session.test.ts`
- [x] Root commands exist for `bun run test:hub`, `bun run typecheck:hub`, `bun run typecheck:web`, and `bun run test:web`
- [x] Manual start-session / auto-run companion checks remain documented for product-feel validation

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Direct init success feels low-noise and task kickoff happens after init success | INIT-01, INIT-02 | Product feel and prompt ordering matter, not just route state | Start a task session with a healthy `.hopi/init.sh`; confirm the session opens, transcript shows the direct init result/success note, and the main kickoff does not arrive before init completes |
| Failed init keeps the started session alive for both manual start and auto-run | INIT-02 | Cross-path UX is easier to confirm end-to-end manually first | Reproduce one init failure from manual start-session and one from auto-run; confirm the spawned session remains linked, transcript shows CLI output, and the task is not silently archived |
| Refresh/reconnect preserves durable init status and blocker summary | INIT-03 | Full browser re-entry behavior still needs a companion smoke pass | Put init into running, retrying, blocked, and succeeded states; refresh task page or reopen session chat; confirm the status summary persists from task data |
| Blocked init does not prematurely continue main task work | INIT-01, INIT-02 | Ordering quality and prompt timing are UX-sensitive | Force a repeated blocker; confirm the session stays alive, runtime becomes blocked with an exact manual next step, and no automatic kickoff prompt bypasses the blocker |

---

## Validation Notes by Plan

### Plan 05-01
- Lock the durable `initRuntime` contract first so later repair and UI work read one task-backed source of truth.
- Verify manual `start-session` and auto-run use the same orchestration helper boundaries.
- Confirm kickoff prompt timing stays correct after session-start refactor.

### Plan 05-02
- Add hub regressions for transcript-visible init result messages, same-session repair prompts, retry count/fingerprint persistence, repeated blocker stop, and exact manual next-step text.
- Cover auto-run parity explicitly; this is the highest-risk behavior gap in the current repo.
- Confirm blocked init does not archive the started session or sneak the main kickoff through early.

### Plan 05-03
- Typecheck and focused web tests for typed init runtime exposure, task cache updates after `start-session`, and session/task summary rendering.
- Keep a browser re-entry smoke pass as companion coverage for refresh/reconnect feel.
- Verify task/session UI stays aligned with the same durable init runtime contract the hub persists.

---

## Validation Sign-Off

- [x] All planned tasks have automated verify or documented manual companion
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers current init/runtime test assets and missing UI automation gaps
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-08
