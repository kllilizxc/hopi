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
- repeated-failure policy = escalate to `Review` after `3` consecutive failed attempts
- hard attempt cap = stop after `5` total attempts for the same loop run
- review default = human-approved, agent-assisted

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

V1 retry / escalation policy:

- keep retry policy intentionally simple
- `3` consecutive failed attempts on the same plan => move card to `Review`
- `5` total attempts on the same loop run => stop automatic retries
- any explicit policy gate or permission block => move to `Review`
- human can restart loop from `Review`

### V1 context pack

The quality of the Ralph loop depends heavily on the attempt input contract.

V1 context pack should stay small, deterministic, and repeatable.

Its job is to answer:

- what plan is being executed
- where execution should happen
- what smallest step should be advanced now
- how completion will be judged
- what happened last attempt that should influence this one

Recommended sections:

- `identity`
    - `programId`
    - `planKey`
    - `attemptId`
    - `phase`
    - `planTitle`
    - `planPath`
- `workspace`
    - repo root
    - worktree path
    - current branch
    - target branch when known
- `planningRefs`
    - `.planning/PROJECT.md`
    - `.planning/ROADMAP.md`
    - current `PLAN.md`
    - optional phase-specific `CONTEXT.md` / `RESEARCH.md` when present
- `currentObjective`
    - plan goal summary
    - current smallest next step
    - explicit instruction to advance one smallest step only
- `acceptanceAndChecks`
    - completion criteria
    - required validation commands
    - repo-specific verification expectations
- `previousAttemptMemory`
    - previous attempt summary
    - failure fingerprint
    - changed files summary
    - checks result summary
- `operatingRules`
    - stay within this plan
    - do not rewrite roadmap unnecessarily
    - keep work inside the current worktree
    - report clear blocked reason when blocked
- `outputContract`
    - final status
    - summary
    - changed files
    - checks run and results
    - next suggested step

V1 memory rule:

- carry only summarized memory from the previous attempt
- do not inject full prior logs or full conversation history into each new attempt

This keeps attempts:

- fresh
- small
- predictable
- easier to debug

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
- each attempt receives the generated context pack as its primary execution input

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

### Review default

V1 review policy:

- review is human-approved by default
- agent may prepare review summaries, evidence digests, and merge notes
- agent does not auto-approve its own completion in v1
- merge should happen only after human review approval unless explicitly overridden later

### Merge approval default

V1 merge policy:

- merge is human-approved by default
- autonomous execution may prepare a merge packet, but may not land automatically
- merge happens only from `Review`
- merge approval is a distinct action, not an implicit side-effect of loop completion

Required merge packet contents:

- phase
- plan
- target branch
- source worktree / branch
- attempt count
- changed files summary
- required checks summary
- agent-produced completion summary
- warnings or blocker notes

Required merge preconditions:

- no active attempt still running
- plan is in `Review`
- required checks are green
- target branch is resolved
- worktree merge state is clean enough to proceed
- no unresolved human gate remains

Non-goal for v1:

- zero-click automatic merge after loop completion

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
- use existing file-oriented editing flows
- make small direct markdown edits
- create small patch-style updates when obvious
- trigger loop actions from parsed planning context

Not in v1:

- custom rich markdown editor
- full structured planning editor
- visual plan builder
- reconciliation engine
- semantic round-trip editing between DB and planning graph

### GSD artifact authoring default

V1 authoring model:

- hybrid, but intentionally biased toward prompt/session-driven authoring

OMC-client should primarily handle:

- phase and plan discovery
- parsed summaries
- plan selection and loop control
- lightweight markdown edits
- opening relevant planning files

Agent/session workflows should primarily handle:

- writing `PROJECT.md`
- writing `REQUIREMENTS.md`
- writing `ROADMAP.md`
- writing `PLAN.md`
- large planning rewrites
- checklist decomposition
- fix-plan generation after failed review or verification

Reason:

- GSD already works naturally through markdown files
- OMC-client should be an execution control plane first
- avoiding a heavy planning editor keeps v1 small and shippable
- large planning changes are better handled where the agent already has full repo context

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

## GSD workspace strategy

OMC should start in a **fresh GSD workspace**, not by extending the current repository `.planning` milestone.

Reason:

- the current `.planning` already represents a completed action-runtime milestone
- OMC is a new product direction, not the next incremental phase of that work
- Phase numbering should restart from `1` for the OMC roadmap
- OMC planning should not inherit old milestone state, summaries, or phase semantics

Recommended workspace:

- workspace name: `hopi-omc`
- workspace shape:
    - `WORKSPACE.md`
    - `.planning/`
    - `hopi/` worktree

Implication:

- current repo `.planning` stays as historical record for the completed milestone
- new OMC work starts from a fresh `PROJECT.md`, `REQUIREMENTS.md`, `ROADMAP.md`, `STATE.md`
- first OMC phase is `Phase 1: OMC Foundation`

## Deployment stance

V1 deployment:

- `OMC-client` is served by the existing hub at `/omc`

Reason:

- fastest path to shipping
- reuses existing auth/session/SSE/API plumbing
- avoids extra deployment surface while the product model is still changing

## Open questions

- none for the current v1 direction; next work should focus on implementation slicing

## V1 implementation slice

This section describes the smallest version that feels like a real OMC product.

### Core product promise for v1

V1 should let a user:

- open OMC for one repo-backed program
- see plans from `.planning/*` grouped by phase
- start a Ralph loop on one plan
- watch attempts and evidence accumulate
- see plans move through `Planning / Running / Review / Done`
- review a completed or blocked plan
- explicitly approve merge

If v1 cannot do those things cleanly, it is still too early.

### What a board card is in v1

Card identity:

- derived from `PLAN.md` file path

Recommended stable key:

- `programId + normalizedPlanPath`

This means:

- files define which cards exist
- DB defines runtime state of those cards

### Planning indexer contract for v1

The planning indexer is a read-model builder, not a planner.

Its job:

- discover which plans should appear in OMC
- extract small, stable card metadata
- provide stable plan identity for runtime joins

Its non-job:

- rewrite planning
- infer deep semantics from prose
- build a full dependency solver
- become the canonical planning engine

### Planning files in scope

Read in v1:

- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/phases/**/*PLAN.md`
- optional sibling `CONTEXT.md` and `RESEARCH.md` for detail views

Ignore in v1:

- `.planning/quick/**`
- `.planning/milestones/**`
- `.planning/debug/**`
- `.planning/todos/**`
- ad hoc notes not part of formal phase planning

### Plan discovery rules

V1 discovery rule:

- every file matching `.planning/phases/**/*PLAN.md` becomes one plan card candidate

Phase grouping rule:

- phase grouping is derived from the parent phase directory

Examples:

- `.planning/phases/01-foundation/01-01-PLAN.md`
- `.planning/phases/01-foundation/01-02-PLAN.md`

Both are separate cards grouped under the same phase.

### Plan key strategy

Use two identifiers:

- `planPath`
    - canonical source identity
- `planKey`
    - stable API/runtime key

Recommended v1 approach:

- normalize relative path separators
- keep `planPath` exactly as readable source identity
- derive `planKey` from normalized path using a stable hash

Reason:

- readable source identity for debugging
- stable route-safe key for APIs and DB joins
- no need to embed full file paths in every URL

### Parsed card fields from planning indexer

Each discovered plan should return a small parsed summary.

Recommended v1 fields:

- `phaseKey`
- `phaseLabel`
- `planKey`
- `planPath`
- `planTitle`
- `summary`
- `checklistTotal`
- `checklistDone`
- `checklistOpen`
- `firstOpenItem`
- `lastModifiedAt`

Extraction rules:

- `planTitle`
    - first markdown H1
    - fallback: filename
- `summary`
    - first paragraph after title
    - fallback: empty
- `checklist*`
    - derived from markdown task-list items
- `firstOpenItem`
    - first unchecked checklist item

### Parsing approach

Keep parsing intentionally lightweight in v1.

Recommended parser style:

- line-based scan
- simple heading detection
- simple markdown task-list detection
- first-paragraph extraction

Reason:

- fast to implement
- easy to debug
- robust enough for board rendering

Non-goal for v1:

- full markdown AST semantics unless proven necessary later

### How board columns are derived

Board column is not derived from markdown alone.

Recommended v1 precedence:

1. `Running`
    - active loop exists
2. `Review`
    - review required
    - or plan is complete but awaiting merge/review decision
3. `Done`
    - merge completed
    - or explicit done marker recorded in runtime
4. `Planning`
    - everything else

This means:

- files determine card existence and plan content
- runtime DB determines operational column state

### How planning badges are derived

Recommended v1 badge sources:

- `ready-to-run`
    - derived from planning + runtime
- `needs-spec`
    - derived from missing planning structure
- `blocked`
    - runtime only
- `attempts:n`
    - runtime only
- `last-failure`
    - runtime only

Important v1 rule:

- do not infer `blocked` from arbitrary prose inside markdown

### Ready-to-run heuristic

Keep this conservative.

Recommended v1 heuristic:

- plan has a title
- plan has at least one checklist item
- plan is not `Running`
- plan is not `Review`
- plan is not `Done`

If any of those are false:

- omit `ready-to-run`

### Needs-spec heuristic

Recommended v1 heuristic:

- missing title
- or zero checklist items

This is deliberately shallow.

The goal is to surface obviously under-specified plans, not to judge plan quality deeply.

### Minimal runtime data model for v1

Do not model the whole planning universe in DB yet.

Recommended DB entities:

- `Program`
- `PlanRuntime`
- `LoopRun`
- `Attempt`
- `Evidence`
- `ReviewDecision`
- `MergeRecord`

Recommended non-goal for v1:

- separate DB tables for `Phase` and `Plan` as canonical planning entities

Instead:

- parse phases and plans from files
- store runtime state keyed by stable plan key

### PlanRuntime

This is the missing bridge object for v1.

Purpose:

- attach runtime state to one markdown plan card

Suggested fields:

- `programId`
- `planKey`
- `planPath`
- `phaseKey`
- `column`
- `currentLoopRunId`
- `currentWorktreePath`
- `currentBranch`
- `attemptCount`
- `consecutiveFailureCount`
- `lastFailureFingerprint`
- `reviewRequired`
- `mergeApprovedAt`
- `doneAt`
- `updatedAt`

### Pages for v1

Recommended initial routes:

- `/omc`
- `/omc/programs/$programId`
- `/omc/programs/$programId/plans/$planKey`
- `/omc/programs/$programId/attempts/$attemptId`

### `/omc`

Purpose:

- program picker
- quick status across programs

V1 content:

- program list
- machine / repo root
- active running count
- review queue count
- last activity

### `/omc/programs/$programId`

Purpose:

- main execution board

V1 content:

- phase-grouped board
- columns: `Planning / Running / Review / Done`
- card badges:
    - `ready-to-run`
    - `blocked`
    - `attempts`
    - `last failure`
    - `needs review`
- top summary:
    - active loops
    - review queue
    - failed today
    - merged today

Primary actions:

- start loop
- stop loop
- retry from review
- open plan detail

### `/omc/programs/$programId/plans/$planKey`

Purpose:

- plan detail + control pane

V1 content:

- plan title
- phase label
- source file path
- parsed checklist summary
- current runtime status
- worktree / branch info
- recent attempts list
- evidence summary
- lightweight file actions

Primary actions:

- open plan file
- start loop
- stop loop
- reopen from review
- approve review
- approve merge
- open takeover session

### `/omc/programs/$programId/attempts/$attemptId`

Purpose:

- deep inspection for one attempt

V1 content:

- context pack
- final prompt
- timeline
- logs / messages
- changed files
- evidence attached to this attempt
- failure fingerprint
- stop reason

### Required backend capabilities for v1

The backend only needs enough to support the pages above.

Recommended capability groups:

- program registry
- planning indexer
- runtime state store
- loop executor
- review + merge actions

### Program registry APIs

Suggested endpoints:

- `GET /api/omc/programs`
- `POST /api/omc/programs`
- `GET /api/omc/programs/:programId`

V1 program creation should capture:

- machine id
- repo root / default workspace
- display name
- default agent/model settings

### Planning indexer APIs

Suggested endpoints:

- `GET /api/omc/programs/:programId/planning-index`
- `GET /api/omc/programs/:programId/plans/:planKey`

What they should do:

- read `.planning/ROADMAP.md`
- discover `.planning/phases/**/*PLAN.md`
- parse phase and plan metadata
- derive checklist counts
- derive phase grouping
- return stable plan keys

### `planning-index` response shape

Recommended v1 response:

```ts
type PlanningIndexResponse = {
    program: {
        id: string
        name: string
        repoRoot: string
    }
    phases: Array<{
        phaseKey: string
        phaseLabel: string
        plans: Array<{
            planKey: string
            planPath: string
            planTitle: string
            summary: string
            checklistTotal: number
            checklistDone: number
            checklistOpen: number
            firstOpenItem: string | null
            lastModifiedAt: number
        }>
    }>
}
```

### `GET /plans/:planKey` response shape

This endpoint should power the plan detail page.

Recommended v1 response:

```ts
type PlanDetailResponse = {
    programId: string
    plan: {
        planKey: string
        planPath: string
        phaseKey: string
        phaseLabel: string
        planTitle: string
        summary: string
        checklist: Array<{
            text: string
            checked: boolean
        }>
        refs: {
            projectPath: string
            roadmapPath: string
            contextPath?: string
            researchPath?: string
        }
        lastModifiedAt: number
    }
    runtime: {
        column: 'Planning' | 'Running' | 'Review' | 'Done'
        currentLoopRunId: string | null
        currentWorktreePath: string | null
        currentBranch: string | null
        attemptCount: number
        consecutiveFailureCount: number
        lastFailureFingerprint: string | null
        reviewRequired: boolean
        mergeApprovedAt: number | null
        doneAt: number | null
        updatedAt: number | null
    }
}
```

Design note:

- keep planning payload and runtime payload clearly separated
- this makes file-truth vs runtime-truth explicit in the API

### Runtime state APIs

Suggested endpoints:

- `GET /api/omc/programs/:programId/plan-runtimes`
- `GET /api/omc/programs/:programId/plans/:planKey/runtime`
- `GET /api/omc/programs/:programId/plans/:planKey/attempts`
- `GET /api/omc/attempts/:attemptId`

Purpose:

- board hydration
- detail page hydration
- attempt inspector hydration

### Loop control APIs

Suggested endpoints:

- `POST /api/omc/programs/:programId/plans/:planKey/start`
- `POST /api/omc/programs/:programId/plans/:planKey/stop`
- `POST /api/omc/programs/:programId/plans/:planKey/retry`
- `POST /api/omc/programs/:programId/plans/:planKey/takeover`

Behavior:

- `start` creates or resumes the active loop run for that plan
- `stop` pauses automatic attempts
- `retry` re-enters `Running` from `Review`
- `takeover` opens interactive Codex session on the same worktree

### Review + merge APIs

Suggested endpoints:

- `POST /api/omc/programs/:programId/plans/:planKey/review/approve`
- `POST /api/omc/programs/:programId/plans/:planKey/review/reopen`
- `GET /api/omc/programs/:programId/plans/:planKey/merge-packet`
- `POST /api/omc/programs/:programId/plans/:planKey/merge/approve`

Behavior:

- review approval marks plan eligible for merge
- reopen sends card back to `Running` or `Planning` depending on action chosen
- merge packet returns the human-review payload
- merge approval performs the actual merge

### SSE events for v1

Suggested event families:

- `omc-program-updated`
- `omc-plan-runtime-updated`
- `omc-loop-run-updated`
- `omc-attempt-added`
- `omc-attempt-updated`
- `omc-evidence-added`
- `omc-review-updated`
- `omc-merge-updated`

V1 principle:

- small payloads
- query invalidation friendly
- avoid streaming huge attempt logs through SSE when existing session/message APIs can be reused

### What to defer out of v1

Do not let these expand scope:

- visual blueprint graph editor
- custom markdown editor
- multi-repo program orchestration
- plan checklist items as first-class cards
- auto-merge by default
- automatic PR creation / CI integration
- advanced dependency graph UI
- full planner UX inside OMC-client

### Recommended build order

1. add `Program` + `PlanRuntime` + `LoopRun` + `Attempt` + `Evidence` schemas
2. add planning indexer over `.planning/*`
3. add minimal OMC APIs for program list + planning index + plan runtime
4. create `OMC-client/` app shell served at `/omc`
5. ship read-only phase-grouped plan board
6. add loop start / stop / retry
7. add attempt inspector
8. add review approval + merge packet
9. add merge approval action

## Discussion notes

This document is intentionally opinionated but not locked.

Expected next steps:

- refine naming
- pin canonical data model
- define the first thin slice we can actually ship
