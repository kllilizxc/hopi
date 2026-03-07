# Architecture

**Analysis Date:** 2026-03-07

## Pattern Overview

**Overall:** Bun workspaces monorepo; local-first “agent control plane” (CLI runner + Hub server + Web/PWA UI); realtime sync.

**Key Characteristics:**
- Local agent processes; remote control/monitor UI
- Hub as state + fanout: HTTP API + Socket.IO + SSE + SQLite
- Shared protocol package (`shared/` → `@hopi/protocol`) used everywhere
- Optional relay/tunnel mode (`hub/src/tunnel/*` + `tunwg` runtime tool)
- Namespaced auth tokens (`CLI_API_TOKEN:<namespace>`) for multi-user isolation (`hub/src/utils/accessToken.ts`)

## Layers

**Protocol / Contracts:**
- Purpose: shared types, schemas, socket event shapes, env var constants
- Contains: `Session`/`Message`/`Machine` types; socket typings; Zod schemas; brand/env constants
- Location: `shared/src/index.ts`, `shared/src/types.ts`, `shared/src/socket.ts`, `shared/src/schemas.ts`, `shared/src/brand.ts`
- Depends on: `zod`
- Used by: `cli/`, `hub/`, `web/`

**CLI (Agent Runner + Hub Client):**
- Purpose: start/attach local agent sessions; stream events to hub; answer RPC requests from hub (file/git/spawn/etc)
- Contains: command routing, agent adapters (Claude/Codex/Gemini/OpenCode), Socket.IO client, RPC handler manager, runner daemon, local persistence, terminal UI
- Key paths: `cli/src/index.ts`, `cli/src/commands/*`, `cli/src/api/*`, `cli/src/runner/*`, `cli/src/claude/*`, `cli/src/codex/*`, `cli/src/agent/*`, `cli/src/opencode/*`, `cli/src/terminal/*`, `cli/src/ui/*`
- Depends on: external CLIs (Claude/OpenCode), `socket.io-client`, `axios`
- Used by: user terminal; hub RPC via `hub/src/sync/rpcGateway.ts`

**Hub (Sync + API + Persistence):**
- Purpose: “single source of truth” for sessions/messages/machines; realtime fanout; notifications; optional relay tunnel
- Contains: HTTP API (Hono), SSE updates, Socket.IO server, sync engine + caches, SQLite store, push + Telegram channels, tunnel manager
- Key paths: `hub/src/index.ts`, `hub/src/web/server.ts`, `hub/src/web/routes/*`, `hub/src/socket/*`, `hub/src/sse/*`, `hub/src/sync/*`, `hub/src/store/*`, `hub/src/notifications/*`, `hub/src/push/*`, `hub/src/telegram/*`, `hub/src/tunnel/*`
- Depends on: `bun:sqlite`, `socket.io`, `hono`, `grammy`, `web-push`
- Used by: CLI, Web PWA, Telegram Mini App

**Web (UI / PWA / Mini App):**
- Purpose: remote monitoring + control; approvals; chat; tasks/projects/workspaces; file/git views; terminal; voice
- Contains: React app, router, TanStack Query hooks, SSE subscriber, socket client (terminal)
- Key paths: `web/src/main.tsx`, `web/src/router.tsx`, `web/src/hooks/useSSE.ts`, `web/src/api/client.ts`, `web/src/routes/**`, `web/src/components/**`
- Depends on: TanStack Router/Query, Tailwind, `@assistant-ui/react`, `socket.io-client`, PWA SW (`web/src/sw.ts`)

## Data Flow

**CLI session start (direct-connect default):**
1. User runs `hopi ...` → `cli/bin/hopi.cjs` → `cli/src/index.ts`
2. Command selection + args → `cli/src/commands/runCli.ts`, `cli/src/commands/registry.ts`
3. CLI authenticates + creates/loads session/machine via hub REST → `cli/src/api/api.ts` → hub routes `hub/src/web/routes/cli.ts`
4. CLI opens Socket.IO connection (namespace `/cli`) and emits session events (`message`, `update-metadata`, `update-state`) → hub socket setup `hub/src/socket/server.ts` + handlers `hub/src/socket/handlers/cli/*`
5. Hub `SyncEngine` mutates caches and persists to SQLite → `hub/src/sync/syncEngine.ts` + `hub/src/store/*`
6. Hub publishes `SyncEvent` stream to web via SSE → `hub/src/sse/sseManager.ts` → web subscriber `web/src/hooks/useSSE.ts`
7. Optional notifications fanout (push/Telegram) → `hub/src/notifications/*`, `hub/src/push/*`, `hub/src/telegram/*`

**Web action → CLI via hub RPC:**
1. Web calls hub API route (git/files/tasks/machines/etc) → `hub/src/web/routes/*`
2. Route uses `SyncEngine` + RPC gateway → `hub/src/sync/rpcGateway.ts`
3. Hub sends Socket.IO `rpc-request` to CLI → `hub/src/socket/rpcRegistry.ts`
4. CLI executes handler via `cli/src/api/rpc/RpcHandlerManager.ts` and tool modules (`cli/src/modules/*`)
5. Result returned; hub persists + emits `SyncEvent`; web refresh via SSE

**Terminal streaming (web ↔ hub ↔ CLI):**
- Web emits `terminal:*` socket events (create/write/resize/close) → hub terminal handler `hub/src/socket/handlers/terminal.ts`
- Hub routes terminal data to the CLI session; CLI owns the local PTY/shell integration (`cli/src/terminal/*`)

**Relay mode (E2E tunnel option):**
1. Hub started with `--relay` → `hub/src/index.ts` (`resolveRelayFlag`)
2. Tunnel bootstrap → `hub/src/tunnel/tunnelManager.ts`, TLS gate `hub/src/tunnel/tlsGate.ts`
3. Webapp served separately in relay mode (hub root shows pointer) → `hub/src/web/server.ts` (`options.relayMode`)

**State Management:**
- Hub: SQLite persistence (`hub/src/store/index.ts`) + in-memory caches (`hub/src/sync/sessionCache.ts`, `hub/src/sync/machineCache.ts`) + event publisher (`hub/src/sync/eventPublisher.ts`)
- CLI: local settings + runner state in `~/.hopi` (`cli/src/persistence.ts`) + ephemeral outbox/buffers (`cli/src/api/socketOutbox.ts`)
- Web: React Query cache (`web/src/lib/query-client.ts`) + SSE-driven cache updates/invalidation (`web/src/hooks/useSSE.ts`)

## Key Abstractions

**Protocol Types (`@hopi/protocol`):**
- Purpose: shared shapes + invariants across processes
- Examples: `shared/src/types.ts`, `shared/src/socket.ts`, `shared/src/schemas.ts`
- Pattern: contract-first workspace package consumed by `cli`, `hub`, `web`

**Session / Machine / Message:**
- Purpose: primary domain entities (what is running, where, and what happened)
- Hub persistence: `hub/src/store/sessionStore.ts`, `hub/src/store/machineStore.ts`, `hub/src/store/messageStore.ts`
- Hub orchestration: `hub/src/sync/syncEngine.ts`, `hub/src/sync/messageService.ts`
- Web consumption: hooks in `web/src/hooks/queries/*`

**SyncEngine:**
- Purpose: orchestrator; apply updates; publish events; route RPC; expire inactive state
- Location: `hub/src/sync/syncEngine.ts`
- Pattern: in-memory cache + persistence + event fanout

**RPC:**
- Purpose: run privileged ops on the machine running the agent (git/file/command/preview/etc)
- Hub: `hub/src/sync/rpcGateway.ts`, `hub/src/socket/rpcRegistry.ts`
- CLI: `cli/src/api/rpc/RpcHandlerManager.ts`

**Versioned updates:**
- Purpose: monotonic metadata/state writes; reject stale updates
- CLI helper: `cli/src/api/versionedUpdate.ts`
- Hub store typing: `hub/src/store/types.ts` (`VersionedUpdateResult`)

## Entry Points

**CLI:**
- Location: `cli/bin/hopi.cjs` (npm bin wrapper), `cli/src/index.ts` (Bun entry)
- Triggers: `hopi ...` invocation
- Responsibilities: parse args; dispatch subcommand; start agent; connect to hub

**Hub:**
- Location: `hub/src/index.ts`
- Triggers: `hopi hub` / `bun run --cwd hub start`
- Responsibilities: load config; init store; start HTTP/SSE/socket; start tunnel/Telegram/push (optional)

**Web:**
- Location: `web/src/main.tsx`
- Triggers: browser load / Telegram Mini App load
- Responsibilities: auth bootstrap; router; query client; SSE subscription; render UI

## Error Handling

**Strategy:** boundary validation + early returns; top-level fatal catches; RPC errors serialized to JSON

**Patterns:**
- Hub: request validation via `zod` in routes (example `hub/src/web/routes/auth.ts`); auth middleware returns 401/JSON (`hub/src/web/middleware/auth.ts`)
- CLI: command-level throw/exit; logs via `cli/src/ui/logger.ts`
- RPC: handler exceptions converted to JSON `{ error }` (`cli/src/api/rpc/RpcHandlerManager.ts`)

## Cross-Cutting Concerns

**Logging:**
- CLI: `cli/src/ui/logger.ts`
- Hub: `hono/logger` + `console` (`hub/src/web/server.ts`, `hub/src/index.ts`)

**Validation:**
- Shared schemas: `shared/src/schemas.ts`
- Hub request bodies: `zod` in `hub/src/web/routes/*`
- CLI API parsing: schemas in `cli/src/api/types.ts`

**Authentication / Namespacing:**
- Access token parsing + namespace extraction: `hub/src/utils/accessToken.ts`
- JWT minting: `hub/src/web/routes/auth.ts`
- JWT verification: `hub/src/web/middleware/auth.ts`

**Packaging / Embedded assets:**
- Web dist served by hub (direct-connect) or embedded into single executable → `hub/src/web/server.ts`
- Embedded web asset generation → `hub/scripts/generate-embedded-web-assets.ts` → `hub/src/web/embeddedAssets.generated.ts`
- CLI runtime tools unpacking (ripgrep/difftastic/tunwg) → `cli/src/runtime/assets.ts`

