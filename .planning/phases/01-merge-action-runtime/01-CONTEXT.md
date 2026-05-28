# Phase 1: Merge Action Runtime - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase makes Merge feel like part of the linked task conversation rather than a detached backend workflow. The scope is action entry, session handoff, in-thread kickoff shape, and durable user-visible runtime status for Merge.

This phase does **not** add Preview/Init parity, generic custom actions, or the full self-healing merge loop. It clarifies how Merge should enter and appear in the product so later phases can implement the actual inspect/fix/retry behavior on top of a stable runtime model.

</domain>

<decisions>
## Implementation Decisions

### Session Handoff
- If the user clicks Merge and there is no usable linked session, HOPI should auto-start one and continue Merge there.
- If the currently linked session is wrong, stale, or not merge-capable, HOPI should relink to the best usable session automatically.
- When multiple plausible sessions exist, prefer the task-linked session by default.
- If the best candidate session is stale but recoverable, resume it automatically rather than starting fresh.

### Kickoff Shape
- Merge should begin as a normal chat message in the task conversation, not as a special action card.
- The initial merge message should be a short action request with only the context needed to act.
- If HOPI had to auto-start, resume, or relink a session first, show one short note before continuing Merge.
- Special orchestration wording should be minimal; the flow should feel like ordinary agent work.

### Busy Behavior
- If the linked session is actively thinking, queue Merge instead of interrupting current work.
- If the session is waiting on an approval/request, keep Merge pending and continue automatically after that request is resolved.
- While queued, show a compact pending state rather than a noisy transcript flood.
- User should be able to stop/cancel Merge while it is queued or running.

### Status Surfacing
- Outside the transcript, keep Merge status compact and task-scoped rather than creating a large dedicated action panel.
- While Merge is running, detailed progress should look like normal CLI/tool-call output inside the conversation messages.
- After success, leave a short persistent summary in product UI; the full story lives in the thread/tool calls.
- If Merge stops on a real blocker, persistent status should emphasize the exact next manual step.

### Claude's Discretion
- Exact wording for the short merge kickoff message.
- Exact labels for compact task status states, as long as they stay concise and consistent with normal agent flow.
- Exact UI placement for the compact status, as long as it remains task-scoped and subordinate to the transcript.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `web/src/components/SessionChat.tsx` — current Merge button, ephemeral merge event rendering, and task-chat action row logic already provide the main UX seam.
- `web/src/hooks/queries/useTaskWorktreeMergeState.ts` — existing merge-state query shape can seed Phase 1 runtime status behavior.
- `web/src/hooks/mutations/useMergeTaskWorktree.ts` — existing mutation and optimistic task patching provide a reusable client-side entry path.
- `hub/src/web/routes/tasks.ts` — `GET /tasks/:taskId/worktree/merge-state`, `POST /tasks/:taskId/worktree/merge`, `computeMergeGitState`, `persistSuccessfulTaskMerge`, existing merge-script prompt path, and assistant-completion waiting logic are strong brownfield anchors.
- `hub/src/sync/sessionTaskLink.ts` — existing session metadata backlink helper is the main reusable relink primitive.
- `hub/src/store/types.ts` and `hub/src/store/tasks.ts` — durable task fields already exist for `activeSessionId`, workflow state, and merge-result markers.

### Established Patterns
- Merge is currently triggered from the task chat surface and reflected with TanStack Query + SSE updates.
- Merge availability is guarded by active task session, worktree metadata, and session-not-busy checks.
- Detailed merge feedback is currently ephemeral in UI-local `mergeEvents`, not durable conversation history.
- Task/session linkage is dual-source today: task row + session metadata backlink. Resume flows usually repair the link, but patch-based updates can drift.
- There is currently no separate durable action-run entity for Merge; persistence lives mostly on the task row.

### Integration Points
- Web entry: `SessionChat` merge click path and compact task/chat status surface.
- Hub orchestration: merge-state and merge execution routes in `hub/src/web/routes/tasks.ts`.
- Session handoff/relink: task `activeSessionId`, `setSessionTaskLink`, and resume/reattach behavior.
- Realtime continuity: existing task updates over SSE and query invalidation paths.
- Existing conversation bridge: merge-script and conflict prompts already inject messages into the active session; this is the nearest existing path toward conversation-native Merge.

</code_context>

<specifics>
## Specific Ideas

- “When I clicked merge, it's like the agent automatically chose a cli tool, and run the scripts, and it will know if it failed.”
- “The same as calling a cli tool, show cli results in a message.”
- Merge should feel like normal agent flow, not a detached system workflow.

</specifics>

<deferred>
## Deferred Ideas

- Apply the same conversation-native runtime model to Preview after merge-first flow is trusted.
- Apply the same conversation-native runtime model to Init after merge-first flow is trusted.
- Generalize the model into a broader custom project action framework in a later phase.

</deferred>

---
*Phase: 01-merge-action-runtime*
*Context gathered: 2026-03-07*
