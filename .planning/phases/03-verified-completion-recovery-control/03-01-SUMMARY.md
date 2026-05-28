---
phase: 03-verified-completion-recovery-control
plan: 01
subsystem: hub-cli
tags: [merge-verification, repo-truth, recovery-control]
requires:
  - 02-01
  - 02-02
  - 02-03
provides:
  - Worktree snapshot capture before agent-driven merge completion
  - Target-branch repo-truth verification gate before persisting merge success
  - Regression coverage for false-success blocking and verification RPC behavior
affects: [task-merge-route, git-rpc, merge-runtime]
tech-stack:
  added: []
  patterns: [capture-then-verify merge truth, safe false-negative over false-success]
key-files:
  created: []
  modified:
    - cli/src/modules/common/handlers/git.ts
    - cli/src/modules/common/handlers/git.test.ts
    - hub/src/sync/rpcGateway.ts
    - hub/src/sync/syncEngine.ts
    - hub/src/web/routes/tasks.ts
    - hub/src/sync/projectScripts.ts
    - hub/src/web/routes/tasks.merge-script.test.ts
    - hub/src/web/routes/tasks.merge-error.test.ts
    - hub/src/web/routes/tasks.workflow.test.ts
key-decisions:
  - "Capture a worktree snapshot before the merge turn, then verify the target branch against that exact snapshot before persisting success."
  - "Prefer an explicit blocked false-negative over ever marking a merge successful without proof."
patterns-established:
  - "Conversation-native merge completion now requires repo-truth verification instead of trusting ready/success signals alone."
  - "CLI git RPC now exposes snapshot capture and verification primitives that stay inside normal workspace sandbox tooling."
requirements-completed: [VERIFY-01, VERIFY-02]
completed: 2026-03-07
---

# Phase 3 Plan 01 Summary

**Repo-truth verification before merge completion state changes**

## Accomplishments
- Added CLI git RPC helpers to capture a temporary snapshot of the worktree state and later verify whether the target branch actually contains that captured diff.
- Refined Merge so an idle click now auto-runs `.hopi/merge.sh` directly through the session bash RPC first, then only hands control to the agent when direct execution fails or cannot be verified.
- Updated the task merge route to capture verification state before the agent merge turn starts and to block immediately if snapshot capture fails.
- Updated the merge monitor so it verifies the target branch before calling merge-success persistence; ready output alone no longer marks a task merged.
- Added hub regressions for verified success, verification failure blocking, queued/approval kickoff coverage, and auto-start workflow kickoff coverage.
- Added CLI regressions for snapshot verification before and after a real merge.

## Files Created/Modified
- `cli/src/modules/common/handlers/git.ts` - adds snapshot capture/verification RPC handlers and supporting git helpers.
- `cli/src/modules/common/handlers/git.test.ts` - covers verified and unverified snapshot outcomes.
- `hub/src/sync/projectScripts.ts` - normalizes skipped-script output for direct merge-first execution.
- `hub/src/sync/rpcGateway.ts` - wires new git RPC calls through the gateway.
- `hub/src/sync/syncEngine.ts` - exposes snapshot capture/verification wrappers to route code.
- `hub/src/web/routes/tasks.ts` - captures verification snapshots before merge kickoff and requires repo-truth verification before persisting success.
- `hub/src/web/routes/tasks.merge-script.test.ts` - verifies verified-success and verification-failure behavior.
- `hub/src/web/routes/tasks.merge-error.test.ts` - keeps queued and approval-pending kickoff coverage aligned with required snapshot capture.
- `hub/src/web/routes/tasks.workflow.test.ts` - covers auto-start merge kickoff with verification plumbing.

## Decisions Made
- Verification compares the captured snapshot diff against the target branch via reverse patch check so the system asks git for proof instead of trusting a script exit or assistant reply.
- A clean Merge click should take the fast path: direct script tool call first, agent loop only on failure or ambiguous repo truth.
- When verification cannot prove success, the task moves to blocked with a note pointing the user back to transcript-visible tool output and retry flow.
- Successful verification stores the verified target HEAD as the merge commit reference for task metadata.

## Validation
- `bun run typecheck:hub` ✓
- `bun run test:hub` ✓
- `bun run typecheck:cli` ✓
- `cd cli && bun x vitest run src/modules/common/handlers/git.test.ts -t "captures snapshot and verifies merged target branch|reports snapshot as unverified before merge"` ✓
- `cd cli && bun x vitest run src/modules/common/handlers/git.test.ts` still has pre-existing failures in older tests (`auto-commits worktree changes before merge`, `returns normalized conflict message when merge fails with conflicts`, `still supports explicit staged and unstaged filters`)

## Next Phase Readiness
- Phase 3 Plan 02 can now add retry fingerprinting and loop-stop control on top of a trustworthy merge-success gate.
- Blocked merge summaries already have verified-failure hooks; Plan 03 can polish final handoff text and metadata details without reworking the verification contract.

---
*Phase: 03-verified-completion-recovery-control*
*Completed: 2026-03-07*
