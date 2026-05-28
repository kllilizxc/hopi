# Architecture

**Analysis Date:** 2026-03-29

## Pattern Overview

**Overall:** Modular monolith with three live surfaces: CLI agent host, hub server, and web PWA.

**Key Characteristics:**
- `cli` wraps external agent CLIs and runs a local background runner.
- `hub` owns durable state, auth, realtime fan-out, and optional Telegram/tunnel integration.
- `web` is a thin TanStack Router client over hub REST, SSE, and Socket.IO.
- `shared` is the protocol boundary for schemas, types, and cross-package contracts.

## Boundaries

**CLI surface:**
- Purpose: launch and control Claude, Codex, Gemini, and OpenCode sessions.
- Boundary: no persistence responsibility beyond local runner state and auth settings.
- Main entry: `cli/src/index.ts` -> `cli/src/commands/runCli.ts`.

**Hub surface:**
- Purpose: central coordinator for sessions, projects, tasks, machines, messages, and notifications.
- Boundary: owns SQLite-backed persistence and exposes REST, SSE, Socket.IO, and Telegram entry points.
- Main entry: `hub/src/index.ts` -> `hub/src/web/server.ts` + `hub/src/socket/server.ts`.

**Web surface:**
- Purpose: remote control UI, session chat, file/terminal views, and project workbench.
- Boundary: presentation, query orchestration, and client-side realtime updates only.
- Main entry: `web/src/main.tsx` -> `web/src/router.tsx`.

**Shared contract:**
- Purpose: keep schemas and payload shapes aligned across packages.
- Boundary: no runtime-specific code; protocol-only exports from `shared/src/index.ts`.

## Layers

**Entry and command layer:**
- Purpose: parse invocation and select the correct runtime mode.
- Contains: `cli/src/commands/*.ts`, `hub/src/index.ts`, `web/src/router.tsx`.
- Depends on: package-local services and `shared` contracts.
- Used by: end users, the browser app, and the mobile/Telegram path.

**Orchestration layer:**
- Purpose: translate external events into session/task/project state transitions.
- Contains: `hub/src/sync/syncEngine.ts`, `hub/src/sync/taskAutomation.ts`, `hub/src/sync/autoRunScheduler.ts`, `hub/src/sync/projectAutomationReadiness.ts`.
- Depends on: store, RPC gateway, event publisher, message/session caches.
- Used by: hub routes, Socket.IO handlers, and notification emitters.

**Persistence layer:**
- Purpose: provide durable storage for sessions, messages, machines, users, projects, workspaces, tasks, and push subscriptions.
- Contains: `hub/src/store/*.ts`.
- Depends on: SQLite via `Store`.
- Used by: sync engine, route handlers, and configuration/bootstrap logic.

**Presentation layer:**
- Purpose: render UI and manage client-side data fetching/state.
- Contains: `web/src/components/`, `web/src/routes/`, `web/src/hooks/`, `web/src/lib/`.
- Depends on: TanStack Query/Router, `@hopi/protocol`, hub API client.
- Used by: browser and Telegram Mini App runtime.

## Data Flow

**CLI session flow:**
1. User runs `hopi` or a subcommand.
2. `cli/src/index.ts` loads `runCli()`.
3. Command registry resolves the agent mode and optional runtime assets.
4. CLI connects to the hub over Socket.IO and/or REST through `cli/src/api/*`.
5. Agent output becomes session events, message updates, and RPC traffic back to the hub.

**Hub realtime flow:**
1. `hub/src/index.ts` creates config, store, sockets, SSE, notifications, and optional tunnel/bot.
2. `hub/src/socket/server.ts` authenticates CLI and terminal namespaces.
3. `hub/src/sync/syncEngine.ts` updates in-memory caches and writes through to the store.
4. `hub/src/sse/sseManager.ts` broadcasts updates to the web client.
5. `hub/src/notifications/*` fan out important events to Telegram and push channels.

**Web control flow:**
1. `web/src/router.tsx` mounts the shell and routes.
2. Query hooks fetch sessions, messages, machines, projects, and tasks.
3. SSE updates invalidate TanStack Query caches.
4. User actions call hub REST endpoints, which may trigger RPC back to CLI.

**Project/task automation flow:**
1. `hub/src/web/routes/projects.ts` creates projects, workspaces, and bootstrap tasks.
2. `hub/src/web/routes/tasks.ts` and `hub/src/sync/taskAutomation.ts` coordinate task lifecycle.
3. `hub/src/sync/setupWorkflowRunner.ts`, `hub/src/utils/taskActionRuntime.ts`, and `shared/src/actions.ts` define the project action contract.
4. `web/src/routes/projects/*` renders the project workbench, task chat, files, diffs, terminal, and settings.

**State management:**
- Durable state lives in SQLite via `hub/src/store/index.ts`.
- Runtime state lives in `SessionCache`, `MachineCache`, and the task automation scheduler inside `hub/src/sync/syncEngine.ts`.
- Web client state is transient and cache-backed; it rehydrates from hub APIs and SSE events.

## Key Abstractions

**Session:**
- Purpose: the primary unit of agent activity and UI navigation.
- Examples: session caches, session routes, session messages, session metadata.
- Pattern: store-backed domain object with realtime projections.

**Project/workspace/task trio:**
- Purpose: model repository-level automation and task planning.
- Examples: `hub/src/store/projects.ts`, `hub/src/store/workspaces.ts`, `hub/src/store/tasks.ts`, `web/src/routes/projects/task-workbench.tsx`.
- Pattern: project-scoped orchestration with declarative action contracts.

**Sync engine:**
- Purpose: central coordinator for message/session/machine updates and RPC routing.
- Examples: `SyncEngine`, `SessionCache`, `MessageService`, `RpcGateway`.
- Pattern: event-driven application service.

**Transport adapters:**
- Purpose: isolate communication details from business logic.
- Examples: Socket.IO server, SSE manager, Telegram bot, web API client.
- Pattern: boundary adapters around the hub core.

## Entry Points

**CLI entry:**
- Location: `cli/src/index.ts`
- Triggers: `hopi`, `hopi codex`, `hopi runner start`, etc.
- Responsibilities: resolve command, ensure runtime assets, dispatch execution.

**Hub entry:**
- Location: `hub/src/index.ts`
- Triggers: `hopi hub` / bundled binary startup.
- Responsibilities: create config, initialize store and services, start HTTP and Socket.IO.

**Web entry:**
- Location: `web/src/main.tsx`
- Triggers: browser/PWA load.
- Responsibilities: bootstrap React app and router.

## Error Handling

**Strategy:** validate at the boundary, return explicit HTTP/socket errors, and keep orchestration failures localized.

**Patterns:**
- Zod schemas at REST and shared-contract boundaries.
- Route handlers return typed 400/409/500 responses instead of propagating raw exceptions.
- Socket auth failures are rejected during namespace handshake.
- CLI command startup uses a single top-level async path so command failures bubble cleanly.

## Cross-Cutting Concerns

**Authentication:**
- CLI uses `CLI_API_TOKEN` with namespace suffixes.
- Web uses JWT auth plus Telegram init data where applicable.
- Hub enforces auth in `hub/src/web/middleware/auth.ts` and `hub/src/socket/server.ts`.

**Realtime sync:**
- Socket.IO carries CLI/session control traffic.
- SSE carries browser updates.
- `SyncEngine` keeps caches, persistence, and broadcasts aligned.

**Validation:**
- `shared/src/schemas.ts` and `shared/src/actions.ts` define the protocol shape.
- Hub routes validate request bodies with Zod before touching the store.

**Configuration:**
- Environment and persisted settings are normalized in `cli/src/configuration.ts` and `hub/src/configuration.ts`.
- Brand and product constants come from `shared/src/brand.ts`.

*Architecture analysis: 2026-03-29*
*Update when major patterns change*
