---
phase: 01
slug: omc-foundation
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-05
---

# Phase 1 — Validation Strategy

> Validation contract for the message-driven OMC prototype redesign.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | TypeScript strict checks + Vite build + manual prototype behavior verification |
| **Config file** | `omc-prototype/package.json` plus root workspace scripts if extended |
| **Quick run command** | `cd /Users/realizer/Code/hopi && bun run typecheck:omc-prototype && bun run build:omc-prototype` |
| **Full suite command** | `cd /Users/realizer/Code/hopi && bun run typecheck:omc-prototype && bun run build:omc-prototype` |
| **Estimated runtime** | ~20-60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd /Users/realizer/Code/hopi && bun run typecheck:omc-prototype`
- **After every plan wave:** Run `cd /Users/realizer/Code/hopi && bun run typecheck:omc-prototype && bun run build:omc-prototype`
- **Before `$gsd-verify-work`:** Full prototype build must be green and manual interaction checks must pass
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Manual Companion | Status |
|---------|------|------|-------------|-----------|-------------------|------------------|--------|
| 01-01-01 | 01 | 1 | OMC-15, OMC-17 | thread/message types and store transitions | `bun run typecheck:omc-prototype` | inspect thread lifecycle in UI | ⬜ pending |
| 01-01-02 | 01 | 1 | OMC-14, OMC-16 | first-message contract and per-thread messaging | `bun run typecheck:omc-prototype` | confirm quick action + freeform reply both append in-thread | ⬜ pending |
| 01-01-03 | 01 | 1 | OMC-20 | default-thread selection and reopen behavior | `bun run build:omc-prototype` | confirm unresolved threads win by default | ⬜ pending |
| 01-02-01 | 02 | 2 | OMC-19 | assistant-ui runtime integration | `bun run typecheck:omc-prototype && bun run build:omc-prototype` | active thread renders as real chat | ⬜ pending |
| 01-02-02 | 02 | 2 | OMC-14, OMC-20 | inbox grouping and scalable operator rail | `bun run build:omc-prototype` | unresolved / handled / silent are legible | ⬜ pending |
| 01-02-03 | 02 | 2 | OMC-16 | one composer per active thread, including direction threads | `bun run build:omc-prototype` | no per-message or per-card textareas remain; direction threads support quick action + freeform reply | ⬜ pending |
| 01-03-01 | 03 | 3 | OMC-18 | canvas demotion and thread handoff | `bun run typecheck:omc-prototype && bun run build:omc-prototype` | canvas no longer owns primary decision controls | ⬜ pending |
| 01-03-02 | 03 | 3 | OMC-14, OMC-20 | thread metadata and handoff visibility on the canvas | `bun run typecheck:omc-prototype && bun run build:omc-prototype` | canvas points to relevant threads without duplicating the action surface | ⬜ pending |
| 01-03-03 | 03 | 3 | OMC-14, OMC-20 | mobile/drawer and operator-shell polish | `bun run typecheck:omc-prototype && bun run build:omc-prototype` | message experience remains usable in narrow viewport | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ mixed/manual companion required*

---

## Wave 0 Requirements

- [x] Existing repo already contains reusable chat/runtime patterns in `web/`.
- [x] `omc-prototype` already exists and can be iterated independently.
- [x] No new backend/runtime infrastructure is required for this prototype phase.
- [x] No new test framework is required to begin; typecheck/build plus manual interaction checks are sufficient for the redesign pass.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Message panel feels like the primary control surface | OMC-14 | Product posture is experiential, not just structural | Open dashboard and goal pages; confirm all real intervention happens in the right rail, not the canvas |
| Threads behave like topic conversations, not message piles | OMC-15, OMC-20 | Scalable inbox feel depends on thread identity and grouping | Create multiple unresolved topics; confirm each appears as one thread with stable history |
| Freeform guidance is first-class | OMC-16 | The core promise is flexibility, not just buttons | Reply in natural language in a thread; confirm visible in-thread response and state change |
| Thread lifecycle is understandable | OMC-17 | Lifecycle correctness is a product rule, not only a type rule | Move a topic through pending -> in-progress -> waiting -> resolved, and separately through pending -> silent |
| Main canvas has become contextual only | OMC-18 | Duplication is a UX failure more than a type failure | Confirm approval/risk/direction controls are gone from dashboard/goal/execution surfaces |
| Reused chat foundation still feels native to OMC | OMC-19 | The risk is importing a session-first feel into the prototype | Check that the active thread behaves like chat without feeling like a session console |
| First Agent message contract is complete | OMC-15, OMC-16, OMC-17 | Contract coverage is semantic, not just structural | Open approval, risk, direction, and status threads; confirm first message includes why-now, suggested actions, freeform invitation, and required consequence language |
| Desktop shell keeps a fixed right-side panel | OMC-14, OMC-18, OMC-20 | Layout posture affects the whole product feel | On wide viewport, confirm the message panel remains a fixed right rail around `420-480px` and does not collapse into inline content |
| Direction threads are real operator conversations | OMC-15, OMC-16 | Direction work is easy to under-specify | Open a direction thread; verify quick action and freeform guidance both change visible thread state and conversation |

---

## Validation Sign-Off

- [x] All intended plan areas have automated checks or explicit manual companions
- [x] Sampling continuity is acceptable for a prototype-first phase
- [x] Wave 0 covers all required references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
