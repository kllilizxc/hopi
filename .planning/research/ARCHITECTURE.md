# Architecture Research: Conversation-Native, Self-Healing Project Actions

## Executive Summary

- Recommendation: add a thin project-action coordination layer on top of current task/session/message architecture; no platform rewrite.
- Merge-first v1: web creates typed action intent; hub persists run + injects a normal user prompt into the linked task session; agent executes `.hopi/merge.sh` with normal workspace tools; hub verifies repo state after the agent settles; web reflects result through SSE + query invalidation.
- Keep hub as orchestrator, verifier, and state owner. Keep agent as executor and repair loop owner. Keep CLI/tool layer as sandboxed capability surface. Keep repo scripts as project-owned workflow logic.
- Current repo already has most primitives: task/session linkage, prompt injection, localId correlation, workspace-scoped `bash`/`git`/file RPC handlers, merge-state verification, SSE fanout, and task workflow transitions.
- Main architecture shift: remove hidden backend merge logic from the primary happy path. Success path should become observable conversation + tool output, not detached RPC workflow.
- Confidence:
  - High: reuse of existing `SyncEngine`, `MessageService`, `EventPublisher`, `taskSessionService`, `projectScripts`, RPC handlers, SSE invalidation.
  - Medium: dedicated `task_action_runs` persistence + dedicated `task-action-updated` event.
  - Medium: optional later action-telemetry extraction from model-specific tool-call messages.

## System Overview

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                  Web / PWA                                  │
│  Merge button • action badge • session chat • task detail • query cache     │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ REST request + SSE updates
┌───────────────────────────────▼──────────────────────────────────────────────┐
│                                     Hub                                      │
│  route validation • action coordinator • message service • verifier         │
│  task/session stores • action-run store • workflow strategy • SSE publisher │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ Socket.IO message stream + RPC
┌───────────────────────────────▼──────────────────────────────────────────────┐
│                              CLI / Agent Session                             │
│  agent wrapper • rpc handler manager • permission handling • preview mgr    │
│  common handlers: bash, git, readFile, listDirectory, ripgrep, uploads      │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                │ native tool calls / stdout / stderr
┌───────────────────────────────▼──────────────────────────────────────────────┐
│                              Workspace Sandbox                               │
│  repo files • `.hopi/merge.sh` • git state • tests • package scripts        │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Typical Implementation |
|-----------|----------------|------------------------|
| Web action UI | Capture user intent, dedupe clicks, show state, keep conversation primary | `web/src/components/SessionChat.tsx`, generic mutation/query hooks, SSE-driven invalidation |
| Hub task-action route | Auth, schema validation, resolve task/session/worktree context, call coordinator | Extend `hub/src/web/routes/tasks.ts` or extract to `hub/src/web/routes/taskActions.ts` |
| Hub action coordinator | Persist action run, build prompt, send prompt, wait for quiescence, verify result, update task | New `hub/src/sync/projectActions/` package |
| Hub verifier layer | Decide success from repo state, not assistant prose | Reuse `git-merge-worktree-state`, `projectScripts`, later preview ready-marker checks |
| Hub stores | Durable action history + task fields for fast board queries | New `task_action_runs` table plus existing `tasks`, `messages`, `sessions` |
| Session/message core | Deliver prompts to agent, store all messages, fan out realtime events | Existing `MessageService`, `SessionCache`, `EventPublisher`, `SyncEngine` |
| CLI session bridge | Expose sandboxed capabilities; keep product-specific action policy out | Existing `apiSession`, `RpcHandlerManager`, common handlers |
| Tool/RPC layer | Execute workspace-scoped commands/files/git safely | Existing `bash`, `git-*`, `readFile`, `listDirectory`, `ripgrep` handlers |
| Repo-owned scripts | Express project-specific merge/init/preview logic | `.hopi/merge.sh`, `.hopi/init.sh`, `.hopi/preview.sh` |

## Recommended Project Structure

```
shared/
└── src/
    ├── projectActions.ts      # Action kinds, statuses, API payloads, SSE event types
    └── schemas.ts             # Zod schemas for action runs and requests

hub/
└── src/
    ├── store/
    │   ├── taskActionRunStore.ts   # SQLite read/write API for action runs
    │   └── types.ts                # StoredTaskActionRun type
    ├── sync/
    │   └── projectActions/
    │       ├── coordinator.ts      # Main orchestration entrypoint
    │       ├── definitions/
    │       │   ├── merge.ts        # Merge-specific prompt + verifier + completion logic
    │       │   ├── preview.ts      # Later milestone
    │       │   └── init.ts         # Later milestone
    │       ├── registry.ts         # Action definition lookup
    │       ├── prompts.ts          # Shared action envelope/prompt helpers
    │       ├── observe.ts          # Wait-for-quiescence, ready-event correlation, timeout logic
    │       └── types.ts            # Action runtime interfaces
    └── web/routes/
        └── taskActions.ts          # `POST /tasks/:taskId/actions/:kind`, query endpoints

web/
└── src/
    ├── hooks/mutations/
    │   └── useRunTaskAction.ts     # Generic action mutation hook
    ├── hooks/queries/
    │   └── useTaskActionRuns.ts    # Action run history / active run query
    ├── lib/
    │   └── taskActions.ts          # Labels, status formatting, button rules
    └── components/
        └── task-actions/
            ├── TaskActionBadge.tsx
            └── TaskActionPanel.tsx
```

### Structure Rationale

- **`shared/src/projectActions.ts`:** keep action contracts cross-package and versionable; same pattern as current shared session/task schemas.
- **`hub/src/sync/projectActions/`:** isolate orchestration from HTTP routes; routes stay thin, sync layer owns behavior.
- **`hub/src/store/taskActionRunStore.ts`:** durable history separate from `tasks` table; preserves fast task queries while enabling later preview/init reuse.
- **`web/src/hooks/...`:** match current TanStack Query organization; mutation/query split already established.
- **No required new CLI folder for v1:** current CLI already exposes the needed sandboxed RPC/tool surface. Optional later telemetry extraction can be additive.

## Build Order

### Phase 1: Extract merge orchestration into a reusable hub module

- Pull current merge prompt, wait, and verification logic out of `hub/src/web/routes/tasks.ts` into `hub/src/sync/projectActions/definitions/merge.ts`.
- Preserve current behavior first; goal = reduce route complexity and prove clean boundary.
- Confidence: high. Current merge route already contains prompt builder, assistant wait, and repo-state verifier.

### Phase 2: Add durable action-run schema + store

- Add `TaskActionKind`, `TaskActionStatus`, `TaskActionRun`, request/response schemas in `shared`.
- Add `task_action_runs` SQLite table. Append-only or mostly append-only preferred; easier audit trail, retries, later analytics.
- Keep task-level merge summary fields (`worktreeMergedAt`, `worktreeMergeCommit`) for fast board/status checks.
- Confidence: medium. Strong fit with current store architecture; new table adds one migration only.

### Phase 3: Switch Merge button to generic action intent API

- Replace merge-specific web mutation with generic `runTaskAction({ taskId, kind: 'merge' })`.
- Route should dedupe active runs per `(taskId, kind)` and reuse existing active task session when possible.
- If no session exists, prefer existing task-session startup path over detached worker session.
- Confidence: high for route/mutation change; medium for exact dedupe semantics.

### Phase 4: Make conversation the canonical live log

- On action request, hub sends a normal user message with stable `localId`/action metadata.
- Session chat remains the primary progress surface. Separate action badge/panel only summarizes run status, attempt count, last verifier result, blocker.
- Hub emits `task-action-updated` plus existing `task-updated` when outcome affects task state.
- Confidence: medium-high. Reuses current message + SSE primitives; requires one new event type.

### Phase 5: Converge preview and init onto the same coordinator

- `preview`: same intent flow, different verifier (`preview-start` readiness marker or preview status), different blocker semantics.
- `init`: same intent flow, verifier becomes script existence + focused execution sanity check.
- Do not build a giant generic DSL first; add only the common interfaces needed after merge proves out.
- Confidence: medium. Strong structural fit, but exact verifier details differ by action.

### Phase 6: Optional later action telemetry normalization

- If richer UI needed, add model-specific extraction layer for tool-call events, similar to existing `taskTools` registry.
- Use telemetry for timeline decoration only. Do not make correctness depend on parsing model-specific message shapes.
- Confidence: medium. Good fit with current extractor pattern; not required for merge-first outcome.

## Architectural Patterns

### Pattern 1: Action Intent + Run Journal

**What:** separate user intent and operational execution state from core `Task` record.
**When to use:** any project action that can span multiple messages, retries, or verification steps.
**Trade-offs:** one extra table + event type; better auditability, dedupe, later preview/init reuse.

**Example:**
```typescript
type TaskActionRun = {
    id: string
    taskId: string
    projectId: string
    kind: 'merge' | 'preview' | 'init'
    status: 'queued' | 'prompted' | 'waiting_for_agent' | 'verifying' | 'blocked' | 'succeeded' | 'failed' | 'canceled'
    sessionId: string | null
    latestPromptLocalId: string | null
    attempt: number
    summary: string | null
    lastError: string | null
    createdAt: number
    updatedAt: number
    finishedAt: number | null
}
```

### Pattern 2: Hub-Orchestrated Prompt Injection, Agent-Executed Work

**What:** hub converts button click into a normal conversation prompt; agent performs work through normal tools inside the workspace sandbox.
**When to use:** repo-specific workflows where `.hopi/*` scripts, git state, and local fixes vary per project.
**Trade-offs:** slower than hidden direct RPC; much better observability, self-healing, product feel, and project flexibility.

**Example:**
```typescript
await messageService.sendMessage(sessionId, {
    text: buildMergeActionPrompt(context),
    localId: `action:merge:${task.id}:${run.id}:attempt:${run.attempt}`,
    sentFrom: 'webapp'
})
```

### Pattern 3: State-Based Verification, Not Text-Based Success

**What:** hub decides completion from repo/preview state checks after the agent settles; assistant summary is useful but non-authoritative.
**When to use:** merge, preview, init, deployments, migrations, or any action where “done” has an observable external state.
**Trade-offs:** extra verifier RPC calls; much lower false-success risk across different agent flavors.

**Example:**
```typescript
const verification = await mergeDefinition.verify({
    sessionId,
    task,
    targetBranch
})

if (verification.status === 'succeeded') {
    await mergeDefinition.onSuccess({ task, verification })
}
```

### Pattern 4: Registry Before Framework

**What:** action definitions share a small interface; each action still owns its own prompt, verifier, and completion rules.
**When to use:** brownfield expansion from one action to two or three closely related actions.
**Trade-offs:** some duplication stays; avoids speculative generic workflow engine.

**Example:**
```typescript
type TaskActionDefinition = {
    kind: 'merge' | 'preview' | 'init'
    buildPrompt(context: ActionContext): string
    verify(context: ActionContext): Promise<ActionVerification>
    onSuccess?(context: ActionSuccessContext): Promise<void>
}
```

## Data Flow

### Request Flow

```
[User clicks Merge]
    ↓
[web mutation: runTaskAction]
    ↓ REST
[hub action route]
    ↓
[persist TaskActionRun: queued]
    ↓
[resolve active task session / start if needed]
    ↓
[MessageService.sendMessage(localId=action:merge:...)]
    ↓ Socket.IO
[CLI relays normal user message to agent]
    ↓
[agent decides tools]
    ↓
[bash/git/readFile/listDirectory tool calls in workspace sandbox]
    ↓ stdout/stderr back to agent
[agent edits/fixes/retries as needed]
    ↓ streamed messages/tool events
[hub stores messages + broadcasts SSE]
    ↓
[hub observes agent quiescence]
    ↓
[hub verifier checks merge state]
    ↓
[update TaskActionRun + Task fields]
    ↓ SSE invalidation
[web badge/task state refresh + conversation remains full log]
```

### State Management

```
[task_action_runs table]          [tasks table]             [messages table]
          ↓                           ↓                         ↓
[EventPublisher / SSEManager] ─────────────────────────────────────→ [useSSE]
          ↓                                                          ↓
[task-action-updated event]                                   [TanStack Query]
          ↓                                                          ↓
[TaskActionPanel / Badge]                                  [task detail / board / chat]
```

### Intent Movement Across Layers

1. **Web layer:** create typed intent only. No merge script logic, no git logic, no retries.
2. **Hub route layer:** authorize + resolve task/session/worktree context + dedupe active run.
3. **Hub action coordinator:** persist run, build action envelope, inject prompt, wait for idle, verify outcome, publish state.
4. **CLI/session layer:** relay prompt and expose tools. No HOPI-specific merge policy beyond sandbox enforcement and current RPC registration.
5. **Agent layer:** choose tool sequence, inspect failures, repair files/scripts, retry.
6. **Tool layer:** run actual commands/files/git inside workspace-scoped path security.
7. **Hub verifier:** check repo state after agent settles; update durable run/task state.
8. **Web layer:** show action status summary; show full operational detail in chat transcript already streamed from the agent.

### Key Data Flows

1. **Merge-first happy path:** click Merge → prompt injected → agent runs `.hopi/merge.sh` → repo state no longer mergeable → task marked merged.
2. **Self-heal path:** script fails → agent sees stderr → edits `.hopi/merge.sh` or repo files → re-runs tool call → verifier eventually passes or blocker captured.
3. **Later preview/init path:** same intent/run journal + different verifier; no new cross-layer control plane needed.

## Subsequent-Milestone Integration Notes

- **Keep current task/session model:** project actions should attach to tasks and their active sessions, not create a parallel “workflow engine.”
- **Keep workflow strategy ownership narrow:** `workflowStrategy` still governs task phase/status semantics; action runs track operational execution details.
- **Keep merge fields on `Task`:** board queries and merge badges stay fast; action table handles history and genericity.
- **Use verifier interfaces, not action-specific route branches:** preview and init should plug new definitions into the same coordinator.
- **Prefer one new shared event now:** `task-action-updated` avoids overloading `task-updated` with operational noise as more actions arrive.
- **Do not require action-specific CLI code for v1:** tool surface already exists. Revisit only if action timeline UX later needs better correlated telemetry.

## Scaling Considerations

| Scale | Architecture Adjustments |
|-------|--------------------------|
| 0-50 active sessions / hub | Current monolith + SQLite + SSE fine. Add `task_action_runs` table, indexed by `taskId`, `status`, `kind`. |
| 50-250 active sessions / hub | Optimize action observers: event-driven wakeups first, bounded polling second. Keep SSE invalidation targeted by `taskId` / `projectId`. |
| 250+ active sessions / hub | Consider moving hot transient action observation to in-memory coordinator or Redis-like bus; keep SQLite as source of truth. Only split if one hub becomes chat-fanout bound. |

### Scaling Priorities

1. **First bottleneck:** chat/event fanout and redundant query invalidation, not action persistence. Fix with narrow SSE events and targeted TanStack invalidation.
2. **Second bottleneck:** too many concurrent wait/verifier loops. Fix with event-triggered state transitions, per-session observer reuse, and strict timeouts.

## Anti-Patterns

### Anti-Pattern 1: Hidden Backend Fixer Workflow

**What people do:** button click triggers hub-side merge logic, conflict resolution, or repo edits outside the agent conversation.
**Why it's wrong:** breaks observability, hides stdout/stderr from the agent, hard-codes project behavior, fights local-first trust model.
**Do this instead:** hub injects intent; agent executes and repairs through normal tool calls; hub verifies only.

### Anti-Pattern 2: Success Equals “Assistant Said Done”

**What people do:** mark action successful from final assistant text alone.
**Why it's wrong:** model summaries differ by agent flavor and can be wrong, partial, or optimistic.
**Do this instead:** success from repo/preview state verifier; assistant summary stored as explanation only.

### Anti-Pattern 3: Giant Generic Action DSL Too Early

**What people do:** design a universal workflow engine before merge-first proves out.
**Why it's wrong:** slows delivery, hides real constraints, and adds abstractions before the second use case lands.
**Do this instead:** one coordinator + per-action definitions + tiny shared interfaces.

### Anti-Pattern 4: Model-Specific Tool Parsing as Core Correctness Path

**What people do:** depend on Claude/Codex/OpenCode tool-call transcript parsing to decide whether action worked.
**Why it's wrong:** message shapes differ by wrapper and evolve over time; brittle cross-agent coupling.
**Do this instead:** use tool parsing only for optional rich timeline UI; keep verifier state authoritative.

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Socket.IO | Hub↔CLI RPC + realtime message relay | Good fit for action dispatch + verifier RPC reuse; existing ack/timeout model already in place. |
| SSE | Hub→web realtime invalidation stream | Best for action-run/status fanout to many viewers; matches current `useSSE` architecture. |
| SQLite | Durable task/action/message/session state | Sufficient for merge-first and later preview/init; append-only action journal preferred. |
| Wrapped agent CLIs | Conversation + tool execution engine | Agent remains repo-specific planner/executor; HOPI should not replace this with fixed workflow code. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `web` ↔ `hub/web/routes` | REST mutation/query | Web owns intent only; hub owns orchestration. |
| `hub/web/routes` ↔ `hub/sync/projectActions` | Direct service call | Keep HTTP thin; action coordinator reusable by future triggers. |
| `hub/sync/projectActions` ↔ `hub/store` | Store APIs | Persist active run, attempt count, blocker/error, summary, timestamps. |
| `hub/sync/projectActions` ↔ `MessageService` | Direct method call | Prompt injection should reuse normal chat delivery path. |
| `hub/sync/projectActions` ↔ `SyncEngine`/`rpcGateway` | Existing RPC methods | Use for verification and task/session startup only; not hidden primary execution. |
| `hub/socket/handlers/cli` ↔ `messages/tasks` | Existing realtime message ingest | Conversation and optional telemetry already flow here. |
| `cli/apiSession` ↔ common handlers | RPC registration | Existing workspace-scoped tool surface sufficient for merge-first. |
| `taskAutomation` / `workflowStrategy` ↔ action coordinator | Realtime events + task updates | Keep task business state separate from action operational state. |

## Sources

- **Repo-grounded, high confidence**
  - `README.md`
  - `.planning/PROJECT.md`
  - `docs/guide/how-it-works.md`
  - `hub/src/web/routes/projects.ts`
  - `hub/src/web/routes/tasks.ts`
  - `hub/src/sync/taskSessionService.ts`
  - `hub/src/sync/projectScripts.ts`
  - `hub/src/sync/improvementsScan.ts`
  - `hub/src/sync/taskAutomation.ts`
  - `hub/src/sync/workflowStrategy.ts`
  - `hub/src/sync/messageService.ts`
  - `hub/src/socket/handlers/cli/sessionHandlers.ts`
  - `hub/src/sync/taskTools/README.md`
  - `hub/src/store/index.ts`
  - `shared/src/brand.ts`
  - `shared/src/messages.ts`
  - `shared/src/schemas.ts`
  - `shared/src/socket.ts`
  - `cli/src/api/apiSession.ts`
  - `cli/src/modules/common/registerCommonHandlers.ts`
  - `cli/src/modules/common/pathSecurity.ts`
  - `cli/src/modules/common/handlers/bash.ts`
  - `cli/src/modules/common/handlers/git.ts`
  - `web/src/components/SessionChat.tsx`
  - `web/src/hooks/useSSE.ts`
  - `web/src/hooks/mutations/useMergeTaskWorktree.ts`

- **Official/current references, used as supporting rationale**
  - OpenAI Agents SDK tools guide — model requests tools; app executes them: <https://openai.github.io/openai-agents-js/guides/tools/>
  - Socket.IO docs, emitting events / acknowledgements / timeouts: <https://socket.io/docs/v4/emitting-events/>
  - TanStack Query docs, query invalidation from mutations/external events: <https://tanstack.com/query/latest/docs/framework/react/guides/invalidations-from-mutations>

- **Inference notes**
  - Dedicated `task_action_runs` persistence, `task-action-updated` SSE event, and generic `projectActions` sync package are architectural recommendations inferred from current store/sync layering; not present in repo today.
  - Optional later action-telemetry normalization draws from the existing `taskTools` extractor-registry pattern; moderate confidence, deferred by design.

---
*Architecture research for: conversation-native, self-healing project actions in HOPI*
*Researched: 2026-03-07*
