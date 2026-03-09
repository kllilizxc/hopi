# Phase 4: Preview Action Parity - Research

**Researched:** 2026-03-08
**Domain:** Brownfield preview action parity on HOPI's merge-first action runtime
**Confidence:** HIGH for repo-grounded gaps, reuse path, and plan slicing; MEDIUM for exact preview runtime field names until implementation settles

<research_summary>
## Summary

Preview already has the right product instinct: direct repo-local start first, transcript append after the attempt, then agent setup/repair only when the direct path fails. `POST /tasks/:taskId/preview/start` already does a real preview RPC call, falls back from worktree root to local root when the worktree path has no runnable command, appends a CLI-style result message into the task transcript, and can auto-prompt the agent to create or repair `.hopi/preview.sh`.

What Preview does **not** have is the durable runtime contract that now makes Merge coherent across hub, store, shared schema, SSE, and web UI. There is no `previewRuntime` on the task model, no store column, no shared schema, no retry fingerprint/count persisted between attempts, no queued or approval-pending runtime when the linked session is busy, and no task-backed summary that survives refresh or reconnect. The current late-crash self-heal loop is held in `inFlightPreviewMonitorControllers`, so the runtime intent disappears with process memory.

That means Phase 4 should **reuse Merge as the reference implementation**, not invent a second preview-specific state machine. Smallest brownfield path:

1. add a preview runtime contract beside `task.mergeRuntime`,
2. persist and emit it through the existing task update path,
3. move preview monitor / retry semantics onto that durable runtime,
4. then switch web/task UX to read the durable preview runtime as the source of truth.

Product direction stays direct-success-first. If the linked session is idle, Preview should try the CLI-like repo preview path immediately. Agent repair belongs only after direct start fails, readiness never arrives, or a started preview crashes.
</research_summary>

<repo_findings>
## Repo Findings

### Current preview flow already covers the happy-path mechanics
- `hub/src/web/routes/tasks.ts` `POST /tasks/:taskId/preview/start` resolves the linked task session with `resolveTaskPreviewAccess()` and chooses the best preview root with `resolveTaskPreviewPath()`.
- `runObservedPreviewAttempt()` calls `previewStartForSession()` first, then falls back to machine-level `previewStart()` only when the session RPC handlers are unavailable.
- `observePreviewStart()` waits briefly for `ready`; if Preview is still booting after the short observe window, the route still returns success with the raw preview status.
- If the worktree root has no runnable preview command, `resolveTaskPreviewFallbackPath()` retries from the local/base path before asking the agent for help.
- Every direct attempt appends `buildPreviewStartResultMessage()` into the task transcript via `appendAssistantTextMessage()`, so the user and agent can already see command, root path, log tail, error text, and fallback notes.

### Current repair flow is already transcript-visible, but runtime-local
- Missing preview command goes through `createPreviewSetupPrompt()` + `tryAutoSetupPreviewScript()`, which asks the agent to create or repair `.hopi/preview.sh`, keep the readiness marker contract, and run a quick sanity check.
- Launch failures go through `createPreviewRepairPrompt()` + `tryAutoRepairPreviewFailure()`, which sends the last command, last error, and recent log tail into the same linked session.
- `sendPreviewRepairPrompt()` waits for assistant completion, then the route retries the same direct preview start path.
- `schedulePreviewSelfHealMonitor()` keeps polling preview status after an initially successful response and can auto-repair late crashes.

### The big gap versus Merge is durability, not feature intent
- `shared/src/schemas.ts` defines `TaskMergeRuntimeSchema` and `TaskSchema.mergeRuntime`, but nothing parallel for Preview.
- `hub/src/store/types.ts`, `hub/src/store/index.ts`, and `hub/src/store/tasks.ts` persist only `merge_runtime`; there is no `preview_runtime` column or normalization path.
- `hub/src/web/routes/tasks.ts` has reusable merge helpers like `buildTaskMergeRuntime()`, `updateTaskMergeRuntime()`, and `emitTaskUpdatedEvent()` that keep task state durable and replayable. Preview has no corresponding task runtime helper.
- Merge retry state persists `retryCount`, `failureFingerprint`, `latestNote`, and `blockedReason`; Preview keeps `repairAttempts` only inside the live monitor closure.
- Merge can represent `queued`, `approval_pending`, `running`, `retrying`, `blocked`, `succeeded`, and `canceled`; Preview route logic does not preflight `session.thinking` or pending approval requests before calling preview RPC.

### Current preview web UX is still route-local and polling-based
- `web/src/components/SessionChat.tsx` keeps Preview state in local component state: `previewStatus`, `previewBusy`, and `previewEvents`.
- The component polls `GET /tasks/:taskId/preview` every 2 seconds while preview is active and builds ephemeral thread events locally.
- Refresh/reconnect therefore only restores what the live preview RPC can currently report; it does not restore why Preview is queued, retrying, blocked, or waiting for user action.
- Merge already solved this differently: the same `SessionChat.tsx` renders durable merge summaries from `task.mergeRuntime`, and `web/src/hooks/mutations/useMergeTaskWorktree.ts` optimistically updates task caches using the persisted runtime contract.

### Merge already contains the reference implementation Preview should copy
- Merge runtime state is task-anchored, compact, emitted through `task-updated`, and synced on relink via `hub/src/sync/sessionTaskLink.ts`.
- Merge route tests already lock the behaviors Preview needs next: direct tool call before agent handoff, queued/approval-pending deferral, retry fingerprinting, repeated-blocker stop, and manual next-step summaries.
- Phase 3 summaries confirm the intended contract: compact durable runtime outside the transcript, detailed CLI output inside the transcript, repeated-fingerprint stop conditions, and explicit manual handoff text.
</repo_findings>

<architecture_recommendation>
## Architecture Recommendation

### Recommended runtime shape
Add `previewRuntime` as a sibling to `mergeRuntime`, not as a brand-new generic action framework. Keep the Merge envelope semantics and only add the preview-specific summary fields the web/task surfaces actually need.

Recommended baseline semantics:
- Core fields mirror Merge: `status`, `sessionId`, `updatedAt`, `requestedAt`, `startedAt`, retry metadata, blocker summary fields.
- Preview-specific summary fields stay compact: last `mode`, `rootPath`, `command`, `url`, and maybe `port` if the UI needs it.
- Keep transcript and live preview RPC as the place for detailed log tail / stdout / stderr. Do **not** persist large logs into task runtime.

Recommended durable status vocabulary:
- `queued` — linked session is busy with a normal turn; Preview will auto-run when the session becomes runnable.
- `approval_pending` — linked session is blocked on a permission request that must be resolved before Preview can auto-run.
- `waiting` — direct Preview start already fired and HOPI is now waiting for readiness or follow-up session confirmation.
- `running` — HOPI is actively issuing the direct Preview start attempt right now.
- `retrying` — direct start or late-crash repair loop is in progress after at least one failed attempt.
- `blocked` — repeated blocker or out-of-sandbox/manual step required.
- `ready` — Preview is up and should stay user-visible across task/chat surfaces.
- `stopped` — Preview process ended or was stopped after being ready.
- `canceled` — user canceled queued/running preview work before it reached a stable outcome.

This is intentionally **parallel to Merge, not identical to Merge**: Preview needs long-lived `ready` / `stopped` states where Merge uses terminal `succeeded`.

### Recommended flow
1. **Before direct start:** resolve the linked session exactly as today, but add the same busy checks Merge uses (`session.thinking`, pending approval requests). If busy, persist `queued` or `approval_pending`, emit `task-updated`, and let a monitor auto-run the same direct preview attempt once the session is free.
2. **Direct start first:** when the session is idle, write `previewRuntime.status = running`, then run the existing preview RPC path (`previewStartForSession()` with machine fallback, worktree/local root fallback intact).
3. **Transcript append stays mandatory:** every direct attempt still writes the CLI-style preview result into the thread before any repair prompt.
4. **Repair only on failure:** only after direct start fails, readiness never arrives, or a running preview crashes should HOPI send setup/repair instructions to the agent.
5. **Retry metadata becomes durable:** persist retry count and failure fingerprint on the preview runtime instead of storing them only in a local closure.
6. **Loop-stop semantics move to runtime:** repeated identical blockers or real out-of-sandbox blockers should end as durable `blocked` preview runtime with exact manual next step text.
7. **Web uses runtime first:** task and session surfaces should render `task.previewRuntime` as the durable summary source, while `GET /tasks/:taskId/preview` remains the live-process detail channel for log tail, ready URL confirmation, and stop RPC.

### Why this is the smallest brownfield path
- It reuses the task/store/shared/SSE/web seams already proven by Merge.
- It keeps Preview's existing direct-start RPC, fallback path resolution, transcript append, and repair prompts.
- It avoids overbuilding the generic action framework that Phase 6 is supposed to evaluate later.
- It preserves the user's requested order of operations: direct CLI-like success path first, agent repair only on failure.
</architecture_recommendation>

<plan_recommendation>
## Recommended 3-Plan Split

### Plan 04-01 — Route Preview trigger through the merge-style direct-run action scaffold
Focus: durable kickoff contract, busy-session deferral, direct-start-first preserved.
- Add `previewRuntime` schema + store persistence + task update emission.
- Preflight preview route for busy/thinking/approval states and persist `queued` / `approval_pending`, then move to `running` and `waiting` as the direct attempt and readiness observation progress.
- Keep current direct start order: preview RPC first when idle, no repair prompt on the success path.
- Preserve worktree→local fallback, transcript append, and current preview RPC fallbacks.

### Plan 04-02 — Add preview retry fingerprinting, blocker summaries, and late-crash loop control
Focus: durable recovery behavior instead of in-memory retry counters.
- Move `schedulePreviewSelfHealMonitor()` semantics onto persisted preview runtime state.
- Persist retry count, failure fingerprint, blocker reason, and exact manual next step.
- Stop on repeated identical blockers or true out-of-sandbox needs.
- Keep repair/setup prompts transcript-visible and only after a failed direct attempt or post-start crash.

### Plan 04-03 — Surface durable preview runtime status, cancel, and retry UX across web/task views
Focus: task/chat parity with Merge.
- Teach task/session web surfaces to summarize `previewRuntime` the way Merge already summarizes `mergeRuntime`.
- Replace route-local preview events as the primary UX with task-backed summary + live detail drill-down.
- Add preview cancel/retry controls that mutate task cache predictably and survive refresh/reconnect.
- Keep raw preview status polling only where live process details are needed; do not rely on it for primary action state.
</plan_recommendation>

<validation_architecture>
## Validation Architecture

### What needs verification
- Direct Preview still runs first when the session is idle; no agent setup/repair prompt appears on the happy path.
- Busy or approval-blocked sessions persist queued runtime state and later auto-run without another user click.
- Failed starts and late crashes append transcript-visible result messages before the agent repair loop continues.
- Retry fingerprint/count survive refresh/reconnect and stop on the same blocker or on out-of-sandbox/manual blockers.
- Web/task surfaces read the durable preview runtime instead of relying on local component state only.

### Best validation layers
- Extend `hub/src/web/routes/tasks.preview.test.ts` for kickoff, busy deferral, repair, repeated blocker, and late-crash coverage.
- Reuse merge route tests (`tasks.merge-script.test.ts`, `tasks.merge-error.test.ts`) as the reference expectations for queueing, approval pending, direct-run-first, and blocker stop behavior.
- Use `bun run typecheck:hub` to lock schema/store/runtime contract changes.
- Use `bun run typecheck:web` for task/chat preview runtime rendering and cache update changes.
- Keep manual coverage for refresh/reconnect and product-feel checks until preview-specific web tests exist.

### Suggested phase gate
- Fast loop: `bun run test:hub`
- Contract safety: `bun run typecheck:hub`
- Web parity safety: `bun run typecheck:web`
- Phase sign-off: `bun run test:hub && bun run typecheck:hub && bun run typecheck:web`

### Avoid in this phase
- Generic action-run table or manifest system.
- Persisting full preview logs into task state.
- Agent-first preview kickoff when the direct path could have succeeded.
- UI work that lands before the runtime contract exists.
</validation_architecture>

<risks>
## Risks and Pitfalls

### Pitfall 1: Building a second preview-only runtime model
If Preview gets a one-off state object or route-local control flow, Phase 6 will have to merge two incompatible designs. Copy Merge's task/runtime/store/SSE pattern now; only diverge where Preview needs `ready` / `stopped` semantics.

### Pitfall 2: Losing the direct-success-first product behavior
It will be tempting to treat Preview like Merge conversation handoff and send an agent prompt up front. That would regress the current fast path and violate the user request. Direct preview RPC must remain first when the session is idle.

### Pitfall 3: Keeping two sources of truth forever
`GET /tasks/:taskId/preview` should stay the live process probe, but `task.previewRuntime` needs to become the durable action summary. If both try to be the main UI truth, refresh/reconnect bugs will persist.

### Pitfall 4: Leaving retry limits in memory only
Current preview recovery counts attempts inside `schedulePreviewSelfHealMonitor()`. That resets after route re-entry or hub restart and cannot stop repeated blockers reliably. Phase 4 should persist retry metadata on the task runtime.

### Pitfall 5: Over-persisting logs instead of summaries
The transcript already captures the important command output. Task runtime should keep compact summaries and manual next-step text, not duplicate raw logs.

### Pitfall 6: Forgetting relink/session drift behavior
Merge already syncs runtime session IDs on relink through `sessionTaskLink.ts`. Preview runtime should follow the same pattern or queued/retrying preview state will drift when a task gets relinked.
</risks>

<sources>
## Sources

### Primary
- `.planning/STATE.md`
- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `.planning/phases/03-verified-completion-recovery-control/03-02-SUMMARY.md`
- `.planning/phases/03-verified-completion-recovery-control/03-03-SUMMARY.md`
- `hub/src/web/routes/tasks.ts`
- `hub/src/web/routes/tasks.preview.test.ts`
- `hub/src/web/routes/tasks.merge-script.test.ts`
- `hub/src/web/routes/tasks.merge-error.test.ts`
- `hub/src/store/index.ts`
- `hub/src/store/tasks.ts`
- `hub/src/store/types.ts`
- `hub/src/sync/sessionTaskLink.ts`
- `shared/src/schemas.ts`
- `web/src/components/SessionChat.tsx`
- `web/src/api/client.ts`
- `web/src/hooks/mutations/useMergeTaskWorktree.ts`
- `web/src/hooks/useSSE.ts`

### Notes
- Research based on direct repo inspection only.
- Merge runtime is treated as the canonical brownfield reference implementation for Phase 4.
</sources>
