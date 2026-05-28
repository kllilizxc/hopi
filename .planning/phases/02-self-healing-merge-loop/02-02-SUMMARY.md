---
phase: 02-self-healing-merge-loop
plan: 02
subsystem: hub
tags: [merge-runtime, repair-loop, blocker-notes]
requires:
  - 02-01
provides:
  - Explicit inspect/fix/retry guidance in the merge kickoff prompt
  - Merge runtime notes that point users back to transcript-visible tool output
  - Regression coverage for blocked-yet-retryable merge outcomes
affects: [task-merge-route, merge-runtime, task-chat]
tech-stack:
  added: []
  patterns: [transcript-led repair loop, concise blocked handoff note]
key-files:
  created: []
  modified:
    - hub/src/web/routes/tasks.ts
    - hub/src/web/routes/tasks.merge-script.test.ts
    - hub/src/web/routes/tasks.workflow.test.ts
key-decisions:
  - "Teach the agent repair loop through the prompt and durable runtime notes instead of building new backend retry machinery."
  - "When merge is still pending after a ready event, block with a note that points back to linked-session tool output and in-workspace retry work."
patterns-established:
  - "Running merge runtime notes now explicitly tell the UI to treat the transcript as the detailed source of truth."
  - "Blocked merge notes distinguish retryable in-session repair from true manual or out-of-sandbox blockers."
requirements-completed: [MERGE-05, REPAIR-01, REPAIR-02, REPAIR-03]
completed: 2026-03-07
---

# Phase 2 Plan 02 Summary

**Agent-visible inspect/fix/retry loop for merge failures inside the same session**

## Accomplishments
- Strengthened the Merge kickoff prompt with an explicit recovery loop: keep stdout/stderr in-thread, inspect git/worktree state, edit `.hopi/merge.sh` or other workspace files, then retry in the same session.
- Updated blocked/runtime notes so retryable failures now tell the user and agent to inspect linked-session output rather than treating the merge as a black-box failure.
- Added regression coverage for the “ready but still mergeable” path to ensure the route stays blocked-with-guidance instead of silently claiming success.

## Files Created/Modified
- `hub/src/web/routes/tasks.ts` - adds retry-aware prompt sections and more explicit blocked/runtime note wording.
- `hub/src/web/routes/tasks.merge-script.test.ts` - verifies repair guidance and no hidden retry work when the branch remains mergeable.
- `hub/src/web/routes/tasks.workflow.test.ts` - confirms auto-started merge sessions inherit the same retry guidance contract.

## Decisions Made
- Keep the repair loop general enough for project-specific scripts while still making the first merge attempt deterministic.
- Use short durable notes for UI replay and leave detailed failure context in the normal conversation transcript.

## Validation
- `bun run typecheck:hub` ✓
- `bun run test:hub` ✓

## Notes
- Plan 02 deliberately avoids Phase 3 concerns like final repo-truth verification or retry-loop fingerprinting.
- No git commit created in this turn; implementation remains in workspace state.

---
*Phase: 02-self-healing-merge-loop*
*Completed: 2026-03-07*
