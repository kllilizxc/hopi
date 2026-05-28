# Phase 5: Init Action Parity - Research

**Researched:** 2026-03-08
**Domain:** Brownfield init action parity on HOPI's merge-first / preview-parity action runtime
**Confidence:** HIGH for repo-grounded gaps, plan slicing, and validation layers; MEDIUM for the exact helper boundaries between session-start service and a new init-runtime orchestrator

<research_summary>
## Summary

Init already has part of the desired product shape: `startSessionFromTask()` spawns the real task session, runs the repo-local `.hopi/init.sh` directly inside the workspace, and on the `start-session` route handoff path it appends a CLI-style transcript message plus a repair prompt instead of immediately killing the session. That means the direct-run-first instinct is already present.

What Init does **not** have is the explicit action-runtime contract Merge and Preview now share. Init still lives as a special branch inside session bootstrap logic, has no durable `initRuntime` on the task, has no bounded retry or blocker fingerprint, and has no typed task/web surface that survives refresh or reconnect. The route-local handoff path only exists for manual `POST /tasks/:taskId/start-session`; the auto-run scheduler still calls `startSessionFromTask()` in the old fail-hard mode, which archives the just-started session and blocks the task when init fails.

That means Phase 5 should **promote init from hidden bootstrap behavior to a first-class task action runtime** while preserving the direct CLI-like first attempt. Smallest brownfield path:

1. split session spawn from init orchestration,
2. persist a compact `initRuntime` on the task,
3. reuse Merge/Preview-style transcript + repair + retry + blocker discipline,
4. then surface durable init status in task/session UI.

The key product rule is unchanged: direct init attempt first, low-noise success path, agent repair only after the real CLI attempt fails, and no out-of-sandbox magic.
</research_summary>

<repo_findings>
## Repo Findings

### Current init success path already does the real direct attempt
- `hub/src/sync/taskSessionService.ts` `startSessionFromTask()` spawns the task session, links it to the task, then runs `.hopi/init.sh` through `engine.runBash()` before sending the kickoff prompt.
- The init script is resolved against candidate working directories, including the linked session runtime path and the workspace path, so the happy path already uses real repo-local state.
- On success, kickoff text gets a compact note: `System note: Ran \.hopi/init.sh successfully before this prompt.` That preserves the clean success path without extra repair chatter.

### Current init failure recovery is transcript-visible, but only for the manual route
- `hub/src/web/routes/tasks.ts` `POST /tasks/:taskId/start-session` passes `initFailureMode: 'handoff'` into `startSessionFromTask()`.
- On `kind === 'init_handoff'`, the route appends a direct CLI result message with command, stdout, and stderr, then sends a repair prompt into the started session.
- `hub/src/web/routes/tasks.start-session.test.ts` already proves the desired session-lives-on behavior for this one path: the task stays `in_progress`, the session stays linked, and the transcript contains the init failure summary.
- The repair prompt also contains the main task kickoff summary, which means init recovery and task kickoff are still entangled inside one special-case prompt instead of one explicit action lifecycle.

### Auto-run still violates the Phase 5 product contract
- `hub/src/sync/autoRunScheduler.ts` calls `startSessionFromTask()` with the default `initFailureMode: 'error'`.
- In that mode, failed init archives the spawned session and returns an error, and the scheduler then marks the task `blocked` and emits a toast.
- That is the clearest repo-grounded gap versus `INIT-02`: auto-run does **not** keep the started session alive or preserve the same repair loop the manual route now gets.

### The big gap versus Merge/Preview is that Init has no durable runtime contract
- `shared/src/schemas.ts` and `shared/src/types.ts` currently persist `mergeRuntime` and `previewRuntime`, but nothing parallel for init.
- `hub/src/store/index.ts`, `hub/src/store/types.ts`, and `hub/src/store/tasks.ts` only round-trip merge/preview runtime columns and relink logic.
- `web/src/types/api.ts` has no `TaskInitRuntime`, and `TaskStartSessionResponse` only exposes `{ task, sessionId }`.
- Because there is no task-backed init runtime, refresh/reconnect cannot explain whether init is running, retrying, blocked, or already succeeded.

### Current retry/blocker semantics are one-shot, not action-runtime level
- Manual start-session handoff sends one repair prompt, but there is no durable retry count, failure fingerprint, repeated-blocker detection, or exact persisted manual next step.
- There is also no explicit “continue main task only after init succeeds” state transition beyond prompt wording.
- Merge and Preview already solved these concerns with persisted runtime notes, blocker summaries, and bounded loops. Init should copy that discipline rather than inventing a separate recovery model.

### Current web/task UX has no init-aware status surface
- `web/src/hooks/mutations/useStartTaskSession.ts` only returns `task` and `sessionId` and invalidates task/session queries.
- `web/src/routes/projects/task-workbench.tsx` shows a generic “session started” toast and navigates onward; there is no init status summary, retry note, or blocker surface.
- `web/src/components/SessionChat.tsx` and `web/src/components/AssistantChat/HappyThread.tsx` now render Merge and Preview runtime summaries, but nothing for Init.
- That means even the improved manual handoff path becomes easy to lose after reload or re-entry.
</repo_findings>

<architecture_recommendation>
## Architecture Recommendation

### Recommended runtime shape
Use a dedicated `task.initRuntime` that stays **close to** Merge/Preview runtime fields without jumping early to a generic action manifest.

Recommended fields:
- `status`
- `sessionId`
- `updatedAt`
- `requestedAt`
- `startedAt`
- `completedAt`
- `retryCount`
- `failureFingerprint`
- `latestNote`
- `blockedReason`

Recommended statuses for Phase 5:
- `running`
- `retrying`
- `waiting`
- `blocked`
- `succeeded`
- `canceled` only if implementation truly needs an explicit aborted state during session start handoff; otherwise defer

Keep the vocabulary aligned with Merge/Preview, but do **not** add Preview-only `ready` / `stopped` semantics to Init.

### Recommended flow
1. `startSessionFromTask()` becomes responsible for session creation, task/session linking, and kickoff gating, not for owning the entire init action lifecycle inline.
2. A dedicated init-runtime helper performs the direct `.hopi/init.sh` attempt, appends transcript-visible CLI results, updates `task.initRuntime`, and decides whether to retry, block, or succeed.
3. On failure, the helper sends a same-session repair prompt, waits for the assistant turn to finish, reruns the direct init command, and persists retry metadata between attempts.
4. Only after init succeeds should the main task kickoff prompt be sent automatically. If init blocks, keep the session alive and preserve the manual next step instead of silently continuing task work.
5. Auto-run scheduler and manual start-session route must call the same helper so the product contract is identical regardless of how the task started.

### Why this is the smallest brownfield path
- Reuses already-proven Merge/Preview runtime semantics.
- Preserves the real CLI-like direct init attempt already implemented.
- Fixes the biggest inconsistency first: manual and auto-run start paths currently behave differently on init failure.
- Avoids premature Phase 6 generalization while still leaving clean seams for later action-runtime consolidation.
</architecture_recommendation>

<plan_recommendation>
## Recommended 3-Plan Split

### Plan 05-01 — Promote init execution into an explicit action runtime during session start
Focus: durable `initRuntime` contract, store/schema/API threading, and separating session spawn from init orchestration.

Why first:
- Every later repair/UI change needs one task-backed source of truth.
- Session-start and auto-run paths need one shared helper before behavior changes can stay consistent.

### Plan 05-02 — Reuse transcript-led repair, retry, and blocker handling for init failures
Focus: direct CLI result messages, same-session repair prompts, bounded retry loop, repeated-blocker stop, and “kickoff only after init success” discipline.

Why second:
- This is the core product parity gap.
- It turns the current one-shot handoff into a real self-correcting runtime the hub can observe and summarize.

### Plan 05-03 — Surface durable init runtime state and summaries across task/session views
Focus: typed API/web exposure, task/session summary banners, start-session cache updates, and reconnect-safe init visibility.

Why third:
- UI work should read the final runtime contract instead of chasing moving internals.
- It mirrors the successful Preview plan order and keeps execution scoped.
</plan_recommendation>

<validation_architecture>
## Validation Architecture

### What needs verification
- Direct init success still feels low-noise: session starts, init runs, kickoff follows, no unnecessary repair prompt.
- Manual start-session and auto-run both keep the session alive on init failure and use the same runtime contract.
- Retry fingerprints and blocker summaries stop repeated identical init failures with one exact manual next step.
- Kickoff prompt is delayed until init success or explicit manual handoff rules, not sent prematurely on blocked init.
- Task/session surfaces rehydrate durable init state after refresh/reconnect.

### Best validation layers
- **Hub unit/integration tests** for `startSessionFromTask()`, any new init-runtime helper, auto-run scheduler behavior, and `tasks.start-session` route responses.
- **Store/schema tests** for `initRuntime` migration, round-trip persistence, and relink/session-id coherence.
- **Web type + component/hook tests** for typed `initRuntime` exposure, task cache updates after start-session, and session/task banner rendering.
- **Manual companion checks** for start-session product feel, especially kickoff timing and reload/re-entry visibility.

### Suggested phase gate
Use the same fast loop as Phase 4:
- `bun run test:hub`
- `bun run typecheck:hub`
- `bun run typecheck:web`

Add `bun run test:web` once init web hook/component coverage lands in Plan 05-03.

### Avoid in this phase
- Generic action manifest or shared multi-action abstraction beyond what Init needs right now.
- Heavy browser end-to-end coverage before the runtime contract stabilizes.
- Persisting full init logs on the task record; keep durable summaries compact and leave detailed output in the thread.
</validation_architecture>

<risks>
## Risks and Pitfalls

### Pitfall 1: Keeping init hidden inside bootstrap logic
If session-start service continues to own all init behavior inline, later retry/UI work will stay special-cased and hard to rehydrate.

### Pitfall 2: Fixing only the manual route
If manual `start-session` gets parity but `AutoRunScheduler` still archives failed init sessions, the product remains inconsistent.

### Pitfall 3: Sending kickoff before init is actually stable
If task kickoff still rides inside the failure prompt or fires before retry success, users will see task work start on a broken environment.

### Pitfall 4: Inventing a third retry model
Merge/Preview already solved retry count, blocker summary, and exact manual next-step persistence. Init should reuse that shape.

### Pitfall 5: Overgeneralizing into Phase 6 early
A shared action framework is desirable later, but forcing it now will blur ownership and increase risk during session-start changes.

### Pitfall 6: Forgetting refresh/reconnect visibility
Without durable init summaries in task/session UI, the action will still feel like hidden bootstrap magic even if the backend loop improves.
</risks>

<sources>
## Sources

### Primary
- `hub/src/sync/taskSessionService.ts`
- `hub/src/sync/taskSessionService.test.ts`
- `hub/src/web/routes/tasks.ts`
- `hub/src/web/routes/tasks.start-session.test.ts`
- `hub/src/sync/autoRunScheduler.ts`
- `web/src/hooks/mutations/useStartTaskSession.ts`
- `web/src/routes/projects/task-workbench.tsx`
- `shared/src/schemas.ts`
- `shared/src/types.ts`
- `hub/src/store/tasks.ts`
- `.planning/phases/04-preview-action-parity/04-01-SUMMARY.md`
- `.planning/phases/04-preview-action-parity/04-02-SUMMARY.md`
- `.planning/phases/04-preview-action-parity/04-03-SUMMARY.md`

### Notes
- No phase-specific `05-CONTEXT.md` exists yet; planning should use project decisions already captured in `.planning/PROJECT.md`, `.planning/ROADMAP.md`, and `.planning/STATE.md`.
</sources>
