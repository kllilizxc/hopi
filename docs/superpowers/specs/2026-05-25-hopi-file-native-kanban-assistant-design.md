# HOPI File-Native Kanban Assistant Design

Date: 2026-05-25
Status: accepted design

Supersedes the control-plane direction in:

- `docs/2026-05-15-hopi-goal-kanban-assistant-unified-design.md`

## Summary

HOPI should make project workflow state visible, local, and assistant-operable through ordinary files and local scripts.

The core shift:

- `todo.yml` is the only durable kanban workflow truth.
- The web kanban is a projection of `todo.yml`.
- Assistant kanban writes go through project-local skill scripts under `.hopi/skills/kanban/`.
- The DB stores runtime/session overlay, not kanban workflow state.
- Trace is documentation, not replay state.

This keeps the control surface small and inspectable. Assistant does not need hidden hub actions or direct DB mutation to operate the board. It reads scripts, calls scripts, and sees the files those scripts change.

## Goals

- Make kanban state recoverable from repo-local docs.
- Keep assistant operations transparent and debuggable.
- Avoid hidden write paths in hub/server code.
- Keep P0 simple enough to ship and evaluate.
- Preserve runtime/session performance through DB-backed overlays.
- Record enough trace to explain workflow and file-write history without dumping full transcripts.

## Non-Goals

- No manifest, version manager, or auto-upgrade system for project-local skills in P0.
- No assistant-generated skills as a P0 dependency.
- No full session transcript persistence into docs.
- No replaying `events.jsonl` to recover kanban state.
- No DB-backed kanban projection as durable or semi-durable truth.
- No Python, Bun, TypeScript compile step, or package install requirement for default kanban scripts.

## File Layout

Each goal owns durable workflow docs:

```text
.hopi/
  docs/
    index.md
    goals/
      <goalKey>/
        goal.md
        design.md
        todo.yml
        decisions.yml
        events.jsonl
        write-trace.jsonl
  skills/
    kanban/
      SKILL.md
      todo.mjs
      yaml.mjs
```

`todo.mjs` and `yaml.mjs` are copied into each project. The duplication is intentional for P0: one self-contained project-local control surface is simpler than a shared user-home dependency.

## State Ownership

### Docs Own Workflow Truth

`todo.yml` owns:

- task refs
- titles and bodies
- kanban status
- dependency graph
- structured workflow blockers
- task order if ordering is represented

`decisions.yml` owns structured decision topics.

`goal.md` and `design.md` own durable goal context and design rationale.

`events.jsonl` explains workflow mutations. It is append-only trace, not replay state.

`write-trace.jsonl` audits agent file writes. It does not affect kanban state.

### DB Owns Runtime Overlay

The DB stores only live/runtime data:

- sessions and messages
- `goalKey + taskRef -> sessionId` linkage
- runtime attempt metadata
- runner state
- permission and approval state
- failure summaries tied to an attempt
- paged session history indexes

The DB does not store kanban workflow truth:

- no task title/body as source of truth
- no task lane/status as source of truth
- no dependency graph
- no workflow blocker truth
- no durable board order

If a DB overlay points to a missing `taskRef`, the overlay is orphaned. It should be ignored by the board and surfaced in diagnostics.

## `todo.yml` Schema

P0 schema:

```yaml
version: 1
goal:
  goalKey: tutorial
  title: Tutorial Goal
items:
  - ref: teaching-matrix
    status: done
    title: Build teaching matrix
    body: Produce the stable tutorial matrix and acceptance criteria.
    dependencyTaskList: []

  - ref: tutorial-story-content
    status: planned
    title: Implement tutorial story content
    body: Fill story content and first tutorial battle flow.
    dependencyTaskList:
      - ref: teaching-matrix
    blockers:
      - kind: decision
        ref: choose-tone
        summary: Waiting for user to choose tutorial narrative tone.
```

Statuses:

```text
candidate | planned | in_progress | in_review | merging | done
```

Rules:

- `ref` is required, stable, and unique inside one goal.
- `status` is the kanban lane, except `candidate` is a reservoir/backlog status.
- There is no `blocked` status.
- `blockers` explains why work cannot proceed, but does not define a lane.
- `dependencyTaskList` is the canonical dependency model.
- Dependency entries reference other item refs.
- Runtime failures may appear as derived UI badges through DB overlay, not as workflow truth unless a script records a durable blocker.

## Kanban Skill

Assistant operates kanban through:

```text
.hopi/skills/kanban/SKILL.md
.hopi/skills/kanban/todo.mjs
.hopi/skills/kanban/yaml.mjs
```

Default runtime:

- Node.js plain ESM.
- Run with `node`.
- No Bun.
- No TypeScript compile.
- No npm install.
- YAML support is provided by the local `yaml.mjs` helper.

P0 commands:

```bash
node .hopi/skills/kanban/todo.mjs list --goal <goalKey>
node .hopi/skills/kanban/todo.mjs add --goal <goalKey> --ref <ref> --title <title> --status candidate|planned
node .hopi/skills/kanban/todo.mjs move --goal <goalKey> --ref <ref> --status <status>
node .hopi/skills/kanban/todo.mjs update --goal <goalKey> --ref <ref> --title <title> --body <body>
node .hopi/skills/kanban/todo.mjs link-dependency --goal <goalKey> --ref <ref> --depends-on <ref>
```

Script responsibilities:

- read and parse `.hopi/docs/goals/<goalKey>/todo.yml`
- validate legal statuses
- validate unique refs
- validate dependency targets exist
- reject dependency cycles
- write through a temporary file and rename
- append `events.jsonl` on successful mutation
- return machine-readable JSON

The script is the only recommended write path for kanban workflow state. Direct file editing remains technically possible because this is local-first software, but assistant prompts and skills should instruct assistant to use the script.

P0 intentionally excludes:

- skill manifest
- template version tracking
- automatic upgrade
- package manager behavior
- assistant self-repair of core kanban script
- complex permission framework

## UI And Sync

Board read flow:

```text
todo.yml
  -> API parse
  -> runtime overlay lookup from DB
  -> response
  -> Web kanban
```

Mutation flow:

```text
assistant or user
  -> node .hopi/skills/kanban/todo.mjs ...
  -> todo.yml + events.jsonl
  -> watcher/API/reconcile notices docs change
  -> SSE invalidates client queries
  -> Web refetches board
```

The UI must not write kanban workflow state directly to DB. P0 board controls that would mutate kanban state are disabled or removed until they can call the same project-local script path. The board is read-only for workflow state in P0.

Sync triggers:

- file watcher for low-latency changes under `.hopi/docs/goals/**`
- API read that reparses or validates file mtime
- periodic reconcile tick as watcher-loss fallback
- SSE only to notify clients to refetch

Parse failure behavior:

- do not replace the last valid board with corrupt data
- return/display a docs parse error
- keep runtime sessions untouched
- require user/assistant to repair `todo.yml` through the kanban skill or manual edit

## Reconciler

The reconciler is deterministic control-plane logic, not an agent.

Responsibilities:

- read `todo.yml` and `decisions.yml`
- derive dependency blockers
- combine docs state with DB runtime overlay
- start eligible runtimes when automation policy allows
- clean or report orphan runtime links
- emit SSE refetch events
- when automation must change workflow state, invoke the same kanban writer path used by assistant/user scripts and append workflow events

The reconciler does not persist kanban projection into DB. It can use memory caches for performance, but those caches are disposable.

## Actors

### Assistant

Assistant is goal-scoped.

Allowed:

- read repo files
- read `.hopi/docs`
- read project-local kanban skill scripts
- call `.hopi/skills/kanban/todo.mjs`
- call HOPI APIs for paged session history
- explain board state and blockers

Forbidden in P0:

- direct source code writes
- direct DB writes
- direct hidden hub actions for kanban changes
- direct mutation of kanban state outside the kanban skill

### Planner

Planner may update `goal.md` and `design.md` directly.

Planner creates or reshapes kanban items through the same project-local kanban skill. If a missing answer would materially change decomposition, Planner records a structured decision topic instead of guessing.

### Worker Agents

Worker agents implement, review, and merge source changes. Their source writes are normal task runtime behavior and are audited by `WriteTraceRecorder`.

Worker agents do not own kanban truth. They can report outcomes, but durable kanban state changes go through the docs-backed control path.

## Trace

### Workflow Trace

Path:

```text
.hopi/docs/goals/<goalKey>/events.jsonl
```

Purpose:

- explain why workflow state changed
- make assistant/user debugging easier
- provide audit of kanban mutations

Event examples:

- item added
- item moved
- item updated
- dependency linked
- decision created
- decision resolved
- planner request created

Required fields:

- id
- timestamp
- writer
- action
- entity
- before summary
- after summary
- reason
- command/script metadata

`events.jsonl` is not replayed to recover board state. `todo.yml` is current state.

### File Write Trace

Path:

```text
.hopi/docs/goals/<goalKey>/write-trace.jsonl
```

Purpose:

- audit agent file writes
- help assistant diagnose what changed without reading full transcripts first
- avoid trace files containing full source content

Unified recorder:

```text
normalized tool-call / tool-result / patch event
  -> WriteTraceRecorder
  -> write-trace.jsonl
```

Coverage:

- Claude Code: extend generated hook settings beyond `SessionStart` to `PreToolUse` and `PostToolUse` for write tools such as `Write`, `Edit`, `MultiEdit`, and `NotebookEdit`.
- OpenCode: use existing plugin forwarding around `tool.execute.before` and `tool.execute.after`.
- Codex: use HOPI normalized events, including remote/app-server file-change and patch events, plus local session scanner events where available.

Recorded fields:

- agent
- sessionId
- cwd
- toolName
- callId
- target paths
- argument summary
- result summary
- timestamp

Default policy:

- record write-file tools only
- do not record full file content
- keep trace compact and goal-scoped where possible

## P1: Assistant-Made Skills

Assistant-created project-local skills are P1.

They are allowed as an experiment in routine capture:

- assistant may create scripts for repeated local workflows
- assistant may read and call those scripts later
- scripts may live under `.hopi/skills/<name>/`

Constraints:

- P1 skills must not be required for P0 kanban correctness
- P0 kanban skill remains the stable control path
- no auto-upgrade or manifest system in P0
- no review/permission framework in P0

This keeps the experiment possible without making the core board depend on self-modifying capability infrastructure.

## Testing Strategy

Core tests should avoid browser-first coverage.

P0 must cover:

- parsing valid `todo.yml`
- rejecting invalid YAML
- rejecting duplicate refs
- rejecting invalid statuses
- rejecting dependencies on missing refs
- rejecting dependency cycles
- atomic write behavior for successful mutations
- no file mutation on failed validation
- `events.jsonl` append on successful script mutation
- API board response built from `todo.yml`
- DB runtime overlay attached by `goalKey + taskRef`
- orphan DB runtime overlay ignored or surfaced as diagnostic
- SSE invalidates board queries after docs changes
- watcher-loss recovery through API read or reconcile tick
- `WriteTraceRecorder` records normalized write events without full file contents

## Migration Direction

Current implementation contains DB task projection and server-side kanban mutation paths. Migration should move toward:

- keeping existing DB task/session behavior only as runtime overlay during transition
- making board API derive workflow fields from `todo.yml`
- removing DB task title/status/dependency from the canonical read path
- routing assistant kanban writes through `.hopi/skills/kanban/todo.mjs`
- keeping server routes only as bridges to local scripts where needed
- splitting workflow trace from write-file trace

The migration should not preserve backward compatibility with legacy workflow truth once the file-native model is enabled for a project.

## Hard Invariants

1. `todo.yml` is the only kanban workflow truth.
2. DB never owns kanban lane/status/title/dependency truth.
3. Assistant kanban writes go through project-local kanban skill scripts.
4. UI board state is derived from docs plus runtime overlay.
5. `events.jsonl` explains state changes but is not replayed for current state.
6. `write-trace.jsonl` audits file writes but does not affect workflow state.
7. `blocked` is not a task status or lane.
8. Runtime/session history stays in API-accessible storage, not docs.
9. P1 assistant-made skills cannot be required for P0 board correctness.
10. The P0 skill is self-contained and does not require Bun, TypeScript, npm install, Python packages, or user-home helper files.
