# Goal/Kanban/Assistant File-Native Alignment Plan

Status: draft alignment plan
Date: 2026-06-06

## Scope

This document compares the current `hopi` implementation with the referenced design:

`/home/kllilizxc/Code/hopi-auto/docs/hopi-goal-kanban-assistant-unified-design.md`

Important authority note: that referenced file is marked as historical background and says Phase 1 supersedes obsolete details such as `candidate`, task status `blocked`, `dependencyTaskList`, and `todo.mjs`. This plan therefore keeps the stable design invariants from the unified design, but uses the current Phase 1 authority from `hopi-auto/docs/agent-handoff.md` and `hopi-auto/docs/hopi-phase-1-authority.md` where they conflict.

Target invariants:

- `todo.yml` is durable workflow truth.
- `events.jsonl` is append-only workflow audit trace.
- `decisions.yml` is durable decision truth.
- Runtime/session data is overlay, not workflow truth.
- Web board is docs projection plus runtime overlay.
- Assistant is Goal-scoped and constrained to typed durable actions.
- Scheduler is deterministic control-plane logic.
- DB task/goal/decision rows are indexes, caches, or runtime overlay only.

This plan keeps the current repo shape (`hub/`, `web/`, `cli/`, `shared/`) and describes how to align it. It does not require copying the `hopi-auto/packages/*` tree into this repo.

## Current Implementation Summary

The current repo already has a partial Goal Assistant and kanban implementation, but its source-of-truth direction is inverted from the file-native design.

- `hub/src/store/tasks.ts` and `hub/src/store/goals.ts` still persist durable-looking task and goal fields in SQLite. The obsolete `goal_decision_topics` store/schema layer has now been removed from current code paths and current schema creation; historical installs may still only encounter it through a one-time schema drop migration.
- `hub/src/sync/goals/goalTodo.ts` now supports the canonical `goal + items[]` shape, and live read/bootstrap/import paths now only normalize already-canonical goal-local `todo.yml` files; they no longer auto-upgrade legacy `goals: [...]` files in place, and the last explicit legacy YAML migration helper plus legacy markdown conversion helpers have also been removed. That canonicalization path still normalizes already-canonical goal-local files in place when they carry stale residue such as `status: blocked`, and the remaining live writable helpers (`createGoalTodoTaskId`, metadata sync, todo upsert/remove) parse only the canonicalized document instead of consulting a legacy parser/fallback branch. Canonical `blockedBy.kind` values are now normalized toward the structured blocker vocabulary instead of leaking runtime-specific strings such as `preview` or `agent`, legacy/canonical `status: blocked` items are rewritten back to a durable lane plus blockers during canonicalization, plain planning writes without an explicit `candidate/deferred` tag durable-write `status: planned` instead of defaulting back to `candidate`, and canonical board items also stop exposing `candidate` as a live task status: legacy/canonical `status: candidate|deferred` is rewritten to `status: planned` plus a compatibility `tag`, so reservoir semantics survive without keeping `candidate` in the canonical lane vocabulary. Production `readGoalTodo()` / goal-doc import preview no longer implicitly fall back to either legacy root `.hopi/docs/todo.yml` or `todo.md`, and both `parseGoalTodoYaml(...)` and `canonicalizeGoalTodoYaml(...)` are canonical-only: none of those live helpers parse legacy YAML directly or export compatibility `sections` / `rawYaml`.
- `hub/src/sync/taskAutomation.ts` now clears stale merge blocker state consistently when a Goal task is re-prompted back into execution: the `automation_task_prompted` path now clears both overlay blocker fields and stale `mergeRuntime` before writing `todo.yml`, so docs and runtime no longer diverge with an `in_progress` todo item that still carries a blocked merge hold in the overlay.
- The older `updateGoalTodoTaskState(...)` / `updateGoalTodoYaml(...)` `GoalTodoUpdateKind` writer path has now been removed from production code and tests; active code paths write Goal todo state through canonical `upsertGoalTodoTaskState(...)` or `removeGoalTodoTaskState(...)`.
- Goal task blocked writes that go through the main docs-first upsert path now preserve the prior canonical lane when possible and express the block through `blockedBy[]`, so many runtime/document writes no longer collapse durable `todo.yml` state into `status: blocked` for preview/init/evaluator/merge interruptions. The compatibility `sections` projection now also keeps that durable lane and carries blocker metadata instead of manufacturing a blocked column for every canonical `blockedBy[]` item.
- The former `hub/src/sync/goals/goalTodoTaskSync.ts` DB-to-doc mirror helper has been removed from production code. Canonical paths now write `todo.yml` directly, and read paths no longer backfill legacy DB-only Goal tasks into docs.
- `hub/src/web/routes/tasks.ts`, `hub/src/web/routes/goals.ts`, `hub/src/sync/goalAssistant.ts`, and the scheduler candidate-selection path already read canonical board projections from docs first. `hub/src/sync/goals/goalActionPacket.ts` now writes both `create_goal_task` and `update_current_task` board changes to `todo.yml` before materializing/updating overlay rows when a Goal workspace is available, and those docs writes now derive durable lane/tag directly from task state plus runtime blocker metadata instead of routing through a legacy `GoalTodoUpdateKind`/`blocked` intermediate. Newly created Goal tasks no longer stay blocked-shaped when a legacy action packet says `status: blocked` without blocker payload, `create_goal_task` duplicate suppression now also consults canonical board items instead of only existing SQLite overlay rows so docs-only todo items are not recreated by planner packets and stale DB-only Goal rows no longer suppress creation when a docs-backed Goal workspace is present, the low-level `applyGoalActionPacketFromSession(...)` helper now also accepts canonical Goal todo refs directly by materializing the writable overlay row first instead of requiring the raw SQLite task id, but stale DB-only `manual` and `project_init` Goal rows in docs-backed workspaces are now rejected there instead of being allowed to create durable `todo.yml` state from SQLite residue, `update_current_task` now preserves the owning lane plus blocker metadata when replaying legacy blocked packets onto preview/merge/evaluator blocked Goal tasks instead of re-exporting `blocked` as a durable lane, now also reads the docs-projected Goal task view before defaulting title/description on `update_current_task`, and no longer recreates a removed canonical todo item from a raw Goal overlay row when the board item has already disappeared before the action packet is applied. Source-less stale blocked rows no longer get re-expanded into synthetic durable `intervention` blockers through that action-packet path, both action-packet main paths plus fallback docs sync now retain explicit workflow-event names instead of collapsing back to generic todo sync audit entries, and `create_decision_topic` packets now validate linked Goal tasks through docs projection so docs-only Goal todo refs can open blocking decision topics without a pre-existing SQLite task row while stale DB-only Goal rows are skipped instead of being reinterpreted as task-scoped decision targets. The ready-event recovery gate in `hub/src/sync/taskAutomation.ts` now also allows those runtime-blocked Goal tasks to consume a final action packet instead of only agent/scheduler blocked tasks. Most other scheduler/task-automation transitions still materialize DB task rows and then sync docs.
- `hub/src/sync/taskSessionService.ts` now writes Goal task session start and linked-session continuation lane changes to `todo.yml` before updating runtime overlay rows, so the scheduler's main task-start path is partially docs-first even though many downstream runtime transitions are still DB-shaped. Its Goal docs writer now also persists blocker metadata whenever a session-start path explicitly carries an init blocker, Goal kickoff/session-start reads now pull title/description/status from the docs-projected task view instead of trusting stale overlay metadata, both successful and init-blocked `startSessionFromTask(...)` results now return that docs-projected Goal task view instead of the raw updated overlay row, successful `continueTaskInLinkedSession(...)` results do the same, low-level `startSessionFromTask(...)` and `continueTaskInLinkedSession(...)` now also accept canonical Goal todo refs directly by materializing the writable overlay row when needed instead of requiring a raw SQLite task id first, and that low-level writable-task resolver now materializes before raw lookup so stale Goal rows with `id === goalTodoRef` also get their missing `goalTodoRef` repaired before session start continues while stale DB-only Goal rows with no docs-backed projection are now rejected instead of starting/continuing through raw SQLite alone. Its session-state docs writer now also refuses to recreate a removed canonical todo item from a raw Goal overlay row if the board item disappears mid start/continue flow, so linked-session continuation no longer writes `todo.yml` back from stale overlay state after the board item has been deleted. Session start and linked-session continuation return paths now also keep the last docs-backed Goal task view when the canonical board item disappears after the overlay update, instead of falling back to stale overlay title/description in the returned task payload or kickoff summary. Linked-session continuation now clears stale init blockers from both docs and overlay when Goal work resumes successfully, and planner kickoff guidance no longer tells agents to reconcile legacy `operator/planner-mail.yml` or create new workflow truth in the old `goals[]` / `tag` shape. The shared `resolveBestUsableTaskSession(...)` relink path now also returns the docs-projected Goal task view after it reattaches a better session, the lower-level `relinkTaskToSession(...)` helper now does the same while also stamping the canonical docs-backed Goal title into session link metadata instead of preserving a stale overlay title there, direct `setSessionTaskLink(...)` / `syncTaskSessionLink(...)` metadata writes now also reject both stale DB-only runtime Goal residue (`manual` and `project_init`) and docs-missing Goal overlays that still carry a stored `goalTodoRef`, instead of stamping session metadata from raw SQLite alone after the canonical todo item has disappeared, stale DB-only runtime Goal residue is likewise rejected by both `relinkTaskToSession(...)` and `resolveBestUsableTaskSession(...)` instead of continuing through merge/preview/start-session helpers as if it were real docs-backed work, docs-missing Goal overlays that still carry a stored `goalTodoRef` are now rejected by those same relink/session-resolution helpers instead of being treated as valid runtime truth after the canonical todo item has been removed, and session link metadata for Goal tasks is now normalized to canonical `goalTodoRef` while metadata-based task resolution still maps that ref back onto legacy writable overlay ids when needed.
- `hub/src/sync/taskAutomation.ts` now writes several high-frequency Goal runtime transitions to `todo.yml` before updating overlay rows, including follow-up automation prompts, live-message recovery from inactive blocks, inactive-session blocking, evaluator missing-action fallback/requeue/block, permission-pending review handoff, `thinking_resumed` review-to-execution transitions, interruption-driven blocking, and the main bootstrap/preview retry-ready-block flow for `project_init` tasks. Goal-scoped `project_init` tasks no longer short-circuit out of bootstrap ready handling just because they are Goal tasks, so contract/preview repair-block flows now also reach the docs-first bootstrap path, while stale DB-only `project_init` Goal rows in docs-backed workspaces are now ignored by that ready/bootstrap handoff instead of bootstrapping repo docs from SQLite residue alone. Goal ready/action-packet gating now also reads the docs-projected task view instead of trusting stale overlay lane fields, while still preserving explicit overlay blocker metadata during recovery checks, so a stale SQLite `planning` row no longer prevents a docs-backed `in_progress` Goal task from consuming its final action packet or ready-driven review transition. Idle goal-action replay during project ticks now uses that same docs-projected lane check, session-link fallback by `activeSessionId` now also resolves the unique docs-backed running Goal task instead of only inspecting raw overlay status, and session metadata that only carries a canonical Goal todo ref now materializes the writable overlay row before task automation continues so docs-only current Goal work can still consume action packets and runtime transitions without a pre-existing SQLite task row. Per-conversation worktree auto-commit now also reads the docs-projected Goal task view before deciding done-vs-review gating and commit-message title, `thinking_resumed` now also reopens Goal review work through the docs-backed lane model instead of skipping Goal tasks entirely, and inactive-session / interruption blocking now also recover the owning Goal lane from docs projection before persisting blocker metadata, so stale planning overlays no longer downgrade docs-backed `in_progress` Goal work to a planned hold. Goal-scoped inactive-session and interruption blocks now keep the overlay task on its current lane while persisting blocker metadata, instead of forcing the overlay row itself to `status: blocked`. Its helper-level Goal todo writers now also reapply the docs-projected Goal runtime view before reusing title/description, skip docs writes entirely once the canonical board item has already disappeared instead of recreating it from a raw overlay row during later permission-pending/runtime transitions, and broader post-update runtime transitions now keep the last docs-backed Goal task view when the canonical board item disappears instead of degrading controller/toast feedback back to raw overlay title/description. Bootstrap contract/preview retry-block writes therefore no longer let stale overlay titles overwrite canonical `todo.yml`, and the other prompt/review/block transitions now likewise reproject the post-update Goal task view before controller notifications, blocked-message local IDs, and realtime toast bodies. Its internal canonical-path helpers now write `todo.yml` directly instead of calling the legacy DB-to-doc mirror helper, but broader runtime automation still remains mixed.
- `hub/src/sync/taskAutomation.ts` and `hub/src/sync/autoRunScheduler.ts` helper-level Goal todo writers now also recover a canonical lane from legacy blocked overlay rows by looking at blocker/runtime metadata first, so old `status: blocked` rows with preview/init/merge/evaluator/scheduler blockers no longer get blindly re-exported to `todo.yml` as blocked-shaped durable state during later automation/scheduler writes. Those helper-level writers also no longer synthesize a durable `intervention` blocker solely from a source-less stale `status: blocked` overlay row; explicit blocker metadata or blocked runtime state now has to exist before a durable blocker is rewritten into docs, and when both exist the explicit overlay blocker now wins over stale runtime blocker metadata so later scheduler/automation writes do not keep reusing an old preview/init summary after a newer block reason has already been set on the overlay. Scheduler runner-recovery reopen, runner-offline waiting, and startup-failure block follow-up paths now also keep the last docs-backed Goal task view before controller notifications and start-failure toasts when the canonical board item disappears mid-transition, so stale overlay titles no longer leak into those scheduler-facing responses after a runtime transition, and the scheduler's helper-level docs writers now likewise refuse to recreate a removed canonical todo item from a raw Goal overlay row when the board item disappears mid-transition. `hub/src/sync/goals/goalTaskState.ts` now centralizes that lane/blocker normalization for scheduler, task automation, goal control, goal action-packet handling, auto-merge follow-up, task-session start/continue docs sync, the shared Goal task projection, Goal Assistant lane fallback, and the goal-scoped `/tasks` route writers, so those still-live control/read paths no longer each maintain their own copy of the legacy `planning/running/review/blocked` recovery switch.
- `hub/src/sync/taskAutomation.ts` recovery paths for missed final Goal action packets and live-message recovery no longer require `task.status = blocked`; they now key off blocker metadata so lane-preserving overlay states can still recover. `goalActionPacket.update_current_task` now also clears stale blocker fields when the final packet moves work back into review/done instead of carrying old scheduler/agent blockers forward.
- `hub/src/sync/taskAutoMerge.ts` now writes Goal auto-merge runtime transitions to `todo.yml` before updating overlay rows, including merge-blocked, force-review runtime updates, and successful completion of accepted tasks, and its canonical-path writes no longer depend on the legacy DB-to-doc mirror helper or the older `updateGoalTodoTaskState(kind: 'done')` path. Goal-scoped auto-merge failures now preserve review lane in runtime overlay while carrying merge blocker metadata, instead of forcing the overlay row itself to `status: blocked`, its durable blocker helper no longer manufactures an `intervention` blocker from a source-less stale blocked row, and its initial accepted/recoverable candidate gate now also reads the docs-projected Goal task view instead of only trusting raw overlay status, so docs-backed accepted/in-review Goal work no longer gets skipped just because SQLite is stale. Preferred-session auto-merge relink now also reprojects the Goal task through docs before returning it to the merge runner, no longer falls back to the raw pre-relink task when `relinkTaskToSession(...)` rejects a docs-missing Goal overlay, and `updateMergeRuntime(...)` plus the later repair/success/error re-fetches now keep the last docs-backed Goal task view when the canonical board item disappears mid-merge instead of degrading to the raw updated overlay row, so evaluator-session fallback merge commit messages, conflict-repair prompts, controller blocked notifications, and final todo writes no longer keep using stale overlay titles after a relink or runtime transition. Its docs writers now also refuse to recreate a removed canonical todo item from a raw overlay row after the board item disappears mid-merge, and the low-level `autoMergeAcceptedTask(...)` / `requestAutoMergeAcceptedTask(...)` entrypoints now also accept canonical Goal todo refs directly by materializing or resolving the writable overlay row first instead of requiring the raw SQLite task id while rejecting stale DB-only Goal rows when a docs-backed workspace exists.
- `hub/src/sync/autoRunScheduler.ts` now writes runner-recovery reopen, runner-offline waiting, and startup-failure block transitions to `todo.yml` before updating overlay rows, and Goal autopilot gating now overlays canonical `goal.md` status/autopilot fields before seeding planner/radar work. Goal task startup failures, runner-offline wait states, and runner-recovery reopen/reblock transitions in the scheduler now preserve the task's docs-backed current lane in runtime overlay while carrying scheduler blocker metadata, rather than forcing the overlay row to `status: blocked` or resetting recovered work back to `planning`, and the scheduler's docs writer now persists durable blockers whenever blocker metadata exists instead of only when the overlay status is literally `blocked`. Those helper-level scheduler docs writes now also reapply the docs-projected Goal runtime view before reusing title/description fields, so stale overlay titles no longer overwrite canonical `todo.yml` during runner-waiting or startup-failure updates. Planner/radar seed task creation itself now also writes `todo.yml` before creating overlay rows, the scheduler's internal canonical-path helpers no longer depend on the legacy DB-to-doc mirror helper, planner low-water candidate/deferred checks no longer re-read legacy `todo.sections`, reservoir `candidate/deferred` docs-backed items are no longer treated as auto-runnable planning work just because their canonical lane is `planned`, existing Goal overlay rows are no longer rewritten with projected board fields just to start execution, `task-added` / `task-updated` scheduler event gating now also resolves canonical Goal todo refs through docs projection before deciding whether to request a tick, legacy DB-only Goal tasks without docs projection no longer request scheduler ticks from either `task-added` or `task-updated`, and Goal autopilot seed/reconcile now likewise ignores stale DB-only Goal rows when a docs root exists but neither canonical `goal.md` nor canonical `todo.yml` is present, so scheduler bootstrap no longer creates planner/radar work or repo docs from pure SQLite residue alone. Planner/radar contracts no longer tell agents to reconcile legacy `operator/planner-mail.yml` or author new workflow truth in the old `goals[]` / `tag` shape. Several other scheduler/runtime mutations are still mixed.
- Goal-scoped `/tasks` create and same-goal patch routes now write `todo.yml` first and append explicit docs-first workflow events before returning/updating overlay rows. Those generic create/patch paths now also persist durable `blockedBy[]` whenever blocker metadata is present, even when the task remains on a canonical lane such as review instead of collapsing through `status: blocked`, and their mutation responses now re-read the docs-projected Goal task instead of returning the raw overlay row. Generic same-goal patch notifications now also reproject Goal tasks before controller blocked feedback, so stale overlay titles no longer leak through that generic `/tasks/:taskId` patch surface either, stale DB-only Goal rows now stay hidden from same-goal patch responses instead of leaking back through the route-level runtime view helper, and when the canonical board item disappears after the docs-first patch write the generic patch response/controller path now keeps the last docs-backed Goal task view instead of degrading back to the raw updated overlay row. Generic Goal-scoped create/patch requests that still arrive as legacy `status: blocked` now also normalize the overlay row back onto the inferred owning lane (`planning`, `review`, or `running`) instead of storing a blocked-shaped Goal task when blocker metadata is enough to explain the hold, and they no longer synthesize a durable `intervention` blocker when that legacy `blocked` request carries no blocker metadata at all. Goal-scoped archive now also removes the canonical todo item before archiving the overlay row, so archiving Goal work no longer leaves stale durable board truth behind in `todo.yml`. The goal-scoped `attach-session`, `start-session`, merge kickoff, merge-cancel, preview success/get, preview-stop, and preview-start blocked/repair responses now follow the same docs-projected return path, so the caller can observe canonical lane/tag/blocker projection without waiting for a second task fetch. Goal-scoped preview/merge runtime route updates, including merge-cancel, now also write `todo.yml` before overlay rows when those runtime transitions change durable board state, and successful merge persistence now follows the same ordering. Route-level Goal todo writes now also reapply the docs-projected Goal runtime view before reusing title/description/blocker fields, so preview/merge runtime updates no longer let stale overlay titles overwrite canonical `todo.yml`, those post-update preview/merge helper paths now also reproject Goal tasks before controller blocked notifications so stale overlay titles stop leaking into controller-visible route feedback, and the merge/preview runtime helper return values themselves now carry the docs-projected Goal view instead of handing later route logic a raw updated overlay row. When the canonical Goal board item disappears mid-preview route, the preview runtime response now keeps the last docs-backed Goal task view plus fresh runtime/blocker metadata instead of falling back to the raw updated overlay row, and the same is now true for merge-blocked route transitions. Those merge/preview route helpers now also derive their overlay status patch from the docs-projected Goal lane before writing SQLite, so stale overlay `planning`/`in_progress` aliases no longer downgrade blocked preview/merge transitions onto the wrong execution/review variant, the preview start/get/stop cluster now accepts canonical Goal todo refs as task identifiers instead of requiring the raw SQLite task id, and the merge-state, merged-diff, merge kickoff, and merge-cancel route cluster now does the same. Deferred preview/self-heal monitor keys now also use the canonical Goal todo ref when one exists, so queued preview cancel/stop flows do not miss an in-flight monitor just because the caller addressed the task by docs ref instead of the raw SQLite id. The queued merge monitor that resumes deferred Goal merges after a thinking/approval hold now also keys and reloads Goal tasks through canonical refs when one exists, then reprojects the stored task through docs before it resolves the usable session, so stale overlay titles no longer get carried into later merge commit messages or final `todo.yml` writes, queued merge cancel via canonical ref does not leave a background monitor running, and the deferred monitor now stops entirely when the canonical todo item disappears instead of falling back to a stale SQLite Goal overlay row. Preview-blocked route/runtime updates no longer require `task.status = blocked`; they now keep the execution lane in both overlay and docs while recording blocker metadata through `previewRuntime` plus durable `blockedBy[]`. Merge-blocked route/runtime updates likewise no longer require `task.status = blocked`; they now keep the review/merging lane in both overlay and docs while recording blocker metadata through `mergeRuntime` plus durable `blockedBy[]`. Cross-goal task moves and unlinks now also remove the old todo item from the previous Goal docs and append removal events. The shared Goal task projection now uses canonical `board.items` as the durable source and treats `sections` as compatibility metadata only, so stable `ref` plus separate `taskId` pairs now project correctly; read paths no longer repair `goalTodoRef` into SQLite as a side effect, legacy overlays only get their missing canonical ref materialized during explicit write/materialization paths, materialization no longer trusts a pre-existing `goalTodoRef` by itself when the canonical docs item has disappeared, newly materialized writable Goal overlay rows no longer copy synthetic preview/init/merge runtime envelopes out of docs projection, the shared `getTaskByNamespaceOrGoalTodoProjection(...)` helper now also returns `null` for stale DB-only Goal rows when a docs-backed workspace exists but no canonical todo item matches, and stale DB-only Goal rows are now hidden from direct task detail/preview read surfaces unless they have a docs-backed projection. Docs-backed blocked items now preserve their canonical lane in the shared `/tasks` projection, surface blocker/runtime metadata without rewriting canonical `todo.yml` on read, no longer rewrite overlay rows to `task.status = blocked` merely because preview/merge/init runtime state is blocked, and still surface explicit legacy overlay blockers such as scheduler/agent holds when a source-tagged blocked row exists even if the durable docs stay on the canonical lane. Projected Goal tasks now also expose that lane explicitly as `goalCanonicalStatus`, so clients no longer have to reconstruct the canonical board lane entirely from raw legacy `status` aliases, tags, and runtime envelopes. Source-less stale DB blockers remain suppressed by docs authority. Legacy DB-only Goal tasks no longer define the board until an explicit migration materializes durable todo items. Merge runtimes in `canceled` state no longer keep todo items stuck in the synthetic `merging` lane. The unfiltered `/projects/:projectId/tasks` list now merges non-goal DB tasks with docs-projected Goal tasks so docs-only Goal work is visible outside goal-scoped queries, but several broader runtime flows still remain DB-shaped.
- Goal todo API responses now expose canonical `board` plus projected tasks only; compatibility `sections` and older `exists/path/rawYaml/updatedAt` response metadata are no longer part of the main `/goals/:id/todo` contract, and the internal `readGoalTodo()` helper now also returns only `board + updatedAt`. Goal-doc import preview likewise now counts only canonical `board.items`.
- `hub/src/store/tasks.ts` now allows runtime overlay rows to keep blocker metadata (`blockedReason`, `blockedSource`, `blockedSessionId`) even when the task remains on a non-`blocked` lane, so lane-preserving preview/init/merge/automation blockers no longer have to collapse the DB overlay into `status: blocked` just to survive round-trips.
- `hub/src/store/index.ts` schema migration backfills no longer coerce merge/preview/init blocked runtime rows onto `status: blocked` during upgrade; they now preserve the pre-existing lane, clear stale `finishedAt` when needed, and still backfill blocker fields from blocked runtimes/message history.
- `hub/src/web/routes/goals.ts` now backfills the initial planner seed task for existing planning goals by writing `todo.yml` first before creating the overlay task row, records a dedicated workflow event for that backfill path, no longer falls back through the legacy DB-to-doc mirror helper, and now skips that backfill when goal-local `todo.yml` already contains non-reservoir docs-only items instead of only checking DB task rows; pure `candidate/deferred` reservoir notes still allow the seed.
- `hub/src/web/routes/taskFinishAutomation.ts` now also marks finished Goal todo items done through canonical `upsertGoalTodoTaskState(...)` instead of the older `updateGoalTodoTaskState(kind: 'done')` path, so post-finish automation no longer depends on that legacy write API.
- `web/src/routes/projects/kanban.tsx` now uses `useGoalTodo()` as the goal-scoped board source instead of also depending on `/tasks`, so goal kanban loading/error state follows the canonical docs projection. Its reservoir-note filter now also keys off the derived task lane instead of raw `planning/planned` status, legacy blocked/planned drift does not leak candidate/deferred notes back into execution columns, the reservoir panel itself now reads canonical `board.items` only instead of merging in legacy `todo.sections`, and reservoir notes now come from `planned + tag:candidate|deferred` instead of a separate live `candidate` status. The broader `/tasks` surface and several runtime flows still remain mixed DB/docs paths.
- `web/src/lib/task-session-timeline.ts` now derives evaluator/review and merge-stage UI state from the task lane plus runtime overlay instead of assuming `task.status === 'blocked'` for merge-blocked review flows, and its fallback evaluator-session inference now also keys off canonical lane completion/review state instead of raw `finished` / `done` task status. `web/src/lib/task-action-runtime.ts` now uses canonical task lane when deciding whether merge actions remain available, instead of keying that control surface off raw `review` / `blocked` task statuses. `web/src/components/SessionChat.tsx` now also gates merge-state querying and the in-chat continue action from `getTaskLane(task)` instead of raw `task.status === 'in_review'`, so docs-projected Goal review work no longer loses those controls just because the legacy task status alias is `review`. `web/src/lib/task-status.ts` now also prefers the projected `goalCanonicalStatus` field when it exists, so goal-backed UI surfaces do not need to reverse-engineer canonical lanes from legacy task statuses before considering runtime overlay.
- `web/src/lib/task-action-runtime.ts` blocked-status summaries now also fall back to canonical lane plus runtime metadata when explicit `blockedSource` is missing, so review-lane blockers no longer collapse to a generic "任务受阻" card. `web/src/hooks/mutations/useMergeTaskWorktree.ts` optimistic merge updates now decide completion from the derived task lane instead of raw task status, clear stale merge blocker fields once merge retry/success moves the task forward, recover legacy blocked Goal tasks back into canonical `in_review` while merge retry restarts, and prefer a docs-projected `task` returned by merge/merge-cancel responses when the server already has the canonical projection. `web/src/hooks/mutations/useTaskPreview.ts` now also prefers the docs-projected task returned by preview start/get/stop responses when present, instead of only splicing `previewRuntime` onto a stale cached task shell. `web/src/hooks/mutations/useCreateTask.ts` now assigns `goalCanonicalStatus` on optimistic Goal tasks as well, so goal-scoped kanban/workbench state does not need to fall back to legacy task-status inference while a create mutation is still in flight.
- `shared/src/tasks.ts` now makes canonical Goal board statuses (`planned`, `in_progress`, `in_review`, `merging`, `done`) the primary task-status order in shared protocol vocabulary, while legacy runtime aliases (`planning`, `running`, `review`, `blocked`, `finished`) remain accepted only as compatibility values. `hub/src/sync/goals/goalTodo.ts` and `web/src/types/api.ts` now both mirror that by removing both `blocked` and `candidate` from `GoalTodoCanonicalStatus`; compat parsing still accepts legacy/canonical `status: blocked` and legacy/canonical `candidate/deferred` reservoir data on read, but typed canonical board state no longer models either as a first-class durable lane.
- Goal-owned metadata writes now sync `goal.md` and `todo.yml` header metadata on explicit API goal patches, planner `update_goal` action packets, and goal-level block/unblock transitions. Goal creation now appends `goal_created_from_goals_api`; API goal patches append `goal_updated_from_goals_api`; planner `update_goal` packets append `goal_updated_from_action_packet`; and automation pause/resume routes append `goal_automation_paused_from_goals_api` / `goal_automation_resumed_from_goals_api`. Those mutations now feed workflow audit while still driving the main `GET /goals` list response, Goal Assistant snapshot reads, controller session naming, controller briefing summaries, scheduler goal-autopilot gating, and Goal mutation responses for create/patch/pause/resume. Goal lists now also hide stale DB-only Goal rows when a docs-backed workspace exists but no canonical `goal.md` has been bootstrapped for that Goal, selected-goal todo board reads now reject those same stale DB-only Goal rows instead of returning an empty board, goal-level decision topic list/create routes now reject them too, and direct goal patch/pause/resume routes now reject them as well, so repo docs rather than SQLite residue define which Goals are visible and mutable through the main Goal API surface. Goal-level workflow-event `before/after` snapshots now also overlay canonical `goal.md` instead of serializing only the raw DB row, so audit entries track the same docs-backed goal metadata the rest of the read model sees. Controller goal summaries and goal-doc import preview counts now both count canonical `board.items` lanes instead of legacy `todo.sections`, planner action-packet `todoRef` title lookup now stays on canonical board items rather than consulting compatibility projections, and planner-seed backfill now ignores stale DB-only Goal rows when canonical `todo.yml` is otherwise empty, so SQLite overlay residue no longer suppresses docs-first planning bootstrap. Broader Goal reconcile still leans on DB rows.
- `hub/src/sync/goalAssistant.ts` now reads board projection, `decisions.yml`, `planning-requests.yml`, and repo-level preference docs first; DB operator intents are no longer part of the snapshot truth, live assistant reads no longer fall back to legacy `operator/planner-mail.yml` or `.hopi/docs/preference.md` when the canonical files are missing, and its shared Goal context resolver now also rejects stale DB-only Goal rows when a docs-backed workspace exists but neither canonical `goal.md` nor canonical `todo.yml` is present. Goal Assistant snapshot task summaries now emit canonical task statuses (`planned` / `in_progress` / `in_review` / `merging` / `done`) derived from the docs-backed lane model instead of exposing raw legacy overlay statuses such as `planning` / `running` / `review` / `blocked`, the snapshot's active-runtime matching now also accepts session metadata that stores canonical `goalTodoRef` instead of a raw overlay id, and the snapshot surface now exposes canonical `planningRequests` rather than `unreadPlannerMail`. The Goal Assistant MCP/server surface now exposes canonical `request_planning` / `/planning-requests` for planner follow-through while retaining `mail_to_planner` / `/planner-mail` as compatibility aliases backed by the same `planning-requests.yml` writer, and the canonical planning-request mutation response now returns `planningRequestId` instead of the older `mailId` wording. Decision-topic task block/requeue control paths now also write `todo.yml` before updating overlay rows, preserve the task's existing lane while carrying decision blocker metadata, append task-scoped decision block/unblock mutations to `events.jsonl`, and no longer require legacy `task.status = blocked` to resolve/requeue that work. Those task-scoped decision create/resolve paths now also resolve through docs projection first, so docs-only Goal todo items can be blocked or requeued without a pre-existing SQLite overlay row; a writable overlay row is materialized only when blocker/runtime metadata must actually be persisted, durable `decisions.yml` task links are now normalized back to canonical Goal todo refs even when the caller addressed the task by a raw SQLite id, stale DB-only Goal rows no longer qualify as task-scoped decision targets through either the low-level helper or `/goals/:id/topics`, and resolving legacy `decisions.yml` task links no longer requeues stale DB-only Goal rows that are missing from canonical todo docs. Goal-level blocking decision transitions now write `goal.md` before updating the goal row and append explicit `goal_blocked_by_decision` / `goal_unblocked_from_decision` workflow events to `events.jsonl`. Production decision-topic read/write paths also no longer fall back to SQLite when a project lacks a docs-backed workspace; goals routes now reject those mutations/reads instead, low-level `decisions.yml` reads are pure file reads, low-level create/resolve helpers no longer hide backfill side effects, assistant/controller/scheduler reads no longer backfill legacy DB decision rows as a side effect, goals topic list/resolve/create paths no longer auto-import legacy DB decision rows either, the unused namespace-wide decision backfill helper, the last explicit per-goal DB backfill helper, and the `legacyDecisionTopicsBackfilledAt` docs metadata have now been removed, and current store/schema creation no longer includes `goal_decision_topics`.
- `cli/src/goalAssistantMcp.ts` and `hub/src/web/routes/cli.ts` now route `request_task_lane`, `request_planning`, decision resolution, and preference writes through docs-first APIs. The shared `requestGoalTaskLane(...)` control path now writes canonical `todo.yml` state directly before updating overlay rows instead of going through the legacy DB-to-doc mirror helper, those lane-request writes now also start from the docs-projected Goal task view rather than the stale writable overlay row, and the helper now rejects DB-only stale Goal rows that have no canonical todo item instead of materializing new durable board truth from SQLite residue. Returning a task to `planned` or `merging` therefore no longer lets an old overlay title/description leak back into `todo.yml` or the helper return value, and when the canonical board item disappears after the docs-first write the helper now keeps the last docs-backed Goal task view instead of degrading its return value back to the raw updated overlay row. Goal Assistant lane requests now operate only on docs-backed board items. The lane-request API response now exposes `requestId` instead of legacy `intentId`, decision-resolution and automation-resume responses now also overlay canonical `goal.md` before reporting `goalStatus`, the planning-request mutation now returns `planningRequestId`, and the old `goal_operator_intents` store/schema plus scheduler replay residue have now been removed from live code.
- `events.jsonl` now records decision mutations, Goal Assistant lane requests, planner follow-through writes, explicit goal metadata writes from goal creation, goal patch, automation pause/resume, and planner `update_goal` action packets, goal-route planner-seed backfills, scheduler seed/recovery/waiting/block transitions, Goal task session start/continue transitions, selected task-automation transitions, auto-merge runtime updates, Goal-scoped preview/merge runtime route updates, merge runtime updates, and finish automation writes. Explicit docs-first todo upserts now also preserve the requested workflow event even when the durable `todo.yml` item was already in the target state, so no-op lane/blocker transitions no longer silently drop audit entries just because the board text stayed identical. Finish automation now also reprojects finished Goal tasks through docs before it re-writes the final `done` todo item, so stale overlay titles stop leaking back into `todo.yml` during post-finish improvements automation, the low-level `handleTaskMovedToFinished(...)` helper now accepts canonical Goal todo refs instead of requiring the raw SQLite task id, skips follow-up writes entirely once the canonical board item disappears mid-flight instead of recreating it from raw overlay state, and stale DB-only Goal rows in docs-backed workspaces are now ignored there instead of still archiving sessions or running follow-up improvements off SQLite residue. The shared `/tasks` route docs writer now also refuses to recreate a removed canonical todo item from a raw Goal overlay row during preview/merge runtime updates after the board item disappears mid-route. Scheduler seed/recovery/waiting/block audit entries now also carry explicit `taskId` metadata instead of only lane/error tags, but coverage is still partial across the broader runtime surface.
- `write-trace.jsonl` now records goal-scoped file-write tool events from session message ingest for raw Claude `tool_use` / `tool_result` flows and codex-normalized Codex, Gemini-remote, OpenCode local/remote, and Gemini-local transcript-scanner tool-call envelopes. Gemini local no longer forwards only plain text when the transcript already exposes structured `tool_call` / `tool_result` messages. Session-linked write-trace resolution now also accepts canonical Goal todo refs from session metadata instead of only raw SQLite task ids, so docs-backed Goal work no longer drops file-write audit entries just because the runtime overlay row uses a different DB id, and stale DB-only Goal rows in docs-backed workspaces are now ignored there instead of creating `write-trace.jsonl` audit entries from SQLite residue alone.
- Session-linked todo-subtask sync now likewise resolves Goal tasks through canonical todo refs, materializing a writable overlay row when needed instead of requiring session metadata to carry the raw SQLite task id, and stale DB-only Goal rows in docs-backed workspaces are now ignored there instead of letting session metadata or `activeSessionId` push TodoWrite state back into SQLite residue.
- `goalDocPaths.ts` now targets `decisions.yml`, `planning-requests.yml`, `events.jsonl`, `write-trace.jsonl`, and repo-level `.hopi/preference.md`; legacy path helpers remain for import/fallback only.

## Major Mismatches

| Area | Target | Current | Required Change |
| --- | --- | --- | --- |
| Board source of truth | `.hopi/docs/goals/<goalKey>/todo.yml` | SQLite tasks are the main board; todo is mirror/reservoir | Make docs the canonical read/write path and treat DB tasks as runtime overlay |
| Todo schema | `goal: { goalKey, title }`, `items[]` with `ref`, `kind`, `status`, `description`, `acceptanceCriteria`, `blockedBy` | Canonical shape is now authoritative for durable writes and API reads; plain planning writes no longer default back to `candidate`, legacy/canonical `candidate/deferred` items are now canonicalized to `status: planned` plus compatibility tag metadata instead of keeping `candidate` as a live board status, production read paths no longer implicitly fall back to legacy root `.hopi/docs/todo.yml` or `todo.md`, goal-local legacy `todo.yml` is no longer auto-imported by live bootstrap/read/import paths, already-canonical goal-local files with stale blocked residue are still normalized in place, the remaining live writable helpers no longer parse through any legacy parser branch, `/goals/:id/todo` no longer exports compatibility `sections` or older raw-YAML/meta response fields, `readGoalTodo()` now returns only `board + updatedAt`, and both `parseGoalTodoYaml(...)` and `canonicalizeGoalTodoYaml(...)` are canonical-only | No parser migration helper residue left here; keep future work focused on runtime/docs reconcile and blocker model cleanup |
| Task statuses | `planned`, `in_progress`, `in_review`, `merging`, `done` | Shared protocol order plus hub/web canonical board types now use the canonical vocabulary, canonical docs now preserve `planned` / `in_progress` / `in_review` / `merging` across many blocked runtime transitions, legacy/canonical `status: blocked` now rewrites back to a durable lane plus blockers, legacy/canonical `candidate/deferred` now rewrites back to `planned` plus compatibility tag metadata, and docs-backed `/tasks` projection now also keeps the canonical lane instead of collapsing runtime/document blockers into `status: blocked`, but the wider task/runtime model still uses `planning`, `running`, `review`, `blocked`, `done` plus legacy aliases | Keep migrating runtime/read-model surfaces off legacy status aliases |
| Blockers | `blockedBy[]` with structured refs | Canonical docs now normalize blocker kinds toward `decision` / `task` / `merge_conflict` / `intervention`, but DB `blockedReason`, `blockedSource`, task status `blocked`, and legacy todo `blocked` objects still remain in the wider runtime model | Finish converting blockers to structured durable refs and keep DB blocker fields overlay-only during migration |
| Decisions | `decisions.yml` durable truth | Docs-first store exists; low-level decision reads plus create/resolve helpers are pure docs operations, assistant/controller/scheduler/goals-route reads no longer backfill legacy DB decision rows, production reads/writes no longer fall back to DB when a project lacks docs root, the explicit per-goal DB backfill helper plus `legacyDecisionTopicsBackfilledAt` docs metadata have been removed, and current store/schema creation now drops the obsolete `goal_decision_topics` table during upgrade | No live-path change left here; only historical unopened DB files can still contain the obsolete table |
| Workflow audit | `events.jsonl` append-only | Decisions, assistant-driven board/planning writes, and several scheduler/task-automation/merge/finish transitions append events, but many runtime mutations still skip normalized audit entries | Extend event append to every board/decision/planning/runtime mutation |
| Write trace | `write-trace.jsonl` goal-scoped file-write audit | Goal-scoped trace now records Claude raw tool events plus codex-normalized Codex, Gemini-remote/local, and OpenCode tool events at hub ingest time, but coverage still depends on adapters surfacing structured tool events instead of plain text | Extend normalized write-event recording across every supported runtime adapter and file-change surface |
| Assistant snapshot | Docs plus runtime overlay | Snapshot is docs-first for board/decisions/planning/preference, the legacy DB-intent field has been removed, and task summaries now expose canonical task statuses instead of raw legacy overlay statuses, but more scheduler/runtime overlay cleanup still remains | Keep the snapshot docs-first and continue trimming DB-shaped residue from adjacent APIs |
| Assistant mutations | Typed durable actions only | `request_task_lane`, `request_planning`, decision resolution, and preference writes are docs-first, and the legacy `goal_operator_intents` store/schema plus scheduler replay residue have been removed | Keep tool naming and guidance aligned with file-native actions |
| Scheduler | Deterministic docs-based reconcile | `AutoRunScheduler` now selects Goal task candidates from docs projections, low-water planner checks see docs-backed ready work, and runner-recovery reopen / runner-offline waiting / startup-failure block transitions all write docs-first with workflow audit, but broader execution/runtime transitions still materialize DB overlays and write DB state | Reconcile from `todo.yml`, write board events, store only runtime overlay |
| Web board | Docs projection plus overlay | Goal-scoped kanban now reads `useGoalTodo()` with canonical `board.items` for both execution columns and reservoir, but the broader `/tasks` surface and several runtime flows still remain mixed docs/DB paths | Make board query return docs projection everywhere; keep task/session overlay attached by `goalKey + taskRef` |
| Preference | `.hopi/preference.md` | `getPreferencePath(docsRoot)` resolves `.hopi/docs/preference.md` | Move canonical preference path to repo `.hopi/preference.md`; migrate old file |
| Goal docs | `goal.md` plus `design.md` | Bootstrap covers both files, key goal-metadata writes now sync `goal.md`, canonical `goal.md` now drives list/snapshot/controller reads, and scheduler Goal autopilot gating overlays `goal.md` when present, but broader Goal reconcile is still DB-led | Keep `goal.md`/`design.md` durable, and move remaining Goal reads/reconcile toward docs-first |

## Target Data Model

Use the Phase 1 task schema:

```yaml
version: 1
goal:
  goalKey: example
  title: Example Goal
items:
  - ref: T-1
    kind: engineering
    status: planned
    title: Implement backend behavior
    description: Make the behavior work.
    acceptanceCriteria:
      - Behavior is covered by tests.
    blockedBy: []
```

Task kinds:

- `planning`
- `engineering`

Task statuses:

- `planned`
- `in_progress`
- `in_review`
- `merging`
- `done`

Blocker kinds:

- `task`
- `decision`
- `merge_conflict`
- `intervention`

Goal docs layout:

```text
.hopi/
  preference.md
  docs/
    index.md
    goals/
      <goalKey>/
        goal.md
        design.md
        todo.yml
        decisions.yml
        planning-requests.yml
        events.jsonl
        write-trace.jsonl
  runtime/
    goals/
      <goalKey>/
        ...
```

`planning-requests.yml` is not in the historical unified design, but it is part of the newer handoff authority. Use it for assistant/planner follow-through instead of `operator/planner-mail.yml` as the long-term target.

## Implementation Plan

### 1. Add File-Native Stores

Create a new board storage layer in `hub/src/sync/goals/`, modeled after `hopi-auto/packages/backend/src/storage/boardStore.ts` but adapted to the current hub runtime:

- `goalBoardTypes.ts`: `TaskKind`, `TaskStatus`, `BlockerRef`, `TaskItem`, `TodoBoard`, `BoardEvent`.
- `goalBoardValidation.ts`: YAML parse/stringify, duplicate ref checks, valid status checks, missing task blocker checks, blocker cycle checks.
- `goalBoardStore.ts`: `readBoard`, `mutateBoard`, `appendEvent`, atomic write through temp file and rename.
- `goalDecisionStore.ts`: read/write `decisions.yml`; replace DB decision-topic reads in canonical paths.
- `goalPlanningRequestStore.ts`: durable planning follow-through and replacement for planner-mail as target.
- `goalPreferenceStore.ts`: canonical `.hopi/preference.md` read/write.

Update `hub/src/sync/goals/goalDocPaths.ts`:

- add `DESIGN_DOC_FILENAME = 'design.md'`
- change decision target to `decisions.yml`
- add `EVENTS_FILENAME = 'events.jsonl'`
- add `WRITE_TRACE_FILENAME = 'write-trace.jsonl'`
- add `PLANNING_REQUESTS_FILENAME = 'planning-requests.yml'`
- make preference path resolve to `<workspace>/.hopi/preference.md`, not `.hopi/docs/preference.md`
- keep old path helpers as migration-only helpers.

### 2. Migrate Existing Goal Docs

Update `bootstrapGoalDocs()` and import flow:

- Always create `goal.md`, `design.md`, `todo.yml`, `decisions.yml`, `planning-requests.yml`, and empty trace files.
- Preserve existing `goal.md` content; create `design.md` with baseline sections when missing.
- Convert existing `operator/planner-mail.yml` into `planning-requests.yml` or mark it legacy.
- Convert `decisions.md` into `decisions.yml` once; historical DB `goal_decision_topics` rows are now obsolete rather than part of any live migration path.
- Record a backfill marker in `decisions.yml` so DB decision rows are no longer consulted.

Legacy todo migration:

- `planning` or `planned` -> `planned`
- `running` or `in_progress` -> `in_progress`
- `review` or `in_review` -> `in_review`
- `done` or `finished` -> `done`
- `blocked` -> infer owning status from runtime overlay; otherwise use `planned` with an `intervention` blocker
- `tag: candidate/deferred` -> do not keep as task status; convert to planning requests or planning tasks depending on whether the item is actionable
- `blocked` object -> `blockedBy` entry plus event
- `body` -> `description`
- missing acceptance -> `acceptanceCriteria: []`

Docs win during migration. If an existing `todo.yml` already contains curated item refs, use those refs and attach DB overlay by `goalTodoRef`.

### 3. Replace DB-First Board Reads

Current board read path:

```text
web useTasks()
  -> /api/projects/:projectId/tasks
  -> SQLite tasks
  -> kanban columns
```

Target board read path:

```text
todo.yml
  -> goalBoardStore.readBoard()
  -> attach runtime overlay from DB/session cache by goalId + taskRef
  -> API response
  -> Web kanban
```

Required changes:

- Replace `GoalTodoResponse.sections` with a board projection response that includes canonical task fields plus overlay fields.
- Keep DB task rows readable for detail pages during migration, but they must not decide card title, description, lane, order, dependency/blocker truth, or completion.
- Update `hub/src/web/routes/goals.ts` so `/projects/:projectId/goals/:goalId/todo` returns the canonical board projection.
- Update `/projects/:projectId/tasks` to either return the same projection for goal-scoped calls or mark itself legacy.
- Add diagnostics for orphan overlay rows whose `goalTodoRef` no longer exists in `todo.yml`.

### 4. Replace DB-First Mutations

All durable workflow mutations must go through board/decision/planning stores.

Update these paths:

- `hub/src/web/routes/tasks.ts`: task create/update/delete/merge status APIs must not write durable workflow fields directly. They should call board mutation services or become runtime-overlay-only endpoints.
- `hub/src/web/routes/goals.ts`: goal create/update must bootstrap docs and update docs-owned metadata; DB goal rows become index/cache.
- `hub/src/sync/goals/goalActionPacket.ts`: stop creating DB task rows as the authoritative action. Planner/generator/reviewer/merger outputs should call board mutation services and append events.
- `hub/src/sync/goals/goalTodoTaskSync.ts`: this legacy DB-to-doc mirror helper has now been removed; keep future board mutations on direct docs-first writers rather than reintroducing a mirror layer.
- `hub/src/sync/goals/goalControl.ts`: resolving decisions must update `decisions.yml`, update `blockedBy` cleanup through scheduler/reconcile, and append events.

Do not add `todo.mjs` or `.hopi/skills/kanban` as the default path. The referenced historical design mentions it, but its own header and Phase 1 authority explicitly supersede that approach.

### 5. Rebuild Scheduler Around Docs

Replace the DB-task-centered parts of `hub/src/sync/autoRunScheduler.ts` with a docs-based reconcile flow.

Core loop:

1. Read `todo.yml`.
2. Read `decisions.yml` and `planning-requests.yml`.
3. Remove resolved `blockedBy` entries.
4. Select the first dispatchable unblocked task.
5. Start or continue the appropriate runtime.
6. Persist runtime overlay under DB/session cache as needed.
7. Mutate `todo.yml` for status changes and append `events.jsonl`.
8. Emit SSE invalidation.

Status progression:

```text
planning/planned       -> planner   -> in_review
planning/in_review     -> reviewer  -> merging or planned
planning/merging       -> merger    -> done or blocker
engineering/planned    -> generator -> in_review
engineering/in_review  -> reviewer  -> merging or planned
engineering/merging    -> merger    -> done or blocker
```

Current DB fields such as `activeSessionId`, `mergeRuntime`, `previewRuntime`, `initRuntime`, `worktreeMergedAt`, and message/session history remain runtime overlay.

Goal-level `blocked` can still freeze planner/radar refill, but existing materialized tasks should continue draining through review/merge when eligible.

### 6. Rewire Goal Assistant Tools

Keep the typed MCP surface, but make the backend implementation file-native.

Current tools:

- `read_goal_snapshot`
- `request_task_lane`
- `request_planning`
- `mail_to_planner` (compat alias)
- `resolve_decision_topic`
- `resume_goal_automation`
- `read_preference`
- `write_preference`

Target behavior:

- `read_goal_snapshot` reads `todo.yml`, `decisions.yml`, `planning-requests.yml`, `.hopi/preference.md`, and runtime overlay.
- `request_task_lane` directly mutates durable board/task state through the shared control path today; any remaining intent concept should be migration-only, not workflow truth.
- `request_planning` is the canonical planner follow-through tool backed by `planning-requests.yml`; `mail_to_planner` remains only as a compatibility alias during migration.
- `resolve_decision_topic` writes `decisions.yml`; DB decision rows are ignored after backfill.
- `read_preference` / `write_preference` use `.hopi/preference.md`.
- Assistant must not create DB tasks, update DB decision topics, or rely on hidden HOPI_ACTIONS packets.

`hub/src/sync/goalAssistant.ts` has already moved off DB decision-topic truth and no longer surfaces DB operator intents in snapshots. The main remaining work here is to keep adjacent clients/tooling on the canonical `request_planning` wording and continue trimming broader runtime/docs reconcile residue.

### 7. Update Web Projection

Current `web/src/routes/projects/kanban.tsx` builds columns from DB tasks and only displays `todo.yml` as a reservoir. Change it so the canonical board query drives the columns.

Required web changes:

- Replace `useTasks()` as the main kanban source with the file-native board projection from `useGoalTodo()` or a renamed `useGoalBoard()`.
- Render `blockedBy` badges and dependency chips from the board projection.
- Render runtime overlay badges from attached DB/session state.
- Remove or reroute direct task create/update/delete buttons. New work should go through assistant/planning request unless a file-native board mutation API is explicitly provided.
- Show parse errors from `todo.yml` without replacing the last valid board.
- Add orphan overlay diagnostics when runtime data references missing task refs.
- Make quick actions call the same assistant/control API as chat actions.

`web/src/lib/task-status.ts` should use canonical statuses directly instead of mapping `planning/running/review/blocked` into display lanes.

### 8. Add Workflow And Write Traces

Workflow trace:

- Every successful board, decision, and planning-request mutation appends one event to `events.jsonl`.
- Events include writer, action, entity refs, before/after summaries, reason, and command/API metadata.
- `events.jsonl` is audit only; never replay it to reconstruct current board state.

Write trace:

- Add a normalized write trace recorder for file-changing tool events from Claude, Codex, Gemini, and OpenCode integrations.
- Append compact entries to `.hopi/docs/goals/<goalKey>/write-trace.jsonl`.
- Do not store full source content in write traces.
- Include agent, session id, cwd, tool name, call id, target paths, argument summary, result summary, and timestamp.

### 9. Test Plan

Backend tests:

- Parse valid Phase 1 `todo.yml`.
- Reject invalid statuses.
- Reject duplicate `ref`.
- Reject missing task blockers.
- Reject blocker cycles.
- Atomic board write leaves old file intact on validation failure.
- Board mutations append `events.jsonl`.
- DB overlay attaches by `goalId + taskRef`.
- Orphan DB overlay is ignored and surfaced as diagnostics.
- `decisions.yml` backfill from DB happens once.
- After backfill marker, DB decision edits do not affect snapshot.
- Scheduler removes resolved task blockers.
- Scheduler removes resolved decision blockers.
- Scheduler advances one deterministic unit per tick.
- Assistant snapshot is Goal-scoped and docs-backed.
- Assistant preference writes only touch `.hopi/preference.md`.
- Assistant decision resolution writes `decisions.yml`.

Web tests:

- Kanban columns come from board projection, not DB task status.
- `blockedBy.kind === "decision"` renders a decision blocker badge.
- Runtime overlay can mark a card active without changing its canonical status.
- Parse error state is visible.
- Quick actions call the typed assistant/control path.

Regression tests:

- Existing task-session message history remains paginated runtime data.
- Existing CLI/session flows still attach messages and active runtime state to board cards.
- Goal-level blocked state freezes new planning refill but does not stop already materialized review/merge work.

## Rollout Sequence

1. Add new file-native stores and tests without changing API behavior.
2. Add migration helpers for existing DB/doc state.
3. Add board projection API beside current `/tasks` API.
4. Switch assistant snapshot to file-native board/decision reads.
5. Switch Web kanban to board projection.
6. Switch scheduler status progression to board mutations.
7. Disable DB-first task/decision mutation routes or convert them into board-store adapters.
8. Add write trace recorder.
9. Keep the legacy `goalTodoTaskSync` mirror removed and finish removing DB decision-topic canonical reads.
10. Update repo docs to mark `docs/2026-05-15-hopi-goal-kanban-assistant-unified-design.md` as superseded or reconcile it with the current authority.

## Acceptance Criteria

The implementation is aligned when:

- Editing `todo.yml` manually changes the board after refetch/reconcile without touching DB.
- If DB task title/status differs from `todo.yml`, the board shows `todo.yml`.
- Creating or resolving a decision changes `decisions.yml`, not `goal_decision_topics`.
- Scheduler status changes write `todo.yml` and append `events.jsonl`.
- Web board can be rebuilt from `.hopi/docs` plus runtime overlay.
- Assistant actions cannot create DB-owned workflow truth.
- Preference writes land in `.hopi/preference.md`.
- `blocked` is not a task status in the canonical board.
- There is no default `.hopi/skills/kanban/todo.mjs` control path.
- Tests cover parser validation, mutation atomicity, event append, scheduler blocker cleanup, assistant scope, and Web projection.
