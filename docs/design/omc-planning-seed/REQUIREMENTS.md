# Requirements: HOPI OMC

## Product Requirements

### OMC-01 New product mode
HOPI must support a second product mode for autonomous orchestration that is independent from the current session-first `projects` UX.

### OMC-02 Plan-oriented execution
The primary execution unit must be `PLAN.md`, with board cards and loop ownership aligned to that unit.

### OMC-03 Markdown-first planning
Planning truth must remain in markdown files under `.planning/*` rather than a new canonical planning database.

### OMC-04 Codex-first attempt execution
The system must support fresh-context attempt execution using Codex as a first-class runtime.

### OMC-05 Attempt visibility
Each attempt must have visible runtime state, summaries, changed files, and evidence output.

### OMC-06 Human review gate
Completed or blocked plans must enter a human review stage before merge.

### OMC-07 Thin editing posture
Phase 1 should support only lightweight planning edits and file-opening flows, not a rich planning editor.

### OMC-08 Single-repo v1 scope
The initial milestone must assume one primary repository per program.

## Phase 1 Acceptance Criteria

1. A new OMC workspace exists with its own `.planning/` and roadmap.
2. OMC can parse formal GSD `PLAN.md` files and group them by phase.
3. The board shows `Planning`, `Running`, `Review`, and `Done` columns.
4. A user can manually start a loop for one plan.
5. The first attempt produces inspectable runtime output and evidence.
6. Plan detail is execution-first, with runtime state above parsed markdown detail.
7. Human review remains the gate after completion or repeated failure.
