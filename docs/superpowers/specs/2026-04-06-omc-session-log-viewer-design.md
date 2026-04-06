# OMC Session Log Viewer Design

Date: 2026-04-06
Status: Approved for implementation
Scope: add a unified raw session-log viewer inside `omc-prototype` while keeping `PlanningRun` and `PlanRuntime` as separate domain objects

## Summary

Add a new `session-log` mode to the existing OMC right-side message panel so operators can inspect raw underlying agent transcript for:

- guided planning runs
- plan runtimes / attempts

Chosen scope:

- keep `PlanningRun` separate from the current task/runtime model
- unify them only at the observation layer through `sessionId`
- reuse code from `web` at the headless session-message-store level, not by importing the whole `SessionChat` page
- expose session-log entry points from:
  - seed / guided-planning panel
  - plan trace workspace
  - persistent dashboard header affordance for the latest planning run
- support:
  - fetch latest messages
  - load older messages
  - live incremental updates via SSE `message-received`
  - resume inactive session on send
  - sending follow-up messages into the session
- provide a terminal deep-link / route jump, not embedded xterm, for v1

Deliberately out of scope:

- merging `PlanningRun` into the task model
- importing the entire `web` `SessionChat` workbench into OMC
- task-specific runtime cards such as init/preview/merge
- in-panel terminal embedding
- rich web-specific tool cards / preview cards parity in the first slice

## Problem

Operators can now launch real guided planning and interact with real plan runtimes, but they still cannot inspect the raw agent transcript from inside OMC.

Current state:

- OMC shows projected threads and trace events
- OMC can already send messages to live sessions after mapping a thread to a session
- `web` already has a mature session transcript flow
- but OMC has no first-class panel mode for raw session logs

This causes three issues:

1. planning opacity
   The first planning run still feels hidden because the operator can only see high-level state, not the underlying transcript.

2. split mental model
   Threads, traces, and raw session logs are disconnected. Operators can reason about OMC state, but not verify the underlying agent run that produced it.

3. code duplication risk
   Rebuilding another ad-hoc session transcript stack in OMC would duplicate existing web logic.

## Goals

- let operators inspect raw transcript for both guided-planning runs and plan runtimes
- preserve the current OMC domain split:
  - `PlanningRun`
  - `PlanRuntime`
- unify only the viewer path through `sessionId`
- reuse existing session-message-store logic instead of building another one-off transcript cache
- keep the current OMC message panel shell and visual language
- support continuing a session from the same panel

## Non-Goals

- collapsing planning and task/runtime into one domain model
- copying the whole `web` workbench UI into OMC
- perfect UI parity with `web` task session chat
- terminal streaming inside OMC
- building a new generic run orchestration model in this slice

## User Story

As an OMC operator,
I want any underlying agent run to have a visible transcript entry point from the existing message panel,
so I can inspect what the agent actually did, not just the projected OMC state.

## Why Not Reuse `web/SessionChat` Directly

Direct import of the whole `web` `SessionChat` panel is not the right abstraction.

Reasons:

1. it is not a pure session transcript viewer
   It also contains task/workbench-specific runtime cards:
   - init
   - preview
   - merge
   - task navigation

2. it is visually coupled to `web`
   The UI depends on `web`’s Tailwind-based styling stack, which `omc-prototype` does not use.

3. it carries `web`-specific runtime wiring
   It depends on:
   - React Query cache layout
   - toast system
   - translation hooks
   - task-specific hooks and mutations

Chosen reuse boundary:

- reuse headless session-message-store logic
- reuse existing session REST contracts and SSE message events
- build OMC-specific viewer UI using current `omc-prototype` styling and panel shell

## Chosen Approach

Create a shared headless session-message-store in `@hopi/protocol`, then add an OMC-specific `SessionLogWorkspace` inside the existing message panel.

Why this approach:

- reuses the hard part:
  - message window state
  - pagination
  - pending queue / incremental ingest
- avoids dragging `web`’s task semantics into OMC
- keeps OMC visually consistent
- supports future reuse by both `web` and `omc-prototype`

Rejected alternatives:

1. import `web/SessionChat` whole
   Too coupled to task/workbench semantics and Tailwind styling.

2. build a brand-new OMC-only message store
   Fast locally, but duplicates existing session message logic.

3. adopt a third-party chat/session library
   Unnecessary. We already have the right protocol, message transport, and `assistant-ui` foundation.

## Domain Model Decision

Do not merge initial planning into the current task/runtime model.

Keep:

- `PlanningRun`
- `PlanRuntime`

These are different domain objects with different lifecycle semantics.

Unify only at the observation layer:

- both may expose `sessionId`
- the message panel can open a transcript for either

This preserves correct modeling while still giving operators one consistent way to inspect raw agent output.

## UX Design

### Panel Modes

Extend the current message panel modes from:

- `inbox`
- `thread`
- `trace`

to:

- `inbox`
- `thread`
- `trace`
- `session-log`

`session-log` reuses the same panel container and back-navigation behavior.

### Session Log View

Inside `session-log`, render:

- back button
- session title
- source label:
  - `规划运行`
  - or `执行会话`
- flavor / model / worktree metadata when available
- inactive banner when session is inactive
- transcript viewport
- composer for sending follow-up messages
- button:
  - `打开终端`

### Planning Run Entry Points

Expose `查看底层日志` when the latest planning run has a `sessionId`.

Entry points:

1. dashboard hero area
   Persistent affordance so the latest planning run remains inspectable even after plans exist.

2. seed planning panel
   Visible during queued/running/failed states when `planningRun.sessionId` exists.

### Plan Runtime Entry Points

Expose `查看底层日志` for plan runtime sessions through the plan-trace surface.

Chosen entry point for v1:

- `PlanTraceWorkspace` header

Reason:

- plan trace is already the main “under the hood” surface for a plan card
- it naturally bridges projected OMC state and raw session transcript

### Back Navigation

From `session-log`:

- if opened from trace, back returns to trace
- if opened from inbox/thread context, back returns to the previous panel mode

For v1, this can be implemented with a stored previous mode / selection snapshot in local panel state.

## Reuse Architecture

### Shared Headless Message Store

Extract the headless session message window logic from `web` into `@hopi/protocol`.

New shared module responsibilities:

- keep message window state per session
- fetch latest page
- fetch older page
- ingest live incoming messages
- track pending overflow / at-bottom state

The shared module must remain UI-agnostic and React-agnostic.

### Package Responsibilities

`@hopi/protocol`

- shared message-window store factory
- shared message page types / client interface

`web`

- keep current `useMessages` hook, but rebase it onto the shared store factory
- keep `SessionChat` and task/workbench-specific UI

`omc-prototype`

- add its own small `useSessionMessages` hook
- add `SessionLogWorkspace`
- add panel mode / selection handling
- add session-log entry points

## Data Flow

### Opening a Planning Run Log

1. operator clicks `查看底层日志`
2. OMC opens message panel in `session-log` mode with planning-run selection
3. viewer fetches session detail
4. viewer fetches latest messages via shared store
5. viewer listens for SSE `message-received`
6. incoming session messages append into the shared message store

### Opening a Plan Runtime Log

1. operator opens a plan trace
2. operator clicks `查看底层日志`
3. OMC resolves the plan’s current session id
4. message panel switches into `session-log`
5. transcript flow proceeds exactly the same as above

### Sending a Follow-up Message

1. operator types in `session-log` composer
2. viewer checks session state
3. if inactive:
   - call `resumeSession()`
4. send message through `/api/sessions/:id/messages`
5. refresh latest session detail
6. rely on message fetch / SSE to reflect the new transcript

## Error Handling

Cases to handle explicitly:

1. session detail fetch fails
   Show inline error in session-log panel with retry action.

2. messages fetch fails
   Show inline warning while preserving panel shell.

3. send fails
   Show inline send error near composer.

4. terminal route unavailable
   Do not break transcript view. Terminal action can be hidden when no route target is available.

## Testing Strategy

### Shared Store

Add protocol-level tests for:

- latest fetch
- older-page fetch
- live ingest merge
- pending flush behavior

### OMC Session Log Viewer

Add tests for:

- opening planning run log from seed panel
- opening plan runtime log from trace workspace
- session-log mode rendering transcript
- send-on-inactive resumes then sends
- back navigation from session-log

### Web Regression

Add a focused regression proving `web` `useMessages` still works on top of the extracted shared store.

## Acceptance Criteria

- `PlanningRun` stays separate from task/runtime modeling.
- OMC message panel supports a new `session-log` mode.
- Operators can open raw transcript for guided-planning runs when a planning session exists.
- Operators can open raw transcript for plan runtimes from the plan-trace surface.
- OMC and `web` share the same headless session-message-store logic.
- No third-party session viewer library is introduced.
- Existing `web` session chat behavior remains intact.
