---
phase: 02-self-healing-merge-loop
plan: 01
subsystem: hub
tags: [merge-runtime, prompt-contract, project-scripts]
requires:
  - 01-02
  - 01-03
provides:
  - Deterministic script-first merge kickoff prompt inside the linked task conversation
  - Shared merge command builder for exact root/env/script contract reuse
  - Regression coverage for prompt content and merge auto-start kickoff semantics
affects: [task-merge-route, project-scripts, merge-workflow]
tech-stack:
  added: []
  patterns: [shared script command builder, transcript-first action contract]
key-files:
  created: []
  modified:
    - hub/src/sync/projectScripts.ts
    - hub/src/sync/projectScripts.test.ts
    - hub/src/web/routes/tasks.ts
    - hub/src/web/routes/tasks.merge-script.test.ts
    - hub/src/web/routes/tasks.workflow.test.ts
key-decisions:
  - "Reuse projectScripts shell/env quoting logic for prompt generation instead of building ad-hoc route strings."
  - "Make the first merge attempt one visible shell command so the agent sees the same stdout/stderr the user sees."
patterns-established:
  - "Conversation merge prompts now embed one canonical script-first command rooted in the active worktree path."
  - "Prompt-level regression tests lock cwd, env vars, and merge script path so future refactors keep the same contract."
requirements-completed: [MERGE-02, MERGE-04]
completed: 2026-03-07
---

# Phase 2 Plan 01 Summary

**Structured script-first merge kickoff contract inside the linked task conversation**

## Accomplishments
- Extracted `buildMergeScriptCommand()` in `hub/src/sync/projectScripts.ts` so merge prompt generation reuses the same root/env/script contract logic as repo-owned script execution helpers.
- Replaced the vague Merge kickoff text with a deterministic first tool call that runs `.hopi/merge.sh` from the resolved worktree root when present and prints an explicit fallback message when it is missing.
- Updated route tests to pin the exact first-command shape, env vars, and auto-started session prompt behavior.

## Files Created/Modified
- `hub/src/sync/projectScripts.ts` - exports the canonical merge script shell command builder.
- `hub/src/sync/projectScripts.test.ts` - covers root path, env vars, script path, and missing-script output for the new command builder.
- `hub/src/web/routes/tasks.ts` - uses the shared merge command builder inside the conversation kickoff prompt.
- `hub/src/web/routes/tasks.merge-script.test.ts` - locks the prompt contract for the normal merge route.
- `hub/src/web/routes/tasks.workflow.test.ts` - confirms auto-started merge sessions receive the same script-first contract.

## Decisions Made
- Keep actual merge execution inside normal agent tool calls; reuse shared command construction only for deterministic prompt content.
- Prefer the active worktree path when available so the first merge command runs from the same workspace the session is already using.

## Validation
- `bun run typecheck:hub` ✓
- `bun run test:hub` ✓

## Notes
- No git commit created in this turn; implementation remains in workspace state.
- Plan 01 landed alongside Phase 2 Plans 02 and 03 because the prompt contract, blocker notes, and hidden-helper cleanup touched the same hub route.

---
*Phase: 02-self-healing-merge-loop*
*Completed: 2026-03-07*
