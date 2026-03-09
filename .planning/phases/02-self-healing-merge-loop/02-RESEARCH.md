# Phase 2: Self-Healing Merge Loop - Research

**Researched:** 2026-03-07
**Domain:** Brownfield in-session merge execution, repair, and retry inside HOPI's conversation-native runtime
**Confidence:** HIGH for repo-grounded architecture and slicing; MEDIUM for the exact prompt/runtime details until implementation settles

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- The first merge attempt should run `.hopi/merge.sh` when present, from the correct project root, inside the normal workspace sandbox.
- If `.hopi/merge.sh` is missing or unsuitable, the agent may use normal CLI/git tool calls in the same sandbox.
- Merge should feel like a normal agent turn, not a hidden backend worker or detached automation path.
- Tool-call output should appear in the conversation so the agent and user can see what happened.
- If the first merge attempt fails, the agent should inspect actual stdout/stderr or equivalent tool output before choosing the next action.
- The agent should inspect git/worktree state in-session after a failure rather than guessing from backend-only status.
- The agent may edit `.hopi/merge.sh` when the script itself is the blocker.
- The agent may edit other workspace files when repo-local fixes are required to finish the merge.
- After making a fix, the agent should retry merge in the same task session.
- All automatic execution and repair stays inside the workspace sandbox.
- Automatic recovery should stop only when the blocker needs human judgment or work outside the sandbox.
- When blocked, the agent should leave a clear short explanation of what stopped progress and what manual step is needed.
- Phase 2 should prefer visible in-session retries over silent background retries.

### Claude's Discretion
- Exact prompt wording that nudges the agent toward `.hopi/merge.sh` first without making the flow brittle.
- Exact internal runtime shape for attempt counting and short notes, as long as it supports in-session retries and clear blocked handoff.
- Exact division between reusable helper functions and route/session orchestration code.

### Deferred Ideas (OUT OF SCOPE)
- Strong repo-truth verification before marking success.
- Retry fingerprinting and loop-stopping heuristics beyond basic blocker discipline.
- Preview/init parity on the same repair loop runtime.
</user_constraints>

<research_summary>
## Summary

Phase 1 already delivered the hardest product-level shift: Merge now enters the linked task conversation, durable status lives on `task.mergeRuntime`, and the web UI can replay queued/running/blocked state. Phase 2 therefore should **not** build a second execution runtime. The brownfield-friendly move is to deepen the conversation prompt and runtime notes so the agent performs a visible merge/inspect/fix/retry loop inside ordinary tool calls.

The strongest repo insight is that the codebase still contains two merge philosophies:

1. **Current canonical path** — `POST /tasks/:taskId/worktree/merge` sends a prompt into the linked session and monitors the correlated `ready` event.
2. **Legacy hidden automation path** — `tryAutoRunMergeScript()`, `tryAutoResolveMergeConflict()`, and `scheduleBackgroundAutoMergeRetry()` in `hub/src/web/routes/tasks.ts` perform backend-mediated script runs, direct git merge retries, and background loops outside the transcript.

Those hidden helpers are currently not wired into the live route, but they embody exactly the behavior the user wants to avoid. Phase 2 should keep the Phase 1 conversation kickoff as the canonical entry path, reuse its durable runtime contract, and either remove, quarantine, or clearly stop depending on the hidden merge automation helpers so future work cannot drift back toward opaque execution.

**Primary recommendation:** implement Phase 2 as a prompt/runtime refinement and brownfield cleanup phase:
- make the kickoff prompt prescribe an exact first tool-call shape for `.hopi/merge.sh` (with project-root/env guidance),
- make the prompt explicitly require inspect/fix/retry behavior inside the same session,
- preserve compact runtime state while keeping detailed output in the transcript,
- and eliminate any remaining merge paths that bypass normal tool-call visibility.
</research_summary>

<repo_findings>
## Repo Findings

### Canonical live path today
- `hub/src/web/routes/tasks.ts` `POST /tasks/:taskId/worktree/merge` already resolves the best usable task session, checks mergeability, sends a conversation prompt, writes durable runtime state, and monitors completion via prompt `localId` + `ready` event correlation.
- `buildConversationMergePrompt()` already says to prefer `.hopi/merge.sh` and fall back to normal CLI/git tool calls, but the prompt is still high-level and does not strongly prescribe the first exact tool call, retry loop shape, or blocker discipline.
- `scheduleConversationMergeMonitor()` currently decides only broad runtime outcomes after the agent turn: still running, waiting, blocked, or succeeded based on repo mergeability and session state.
- `web/src/components/SessionChat.tsx` now trusts `task.mergeRuntime`, so Phase 2 can reuse the same durable runtime surface without additional UI architecture.

### Brownfield helpers worth reusing
- `hub/src/sync/projectScripts.ts` already knows the canonical env var contract and command shape for `.hopi/merge.sh` through `runMergeScriptIfPresent()`; even if backend execution is not used, this file is a good source of truth for command/env construction.
- `PRODUCT_MERGE_SCRIPT_RELATIVE_PATH` and merge env vars in `hub/src/web/routes/tasks.ts` / `hub/src/sync/projectScripts.ts` give Phase 2 a reusable script contract.
- Existing tests in `hub/src/web/routes/tasks.merge-script.test.ts`, `hub/src/web/routes/tasks.merge-error.test.ts`, and `hub/src/web/routes/tasks.workflow.test.ts` already exercise merge kickoff, ready monitoring, and blocked/success transitions.

### Hidden behaviors that conflict with Phase 2 goals
- `tryAutoRunMergeScript()` sends an extra prompt then waits for assistant completion as a special automation branch instead of treating the main merge request as the one visible runtime.
- `tryAutoResolveMergeConflict()` directly calls `gitAutocommitWorktree()` and `gitMergeWorktree()` from the backend, which hides the actual merge retry mechanics from the transcript.
- `scheduleBackgroundAutoMergeRetry()` performs direct git retries in the background with toasts, again bypassing in-thread tool-call visibility.
- `runMergeScriptIfPresent()` is currently unused for Merge, which is good for Phase 2; wiring it directly into merge execution would regress back toward hidden backend execution.

### Important brownfield constraint
- The Phase 1 monitor marks success when the repo is no longer mergeable after the conversation turn. That is acceptable for Phase 2 as a coarse outcome check, but Phase 2 should not overextend this into full success proof or retry-loop detection; those belong to Phase 3.
</repo_findings>

<architecture_recommendation>
## Recommended Architecture

### Core approach
Keep the Phase 1 route and durable runtime model, but strengthen the merge prompt into a **structured in-session action contract**:
- first attempt: `.hopi/merge.sh` as one normal CLI tool call when present,
- on failure: inspect stdout/stderr and git/worktree state in-session,
- repair: edit script or workspace files as needed,
- retry: rerun merge inside the same turn/session,
- stop: only when blocked by human judgment or outside-sandbox work.

### Why this fits the repo
- It reuses the conversation-native route already live.
- It preserves the user-visible transcript as the detailed source of truth.
- It avoids creating a second merge runtime or resurrecting backend-only merge execution.
- It leaves Phase 3 free to harden verification and loop detection without rewriting Phase 2.

### What should probably be removed or isolated
- Unused hidden merge automation helpers in `hub/src/web/routes/tasks.ts` should not remain as an attractive alternate execution path once Phase 2 lands.
- Shared prompt or command-building logic should be extracted cleanly so script-contract details live in one place, but actual execution stays with the agent.
</architecture_recommendation>

<plan_recommendation>
## Recommended 3-Plan Split

### Plan 02-01 — Structured in-session merge attempt contract
Focus: make Merge kickoff deterministic and tool-call-shaped.
- Extract or define one canonical merge-attempt instruction builder.
- Include exact project root, env vars, script path, and first-attempt expectations.
- Update route tests to lock prompt contents and kickoff semantics.

### Plan 02-02 — Visible inspect/fix/retry loop in the linked session
Focus: teach the runtime/prompt to keep recovery inside the same conversation turn.
- Strengthen prompt language around inspecting stdout/stderr, checking git/worktree state, applying repo-local fixes, and retrying.
- Tune runtime latest-note / blocked messaging around retry-aware outcomes without building full loop-detection yet.
- Add tests covering script failure, repo-local fix path expectations, and same-session retry intent.

### Plan 02-03 — Sandbox-only recovery and blocker discipline
Focus: prevent drift back to opaque or out-of-bounds recovery behavior.
- Remove or quarantine hidden backend merge retry/conflict helpers that bypass transcript visibility.
- Make blocker guidance explicit when work needs human judgment or leaves the workspace sandbox.
- Add regression coverage that merge flow stays in conversation-native tool semantics and does not silently fall back to backend retries.
</plan_recommendation>

<validation_architecture>
## Validation Architecture

### What needs verification
- Merge kickoff prompt contains enough structure for a deterministic first tool call.
- Repo-owned script contract uses the correct project root and env vars.
- Failed first attempts explicitly lead to inspect/fix/retry guidance in the same session.
- No hidden backend merge retry path remains as the canonical behavior.
- Blocked outcomes clearly distinguish real manual/out-of-sandbox blockers from recoverable in-session failures.

### Best validation layers
- Focused hub route tests for prompt content, runtime transitions, and blocked-state notes.
- Unit tests for any extracted prompt/command-building helper.
- Existing web runtime tests from Phase 1 should remain sufficient; minimal web work expected unless API/runtime notes change.

### Avoid in this phase
- Full repo-truth verification before success.
- Retry fingerprinting or identical-failure loop stopping.
- Preview/init planning beyond shared patterns.
</validation_architecture>

<risks>
## Risks and Pitfalls

### Pitfall 1: Reintroducing hidden execution via helper reuse
Reusing `runMergeScriptIfPresent()` as the actual execution path would make merge look stable while hiding stdout/stderr from the conversation. Reuse the command/env contract, not the backend execution primitive.

### Pitfall 2: Overpromising runtime precision before Phase 3
Trying to infer exact retry counts or final truth from partial signals in Phase 2 will create brittle logic. Phase 2 should focus on visible in-session behavior, not authoritative proof.

### Pitfall 3: Leaving dead legacy helpers nearby
If hidden backend retry helpers remain untouched, future edits may accidentally route Merge back through them. Planning should either delete them or clearly fence them off.

### Pitfall 4: Prompt too vague for deterministic first attempt
If the prompt only says “prefer .hopi/merge.sh,” different agents may choose different first steps. Phase 2 needs a clear first-attempt instruction without hardcoding one brittle workflow for all repos.
</risks>

<sources>
## Sources

### Primary
- `.planning/REQUIREMENTS.md`
- `.planning/phases/02-self-healing-merge-loop/02-CONTEXT.md`
- `.planning/phases/01-merge-action-runtime/01-03-SUMMARY.md`
- `hub/src/web/routes/tasks.ts`
- `hub/src/sync/projectScripts.ts`
- `hub/src/web/routes/tasks.merge-script.test.ts`
- `hub/src/web/routes/tasks.merge-error.test.ts`
- `hub/src/web/routes/tasks.workflow.test.ts`
- `web/src/components/SessionChat.tsx`

### Notes
- Explorer subagent research was attempted but failed with rate limiting (`429`), so this research file is based on direct repo inspection.
</sources>
