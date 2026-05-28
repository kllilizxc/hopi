# OMC Message-Driven Operator Shell Design

Date: 2026-04-05
Status: Draft for review
Scope: `omc-prototype/` Phase 1 redesign

## Summary

Reframe OMC prototype interaction around a message-driven operator shell.

- Left canvas: context only
- Right panel: primary action surface
- Every item that needs operator input becomes a thread
- Default message workspace view: thread list
- Thread detail: full chat-style conversation
- Operator can use quick actions or free-form input

This replaces the current mixed model where decisions, context, and thread-like UI all appear in the same surfaces.

## Problem

Current prototype has three structural problems:

1. Decision UI duplicated
   Main canvas and right panel both try to explain and control the same things.

2. Message panel not scalable
   The panel has drifted between cards, stacked layouts, split layouts, and pseudo-chat. As thread count grows, the experience becomes noisy and hard to scan.

3. Agent interaction not flexible enough
   Operator needs a real conversation surface for follow-up questions, custom instructions, and tradeoff clarification. Current ad hoc controls do not support this cleanly.

## Goals

- Make the right panel the single place for operator action
- Keep the main canvas focused on system state and drilldown
- Support many threads without layout collapse
- Make each thread feel like a real chat conversation, not a mini report
- Support both:
  - fast operator decisions through quick actions
  - flexible operator control through natural-language input
- Make thread lifecycle easy to understand at a glance

## Non-Goals

- Replace the underlying fake-data scenario engine
- Build production backend APIs
- Finalize mobile-native behavior beyond a reasonable responsive prototype
- Build a Slack/Discord-scale multipane messaging system
- Expose attempt/session terminal detail in the operator shell phase

## User Model

Primary user: solo operator managing one repo with continuous autonomous execution.

Primary mental model:

- Main canvas answers: what is the system doing?
- Message workspace answers: what needs my judgement, and what do I want the agent to do next?

## Product Structure

### Main Canvas

Purpose: situational awareness and drilldown.

Allowed content:

- goals
- strategy summary
- execution streams
- phase / plan drilldown
- daily digest
- counts or lightweight indicators for pending items

Not allowed:

- approval buttons
- risk resolution buttons
- route-changing buttons
- custom instruction textareas
- long explanatory cards for individual operator decisions

Main canvas should hand off to message threads through lightweight affordances only:

- `打开相关线程`
- `有 1 条待处理`
- `查看 2 条风险线程`

### Message Workspace

Purpose: all operator action.

Message workspace owns:

- approvals
- risk handling
- route changes
- operator follow-up questions
- custom instructions
- agent clarification

## Interaction Model

### Core Principle

One thread = one operator-relevant topic.

Not:

- one goal = one thread
- one stream = one thread
- one message = one thread

Examples:

- `要不要现在放行导入分支`
- `周报范围还要不要继续收紧`
- `当前主线为什么先压导入`
- `归一化风险是否值得打断`

### Thread Types

- `status`
  Agent-initiated status/update thread
- `approval`
  Requires explicit confirmation or instruction
- `risk`
  Requires judgement about interruption, scope, or silence
- `direction`
  Proposed route/priority change or operator-requested replanning

### Thread Lifecycle

Thread status is about one question only:

`Does this topic currently require operator attention?`

Statuses:

- `pending`
  New topic; needs review
- `in_progress`
  Operator responded; agent is acting on it
- `waiting`
  Agent needs another operator reply
- `silent`
  Operator deferred it; do not foreground unless re-triggered
- `resolved`
  Topic closed

Transitions:

- new topic -> `pending`
- open/read -> no lifecycle change; read state only
- operator quick action or free-form reply -> `in_progress`
- agent finishes without more input needed -> `resolved`
- agent asks a new concrete follow-up -> `waiting`
- operator chooses later/snooze -> `silent`
- context invalidates a silent/resolved topic -> `pending`

## Message Workspace Layout

### Default View

Default message workspace view is the thread list.

Reason:

- supports many threads
- matches inbox mental model
- prevents the panel from becoming a long mixed feed

### Thread Detail View

Selecting a thread replaces the list with a full chat detail view inside the same right-side workspace.

No split list + detail stack.
No simultaneous large detail card under the list.

Flow:

1. open panel
2. see thread list
3. open thread
4. view full conversation
5. back returns to list, preserving list scroll position

### Desktop

- fixed right rail
- width target: 420px to 480px
- main canvas retains majority width

### Narrow Screens

- message workspace becomes drawer or fullscreen panel
- same list -> detail flow

## Thread List Design

### Grouping

Order:

1. `等你处理`
2. `进行中`
3. `静默中`
4. `已解决`

`已解决` and `静默中` collapsed by default.

### Thread Row Content

Each row shows only:

- topic title
- one-line preview
- state marker
- timestamp
- optional light context label if needed

Do not show:

- chip piles
- multiple buttons
- confidence percentages
- full route/phase/plan metadata
- long explanations

### Thread Titles

Titles should read like operator topics, not object labels.

Good:

- `要不要现在放行导入分支`
- `周报范围还要不要继续收紧`
- `当前主线为什么先压导入`

Avoid:

- `把持仓导入跑稳 · 当前现状`
- `券商导入契约 · 风险`
- `阶段 01 · 锁定导入契约`

## Thread Detail Design

### Header

Minimal:

- back icon
- topic title
- one-line context strip

Context strip may include:

- goal
- stream
- phase
- plan

Show only the minimum required context for this topic.

### Conversation Body

Standard chat-style message flow.

No oversized report cards.
No repeated context sections.

### Composer

Persistent bottom composer.

Supports:

- normal text reply
- direct instruction
- clarifying question

### Quick Actions

Quick actions appear only under the first agent message when relevant.

Examples:

- `确认放行`
- `再加固一轮`
- `稍后`
- `继续跑`
- `收紧范围`

## First Agent Message Contract

The first agent message should feel like a work message, not a report.

### Required Shape

1. one-sentence conclusion
2. one-sentence reason
3. quick actions, if relevant
4. short prompt that free-form input is allowed

### Examples

Approval thread:

> 我建议先放行导入分支，把火力转去加固合并后问题。  
> 导入链路已经稳定，继续压在这里的收益开始下降。

Risk thread:

> 这个风险先不用打断主线，但我建议收紧周报范围。  
> 周报继续漂会分走主线注意力。

Status thread:

> 当前主线不需要你拍板，我只是同步现在系统怎么排。  
> 如果你想追问原因或改路线，直接告诉我。

### Expanded Detail

Detailed evidence is collapsed behind explicit reveal actions:

- `查看依据`
- `查看影响`
- `看关联计划`

Default state: collapsed.

## Free-Form Operator Control

Free-form input is a first-class feature, not a fallback note box.

Operator should be able to say:

- `先不要放行，再加固一轮`
- `只保留漂移和新鲜度，别扩范围`
- `为什么现在不先做周报`
- `把这个风险和导入流关联给我看`

Expected prototype reaction:

- thread state updates
- relevant goal/stream summaries adjust
- daily digest wording can change
- inbox placement can change

## Third-Party Reuse Strategy

Prefer reuse of existing repo chat stack.

### Reuse

- `@assistant-ui/react`
- `@assistant-ui/react-markdown`
- existing markdown rendering patterns
- existing composer / thread viewport patterns where useful

Relevant references:

- `/Users/realizer/Code/hopi/web/src/components/AssistantChat/HappyThread.tsx`
- `/Users/realizer/Code/hopi/web/src/components/AssistantChat/HappyComposer.tsx`
- `/Users/realizer/Code/hopi/web/src/components/MarkdownRenderer.tsx`

### Build Custom

- thread inbox list
- lifecycle grouping
- thread metadata strip
- operator-topic derivation
- quick-action mapping
- thread state transitions

## Component Boundaries

### `MessageWorkspace`

Owns panel shell and mode switching:

- list mode
- detail mode

### `ThreadInbox`

Owns grouped thread list:

- section grouping
- collapse/expand handled and silent groups
- row selection

### `ThreadDetail`

Owns current conversation view:

- thread header
- message list
- quick actions
- composer

### `ThreadDerivation`

Transforms scenario snapshot into operator threads and initial first-agent messages.

### `ThreadStateStore`

Owns:

- active thread id
- per-thread message history
- lifecycle transitions
- read/unread
- quick-action effects
- free-form reply effects

## Data Flow

1. scenario snapshot changes
2. thread derivation updates thread list
3. inbox groups threads by lifecycle
4. operator opens a thread
5. thread detail renders stored conversation
6. operator chooses quick action or sends free-form reply
7. store updates thread lifecycle and scenario consequences
8. main canvas re-renders from updated derived state

## Error Handling

Prototype-level only:

- invalid thread id -> fallback to inbox list
- missing derived context -> render minimal title-only header
- message send failure -> local error bubble; keep draft available

No production transport concerns in this phase.

## Testing

### Behavioral

- list view is default
- selecting a thread opens detail
- back returns to list and preserves scroll position
- only one thread detail visible at a time
- thread rows grouped by lifecycle
- resolved and silent groups collapsed by default
- first agent message uses concise chat-style structure
- quick action updates lifecycle correctly
- free-form reply appends to correct thread only
- main canvas has no decision buttons
- main canvas can still open related threads

### State Flow

- `pending -> in_progress`
- `pending -> silent`
- `in_progress -> waiting`
- `in_progress -> resolved`
- `silent/resolved -> pending` when context changes

### Visual

- desktop rail width stable
- thread list rows remain readable with many items
- detail view does not duplicate context already shown in header
- no mixed list-and-detail stacked layout

## Rollout Plan

1. replace current message panel shell with list/detail workspace
2. simplify first-message rendering
3. remove duplicated action controls from main canvas
4. wire quick actions and free-form replies into lifecycle transitions
5. refine spacing and typography only after structural replacement

## Risks

- overloading thread titles with system object names
- letting context metadata grow back into chip clutter
- duplicating decision controls in main canvas
- turning first agent messages back into mini reports

## Acceptance Criteria

- Operator can understand the current inbox without reading long cards
- Every operator-relevant topic exists as a distinct thread
- Opening a thread feels like opening a real conversation
- Operator can both tap quick actions and type custom guidance
- Main canvas no longer competes with the message workspace for control
- Layout supports many threads without collapsing into a long mixed feed
