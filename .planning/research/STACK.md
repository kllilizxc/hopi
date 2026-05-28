# Stack Research

**Domain:** Conversation-native project actions for a brownfield local-first AI coding agent control platform
**Researched:** 2026-03-07
**Confidence:** HIGH for brownfield fit; MEDIUM for future observability package rollout details

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Bun runtime + workspaces | 1.3.5 baseline, stay on 1.3.x for this milestone | Single runtime for hub/cli/shared; subprocess, PTY, SQLite, build/test tooling | Already repo baseline. Best brownfield move. Avoids split-brain Node sidecars. `Bun.spawn()` gives streamed IO, timeout, `AbortSignal`, PTY, and resource usage — all useful for action attempts. |
| TypeScript (strict) | 5.9.x | Shared action contracts across hub, cli, web | Merge-first action flow crosses process boundaries and UI state. Strict discriminated unions + exhaustive reducers matter more than framework churn here. |
| Hono + Socket.IO + `@socket.io/bun-engine` | 4.11.2 / 4.8.3 / 0.1.0 | Hub REST/SSE surface plus low-latency session/machine RPC | Existing transport already fits. Keep one control plane. Use Socket.IO acknowledgements/timeouts for action dispatch; use recovery/replay for reconnect gaps. No new queue broker yet. |
| `bun:sqlite` | built into Bun 1.3.x | Durable local-first persistence for action runs, attempts, observations, replay cursors | Strong fit for single-hub local-first architecture. Transactional. No extra infra. Good place for durable run state while transcript stays human-facing. |
| Zod + `@hopi/protocol` | 4.2.1 / workspace | Runtime validation for action intents, attempt results, observation payloads | Prevents hidden format drift between hub, cli, web. Brownfield-safe extension point. Put new action schemas in shared, not route-local ad hoc objects. |
| OpenTelemetry JS | 2.x stable packages, 0.200.x where package still experimental | Trace/metric backbone for action-run observability | Best standards-based choice for multi-step action debugging. Correlates hub orchestration, CLI execution, RPC latency, and user-visible retries without vendor lock-in. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@opentelemetry/api` | 1.x | Span API, context propagation, trace IDs in hub + cli | Use immediately when introducing `runId`/`attemptId` correlation. Lightweight enough for both hub and CLI entrypoints. |
| `@opentelemetry/sdk-node` + OTLP exporter packages | Match current OTel JS release train | SDK bootstrap and export to local Collector / vendor backend | Use once action runs need cross-process traces beyond console logs. Initialize before loading hub app modules. |
| `@opentelemetry/semantic-conventions` | Match current OTel JS release train | Consistent attribute names for process, exec, git, network metadata | Use for action attributes like `service.name`, `process.pid`, plus HOPI-specific custom attrs (`hopi.action.kind`, `hopi.run.id`). |
| `@modelcontextprotocol/sdk` | 1.25.1 | Future-proof adapter boundary for tool-like action executors | Use if project actions later become internal MCP-style tools or need to expose the same action executor to multiple agent backends. Not required for merge-first v1, but compatible. |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `bun run test` + `vitest`/`bun test` | State-machine tests, transcript/result reducers, retry/idempotency tests | Add focused tests around action orchestration and result normalization. Keep fixture-heavy failure cases. |
| OpenTelemetry Collector | Local trace sink during rollout | Run locally first. Export spans over OTLP HTTP. Useful before choosing any hosted backend. |
| Socket.IO Admin UI | Inspect real-time event flow during reconnect/timeout debugging | Helpful once action status depends on ack/recovery behavior. Optional, not part of product runtime. |

## Prescriptive Stack Choices

### Orchestration pattern

- Keep orchestration in hub process; no Temporal/BullMQ/Redis workflow engine for merge-first v1.
- Add durable hub module, e.g. `hub/src/actions/`, backed by SQLite tables:
  - `action_runs` — one user intent, e.g. merge task worktree.
  - `action_attempts` — each execution/retry.
  - `action_observations` — normalized outputs/events/artifacts.
- State machine: `queued -> dispatching -> awaiting_tool -> running -> blocked -> retrying -> succeeded|failed|canceled`.
- Store idempotency key per action target, e.g. `merge:${taskId}:${sourceBranch}:${targetBranch}`.
- Treat transcript as one observation channel, not the source of truth for run state.

### Script/runtime boundaries

- Hub owns intent, persistence, retry policy, UI-facing state.
- CLI/session owns execution inside the workspace.
- Agent owns adaptive recovery loop when the action is conversation-native.
- Project repo owns merge semantics via `.hopi/merge.sh` or successor script/tool path.
- Do **not** run merge logic in the hub process itself.
- Do **not** make hidden backend merge fallbacks the primary path. They break the product goal.

### Tool-execution abstractions

- Introduce one typed executor interface. Suggested shape:
  - `prepare(run)`
  - `startAttempt(run, executor)`
  - `streamObservation(...)`
  - `completeAttempt(...)`
  - `classifyFailure(...)`
- Support three executor kinds from day one:
  - `agent-tool-call` — primary path; hub prompts the active session to run the action via normal tool semantics.
  - `rpc-command` — typed CLI RPC for diagnostics/capability checks only.
  - `rpc-git` — existing structured git helpers for merge-state checks and last-resort validation.
- First merge attempt: `agent-tool-call`, not `runBash()`.
- Keep `runBash()` only for cheap presence checks / diagnostics until replaced.
- Replace generic `exec`-based command paths with streamed `Bun.spawn([...])` wrappers where HOPI itself launches commands.

### Observability of action runs

- Every run: stable `runId`, `attemptId`, `sessionId`, `taskId`, `projectId`.
- Copy those IDs into:
  - SQLite rows
  - transcript `localId`/metadata
  - structured logs
  - OpenTelemetry span attributes
  - artifact directory names
- Minimum spans/metrics:
  - `action.run`
  - `action.dispatch`
  - `action.attempt`
  - `action.tool_call.wait`
  - `action.result.normalize`
  - `rpc.bash` / `rpc.git_merge_state` / `rpc.git_merge`
- Capture per-attempt counters: retry count, wall time, stdout bytes, stderr bytes, exit code, timeout, sandbox denial, user cancel.
- Keep full stdout/stderr as artifacts when large; keep summaries/tails in DB rows for fast UI.

### Action result handling

- Normalize result separately from transcript. Suggested result envelope:
  - status
  - summary
  - exitCode
  - retryable (`yes`/`no`/`needs_human`)
  - blockerKind (`conflict`, `auth`, `sandbox`, `missing_script`, `unknown`)
  - artifact refs
  - repo delta (`mergeable`, `dirty`, `commitHash`, `diffSnapshot`)
- Transcript remains user-readable.
- Normalized envelope powers badges, retries, notifications, and future automation.
- Record both raw observation and normalized classification. Needed for debugging misclassification.
- Merge success should always be validated by repo state after the attempt, not only by assistant text.

### Safe sandboxed execution

- Workspace sandbox must be enforced in CLI, close to process launch.
- Existing `strictWorkspaceWrites` wrapper is the right authority boundary. Extend it to all action command paths.
- Prefer OS-level sandbox (`sandbox-exec` / `bwrap`) plus sandbox-local HOME/TMP/CODEX_HOME.
- Path validation alone is insufficient for action commands. Current `bash` RPC validates `cwd`, but the shell command can still attempt writes outside the workspace.
- Prefer argv-based execution (`Bun.spawn([cmd, ...args])`) for trusted HOPI-launched commands.
- Use shell execution only when the command itself is shell syntax or project-authored script dispatch. Still sandboxed. Still explicit env allowlist.
- Put run artifacts under workspace-owned path like `.hopi/runs/<runId>/`; easy cleanup, easy audit.

## Installation

```bash
# Baseline check — keep current brownfield runtime
bun --version

# Add action-run observability in hub
bun add --cwd hub @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/semantic-conventions @opentelemetry/exporter-trace-otlp-http

# Add trace context helpers in cli
bun add --cwd cli @opentelemetry/api @opentelemetry/semantic-conventions

# Verify no contract drift
bun run typecheck
bun run test
```

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Hub-native SQLite action state machine | Temporal / Trigger.dev / BullMQ + Redis | Only if HOPI later needs multi-machine durable workflows, external callbacks, calendar timers, or distributed workers beyond the current local-first single-hub model. |
| `Bun.spawn([...])` + streamed artifacts | `child_process.exec` or opaque shell strings | Use shell only for real shell syntax or user-authored project scripts. Avoid `exec` for new action paths; weak streaming, shell parsing, buffer limits. |
| Conversation-native `agent-tool-call` execution | Hidden backend workflow that runs merge and posts final status | Only for emergency admin operations with no active session. Not for the product-default merge UX. |
| OTel traces + normalized DB rows | Console logs only | Only for short-lived experiments. Not enough once retries, reconnects, and partial failures matter. |
| Existing Socket.IO + SSE control plane | Kafka / Redis Streams / NATS | Only if hub becomes horizontally scaled and action events need cross-node fan-out. Premature for this milestone. |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| New workflow engine for merge-first v1 | Extra infra, duplicate durability model, poor fit for local-first single-hub deployment | Hub-native SQLite-backed run/attempt state machine |
| Hidden backend-only merge fallback as the primary path | Agent cannot see stdout/stderr, cannot self-correct, UX feels detached from normal work | Conversation-native action prompt + visible tool-call/result loop |
| Extending generic `bash` RPC built on `child_process.exec` | Shell parsing, buffer-limit risk, poor streaming, weak sandbox guarantees | Typed executor backed by `Bun.spawn` or explicit sandboxed script runner |
| Storing full raw logs inline in one SQLite row | DB bloat, slow queries, bad replay ergonomics | DB summary + artifact files under `.hopi/runs/` |
| Browser-only action state | Loses truth on reconnect, tab close, SSE gap, or Telegram handoff | Durable run state in hub DB with replay to web/Telegram |

## Stack Patterns by Variant

**If project already has `.hopi/merge.sh`:**
- Use conversation-native `agent-tool-call` to run that script first.
- Because repo-specific merge semantics belong in-repo, not in hub code.

**If `.hopi/merge.sh` is missing or broken:**
- Use same run to ask agent to create/fix the script, inspect git state, then retry.
- Because requirement is adaptive recovery inside the normal conversation loop.

**If HOPI itself launches a deterministic helper command:**
- Use `Bun.spawn([...])`, streamed stdout/stderr, timeout, `AbortSignal`, resource usage capture.
- Because argv-based execution reduces injection surface and improves observability.

**If execution genuinely requires shell syntax or package-manager resolution:**
- Use a single sandboxed shell wrapper with escaped values and explicit env contract.
- Because project-authored scripts often need shell features, but sandbox still must hold.

**If session disconnects or web client reloads mid-run:**
- Recover from SQLite-backed run state; replay observations over Socket.IO/SSE.
- Because action truth cannot live only in memory or only in chat.

**If output is too large/noisy for the transcript:**
- Persist full artifacts to `.hopi/runs/<runId>/`, attach summary + tail to transcript, keep normalized result in DB.
- Because humans need concise chat context while debuggers need full raw output.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| `bun@1.3.5+` | `bun-types@^1.3.5` | Keep Bun runtime and bun-types aligned. Current repo baseline. Validate PTY/sandbox behavior before any 1.4 jump. |
| `socket.io@4.8.3` | `socket.io-client@4.8.3` | Keep same minor. Ack timeouts need `>=4.4.0`; connection-state recovery needs `>=4.6.0`. Current repo already above both floors. |
| `hono@4.11.2` | Bun-targeted hub build | No reason to add separate Node HTTP layer for this feature. Keep hub transport simple. |
| `@opentelemetry/api@1.x` | OTel JS 2.x SDK family | Initialize SDK before app modules. Verify Bun ESM bootstrap path during rollout. |
| `TypeScript@5.9.x` | OpenTelemetry JS 2.x requirements | OTel JS 2.0 raised minimum TS to 5.0.4; current repo clears that floor. |
| `bun:sqlite` in Bun 1.3.x | existing hub store pattern | Good for transactional action metadata. Keep large artifacts off-row. |

## Sources

- Repo files — `README.md`, `.planning/PROJECT.md`, `.planning/codebase/STACK.md`, `hub/src/web/routes/tasks.ts`, `hub/src/sync/taskSessionService.ts`, `hub/src/sync/syncEngine.ts`, `cli/src/modules/common/handlers/bash.ts`, `cli/src/modules/common/handlers/git.ts`, `cli/src/sandbox/strictWorkspaceWrites.ts`, `cli/src/agent/messageConverter.ts`, `web/src/chat/normalizeAgent.ts` — current implementation grounding; HIGH confidence
- https://bun.sh/docs/runtime/child-process — verified `Bun.spawn()` array argv, streamed IO, PTY support, timeout/abort, resource usage
- https://bun.sh/docs/runtime/shell — verified Bun Shell escaping/safety model for shell interpolation
- https://bun.sh/docs/runtime/sqlite — verified built-in `bun:sqlite` driver and transactional fit
- https://socket.io/docs/v4/emitting-events/ — verified acknowledgements and per-emit timeout support
- https://socket.io/docs/v4/connection-state-recovery/ — verified reconnect recovery behavior and version floor (`>=4.6.0`)
- https://opentelemetry.io/blog/2025/otel-js-sdk-2-0/ — verified JS SDK 2.x release train and Node/TypeScript floor changes
- https://opentelemetry.io/docs/languages/js/instrumentation/ — verified Node SDK initialization ordering, tracer acquisition, and manual span patterns

---
*Stack research for: conversation-native project actions / merge-first brownfield iteration*
*Researched: 2026-03-07*
