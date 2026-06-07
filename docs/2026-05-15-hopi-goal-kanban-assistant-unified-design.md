# HOPI Goal + Kanban + Assistant Unified Design

> Supersedes the fragmented direction in:
> - `docs/superpowers/specs/2026-05-13-hopi-autonomous-goal-orchestration-design.md`
> - `docs/superpowers/specs/2026-05-15-hopi-project-assistant-goal-state-design.md`
> - `docs/superpowers/specs/2026-05-15-hopi-project-assistant-conversation-boundary-design.md`
> - `docs/design/projects-kanban.md`

## Summary

HOPI is a goal-native autonomous work system. The unit of autonomy is the Goal, not the chat session.

This design rebuilds the system around one simple direction:

1. durable workflow truth lives in `.hopi/docs`
2. assistant reads goal state and writes operator intent
3. scheduler reconciles state and starts the right runtime
4. agents execute work and report typed results
5. kanban is a projection of goal workflow state, not a hand-maintained UI-only board

The assistant is not a hidden controller, not a text parser in the hub, and not a coding agent. It is a goal-scoped operator console backed by real typed tools and read-only repo inspection.

For the user, Assistant is the canonical Kanban butler for that Goal: questions about the board and instructions to operate the board should route through Assistant first.

The orchestrator is not an agent. It is deterministic control-plane logic.

## Design Principles

### 1. Goal-native, not session-native

A Goal owns:

- objective
- success criteria
- todo reservoir
- task graph
- planner inbox
- decision topics
- assistant conversation
- automation policy

Sessions are runtimes attached to work inside the Goal. They are not the workflow container.

### 2. `.hopi/docs` is the durable workflow source of truth

Another process must be able to rebuild goal state from repo-local docs plus runtime logs.

The DB/store may exist, but only as:

- projection
- index
- runtime cache
- event fan-out backing

It must not become a second authoring system with different business truth.

### 3. State-based control flow

The data flow is one-way:

`assistant -> operator intent state -> scheduler reconcile -> runtime execution -> state update`

The assistant does not directly run workflow mutations by hidden hub rules. It requests state changes. The scheduler decides when those changes become real execution.

### 4. Minimal operator tools

The assistant tool surface should stay small and general. No behavior-specific tools like `retry_merge`, `unblock_dependency`, `resolve_decision`, or other narrow verbs.

### 5. Blocked is derived, not a primary lane

Most “blocked” situations are explanations over normal work state:

- waiting on dependencies
- waiting on decision
- merge blocked
- lane capacity full
- missing required workflow output
- runtime start failure

The system should compute those blockers instead of using free-form `blockedReason` as the primary model.

Infra availability holds such as runner offline are also derived blockers. They should preserve the task's current lane, surface an explicit waiting/paused runtime state in UI, and auto-resume through the scheduler/reconciler when infra recovers.

### 6. Planner and Assistant have different authority

- Planner may create, split, replace, reorder, and retire work.
- Assistant may only inspect state, request task lane changes, mail Planner, and update global preferences.

Assistant is not a second Planner.

### 7. Read-only assistant, with one explicit exception

Assistant should have read/search capability over the repo because otherwise it cannot explain state or interpret failure context.

Assistant may not:

- edit source files
- write arbitrary workspace files
- run write-capable shell flows
- change permission mode
- spawn coding subagents
- bypass approval boundaries

The only write exception is `.hopi/preference.md`.

## Non-Goals

- backward compatibility with broken legacy assistant behavior
- hub-side text parsing of user chat into hidden actions
- multiple competing assistant conversations for one Goal
- making assistant capable of direct coding work
- using natural-language `blockedReason` as the dependency model

## System Model

## Project

Project is the repo-level container.

It owns:

- repo identity
- default workspace
- Goal list
- automation defaults
- lane budgets
- runner connectivity

Project is not the operator scope for the assistant. The assistant is Goal-scoped.

## Workspace

Workspace is the filesystem checkout used by autonomous work.

Baseline model:

- one default writable workspace per Project
- task runtimes may create isolated worktrees derived from it
- assistant sees the same repo in read-only mode
- `.hopi/preference.md` is writable by assistant

Workspace setup remains a function or small service, not a large architectural layer.

## Goal

Goal is the main unit of autonomous progress.

Canonical Goal state:

- `goalKey`
- title
- objective
- success criteria
- strategy / current focus
- status: `planning | active | blocked | paused | done | archived`
- automation policy
- task graph
- planner inbox
- decision topics
- assistant conversation

`blocked` at Goal level is a control-plane hold, usually for milestone review or an unresolved goal-level decision.

When a Goal is `blocked`, the scheduler must freeze Planner/Radar refill and any new batch expansion, but it must not cancel or stall already materialized task cards. Existing task cards may continue draining through `planned`, `in_progress`, `in_review`, and `merging` until they settle.

## Goal Docs

Each Goal owns a docs directory:

```text
.hopi/
  preference.md
  docs/
    index.md
    goals/
      <goalKey>/
        goal.md
        todo.yml
        decisions.yml
        operator/
          planner-mail.yml
```

### `goal.md`

Human-readable Goal brief:

- objective
- success criteria
- current strategy
- current focus
- open questions

### `todo.yml`

Structured planning reservoir and durable task graph source.

Each item is the canonical planning record. Example:

```yml
version: 1
goal:
  goalKey: tutorial
  title: Tutorial Goal
items:
  - ref: teaching-matrix
    status: done
    title: 固化教学关剧本大纲与教学矩阵
    body: 产出稳定教学矩阵与验收口径。

  - ref: tutorial-story-content
    status: planned
    title: 落地教程故事与首场演武战斗内容
    body: 补齐故事内容与首场演武流程。
    dependencyTaskList:
      - ref: teaching-matrix
      - ref: story-skeleton
```

Rules:

- `ref` is stable and required
- `dependencyTaskList` is the canonical prerequisite model
- `status` is the durable task lane projection
- Planner creates and updates these items
- task records in the store must link back through `goalTodoRef = ref`

### `decisions.yml`

Structured decision topics. Each topic may be:

- goal-scoped
- task-scoped
- blocking or non-blocking
- waiting or resolved

The system must not rely on free-form chat text to know whether a decision is still open.

### `operator/planner-mail.yml`

Goal-scoped inbox for future Planner work.

This is append-only operator state, not immediate session injection.

## Task

Task is the executable projection of a `todo.yml` item.

Canonical task fields:

- `id`
- `goalId`
- `goalTodoRef`
- `title`
- `description`
- `lane`
- `dependsOnTaskIds`
- `acceptanceContract`
- `source` (`planner | radar | manual`)
- linked runtime summaries
- pending operator intents

`dependsOnTaskIds` is a materialized projection of `dependencyTaskList`, not the planning source.

## Task Lanes

Task lanes are:

- `planned`
- `in_progress`
- `in_review`
- `merging`
- `done`

These are the only canonical execution lanes.

### `planned`

Executable task in the dispatch pool.

It may still be temporarily ineligible because:

- dependencies are not satisfied
- a blocking decision is open
- lane capacity is full
- operator intent is pending consumption

### `in_progress`

Generator-style execution is active or resumable.

### `in_review`

Work artifact exists and must be evaluated against its acceptance contract.

### `merging`

Review passed and the system is merging or repairing merge conflicts.

### `done`

Final completion state.

For code-changing work, `done` means merge succeeded. Review alone is not completion.

## Candidate vs Task

`todo.yml` may also contain non-dispatched planner reservoir items. To keep the execution model clean:

- `candidate` and `deferred` are allowed only in `todo.yml`
- kanban shows only materialized executable tasks
- Planner promotes a `candidate` item into a real task by assigning it an executable lane, usually `planned`

This prevents the board from mixing speculative planning with active execution.

## Blockers

Blocked is not a lane. It is a derived blocker set computed from structured state.

Canonical blocker kinds:

- `dependency`
- `decision`
- `merge`
- `lane_capacity`
- `missing_output`
- `runtime_start_failure`
- `manual_hold`

Each blocker should have machine-readable fields and a human summary.

Examples:

- `dependency`: unfinished `dependsOnTaskIds`
- `decision`: unresolved blocking topic in `decisions.yml`
- `merge`: merge runtime blocked with conflict summary
- `lane_capacity`: eligible task skipped because its execution role budget is full
- `missing_output`: agent finished without required typed workflow output after repair budget exhausted
- `runner_offline`: start/continuation could not launch because the bound machine runner is unavailable; keep the task in its lane and mark it waiting for automatic retry

The UI may render a task as “blocked”, but the persisted lane remains one of the five canonical lanes above.

## Decision Topic

Decision topic is a structured blocking question created by Planner, Generator, Evaluator, or Merger.

Canonical fields:

- `id`
- `goalId`
- optional `taskId`
- title
- body
- `blocking`
- `status = waiting | resolved`
- resolution summary
- source runtime metadata

When a decision is task-scoped, the usual recovery path is:

1. assistant explains the open decision
2. user answers in assistant chat
3. assistant requests the task back into `planned` with the user answer as continuation context
4. scheduler records the answer and clears the waiting decision topic

Goal-level or multi-task decisions should usually generate Planner mail instead of direct task resumption.

## Planner Mail

Planner mail is the operator-to-Planner inbox.

Canonical uses:

- ask Planner to decompose new work
- ask Planner to re-evaluate Goal direction
- communicate cross-task user feedback
- communicate goal-level decision outcomes

Planner mail must not directly interrupt an already running Planner session. It waits for the next Planner run.

## Preference Memory

`.hopi/preference.md` is global, shared memory across Goals and agents.

Rules:

- only assistant writes it
- assistant decides whether feedback is durable enough to store
- format is plain markdown
- no goal-specific preference file in v1

## Session Types

The system uses several runtime session types:

- `assistant`
- `planner`
- `generator`
- `reviewer`
- `merger`
- `radar`

These are runtime identities, not workflow ownership units.

### Assistant session

- exactly one active conversation per Goal
- capability profile: `operator_console`
- read-only repo inspection
- HOPI typed operator tools
- no source editing

### Task execution session

- bound to one task attempt
- capability profile: `coding_agent`
- owns implementation work

### Review session

- bound to one task in `in_review`
- evaluates against acceptance contract
- may send task back to `planned` or advance to `merging`

### Merge session

- bound to one task in `merging`
- merges to target branch / workspace
- may attempt conflict repair within policy

### Planner session

- creates or reshapes task graph
- updates `todo.yml`
- may create decisions
- may resolve planner mail

### Radar session

- scans for drift, regressions, gaps, or missed follow-up work
- may emit planner recommendations, not direct task execution

## Assistant Design

## Scope

Assistant is bound to exactly one Goal.

For that Goal, it is the canonical user-facing Kanban operator surface.

It sees:

- Goal summary
- Goal kanban state
- Goal decision topics
- Goal planner inbox
- active Goal runtimes
- global preference markdown
- repo context in read-only mode

It does not see or mutate unrelated Goals by default.

## Conversation identity

There is one canonical assistant conversation per Goal.

Interventions are not separate chats. They are records that route the user into the same Goal assistant conversation with extra context attached.

This avoids the current class of bugs where a user replies to a blocked-task card and accidentally lands inside a task runtime session.

## Operator tool contract

The assistant gets a minimal typed tool bridge:

### `read_goal_snapshot()`

No parameters. Always reads the current Goal bound to the assistant session.

Returns:

- Goal summary
- tasks with lanes
- derived blockers
- open decision topics
- unread planner mail
- lane budget saturation
- active runtimes
- global preference markdown

### `request_task_lane(taskId, lane, message?)`

Assistant-side request, not direct mutation.

Allowed lanes:

- `planned`
- `merging`

Assistant does not request `in_progress`.
`in_progress` is observed runtime state owned by Scheduler after a task actually starts.
For retry/resume/continue/requeue, assistant requests `planned` and supplies the current problem/context in `message`.

This tool appends operator intent for one task.

If `message` is omitted, the system synthesizes a natural-language continuation message:

- for `planned`: “The user re-added this task to the execution plan. Re-evaluate the current state and continue when scheduler conditions are satisfied.”
- for `merging`: “The user asked to retry merging this task. Re-check the current base state before continuing.”

This single tool covers:

- retry merge
- continue a task
- retry after dependency completion
- retry after decision reply
- requeue a stalled task

If a completed card later proves to own a new concrete failure, this request may reopen that existing card instead of forcing Planner mail for duplicate work.

Assistant should describe `request_task_lane(...)` success as a queued/requested transition unless a fresh snapshot confirms the board has already moved.

Assistant does not need a separate `retry_merge` or `unblock_task` tool.

### `mail_to_planner(body, relatedTaskIds?)`

Append a Goal-scoped planner mail item.

Used for:

- new work requests
- cross-task re-planning
- goal-level direction changes
- operator observations that should shape the next planning pass

### `read_preference()`

Reads `.hopi/preference.md`.

### `write_preference(markdown)`

Rewrites `.hopi/preference.md`.

Only this file path is writable from assistant.

### Implementation status requirement

This document defines the target contract, not a “best effort” fallback.

A Goal Assistant surface is not design-complete unless these operator actions are wired as real typed tools:

- `read_goal_snapshot()`
- `request_task_lane(...)`
- `mail_to_planner(...)`
- `read_preference()`
- `write_preference(...)`

If a deployment only opens a plain chat session with read-only repo access, that session is fallback advisory mode only:

- it may explain state, blockers, and likely next actions
- it may not pretend it created planner mail, queued a retry, or requested a lane transition
- it must explicitly disclose that workflow actions are unavailable in this deployment

In particular, when the user asks for “new task” creation, the correct design behavior is still `mail_to_planner(...)`, not direct task creation by Assistant and not a silent downgrade into prose-only advice.

## Assistant runtime restrictions

Allowed:

- read files
- search files
- read git status/diff/log
- inspect Goal snapshot
- use HOPI typed tools

Forbidden:

- arbitrary file writes
- permission escalation
- shell commands that modify repo state
- coding subagents
- hidden hub-side text action parsing

## Assistant behavior rules

The prompt and tool policy should push assistant toward the typed operator tools when the user intent is operational.

For Kanban questions and Kanban instructions, assistant should default to the current Goal snapshot as the workflow source of truth. Read-only repo inspection is supplemental context, not the first workflow authority.

Examples:

- user says “重试” under a merge-block intervention -> assistant reads snapshot, identifies target task, calls `request_task_lane(taskId, "merging")`
- user says “前置 block 解除了” -> assistant identifies downstream tasks and requests them back to `planned`
- user says “新加一个任务” -> assistant does not create task directly; it sends `mail_to_planner(...)`
- user pastes a concrete build/test/runtime failure -> assistant treats that as operational by default; it reads snapshot, maps the failure to an existing task and requests a lane when ownership is clear, otherwise it sends `mail_to_planner(...)` so the bug becomes tracked work
- user asks “why is this card here”, “what is still blocked”, “what is running now”, or “what should happen next” -> assistant answers from the Goal snapshot and current Goal state, only using repo inspection when workflow state alone is not enough
- user asks assistant to operate the board, such as requeueing a task, continuing work, retrying merge, or adding follow-up work -> assistant should carry that through with the typed operator tools when possible instead of only giving advice
- if the typed operator tool bridge is missing, assistant must say that clearly and remain advisory; it must not act as if prose alone completed the workflow action

## Scheduler / Orchestrator

Orchestrator is deterministic state reconciliation.

It is not an LLM.

## Responsibilities

- import and project Goal docs into runtime state
- compute derived blockers
- consume operator intents
- enforce lane budgets
- dispatch Planner / Generator / Reviewer / Merger / Radar runtimes
- advance task lanes from typed runtime outputs
- create interventions when human attention is required
- keep docs and projections in sync

## Main loop

Each tick:

1. read Goal docs
2. reconcile `todo.yml` items with task projections
3. rebuild `dependsOnTaskIds` from `dependencyTaskList`
4. compute derived blockers
5. consume pending assistant operator intents when eligible
6. dispatch runnable work within lane budgets
7. process completed runtime outputs
8. update `todo.yml`, `decisions.yml`, and runtime projections
9. emit interventions and UI events

## Execution roles and capacity

Role budgets are separate from task lanes.

Recommended role budgets:

- `planner`
- `generator`
- `reviewer`
- `merger`
- `radar`

Each budget counts task-driving work, not arbitrary session count.

That means:

- assistant sessions do not occupy execution capacity
- a task only counts against a role when it is actually driven by that role
- lane-capacity skip must be visible in snapshot/UI

## Dispatch rules

### Planner

Planner should run when any of these are true:

- Goal is in `planning`
- executable task pool is insufficient
- unread planner mail exists
- backstop fired
- radar created planning follow-up

Planner is the only runtime allowed to create or restructure tasks.

### Generator

Generator may run a task only when:

- task lane is `planned`
- dependencies are satisfied
- no blocking decision exists
- role capacity exists

### Reviewer

Reviewer runs tasks in `in_review`.

Outputs:

- accept -> task enters `merging`
- reject -> task returns to `planned` with review feedback

### Merger

Merger runs tasks in `merging`.

Outputs:

- merge success -> task becomes `done`
- merge blocked -> derived merge blocker + assistant intervention
- merge repair retry budget exhausted -> merge blocker remains and intervention is refreshed, not duplicated

### Radar

Radar runs on cadence or idle windows and sends follow-up planning input. It does not directly mutate task lanes outside its own typed outputs.

## Operator intent consumption

`request_task_lane(...)` is never applied directly by assistant.

Scheduler handles it:

- if request is eligible now, consume it and move the task into the requested execution path
- if dependencies or decisions still block it, keep the request pending
- if a continuation message exists, deliver it to the resumed runtime when that runtime starts or resumes
- when reopening completed/merged work into `planned`, clear stale completion and merge-result fields before projecting the lane; otherwise the board can keep showing `done` even though the task has been requeued
- for `planned` operator requests, Scheduler must start a new runtime through the same Project session policy as normal auto-run, including agent flavor, permission mode, and worktree settings; it must not bypass policy by resuming an arbitrary old linked session
- restart context must be budgeted: include the task contract, handoff/evidence, operator continuation message, and a small recent semantic slice of prior chat; never paste full old session transcripts or tool outputs into kickoff

This keeps assistant state-based and makes the system resilient to out-of-order events.

## Missing typed workflow output

Some runtimes must emit typed workflow output for the scheduler to progress the Goal.

If a required output is missing:

1. apply the role-specific repair policy
2. if still missing, create a derived `missing_output` blocker
3. create assistant intervention explaining exactly what is stuck

This is how “task finished without HOPI_ACTIONS” should be modeled in the new system.

## Long-no-progress backstop

The system should have a deterministic backstop. Minimum baseline:

- no task reaches `done` for N hours while Goal is active
- Planner refills occur repeatedly with no completed milestone
- same task bounces across execution phases too many times without forward progress

Backstop effect:

- add planner mail describing the stagnation
- create an assistant intervention
- allow the next Planner pass to re-plan

## Planner Authority

Planner owns graph-shaping changes:

- create new `todo.yml` items
- promote `candidate` to `planned`
- split one task into several
- retire or replace obsolete tasks
- set or rewrite `dependencyTaskList`
- create decision topics

Assistant does not do any of these directly.

## Review and Merge Authority

Reviewer and Merger are part of normal autonomy, not optional extras.

The canonical task progression is:

`planned -> in_progress -> in_review -> merging -> done`

There is no direct `in_progress -> done` shortcut for code-changing tasks.

If a milestone review blocks the Goal while work is already on the board, that hold applies only to creating or promoting more work. Existing task cards still continue through review and merge.

## Interventions

Intervention is a durable operator-facing record for situations that need human attention or explanation.

Kinds:

- `decision_needed`
- `task_blocked`
- `merge_blocked`
- `permission_required`
- `milestone_review`
- `clarification_needed`

Rules:

- intervention belongs to the Goal assistant conversation
- intervention never becomes a task runtime chat
- identical blocking conditions should dedupe by fingerprint
- user reply to intervention enters assistant conversation with intervention context attached

Typical triggers:

- merge blocked after repair budget exhausted
- blocking decision opened
- runtime start failure
- required workflow output missing after retry budget exhausted
- backstop fired

## UI Contract

## Goal board

The board is Goal-scoped.

It shows:

- task cards grouped by canonical lanes
- derived blocker badges
- dependency chips rendered from `dependsOnTaskIds`
- lane-capacity saturation markers
- active runtime indicators

There should be no ambiguity about why a task is not moving.

## Assistant entry

Each Goal has one assistant entry.

If the user clicks an intervention card, the UI opens the same assistant conversation with that intervention highlighted.

The UI should not create a second independent assistant chat for the same Goal unless the user explicitly archives and resets the old one.

## Suggested actions

If the UI offers quick actions, they must call the same typed assistant/operator APIs. They must not fake chat text or bypass scheduler state.

## State Ownership

## Docs own durable workflow truth

Owned in repo-local HOPI docs space:

- goal brief
- todo reservoir and dependency graph
- decision topics
- planner mail
- global preferences (`.hopi/preference.md`)

## Store owns live projection and runtime cache

Owned in store/DB:

- task ids
- runtime ids
- active session linkage
- pending operator intents
- merge/review/runtime attempt metadata
- event fan-out state

The store must be rebuildable from docs plus runtime state.

## Runtimes own execution evidence

Owned by runtime/session layer:

- message log
- tool trace
- patch/evidence summary
- runtime attempt outcome

## Assistant owns only operator intent and preference edits

Assistant may not mutate workflow truth except through:

- `request_task_lane`
- `mail_to_planner`
- `.hopi/preference.md`

## Typical Flows

## A. Merge blocked, user says “重试”

1. Merger fails after repair budget and marks merge blocker.
2. Scheduler creates `merge_blocked` intervention.
3. User replies “重试” in assistant.
4. Assistant calls `read_goal_snapshot()`.
5. Assistant identifies the task from intervention context.
6. Assistant calls `request_task_lane(taskId, "merging")`.
7. Scheduler consumes the request, keeps the task in merge path, and starts a new merge attempt when capacity allows.

No hub-side text parser. No task-session chat hijack.

## B. Dependencies finished, downstream task should resume

1. Upstream tasks reach `done`.
2. Scheduler recomputes derived dependency blockers.
3. Downstream `planned` task becomes eligible automatically.
4. If assistant had already requested `planned`, that pending intent is consumed on the next tick.
5. Generator starts when capacity is available.

No manual unblock tool is required.

## C. User asks for new work in assistant

1. User says the Goal also needs a new task.
2. Assistant inspects current Goal snapshot.
3. Assistant decides this is graph-shaping work.
4. Assistant calls `mail_to_planner(body, relatedTaskIds?)`.
5. Scheduler leaves current execution unchanged.
6. Next Planner pass consumes the mail and updates `todo.yml`.

## E. User reports a concrete repo failure in assistant

1. User pastes a build error, failing test, stack trace, or broken-behavior report.
2. Assistant treats this as operational by default unless the user is clearly asking for explanation only.
3. Assistant reads the current Goal snapshot.
4. If the failure clearly belongs to an existing task already on the board, assistant calls `request_task_lane(...)` for that task.
   If that task is currently `done`, the request may reopen the existing card for follow-up repair rather than creating a duplicate new task.
5. Otherwise assistant calls `mail_to_planner(...)` so the failure is turned into tracked work.
6. Assistant may still summarize the root cause briefly, but it should not stop at diagnosis alone when the typed operator tools are available.

## D. User gives durable preference feedback

1. User repeatedly signals a stable preference.
2. Assistant decides it is durable rather than one-off.
3. Assistant reads `.hopi/preference.md`.
4. Assistant rewrites it with deduplicated updated guidance.
5. Future Planner / Generator / Reviewer / Merger sessions all receive that file in context.

## Module Breakdown For A From-Scratch Build

Another agent should build the system as small focused modules:

1. `goal-docs`
   - read/write `goal.md`, `todo.yml`, `decisions.yml`, `planner-mail.yml`
   - map stable `ref` values and dependencies

2. `goal-projection-store`
   - materialize Goals, Tasks, Decisions, Runtimes
   - keep ids, indexes, pending intents

3. `scheduler`
   - deterministic reconcile loop
   - dependency checks
   - lane budget checks
   - operator intent consumption
   - dispatch decisions

4. `runtime-adapters`
   - planner / generator / reviewer / merger / radar / assistant spawn-resume-finish
   - typed output ingestion

5. `assistant-bridge`
   - operator-console session creation
   - minimal typed tools
   - intervention routing

6. `web-projection`
   - Goal board
   - assistant conversation
   - intervention surfaces
   - runtime workbench

These are build units, not separate product concepts.

## Test Strategy

Core behavior must be tested below the UI.

Required harness:

- in-memory goal docs fixture
- in-memory projection store
- fake scheduler tick
- fake runtime completion hooks
- assistant tool invocation harness

The harness must simulate:

- user sending assistant messages
- assistant issuing tool calls
- scheduler consuming intents
- runtime outputs changing task lanes
- intervention creation and dedupe

Must-cover cases:

- assistant is Goal-scoped only
- dependency blockers derive from `dependencyTaskList`
- retrying merge uses `request_task_lane(..., "merging")`
- dependency-unblocked tasks resume without a special unblock tool
- missing required typed output creates intervention
- one Goal has one assistant conversation
- intervention replies never route into task sessions
- lane capacity blocking is visible in state
- Planner mail does not directly interrupt current Planner session
- assistant can only write `.hopi/preference.md`

## Hard Invariants

These invariants should be enforced in code and tests:

1. assistant cannot create tasks directly
2. assistant cannot modify repo source
3. assistant cannot bypass scheduler by mutating task lane directly
4. Planner is the only graph-shaping runtime
5. dependency ordering is represented structurally, not in prose
6. blocked is never the primary task lane model
7. one Goal has one canonical assistant conversation
8. merge success, not review success, is final completion for code-changing work
9. quick actions and chat actions use the same typed operator path
10. if docs and DB disagree, docs win for durable workflow truth

## Migration Direction

For current code, the target end state is:

- remove assistant-specific text fast paths
- remove action-packet emulation for assistant chat
- keep typed workflow outputs for Planner / Generator / Reviewer / Radar / Merger
- move durable dependency truth to `todo.yml`
- treat legacy `blockedReason` only as compatibility residue during migration
- converge on one Goal assistant conversation model

## Result

This design intentionally reduces the system to a few stable ideas:

- Goal is the unit of autonomy
- `.hopi/docs` is the durable workflow contract
- kanban is a projection of Goal state
- assistant is a Goal-scoped operator console
- scheduler is deterministic
- agents do work, but do not own orchestration

That is the smallest model that still supports:

- multi-lane parallel execution
- Planner / Generator / Reviewer / Merger / Radar
- user-in-the-loop recovery
- readable repo-local workflow state
- a real assistant that can explain and steer the Goal without secretly becoming another coding runtime
