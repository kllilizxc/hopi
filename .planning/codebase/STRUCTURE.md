# Codebase Structure

**Analysis Date:** 2026-03-07

## Directory Layout

```
hopi/
├── cli/                    # CLI entrypoint + agent wrappers + runner daemon
├── hub/                    # Hub server (HTTP API + SSE + Socket.IO + SQLite + Telegram/push)
├── web/                    # React PWA / Telegram Mini App UI
├── shared/                 # Shared protocol package (@hopi/protocol)
├── docs/                   # VitePress documentation site
├── website/                # Marketing site (Vite + server bundle)
├── scripts/                # Repo-level scripts (brand sync/check, maintenance)
├── .planning/              # Planning artifacts (codebase maps, todos)
├── README.md               # Project overview + quickstart
├── package.json            # Bun workspaces + root scripts
├── tsconfig.base.json      # Shared TS config
├── bun.lock                # Bun lockfile
└── TODO.md                 # Project task notes
```

## Directory Purposes

**cli/**
- Purpose: local terminal entrypoint; spawns agents; syncs to hub; runner for remote spawn/resume
- Contains: Bun TS source, npm bin wrapper, build/release scripts, vitest tests
- Key files: `cli/src/index.ts`, `cli/src/commands/runCli.ts`, `cli/src/commands/registry.ts`, `cli/src/api/api.ts`, `cli/src/runner/run.ts`, `cli/bin/hopi.cjs`
- Subdirectories:
  - `cli/src/commands/` command definitions + dispatch
  - `cli/src/api/` hub REST + Socket.IO client utilities
  - `cli/src/api/rpc/` RPC handler registration/dispatch (`cli/src/api/rpc/RpcHandlerManager.ts`)
  - `cli/src/claude/`, `cli/src/codex/`, `cli/src/agent/`, `cli/src/opencode/` agent adapters/runners
  - `cli/src/runner/` background runner (spawn sessions, worktrees, previews)
  - `cli/src/modules/` tool impls (ripgrep/difftastic/git/etc)
  - `cli/src/runtime/` embedded/runtime assets unpack (`cli/src/runtime/assets.ts`)

**hub/**
- Purpose: hub backend; auth; sessions/messages/machines/tasks/projects; realtime fanout; notifications; optional relay tunnel
- Contains: Bun TS server, Hono routes, Socket.IO handlers, SSE manager, SQLite store, Telegram bot, push, tunnel tools
- Key files: `hub/src/index.ts`, `hub/src/web/server.ts`, `hub/src/sync/syncEngine.ts`, `hub/src/store/index.ts`
- Subdirectories:
  - `hub/src/web/` HTTP server + routes + static/embedded asset serving
  - `hub/src/socket/` Socket.IO server + handler modules
  - `hub/src/sse/` Server-Sent Events manager
  - `hub/src/sync/` caches + message service + rpc gateway + task automation
  - `hub/src/store/` SQLite stores + schema migrations
  - `hub/src/telegram/` Telegram bot + callbacks
  - `hub/src/push/` Web Push support (VAPID)
  - `hub/src/tunnel/` relay tunnel manager + TLS gate
  - `hub/tools/` runtime binaries (example `hub/tools/tunwg/*`)
  - `hub/scripts/` maintenance + build helpers (example `hub/scripts/generate-embedded-web-assets.ts`)

**web/**
- Purpose: UI for remote monitoring/control; PWA install; Telegram Mini App mode
- Contains: React app, routes, components, hooks, service worker, build output
- Key files: `web/src/main.tsx`, `web/src/router.tsx`, `web/src/hooks/useSSE.ts`, `web/src/api/client.ts`, `web/src/sw.ts`, `web/vite.config.ts`
- Subdirectories:
  - `web/src/routes/` page-level routes (sessions, projects, settings)
  - `web/src/components/` reusable UI + chat/terminal components
  - `web/src/hooks/` auth, SSE, query/mutation hooks
  - `web/src/realtime/` realtime helpers (SSE/socket adapters)
  - `web/dist/` build output served by hub in direct-connect mode

**shared/**
- Purpose: shared protocol contracts for CLI/hub/web
- Contains: TS modules exporting types, schemas, helpers
- Key files: `shared/src/index.ts`, `shared/src/types.ts`, `shared/src/socket.ts`, `shared/src/schemas.ts`, `shared/src/brand.ts`

**docs/**
- Purpose: user/developer docs site (VitePress)
- Contains: guides + design notes
- Key files: `docs/index.md`, `docs/guide/how-it-works.md`, `docs/package.json`

**website/**
- Purpose: marketing site (static + server bundle)
- Contains: Vite app + `express` server build
- Key files: `website/package.json`, `website/src/server/index.ts`, `website/vite.config.ts`

**scripts/**
- Purpose: repo-level automation helpers
- Key files: `scripts/brand-sync.ts`, `scripts/brand-check.ts`

**.planning/**
- Purpose: planning + meta docs produced by agent workflows
- Key dirs: `.planning/codebase/` (this map), `.planning/todos/`
- Note: not runtime code; repo-local process artifacts

## Key File Locations

**Entry Points:**
- `cli/src/index.ts` - CLI main (Bun) → dispatch to `cli/src/commands/runCli.ts`
- `cli/bin/hopi.cjs` - npm `hopi` bin wrapper selecting platform binary package
- `hub/src/index.ts` - hub server main (HTTP/SSE/Socket.IO + optional tunnel/bot)
- `web/src/main.tsx` - web bootstrap (React Query + router + PWA SW)
- `shared/src/index.ts` - shared exports for `@hopi/protocol`

**Configuration:**
- `package.json` - workspaces + root scripts (`build:single-exe`, `dev`, `typecheck`, `test`)
- `tsconfig.base.json` - shared TS compiler settings
- `cli/src/configuration.ts` - CLI env/settings loading
- `hub/src/configuration.ts` - hub env/settings loading (token, db path, CORS, Telegram, relay)
- `web/vite.config.ts` - web build config + PWA integration

**Core Logic:**
- `hub/src/sync/syncEngine.ts` - session/message orchestration + event publishing + RPC entrypoints
- `hub/src/store/index.ts` - SQLite schema + stores (sessions/messages/machines/projects/workspaces/tasks)
- `hub/src/web/server.ts` - Hono app + routes + static/embedded web serving
- `cli/src/api/api.ts` - CLI REST client for `/cli/*` endpoints
- `cli/src/api/rpc/RpcHandlerManager.ts` - CLI RPC registration/execution
- `cli/src/runner/run.ts` - runner daemon (spawn sessions, manage worktrees, previews)

**Testing:**
- CLI: `cli/src/**/*.test.ts` (Vitest via `cli/vitest.config.ts`)
- Hub: `hub/src/**/*.test.ts` (Bun test; see `hub/package.json`)
- Web: `web/src/**/*.test.ts` (Vitest via `web/vitest.config.ts`)

**Documentation:**
- Root overview: `README.md`
- Hub/CLI/Web guides: `cli/README.md`, `hub/README.md`, `web/README.md`
- Long-form docs: `docs/guide/*`

## Naming Conventions

**Files:**
- `*.ts` / `*.tsx` for TypeScript source
- `*.test.ts` for tests (examples: `hub/src/sse/sseManager.test.ts`, `cli/src/api/versionedUpdate.test.ts`)
- React components generally `PascalCase.tsx` (examples: `web/src/components/SessionChat.tsx`, `web/src/components/SessionList.tsx`)

**Directories:**
- lower-case feature buckets (`cli/src/api/`, `hub/src/sync/`, `web/src/hooks/`)
- “collection” dirs pluralized (`hub/src/web/routes/`, `web/src/components/`)

## Where to Add New Code

**New CLI command:**
- Definition: `cli/src/commands/<name>.ts`
- Register: `cli/src/commands/registry.ts`
- Tests: `cli/src/**/<name>.test.ts` (if unit-testable)

**New Hub API endpoint:**
- Route file: `hub/src/web/routes/<domain>.ts`
- Register route: `hub/src/web/server.ts` (add `app.route('/api', createXRoutes(...))`)
- Tests: `hub/src/web/routes/**/*.test.ts`

**New Socket.IO event / RPC surface:**
- Shared typing: `shared/src/socket.ts`
- Hub handler: `hub/src/socket/handlers/**`
- CLI client/handler: `cli/src/api/**` and/or `cli/src/api/rpc/**`

**New Web page / view:**
- Route: `web/src/routes/**`
- Wire into router: `web/src/router.tsx`
- Data hooks: `web/src/hooks/queries/**`, `web/src/hooks/mutations/**`

**New shared type/schema:**
- Types: `shared/src/types.ts`
- Runtime validation: `shared/src/schemas.ts`

## Special Directories

**Build outputs (generated):**
- `web/dist/` - built web assets served by hub in direct-connect mode (`hub/src/web/server.ts`)
- `hub/dist/` - hub build output (`hub/package.json` build script)

**Generated source (committed):**
- `hub/src/web/embeddedAssets.generated.ts` - generated by `hub/scripts/generate-embedded-web-assets.ts` for single-exe embedding

**Workspace installs (generated):**
- `node_modules/` - dependency installs (not source of truth)

