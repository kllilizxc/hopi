# OMC Decision Briefing Detail Design

Date: 2026-04-07
Status: Draft for review
Scope: real OMC decision-thread detail experience in `omc-prototype`
Related:
- `docs/superpowers/specs/2026-04-05-omc-message-detail-redesign-design.md`
- `docs/superpowers/specs/2026-04-06-omc-plan-raw-run-log-design.md`
- `docs/superpowers/specs/2026-04-06-omc-multi-agent-state-machine-design.md`
- `docs/superpowers/plans/2026-04-06-omc-multi-agent-state-machine.md`

## Summary

Redesign the right-side decision detail view so first-time users can understand a real OMC decision thread without any prior mental model.

Approved direction:

- decision detail starts with a human-readable briefing, not raw agent text
- real project / goal / plan names replace demo-only scenario labels when live OMC data exists
- low-level runtime failures stay available, but move into a collapsed evidence section instead of pretending to be the operator-facing recommendation
- decision buttons describe outcomes in plain language
- raw session log and trace remain one click away from the same panel

This is a product comprehension fix, not just a copywriting tweak.

## Problem

The current decision detail view fails in three ways when connected to real OMC data.

1. Wrong semantic frame

The panel opens as if the user already knows:

- what object is being discussed
- what just happened
- why the system escalated
- what each decision will change

In reality, a first-time user often knows none of that.

2. Demo labels leak into live decisions

Prototype titles such as `调整周报路线` can appear even when the active project is something else like `CardGame` or `First Playable Expedition`.

This makes the thread look broken before the user even reads the body.

3. Low-level runtime summaries leak into the recommendation layer

Strings such as:

`The linked session became inactive before the attempt reported a structured outcome.`

are valid internal evidence, but not valid operator-facing recommendations.

They describe a runtime failure mode:

- the linked execution session stopped being active
- the current attempt did not emit a structured outcome block
- OMC therefore cannot confidently classify the attempt result

That evidence matters, but only after the system first explains it in product language.

## Goals

- make one decision thread understandable without prior OMC background
- answer `what is this`, `what happened`, `why am I involved`, and `what happens if I click`
- separate operator briefing from raw evidence
- preserve direct entry points into session logs and raw traces
- replace demo-specific decision labels with real plan / goal context whenever live OMC data exists
- keep the right-side panel as the single operator surface

## Non-Goals

- redesigning inbox list behavior
- changing the underlying OMC runtime protocol
- removing raw evidence from the UI
- inventing a new full-screen debugging page
- solving every failure classification in this pass

## User Model

Assume the operator may know only:

- project name
- that something surfaced in the inbox

Do not assume they know:

- what a plan runtime is
- what an attempt is
- what a structured outcome block is
- how `session`, `attempt`, `review`, and `approval` relate

The UI must build that context before asking for a decision.

## Recommended Information Hierarchy

Decision detail becomes a four-layer reading path:

1. object identity
2. current situation
3. decision consequences
4. raw evidence

The operator should be able to stop after layer 2 or 3 for normal use, and only expand layer 4 when debugging.

## Detail Layout

### 1. Identity Summary

Top summary card. Always visible.

Contains:

- project
- goal
- plan
- current attempt number when available
- linked session id or short label when available
- lifecycle badge

Rules:

- use real OMC labels first
- never use demo copy like `周报` when live OMC plan data exists
- if a field is unknown, omit it instead of guessing

### 2. Situation Briefing

Primary explanation card. Always visible.

Contains four fixed rows:

- `发生了什么`
- `为什么会找你`
- `系统建议`
- `当前影响`

Rules:

- all four rows use Chinese product language
- write for a user who has not seen the logs
- runtime-specific jargon must be translated

Example for session inactivity:

- `发生了什么`
  `CardGame 的 "Establish expedition domain" 在执行中失去了关联 session，这一轮还没来得及上报结果。`
- `为什么会找你`
  `系统现在无法判断这轮是应该继续、重试，还是改方向，所以需要你确认下一步。`
- `系统建议`
  `先查看这轮日志；如果只是 session 意外断开，可以恢复后重试。`
- `当前影响`
  `这张计划卡暂时不会继续自动推进，直到你确认如何处理。`

### 3. Decision Actions

Action card below the briefing.

Rules:

- button labels describe outcomes, not generic intent
- hide actions that do not match the actual failure or approval type
- if the topic is a runtime interruption rather than a product-scope change, do not show scope-specific labels

Examples:

- `查看日志后重试`
- `先保持现状`
- `按当前建议继续`
- `改成你的要求`

Each action must have supporting helper text in the card body:

- what will happen immediately
- whether automation resumes
- whether the topic leaves the inbox

### 4. Raw Evidence

Collapsed by default.

Contains:

- original low-level summary
- termination reason
- next suggested step
- related trace link
- related session log link

Rules:

- raw English or protocol terms are allowed here
- never place raw evidence above the human-readable briefing
- label this section clearly as evidence, not recommendation

Recommended section title:

`查看原始依据`

Recommended helper line:

`给需要排查底层运行问题时使用；不是给你拍板用的主说明。`

## Decision-Type Rules

### Live OMC decision threads

If the thread comes from real OMC runtime data:

- title from real plan / goal / risk semantics
- briefing from runtime state + typed failure/review metadata
- no demo scenario nouns

### Demo scenario threads

If the thread comes from seeded prototype-only data:

- existing scenario language may remain
- still use the same four-layer layout

### Runtime failure threads

If `terminationReason` or equivalent runtime evidence indicates a technical interruption:

- default title should describe the interruption, not a product direction change
- preferred framing:
  - `执行中断`
  - `等待你确认如何恢复`
  - `本轮结果未上报`

### Approval threads

If the decision is a genuine product approval boundary:

- title can remain domain-oriented
- briefing still must define what is being approved and what changes after approval

## Data Mapping Rules

Introduce a stronger separation between:

- `operator briefing model`
- `raw runtime evidence`

### Operator Briefing Model

Derived UI object that should answer:

- display title
- object labels
- what happened
- why escalated
- recommended action
- impact if deferred
- action labels

It is composed from:

- `OmcPlanRuntime`
- latest `OmcAttempt`
- `terminationReason`
- `nextSuggestedStep`
- work-order / topic linkage
- real plan / goal names

### Raw Runtime Evidence

Unmodified or lightly formatted source details:

- `latestEvidenceSummary`
- attempt summary
- termination reason
- failure fingerprint
- next suggested step

These fields should never be used directly as the top-level human recommendation without translation.

## Runtime Translation Rules

The UI needs a small typed translation layer for known machine outcomes.

Example mappings:

- `session-inactive`
  - human title: `执行中断，等待恢复确认`
  - human summary: `关联的执行 session 失活，这一轮没有产出最终结果。`
  - suggested action: `先查看日志；确认机器稳定后再恢复执行。`
- `session-removed`
  - human title: `执行会话已结束`
  - human summary: `关联 session 已被移除，这一轮不能继续沿用原会话。`
  - suggested action: `确认 runner 正常后，重新启动这一轮。`
- `runner-offline`
  - human title: `执行节点离线`
  - human summary: `负责执行这轮任务的 runner 当前不可用。`
  - suggested action: `先恢复 runner，再决定是否重试。`

Unknown reasons:

- fall back to a generic interruption briefing
- still show raw evidence in the collapsed section

## Navigation

The decision detail panel must expose the existing deep links:

- open session log
- open raw trace

These should live inside or directly under `查看原始依据`, not require the user to return to the board first.

## Rendering Guidance

Reuse existing operator panel primitives where practical.

Preferred implementation shape:

- keep `ThreadConversation` as the lower conversation area
- expand `ThreadHeader` or add a sibling `DecisionBriefingCard`
- move current context refs and derived human explanation above the message transcript
- keep assistant-ui message rendering for transcript continuity

The first visible screen should already make sense before the user reads any chat bubble.

## Testing

Add tests for:

- live OMC thread titles do not reuse demo labels like `周报`
- session-inactive evidence is translated into Chinese operator briefing
- raw English evidence appears only in the collapsed evidence section
- action labels differ between product approvals and runtime interruptions
- session log / trace entry points are visible from the detail panel

## Risks

1. Mixed demo/live data paths

If live OMC data only partially overrides seeded prototype data, demo labels may still leak.

Mitigation:

- prefer explicit live-data detection
- once live data is present, do not fall back to scenario-specific copy for titles

2. Over-translation

If translation becomes too abstract, advanced users may lose confidence.

Mitigation:

- keep raw evidence one click away
- preserve exact technical reason in the evidence section

3. Action mismatch

If buttons still come from old approval templates, the briefing and actions will disagree.

Mitigation:

- derive action families from typed decision category
- test interruption and approval branches separately

## Acceptance Criteria

- a user with no prior OMC context can open one decision thread and explain:
  - what object it is about
  - what happened
  - why the system escalated
  - what each button would do
- live OMC runtime failures no longer appear as demo scenario decisions
- raw English runtime summaries no longer appear as the primary operator recommendation
- session log and raw trace remain accessible from the same right-side panel
