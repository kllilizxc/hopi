---
gsd_state_version: 1.0
milestone: v0.1
milestone_name: omc control plane
status: active
stopped_at: Phase 1 message-driven operator shell executed in the repo mirror; next step is discuss or plan the next OMC phase
last_updated: "2026-04-05T18:40:00+08:00"
last_activity: 2026-04-05 — Executed the replanned message-driven Phase 1 with operator threads, assistant-ui inbox, and canvas-to-thread handoff
progress:
  total_phases: 5
  completed_phases: 5
  total_plans: 15
  completed_plans: 15
  percent: 100
---

# Project State

## Project Reference

See:
- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/phases/01-omc-foundation/01-CONTEXT.md`
- `docs/design/omc-planning-seed/05-CONTEXT.md`

## Current Position

Phase: 1 of 5
Plan: Completed
Status: Message-driven operator shell complete in repo mirror
Last activity: 2026-04-05 — Executed the replanned message-driven Phase 1 with operator threads, assistant-ui inbox, and canvas-to-thread handoff

Progress: [##########] 100%

## Decisions

- OMC starts as a new GSD workspace rather than continuing the current HOPI `.planning`
- `1 card = 1 PLAN.md`
- `1 loop run = 1 PLAN`
- `1 attempt = advance one smallest next step`
- planning truth stays in markdown
- review remains human-gated
- attempt completion is driven by structured completion payloads plus runtime fallback
- OMC loop orchestration is adapter-based: Codex-first, not Codex-only
- takeover deep-links into the existing HOPI session UI instead of embedding a new terminal in OMC-client
- OMC hub evidence is system-grounded with changed-file and diff-summary harvesting, not only agent self-report
- Phase 3 uses a hybrid review posture: plan detail remains the runtime home, but review/merge decisions move into a dedicated cockpit
- Merge packet presentation is decision-first rather than diff-first
- Review exposes two explicit reopen actions: `Resume loop` and `Back to planning`
- Merge failures stay in `Review` as operator-visible `merge-blocked` states instead of auto-jumping back into repair mode
- Merge conflicts stay in `Review` as `merge-blocked: conflict`, with `Resolve conflicts` leading into takeover on the same worktree
- Phase 3 is decomposed into three plans: backend review/merge contracts, merge execution/conflict handling, and the review cockpit UI
- Phase 3 Plan 03-01 promotes review approval, merge posture, and reopen actions to explicit OMC runtime contracts
- Phase 3 Plan 03-01 makes merge packets decision-first server payloads before real merge execution is added
- Phase 3 Plan 03-02 executes merge approval through `gitMergeWorktreeState` and `gitMergeWorktree` directly from OMC, without task/project merge runtime coupling
- Phase 3 Plan 03-02 keeps merge failures in `Review`, with conflicts returning same-session takeover linkage instead of auto-resuming the loop
- Phase 3 Plan 03-03 adds a dedicated review cockpit route while keeping plan detail as the runtime home
- Phase 3 Plan 03-03 keeps review/merge state live through OMC SSE invalidation and merge-specific board badges instead of new columns
- Phase 4 will attach explicit local git repos instead of assuming the hub repo is the only OMC program
- Phase 4 will offer two empty-state actions when planning is missing: `Attach existing planning` and `Create planning seed`
- Phase 4 planning seeds should be minimal and should live inside the attached repo at `.planning/*`, not in a hidden external workspace copy
- Phase 4 should land users in a planning-first posture after bootstrap rather than auto-starting execution
- Phase 4 is decomposed into three plans: backend attach/bootstrap contracts, attach-program UX, and planning-first bootstrap guidance
- Phase 4 Plan 04-01 establishes explicit backend APIs and repo-local seed generation before any client onboarding polish
- Phase 4 Plan 04-02 makes local repo attach native in OMC-client and fixes current multi-program blind spots
- Phase 4 Plan 04-03 turns the planning-missing dead end into an actionable planning-first bootstrap flow
- Phase 4 execution completed the end-to-end `attach local repo -> bootstrap planning -> planning-first guidance` flow inside OMC itself
- Phase 5 will close the current gap between seed scaffold and the first `PLAN.md` cards by making guided planning continuation product-native
- Phase 5 is decomposed into three plans: program-level planning runtime, guided-planning orchestration, and frontend handoff UX
- Phase 5 execution completed the end-to-end `seed scaffold -> guided planning brief -> first executable PLAN cards -> automatic board handoff` flow inside OMC
- The current prototype direction now supersedes the original board-first Phase 1 and reopens Phase 1 around a message-driven operator shell.
- The message panel is now the primary operator control surface; the main canvas becomes contextual support only.
- The new Phase 1 plan split is: operator thread domain and lifecycle, assistant-ui inbox + active thread, then canvas-to-thread handoff cleanup.
- Phase 1 execution replaced the old bespoke message card stack with a real inbox + active-thread shell backed by `assistant-ui`.
- Phase 1 execution moved canvas intervention to thread metadata and open-thread affordances instead of inline action ownership.
- Phase 1 execution added a narrow-width message drawer so the operator shell still works outside wide desktop layouts.

## Pending Todos

None yet.

## Blockers/Concerns

- Planner/checker subagents did not complete reliably in the root repo context, so OMC planning/context artifacts are being maintained manually in the repo mirror.
- Current repo `.planning` remains for the completed action-runtime milestone and should not be reused for OMC work.
- Full `bun run test:hub` still has two pre-existing failures in `hub/src/web/routes/tasks.start-session.test.ts`; OMC-specific tests are green.
- Git metadata writes are blocked in this executor, so per-task commits were not recorded for Phases 3, 4, or 5.
- The original 2026-03-29 Phase 1 board-first context is now superseded for prototype redesign work; use `docs/design/omc-phase-01-context.md` and `docs/design/omc-planning-seed/01-CONTEXT.md` as the canonical message-driven Phase 1 context.

## Session Continuity

Last session: 2026-04-05T18:40:00+08:00
Stopped at: Completed repo-mirror Phase 1 message-driven operator shell execution
Resume file: docs/design/omc-planning-seed/01-03-SUMMARY.md
