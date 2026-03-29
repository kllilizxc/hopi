# Factory Mode / OMC — Native Ralph Loop + GSD (Design Draft)

Date: 2026-03-29
Status: working draft

## Goal

Create a new HOPI product mode that treats `Ralph loop + GSD` as first-class primitives.

This mode should:

- support fresh-context autonomous execution loops natively
- support GSD-style blueprinting, planning, execution, and verification
- use `Codex` as a first-class runtime
- stop being constrained by the current session-first web app mental model
- allow a completely new board / workbench / information architecture
- reuse existing HOPI runtime infrastructure where useful

## Core stance

This should not be implemented as:

- a small extension to the current `projects` kanban
- a new `workflowProfile = "ralph_gsd"` inside the existing task model
- a cosmetic redesign of the current `web/` app

This should be implemented as:

- a second product mode inside the monorepo
- a new orchestration domain model
- a new frontend subproject
- a new control-plane UI built around plans, loops, attempts, evidence, and gates

## Why a new subproject

The current `web/` app is still fundamentally session-first.

Current shape:

- primary product story: remote session control
- projects/tasks: added later, layered onto the session model
- board semantics: classic task lifecycle columns
- workbench semantics: task detail + session attachment + session tools

Target shape:

- primary product story: autonomous coding control plane
- session: execution substrate, not top-level product object
- board semantics: blueprint state + loop state + evidence state
- workbench semantics: attempt inspector + review cockpit + blueprint graph

Conclusion:

- keep current `web/` as session console / legacy project UI
- build a new frontend subproject for the new mode

Chosen frontend subproject name:

- `OMC-client/`

Meaning:

- `One-Man-Company`

Naming note:

- product/mode name can remain flexible for now
- frontend package name is fixed as `OMC-client/`

## Product model

### Existing mode

Current HOPI mode:

- top-level object: `Session`
- supporting objects: `Project`, `Task`, `Workspace`
- control loop: human-driven, session-centric

### New mode

Factory Mode / OMC:

- top-level object: `Program`
- supporting objects:
    - `Blueprint`
    - `Phase`
    - `Plan`
    - `WorkItem`
    - `LoopRun`
    - `Attempt`
    - `Evidence`
    - `DecisionGate`
    - `MergeRecord`

### v1 unit decisions

For v1, lock these choices:

- primary board card = `1 PLAN.md`
- `phase` = grouping / swimlane / filter, not primary card
- `1 loop run = 1 PLAN`
- `1 attempt = advance the current smallest step inside that PLAN`
- `1 PLAN = 1 worktree`
- `1 Program = 1 primary repo`
- planning source of truth = markdown files in `.planning/*`
- planning editing in OMC-client = simplest possible editing only
- OMC-client served by existing hub at `/omc`

High-level relation:

1. user defines or imports a blueprint
2. system reads `.planning/*` and derives executable work items from `PLAN.md` files
3. scheduler chooses the next executable plan
4. Ralph loop spawns a fresh `Attempt` for that plan
5. attempt produces code changes + evidence
6. system decides:
    - continue loop
    - create fix item
    - escalate to human
    - verify
    - merge

## Design principles

- files remain agent-facing context
- planning truth stays in markdown for v1
- every autonomous run must be reproducible
- attempts are first-class history, not hidden implementation detail
- evidence drives state transitions, not agent self-report alone
- human intervention is a designed gate, not an exception path
- session takeover is always available

## Domain model

### Program

Represents one repository / machine / workspace family under orchestration.

Fields, draft:

- `id`
- `namespace`
- `machineId`
- `name`
- `description`
- `defaultWorkspaceId`
- `defaultAgentFlavor`
- `defaultPermissionMode`
- `defaultModel`
- `executionPolicy`
- `mergePolicy`
- `attemptPolicy`
- `createdAt`
- `updatedAt`
- `archivedAt`

### Blueprint

Markdown-based representation of GSD-style planning artifacts.

Sections, draft:

- vision
- requirements
- roadmap
- phases
- plans
- acceptance criteria
- open decisions
- assumptions
- verification requirements

Notes:

- blueprint lives in markdown first
- UI can parse and summarize it
- do not introduce a separate canonical blueprint store in v1

### WorkItem

Smallest unit that the scheduler can send into a Ralph loop.

V1 interpretation:

- `WorkItem` maps `1:1` to a GSD `PLAN.md`
- `phaseId` is derived from the containing phase directory / naming
- checklist items inside the plan are not separate cards in v1
- worktree ownership maps `1:1` to the plan in v1

Fields, draft:

- `id`
- `programId`
- `phaseId`
- `planId`
- `title`
- `goal`
- `acceptanceCriteria`
- `dependencies`
- `priority`
- `status`
- `loopPolicy`
- `workspaceId`
- `branchPolicy`
- `createdAt`
- `updatedAt`

### LoopRun

A managed autonomous execution run for one `WorkItem`.

V1 rule:

- one loop run owns one plan card
- retries stay inside the same loop run until success, budget exhaustion, or human escalation

Fields, draft:

- `id`
- `workItemId`
- `status`
- `attemptBudget`
- `failureBudget`
- `currentAttemptId`
- `startedAt`
- `updatedAt`
- `completedAt`

### Attempt

One fresh-context execution run, usually via `codex exec`.

Fields, draft:

- `id`
- `loopRunId`
- `workItemId`
- `sessionId` nullable
- `runtimeFlavor`
- `status`
- `contextPackVersion`
- `promptHash`
- `worktreePath`
- `branch`
- `startedAt`
- `completedAt`
- `failureFingerprint`
- `summary`

### Evidence

Structured outputs attached to attempts.

Evidence types, draft:

- test run
- typecheck
- lint
- preview readiness
- diff summary
- code review
- UAT note
- merge verification
- agent-produced verification summary

### DecisionGate

Represents a designed pause for human input.

Examples:

- design ambiguity
- policy approval
- repeated failure fingerprint
- blocked dependency
- merge approval

## Execution model

### Native Ralph loop

Ralph loop becomes an explicit state machine, not an informal shell script.

Loop shape:

1. build deterministic context pack
2. spawn fresh attempt
3. execute work
4. gather evidence
5. evaluate policy
6. either:
    - retry with updated context
    - create follow-up work item
    - escalate to human
    - mark ready for verify / merge

V1 execution grain:

- scheduler target = plan
- loop scope = one plan
- attempt scope = one smallest next step within that plan
- review gate happens after the plan is fully complete or explicitly blocked

### Native GSD support

GSD should not be a hidden prompt convention only.

It should exist in the system as:

- markdown parsing/indexing rules
- phase and plan graph
- explicit workflow states
- reusable artifact generation
- review / verify gates

Draft lifecycle:

- `discover`
- `discuss`
- `research`
- `plan`
- `ready`
- `loop_execute`
- `loop_verify`
- `human_review`
- `merge`
- `done`

## Codex-first runtime design

Codex should support two execution modes:

### Ephemeral attempt mode

Default autonomous mode.

Candidate implementation:

- `codex exec`
- fresh context per attempt
- structured output capture
- deterministic prompt bundle
- attempts reuse the plan's existing worktree rather than creating a new worktree per attempt

### Interactive takeover mode

Used when human wants to step in.

Candidate implementation:

- existing interactive HOPI Codex session flow
- attach takeover session to the same worktree / branch / work item
- preserve attempt history and evidence lineage

## Architecture

### Reuse directly

- auth / namespace model
- machine registry
- runner lifecycle
- session transport
- SSE / realtime
- terminal bridge
- file read / search / diff / git primitives
- worktree primitives
- existing Codex integration

### Reuse with adaptation

- current `Project` / `Workspace` records
- current `Task` records as compatibility projection only
- current task-linked session model
- current automation readiness checks

### Replace or bypass

- current task status as canonical orchestration state
- current projects kanban as canonical workbench
- current session-first route hierarchy for this mode
- current thin `gsd` workflow profile as the main long-term implementation

### Suggested package split

- `shared/`
    - add orchestrator schemas and events
- `hub/`
    - add `orchestrator/` domain modules
- `cli/`
    - add runtime adapters for ephemeral attempt orchestration where needed
- `OMC-client/`
    - new frontend subproject for Factory Mode / OMC

## Data architecture

Recommended long-term direction:

- keep SQLite
- add append-only orchestrator events
- build projection tables for fast UI queries
- keep session/message storage as execution evidence store

Reason:

- durable enough
- simple local-first deployment story
- avoids premature infra jump
- fits HOPI architecture better than introducing external workflow infra too early

V1 repo scope:

- one program manages one primary repository
- multi-repo orchestration is explicitly out of scope for v1

## Artifact strategy

The system should maintain:

- markdown planning artifacts
- generated runtime context packs when needed
- DB-backed runtime/evidence history

Draft materialization targets:

- `.planning/PROJECT.md`
- `.planning/REQUIREMENTS.md`
- `.planning/ROADMAP.md`
- `.planning/phases/...`
- `.hopi/factory/...` for runtime-only generated context bundles

Potential rule:

- authored truth: `.planning/*`
- execution truth: generated context pack on disk
- attempt output: summarized into runtime records and optional markdown patches

## UI architecture

### Primary views

- `Overview`
- `Blueprint Graph`
- `Execution Board`
- `Attempt Inspector`
- `Review Cockpit`
- `Merge Center`

### Board semantics

The board should be control-state oriented, not generic task-state oriented.

Important principle:

- board columns should stay few
- detailed orchestration state should move into badges, chips, attempt timeline, and inspector panes
- not every internal state deserves its own kanban column
- v1 should optimize for legibility over semantic purity
- board card should represent a stable execution unit

Card identity for v1:

- one card = one `PLAN.md`
- board groups cards by `phase`
- phase is visible everywhere, but phase is not itself the execution card

Why plan beats phase for the main board:

- phases are roadmap-sized and often too large for one loop
- one phase can contain multiple plans, waves, and review points
- plan is the level GSD executes most concretely
- review / retry / merge semantics are clearer at the plan level
- Ralph loop needs a bounded target; plan is bounded enough for v1

Recommended board columns for v1:

- `Planning`
- `Running`
- `Review`
- `Done`

Why not `Ready` as a top-level column:

- `Ready` is semantically precise
- but it creates one more queue the user has to manage
- in v1, that precision is probably not worth the extra board complexity

Recommended interpretation:

- `Planning`
    - idea exists
    - spec/plan incomplete
    - dependency unresolved
    - executable but not yet started
- `Running`
    - active Ralph loop
    - retrying
    - waiting on machine/runtime
    - gathering evidence
- `Review`
    - needs human signal
    - needs design decision
    - verify failed and needs intervention
    - merge approval pending
    - merge in progress
- `Done`
    - merged
    - verified complete

If we still want to preserve "ready to run" semantics, show it as card metadata inside `Planning`:

- `ready-to-run`
- `blocked`
- `waiting-dependency`
- `needs-spec`

Non-column state should be shown as metadata:

- latest failure fingerprint
- retry count
- gate reason
- merge state
- verification health
- branch / worktree
- agent/runtime flavor

Card content should emphasize:

- current phase
- current plan
- loop status
- attempt count
- latest failure fingerprint
- latest evidence result
- active branch / worktree
- blocker reason

### Attempt inspector

Must show:

- exact context pack
- prompt bundle
- attempt timeline
- changed files
- checks and evidence
- stop reason
- retry / fork / takeover actions

## Data truth strategy

This section defines which layer is authoritative when different representations disagree.

### Why this matters

This system will have at least 3 representations of the same work:

- structured records in storage
- materialized markdown files for agent context
- attempt/session/message history produced during execution

If these drift, the product needs one clear source of truth.

### Recommended v1 strategy

Keep this simple.

Canonical truth for planning:

- `.planning/*` files

Canonical truth for runtime:

- DB records for loops, attempts, sessions, evidence

Historical truth:

- append-only attempts, evidence, messages, logs, diffs

In plain language:

- GSD planning lives in files
- OMC runtime state lives in the database
- OMC-client reads both
- do not build bidirectional sync between structured planning records and markdown in v1

### Why this is the simplest useful option

- GSD already speaks files
- agents already read and write `.planning/*`
- we avoid building a blueprint compiler on day one
- we avoid drift resolution between DB and markdown
- we can ship UI value faster

### Practical v1 rule

1. `.planning/*` is the source of truth for blueprint/planning
2. runtime orchestration state lives in DB
3. attempt/session logs are immutable history
4. if UI edits planning, it edits files directly or writes patches to files

### Planning editing in OMC-client

Keep this thin in v1.

Allowed:

- open relevant planning files
- make small direct markdown edits
- create small patch-style updates
- trigger loop actions from parsed planning context

Not in v1:

- full structured planning editor
- visual plan builder
- reconciliation engine
- semantic round-trip editing between DB and planning graph

### v1 consequence

The UI should treat planning data as:

- parsed files
- indexed file summaries
- lightweight derived metadata

Primary parsed unit:

- `PLAN.md`

Not as:

- a fully structured authoring graph with its own canonical persistence

### Possible v2 evolution

Later, if needed:

- introduce structured blueprint graph in DB
- keep `.planning/*` as generated projection or import/export format

But this should not block v1.

## Migration stance

Do not try to fully migrate current project/task UX first.

Preferred strategy:

1. build new domain and UI in parallel
2. reuse runtime infrastructure underneath
3. optionally expose compatibility projections into old task/project views later

## Deployment stance

V1 deployment:

- `OMC-client` is served by the existing hub at `/omc`

Reason:

- fastest path to shipping
- reuses existing auth/session/SSE/API plumbing
- avoids extra deployment surface while the product model is still changing

## Open questions

- what is the exact retry / escalation policy for repeated failures?
- how should merge approvals work for autonomous runs?
- should review be agent-generated, human-generated, or dual-gated by default?
- how much of GSD artifact authoring should happen in UI vs prompt-driven sessions?

## Proposed first implementation slice

Not final. Just a candidate order.

1. create new orchestrator schemas
2. create new hub APIs and events
3. create Codex ephemeral attempt runner
4. create context pack builder
5. create minimal `OMC-client/` app shell
6. ship read-only phase-grouped plan board + loop overview
7. add start / stop / retry / takeover
8. add attempt inspector
9. add lightweight planning file actions

## Discussion notes

This document is intentionally opinionated but not locked.

Expected next steps:

- refine naming
- pin canonical data model
- define the first thin slice we can actually ship
