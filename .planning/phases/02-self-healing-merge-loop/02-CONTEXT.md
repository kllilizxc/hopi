# Phase 2: Self-Healing Merge Loop - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning
**Source:** User conversation + Phase 1 outcomes

<domain>
## Phase Boundary

This phase turns the conversation-native Merge kickoff into a real in-session repair loop. The first merge attempt should happen the same way a normal agent would work: run the repo-owned merge flow inside the workspace sandbox, read the tool output, decide what failed, make repo-local fixes, and retry inside the same task session.

This phase does **not** finalize repo-truth verification rules or retry-loop stop heuristics beyond the minimum needed to keep the agent inside normal tool flow. Hard success verification and anti-loop hardening belong to Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Execution Model
- The first merge attempt should run `.hopi/merge.sh` when present, from the correct project root, inside the normal workspace sandbox.
- If `.hopi/merge.sh` is missing or unsuitable, the agent may use normal CLI/git tool calls in the same sandbox.
- Merge should feel like a normal agent turn, not a hidden backend worker or detached automation path.
- Tool-call output should appear in the conversation so the agent and user can see what happened.

### Failure Handling
- If the first merge attempt fails, the agent should inspect actual stdout/stderr or equivalent tool output before choosing the next action.
- The agent should inspect git/worktree state in-session after a failure rather than guessing from backend-only status.
- The agent may edit `.hopi/merge.sh` when the script itself is the blocker.
- The agent may edit other workspace files when repo-local fixes are required to finish the merge.
- After making a fix, the agent should retry merge in the same task session.

### Recovery Boundaries
- All automatic execution and repair stays inside the workspace sandbox.
- Automatic recovery should stop only when the blocker needs human judgment or work outside the sandbox.
- When blocked, the agent should leave a clear short explanation of what stopped progress and what manual step is needed.
- Phase 2 should prefer visible in-session retries over silent background retries.

### Claude's Discretion
- Exact prompt wording that nudges the agent toward `.hopi/merge.sh` first without making the flow brittle.
- Exact internal runtime shape for attempt counting and short notes, as long as it supports in-session retries and clear blocked handoff.
- Exact division between reusable helper functions and route/session orchestration code.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `hub/src/web/routes/tasks.ts` already has Phase 1 conversation kickoff plus older merge-script helpers like `createMergeScriptPrompt()`, `tryAutoRunMergeScript()`, `tryAutoResolveMergeConflict()`, and `scheduleBackgroundAutoMergeRetry()`.
- `hub/src/sync/projectScripts.ts` already knows how to run repo-owned scripts inside the workspace sandbox, including `runMergeScriptIfPresent()`.
- `hub/src/web/routes/tasks.merge-script.test.ts` and `hub/src/web/routes/tasks.merge-error.test.ts` already cover pieces of the current merge script and blocked-state behavior.
- `shared/src/schemas.ts` and task persistence already provide durable `mergeRuntime` state from Phase 1.
- `web/src/components/SessionChat.tsx` now shows durable queued/running/blocked/canceled/succeeded status and can be extended later without inventing another runtime surface.

### Established Patterns
- Merge click already enters the linked task conversation and correlates completion via prompt `localId` + `ready` events.
- Existing repo helpers can run scripts within the workspace sandbox while respecting agent/session boundaries.
- Legacy merge code still contains hidden backend-style merge/conflict/autoretry behavior that bypasses the normal tool-call transcript.
- Phase 1 already decided that detailed execution belongs in conversation messages while compact state belongs on the task/chat surface.

### Integration Points
- Merge entry route: `POST /tasks/:taskId/worktree/merge` in `hub/src/web/routes/tasks.ts`.
- Session kickoff prompt builder: `buildConversationMergePrompt()` in `hub/src/web/routes/tasks.ts`.
- Script execution helper seam: `runMergeScriptIfPresent()` in `hub/src/sync/projectScripts.ts`.
- Durable runtime updates: `buildTaskMergeRuntime()` / `updateTaskMergeRuntime()` in `hub/src/web/routes/tasks.ts`.
- Regression coverage anchor: `hub/src/web/routes/tasks.merge-script.test.ts` and `hub/src/web/routes/tasks.merge-error.test.ts`.

### Current Tensions
- Some existing merge behavior still waits on backend completion or direct git operations instead of letting the agent inspect raw tool-call output.
- Background retry logic conflicts with the product direction toward visible in-session recovery.
- Phase 2 must bridge repo-owned script flexibility with agent-visible repair behavior without regressing the Phase 1 durable runtime contract.

</code_context>

<specifics>
## Specific Ideas

- “First tool call to run merge script, if success, agent knows and summary, if failed, agent knows and try to resolve conflicts or other fixes.”
- “Maybe edit the script to prevent the same errors, then it try merge again and normal agent flow.”
- “Everything inside the work space sandbox.”
- “Normal tool calls, everything the same as normal agent flow, the agent decides based on the output of tool call.”

</specifics>

<deferred>
## Deferred Ideas

- Strong repo-truth verification before marking success.
- Retry fingerprinting and loop-stopping heuristics beyond basic blocker discipline.
- Preview/init parity on the same repair loop runtime.

</deferred>

---
*Phase: 02-self-healing-merge-loop*
*Context gathered: 2026-03-07*
