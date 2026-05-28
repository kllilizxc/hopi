---
phase: 4
slug: preview-action-parity
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-08
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest via Bun workspaces |
| **Config file** | Root `package.json` scripts + package-local Vitest/TS config |
| **Quick run command** | `bun run test:hub` · `bun run typecheck:hub` · `bun run typecheck:web` |
| **Full suite command** | `bun run test:hub && bun run typecheck:hub && bun run typecheck:web` |
| **Estimated runtime** | ~60-180 seconds |

---

## Sampling Rate

- **After every task commit:** run `bun run test:hub` for hub/runtime changes; add `bun run typecheck:hub` whenever schema/store/task payloads change; add `bun run typecheck:web` for task/chat/UI changes
- **After every plan wave:** run `bun run test:hub && bun run typecheck:hub && bun run typecheck:web`
- **Before `$gsd-verify-work`:** Phase 4 gate must be green on `bun run test:hub && bun run typecheck:hub && bun run typecheck:web`
- **Max feedback latency:** 180 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 04-01 | 1 | PREVIEW-01, PREVIEW-03 | shared/schema + store migration | `bun run typecheck:hub` | ✅ | ⬜ pending |
| 04-01-02 | 04-01 | 1 | PREVIEW-01, PREVIEW-03 | preview kickoff runtime states (`queued`, `approval_pending`, `waiting`, `running`) | `bun run test:hub` | ✅ | ⬜ pending |
| 04-01-03 | 04-01 | 1 | PREVIEW-01, PREVIEW-02 | direct-run-first route regression, transcript append, worktree/local fallback | `bun run test:hub && bun run typecheck:hub` | ✅ | ⬜ pending |
| 04-02-01 | 04-02 | 2 | PREVIEW-02, PREVIEW-03 | persisted retry count / fingerprint contract | `bun run test:hub && bun run typecheck:hub` | ✅ | ⬜ pending |
| 04-02-02 | 04-02 | 2 | PREVIEW-04 | repeated-blocker stop + exact manual next step | `bun run test:hub` | ✅ | ⬜ pending |
| 04-02-03 | 04-02 | 2 | PREVIEW-02, PREVIEW-04 | late-crash recovery loop control on durable runtime | `bun run test:hub` | ✅ | ⬜ pending |
| 04-03-01 | 04-03 | 3 | PREVIEW-03 | task payload, SSE invalidation, task-backed preview summary types | `bun run typecheck:web && bun run test:web` | ✅ | ✅ green |
| 04-03-02 | 04-03 | 3 | PREVIEW-03 | preview cancel/retry task cache behavior and task/chat rendering | `bun run typecheck:web && bun run test:web` | ✅ | ✅ green |
| 04-03-03 | 04-03 | 3 | PREVIEW-01, PREVIEW-03, PREVIEW-04 | durable refresh/reconnect UX + blocker summary companion check | `bun run typecheck:web && bun run test:web` | ⚠️ mixed | ⚠️ mixed/manual companion |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ mixed/manual companion required*

---

## Wave 0 Requirements

- [x] Existing hub preview route coverage is present in `hub/src/web/routes/tasks.preview.test.ts`
- [x] Existing merge runtime tests are present in `hub/src/web/routes/tasks.merge-script.test.ts` and `hub/src/web/routes/tasks.merge-error.test.ts` for queue/approval/runtime-reference behavior
- [x] Root commands exist for `bun run test:hub`, `bun run typecheck:hub`, and `bun run typecheck:web`
- [x] Manual refresh/reconnect checks remain documented as companion coverage for full browser product feel

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Direct Preview feels CLI-like and agent repair stays off the happy path | PREVIEW-01, PREVIEW-02 | Ordering and product feel depend on transcript UX, not just route status | Trigger Preview from an idle linked task with a valid repo preview command; verify the transcript first shows the direct preview result message and no setup/repair prompt is injected |
| Durable preview runtime survives refresh or reconnect | PREVIEW-03 | Hook-level automation exists, but full browser reconnect feel still needs a companion smoke pass | Put Preview into queued, retrying, ready, and blocked states; refresh task page or reopen session chat; confirm status summary persists from task data and the live preview panel rehydrates details |
| Repeated blocker stop shows exact manual next step | PREVIEW-04 | Manual wording quality and out-of-sandbox cases are UX-sensitive | Reproduce the same blocker twice or simulate a real external dependency blocker; verify Preview stops auto-retrying and shows blocker reason, last failing command summary, and exact manual step |
| Cancel/retry controls stay coherent across task and chat surfaces | PREVIEW-03 | Cross-surface interaction is easier to validate end-to-end manually first | Start Preview, cancel it from the active surface, then retry after reload; verify both task summary and session chat reflect the same runtime outcome |

---

## Validation Notes by Plan

### Plan 04-01
- Extend `hub/src/web/routes/tasks.preview.test.ts` with busy-session deferral and approval-pending kickoff coverage.
- Preserve and re-run current direct-start, auto-setup, auto-repair, late-crash, and worktree/local fallback cases.
- Confirm no regression in the direct-success-first path: Preview should not open with an agent repair prompt when direct start can succeed.

### Plan 04-02
- Add hub regressions for persisted retry count, repeated failure fingerprint, and loop-stop handoff text.
- Validate that transcript append still happens before setup/repair prompts on each failure path.
- Confirm late-crash recovery reads/writes durable runtime state rather than only `inFlightPreviewMonitorControllers` memory.

### Plan 04-03
- Typecheck and manual companion for task/chat rendering against `task.previewRuntime`.
- Preview-specific web hook tests now cover cache updates and rehydration fallback; keep a browser reconnect smoke pass as the companion check for full UI feel.
- Verify SSE-driven task invalidation updates preview runtime summaries without requiring explicit preview polling to explain queue/blocker state.

---

## Validation Sign-Off

- [x] All planned tasks have automated verify or documented manual companion
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers current preview test assets and missing web automation gaps
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-08
