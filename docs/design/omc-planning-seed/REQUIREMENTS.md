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

### OMC-09 Local program attach
OMC must support attaching an arbitrary local git repository as a program by explicit path, rather than only operating on the hub repository.

### OMC-10 Planning bootstrap
When an attached repository does not have a usable `.planning/*` tree, OMC must offer a lightweight bootstrap path: attach an existing planning root or create a minimal markdown planning seed inside the repo.

### OMC-11 Guided planning continuation
After a repository has a planning seed but no executable `PLAN.md` cards yet, OMC must let the user continue into the next planning steps from inside the product rather than requiring manual CLI-only commands.

### OMC-12 Planning-run visibility
When OMC is performing guided planning actions such as bootstrap discuss/plan continuation, the product must show progress, outcome, and failure information explicitly.

### OMC-13 Plan emergence handoff
When guided planning produces the first executable `PLAN.md` cards, OMC must hand the user back to the normal plan board without requiring re-attachment or manual mode switching.

### OMC-14 Message-driven operator surface
The prototype must treat the message panel as the primary operator control surface, with the main canvas acting as contextual support rather than the primary place for decisions.

### OMC-15 Topic-thread model
The message panel must organize intervention work as topic threads rather than raw message piles or route-local cards. Thread identity must be topic-based, with goal/stream/phase/plan attached as metadata.

### OMC-16 Dual interaction model
Every actionable thread must support both quick actions and freeform user replies, and both interaction styles must visibly affect the same thread.

### OMC-17 Thread lifecycle
Operator threads must implement an explicit lifecycle of `pending`, `in-progress`, `waiting`, `silent`, and `resolved`, with unread/read treated as a secondary marker rather than the main status.

### OMC-18 Canvas/context split
Dashboard, goal, and execution pages must stop owning the primary approval/risk/route-change controls and instead surface thread links or metadata only.

### OMC-19 Chat-stack reuse
The prototype should reuse the existing HOPI chat foundation where practical, especially `@assistant-ui/react`, markdown rendering, and thread/composer patterns, instead of extending a fully bespoke chat shell.

### OMC-20 Scalable inbox behavior
The message panel must scale to many topics through a clear inbox model, default unresolved-thread focus, and handled/silent grouping without exploding into one giant freeform message list.

## Phase 1 Acceptance Criteria

1. The prototype presents a fixed right-side message panel on desktop and a usable message drawer/sheet posture on narrow layouts.
2. New intervention-worthy topics appear as topic threads with one structured first Agent message.
3. Approval, risk, and direction threads support both quick actions and freeform chat replies.
4. Thread lifecycle is explicitly represented as `pending`, `in-progress`, `waiting`, `silent`, and `resolved`.
5. The default opened thread is the highest-priority unresolved intervention thread.
6. Dashboard, goal, and execution views no longer own the primary intervention controls.
7. The active thread reuses assistant-ui-style chat rendering/composer patterns rather than remaining a bespoke plain-text card stack.
