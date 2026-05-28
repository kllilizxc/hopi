# Phase 1: Merge Action Runtime - Research

**Researched:** 2026-03-07
**Domain:** Brownfield conversation-native merge action runtime across web, hub, and task-linked agent sessions
**Confidence:** HIGH for repo-grounded architecture and sequencing; MEDIUM for exact naming of new runtime concepts before implementation starts

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- If the user clicks Merge and there is no usable linked session, HOPI should auto-start one and continue Merge there.
- If the currently linked session is wrong, stale, or not merge-capable, HOPI should relink to the best usable session automatically.
- When multiple plausible sessions exist, prefer the task-linked session by default.
- If the best candidate session is stale but recoverable, resume it automatically rather than starting fresh.
- Merge should begin as a normal chat message in the task conversation, not as a special action card.
- The initial merge message should be a short action request with only the context needed to act.
- If HOPI had to auto-start, resume, or relink a session first, show one short note before continuing Merge.
- Special orchestration wording should be minimal; the flow should feel like ordinary agent work.
- If the linked session is actively thinking, queue Merge instead of interrupting current work.
- If the session is waiting on an approval/request, keep Merge pending and continue automatically after that request is resolved.
- While queued, show a compact pending state rather than a noisy transcript flood.
- User should be able to stop/cancel Merge while it is queued or running.
- Outside the transcript, keep Merge status compact and task-scoped rather than creating a large dedicated action panel.
- While Merge is running, detailed progress should look like normal CLI/tool-call output inside the conversation messages.
- After success, leave a short persistent summary in product UI; the full story lives in the thread/tool calls.
- If Merge stops on a real blocker, persistent status should emphasize the exact next manual step.

### Claude's Discretion
- Exact wording for the short merge kickoff message.
- Exact labels for compact task status states, as long as they stay concise and consistent with normal agent flow.
- Exact UI placement for the compact status, as long as it remains task-scoped and subordinate to the transcript.

### Deferred Ideas (OUT OF SCOPE)
- Apply the same conversation-native runtime model to Preview after merge-first flow is trusted.
- Apply the same conversation-native runtime model to Init after merge-first flow is trusted.
- Generalize the model into a broader custom project action framework in a later phase.
</user_constraints>

<research_summary>
## Summary

The brownfield-friendly path is to **not** invent a generic action framework yet. Phase 1 should introduce just enough runtime structure to make Merge enter the existing task conversation predictably and durably, while reusing today’s strongest seams: task-linked sessions, `setSessionTaskLink`, merge-state preflight, SSE-driven task refresh, and existing “send a message into the session” helpers already used for merge/preview automation.

The most important repo fact is that execution truth is currently split. The UI exposes Merge as a button in `SessionChat`, but the user-visible runtime state is mostly ephemeral (`mergeEvents`), while the server still owns several hidden branches of behavior in `hub/src/web/routes/tasks.ts`. Phase 1 should therefore focus on **runtime unification at the intent/state layer**, not on full repair/retry logic. In other words: decide how Merge is started, where it lives, what state is durable, how session relink/queueing works, and how the conversation gets the kickoff message.

**Primary recommendation:** add a thin, merge-specific durable runtime model in hub/web first, reuse the existing linked-task session path, and make the conversation kickoff/message flow the canonical visible entrypoint. Leave the heavy self-healing loop and repo-truth verification hardening to later phases already defined in the roadmap.
</research_summary>

<standard_stack>
## Standard Stack

The established libraries/tools for this domain:

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Bun + TypeScript workspaces | repo baseline | Shared runtime and type-safe contracts across hub/cli/web | Already the repo’s operating model; Phase 1 is an integration phase, not a stack migration |
| Hono routes + SyncEngine + SQLite-backed store | repo baseline | Durable merge runtime state, routing, and fanout | Existing hub architecture already owns task/session truth and SSE distribution |
| TanStack Query + SSE invalidation | repo baseline | Durable UI refresh after action state changes | Existing task/merge-state surfaces already use this pattern |
| Socket.IO task/session channel | repo baseline | Session access, agent-state awareness, and action delivery | Existing session RPC and message flow already run through this channel |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Zod schemas in `shared/src/schemas.ts` | repo baseline | New merge runtime request/response/state contracts | Use for any new durable action-state vocabulary or route payloads |
| Existing task store fields (`workflowProfile`, `workflowPhase`, `activeSessionId`) | repo baseline | Phase-1-compatible persistence anchor | Use first before introducing any broader custom action registry |
| Existing SSE/query invalidation hooks | repo baseline | Replay durable status across reconnects | Use for compact task status and merge state refresh |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Reusing task/session state first | Build a brand-new generic action-run table immediately | More future-proof, but overbuild risk for merge-first v1 |
| Merge-specific runtime vocabulary | Generic custom-action framework now | Attractive long-term, but explicitly out of scope for this phase |
| Conversation kickoff via normal message injection | Dedicated merge modal/panel | Cleaner isolation, but violates the normal-agent-flow product goal |

**Installation:**
```bash
# No new framework required for planning assumptions in Phase 1
# Keep to existing repo stack unless plan finds a targeted need
```
</standard_stack>

<architecture_patterns>
## Architecture Patterns

### Recommended Project Structure
```text
web/src/components/SessionChat.tsx        # merge entry + task chat affordances
web/src/hooks/queries/*                   # compact durable runtime status query
web/src/hooks/mutations/*                 # merge start/cancel/relink mutation path
hub/src/web/routes/tasks.ts               # merge runtime route / durable state transitions
hub/src/sync/sessionTaskLink.ts           # relink session metadata to task
hub/src/store/tasks.ts                    # persist task-side merge runtime fields or patches
shared/src/*                              # any new typed state vocabulary if needed
```

### Pattern 1: Task-anchored runtime, session-anchored execution
**What:** Persist the durable runtime state against the task (or task-adjacent structure), but always deliver execution into the linked task session.
**When to use:** When the user experience must survive reloads/reconnects, but actual work must still happen in the agent conversation.
**Repo evidence:** `task.activeSessionId` already persists the linked session; `setSessionTaskLink()` updates the session metadata backlink; `SessionChat` already owns the Merge surface.

### Pattern 2: Queue, relink, then inject
**What:** Before any merge kickoff message is injected, resolve the best usable session: current linked session if valid, recovered stale session if resumable, best usable candidate if link drifted, or auto-start a new one.
**When to use:** When the action must feel continuous, but session reality may be stale or busy.
**Repo evidence:** Merge state guards already check for active session, worktree metadata, and busy state; resume flows already rewire task links in `sessionCache` and task chat routes.

### Pattern 3: Compact durable status outside, rich transcript inside
**What:** Keep a small task-scoped action badge/state outside the transcript, but surface real running detail as ordinary message/tool-call output in the conversation.
**When to use:** When the product promise is “normal agent flow,” not “special workflow console.”
**Repo evidence:** Current `mergeEvents` are UI-local and ephemeral; SSE/query invalidation already supports durable task refresh; the existing merge-script prompt path already injects user-visible session messages.

### Anti-Patterns to Avoid
- **Ephemeral-only runtime state:** current `mergeEvents` vanish on refresh and cannot support queue/replay semantics.
- **Silent relink or fallback mutations with no thread visibility:** this recreates the detached-backend feel the phase is trying to remove.
- **Solving Phase 2 in Phase 1:** do not plan full inspect/fix/retry mechanics here; Phase 1 should stop at runtime entry/state/visibility.
</architecture_patterns>

<dont_hand_roll>
## Don't Hand-Roll

Problems that look simple but have existing solutions:

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Session-task association | Brand new relationship model | `task.activeSessionId` + `setSessionTaskLink()` + existing resume relink flow | Brownfield-safe and already integrated with UI/task views |
| Action refresh after state changes | Custom websocket/event layer for merge only | Existing SSE invalidation + query refresh patterns | Already used for task-updated and merge-state refresh |
| Merge readiness detection | Hand-built frontend heuristics only | Existing `computeMergeGitState` / `GET /worktree/merge-state` preflight | Server already has the authoritative guard logic |
| Conversation entrypoint | New chat subsystem for action messages | Existing `engine.sendMessage(... sentFrom: 'webapp')` pattern | Already used for merge/preview automation prompts |

**Key insight:** Phase 1 succeeds by formalizing and combining existing repo seams, not by adding a parallel subsystem.
</dont_hand_roll>

<common_pitfalls>
## Common Pitfalls

### Pitfall 1: Phase 1 turns into a hidden refactor of merge execution
**What goes wrong:** Planning drifts into built-in merge logic, script repair semantics, conflict resolution, or final verification rules that belong to later phases.
**Why it happens:** The current code has all of that logic mixed together in one route, making it tempting to “fix everything at once.”
**How to avoid:** Plan only the entry/runtime/state layer here. Explicitly defer inspect/fix/retry and false-success prevention to Phases 2 and 3.
**Warning signs:** Plan tasks mention editing `.hopi/merge.sh`, merge conflict resolution, or repo-truth verification as core deliverables.

### Pitfall 2: Durable runtime state remains UI-local
**What goes wrong:** Merge still appears conversational in one browser tab, but queued/running state disappears on reload or remote handoff.
**Why it happens:** Existing merge feedback already lives in `mergeEvents` in `SessionChat`.
**How to avoid:** Persist a compact runtime status in hub-backed state and replay it through normal task/session refresh paths.
**Warning signs:** Any planned solution depends on component-local state for queued/running/relinked messaging.

### Pitfall 3: Session relink rules remain ambiguous
**What goes wrong:** Merge starts in the wrong thread, duplicates sessions, or silently fails because the task link drifted.
**Why it happens:** The repo currently has dual-source linkage and a patch path that can update the task row without updating session metadata backlink.
**How to avoid:** Plan an explicit “best usable session” resolution step and relink rule before injection.
**Warning signs:** Multiple different routes/hooks decide session handoff independently.

### Pitfall 4: Busy-state behavior conflicts with normal agent flow
**What goes wrong:** Merge interrupts current work unexpectedly, or gets blocked forever with no durable queued state.
**Why it happens:** Current guards mostly say “busy or not,” not “what should happen next.”
**How to avoid:** Separate `queued`, `waiting_for_approval`, `ready_to_inject`, `running`, `blocked`, `succeeded`, and `canceled` semantics at the product level.
**Warning signs:** Planned UI only shows disabled buttons/spinners instead of explicit pending/waiting states.
</common_pitfalls>

<code_examples>
## Code Examples

Repo-grounded patterns to follow:

### Session backlink update
```ts
setSessionTaskLink({
    store,
    engine,
    sessionId,
    namespace,
    projectId,
    taskId,
    name
})
```
Source: `hub/src/sync/sessionTaskLink.ts`

### Existing merge readiness query seam
```ts
const { state: mergeState } = useTaskWorktreeMergeState(api, taskId, { enabled })
```
Source: `web/src/hooks/queries/useTaskWorktreeMergeState.ts`

### Existing conversation injection seam
```ts
await options.engine.sendMessage(options.sessionId, {
    text: prompt,
    localId,
    sentFrom: 'webapp'
})
```
Source: `hub/src/web/routes/tasks.ts` in merge/preview automation helpers
</code_examples>

<sota_updates>
## State of the Art (2024-2025)

Within this repo/domain, the modern product expectation is not a separate workflow UI but a conversation-native action model where the agent remains the visible executor. For this phase, the relevant “current approach” is less about external library churn and more about aligning task actions with ordinary tool-call/chat semantics.

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Detached button-triggered backend workflow | Conversation-native action in the same task thread | Preserves trust and continuity |
| Ephemeral local progress chips | Durable, replayable task/action state | Supports remote control and reconnects |
| Busy = disabled button only | Busy = explicit queue/wait lifecycle | Makes action behavior understandable |

**New patterns to consider:**
- Task-scoped action status vocabulary that is smaller than a full workflow engine
- Merge-specific durable runtime first, generalization later

**Deprecated/outdated for this phase:**
- Treating `mergeEvents` as the primary runtime truth
- Adding special action UIs that bypass normal chat/tool semantics
</sota_updates>

<open_questions>
## Open Questions

1. **Where should the new durable runtime state live first?**
   - What we know: task row already persists merge result markers and linked session identity.
   - What's unclear: whether Phase 1 should extend task fields/status only or add a small adjacent runtime structure.
   - Recommendation: plan for the smallest durable shape that supports queue/replay/cancel semantics without committing to a generic action framework.

2. **How should queued merge appear in the thread before execution starts?**
   - What we know: user wants normal chat messages/tool-call output, but also wants compact pending state outside chat.
   - What's unclear: whether the queued state should inject a placeholder message immediately or wait until the action is actually ready to run.
   - Recommendation: planner should choose one consistent pattern and make it durable across refresh/reconnect.

3. **How should cancel semantics interact with the existing POST /worktree/merge path?**
   - What we know: user wants stop/cancel always available while queued or running.
   - What's unclear: whether Phase 1 only needs UI/runtime cancellation or also a new backend cancellation primitive.
   - Recommendation: plan explicit cancellation semantics as part of runtime modeling, even if actual interrupt behavior stays minimal in Phase 1.
</open_questions>

## Validation Architecture

Phase 1 should validate product-runtime behavior, not merge correctness itself.

### What needs verification
- Merge trigger starts in the correct task/session context.
- Missing/wrong/stale session cases resolve according to the chosen handoff rules.
- Busy sessions produce durable queued/waiting state instead of silent no-ops.
- Refresh/reconnect preserves merge runtime status.
- Conversation kickoff appears as normal chat/message flow, not only ephemeral local UI state.

### Best validation layers
- Hub route/unit tests for handoff resolution, busy-state transitions, and durable state updates.
- Web component/hook tests for merge action visibility, compact status surfacing, and replay after state changes.
- Narrow integration tests around task/session relink and SSE-driven refresh behavior.

### Avoid in this phase
- End-to-end testing of full script repair/retry loops.
- Deep git-merge correctness testing beyond existing merge-state guards.
- Preview/init coverage; out of scope.

<sources>
## Sources

### Primary (HIGH confidence)
- `/Users/realizer/Code/hopi/.planning/phases/01-merge-action-runtime/01-CONTEXT.md`
- `/Users/realizer/Code/hopi/.planning/ROADMAP.md`
- `/Users/realizer/Code/hopi/.planning/REQUIREMENTS.md`
- `/Users/realizer/Code/hopi/.planning/STATE.md`
- `/Users/realizer/Code/hopi/hub/src/web/routes/tasks.ts`
- `/Users/realizer/Code/hopi/hub/src/sync/sessionTaskLink.ts`
- `/Users/realizer/Code/hopi/hub/src/store/tasks.ts`
- `/Users/realizer/Code/hopi/hub/src/store/types.ts`
- `/Users/realizer/Code/hopi/web/src/components/SessionChat.tsx`
- `/Users/realizer/Code/hopi/web/src/hooks/queries/useTaskWorktreeMergeState.ts`
- `/Users/realizer/Code/hopi/web/src/hooks/mutations/useMergeTaskWorktree.ts`
- `/Users/realizer/Code/hopi/web/src/hooks/useSSE.ts`
- `/Users/realizer/Code/hopi/hub/src/sync/sessionCache.ts`
- `/Users/realizer/Code/hopi/web/src/routes/projects/task-session-chat.tsx`
- `/Users/realizer/Code/hopi/CLAUDE.md`

### Secondary (MEDIUM confidence)
- No external browsing used; brownfield recommendations inferred from repo patterns and locked user decisions.

### Tertiary (LOW confidence - needs validation)
- None for planning-critical claims.
</sources>

<metadata>
## Metadata

**Research scope:**
- Core technology: merge action entry/runtime state across web, hub, and task-linked sessions
- Ecosystem: existing repo task/session/SSE/query/message seams
- Patterns: relink/handoff, queueing, conversation kickoff, durable compact status
- Pitfalls: scope bleed, ephemeral runtime state, ambiguous handoff, weak busy-state semantics

**Confidence breakdown:**
- Standard stack: HIGH - existing repo stack already fits the phase
- Architecture: HIGH - strong brownfield seams already exist
- Pitfalls: HIGH - directly visible in current code shape
- Code examples: HIGH - all examples from repo code

**Research date:** 2026-03-07
**Valid until:** 2026-04-06
</metadata>

---
*Phase: 01-merge-action-runtime*
*Research completed: 2026-03-07*
*Ready for planning: yes*
