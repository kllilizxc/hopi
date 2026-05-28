# Codebase Structure

**Analysis Date:** 2026-03-29

## Directory Layout

```text
hopi/
├── cli/             # CLI binary, agent wrappers, runner daemon, runtime assets
├── hub/             # HTTP API, Socket.IO, SSE, Telegram bot, SQLite store
├── web/             # React PWA / Mini App client
├── shared/          # Shared protocol, schemas, types, brand constants
├── docs/            # VitePress documentation site
├── website/         # Marketing site and public web server
├── scripts/         # Repo-level automation scripts
├── .planning/       # Roadmap, state, and codebase maps
├── .github/         # CI, prompts, and repository metadata
├── package.json     # Workspace scripts and root orchestration
└── bun.lock         # Workspace dependency lockfile
```

## Directory Purposes

**cli/**
- Purpose: terminal entrypoint for agent sessions and runner management.
- Contains: Bun/TypeScript sources, packaging entrypoints, executable wrapper, and CLI tests.
- Key files: `cli/src/index.ts`, `cli/src/commands/runCli.ts`, `cli/src/runner/run.ts`, `cli/package.json`.
- Subdirectories: `src/commands/`, `src/runner/`, `src/api/`, `src/codex/`, `src/claude/`, `src/gemini/`, `src/opencode/`, `src/ui/`.

**hub/**
- Purpose: central backend for sessions, messaging, projects, tasks, notifications, and auth.
- Contains: web route handlers, Socket.IO server, sync engine, SQLite stores, Telegram integration, tunnel support.
- Key files: `hub/src/index.ts`, `hub/src/web/server.ts`, `hub/src/socket/server.ts`, `hub/src/sync/syncEngine.ts`, `hub/package.json`.
- Subdirectories: `src/web/routes/`, `src/socket/`, `src/sync/`, `src/store/`, `src/telegram/`, `src/config/`, `src/tunnel/`.

**web/**
- Purpose: React PWA used for remote control and session inspection.
- Contains: router, route components, reusable UI, hooks, realtime helpers, tests, and assets.
- Key files: `web/src/main.tsx`, `web/src/router.tsx`, `web/src/api/client.ts`, `web/package.json`.
- Subdirectories: `src/routes/`, `src/routes/projects/`, `src/routes/sessions/`, `src/components/`, `src/hooks/`, `src/lib/`, `src/realtime/`, `src/test/`.

**shared/**
- Purpose: workspace-wide contract layer.
- Contains: runtime schemas, product constants, message/task types, voice helpers, and protocol exports.
- Key files: `shared/src/index.ts`, `shared/src/schemas.ts`, `shared/src/actions.ts`, `shared/src/types.ts`, `shared/package.json`.
- Subdirectories: flat `src/` modules only.

**docs/**
- Purpose: VitePress documentation and guides.
- Contains: guide pages, design notes, internal docs, and VitePress config/assets.
- Key files: `docs/package.json`, `docs/guide/`, `docs/internal/`, `docs/.vitepress/`.

**website/**
- Purpose: marketing site and public-facing landing pages.
- Contains: frontend app, public assets, and a bundled Node server entry.
- Key files: `website/package.json`, `website/src/`, `website/src/server/index.ts`, `website/vite.config.ts`.

**scripts/**
- Purpose: repository-level automation used by root package scripts.
- Contains: brand sync/check, build helpers, and maintenance tasks.
- Key files: referenced from root `package.json`.

**.planning/**
- Purpose: project state, roadmap, codebase map, and todo/backlog artifacts.
- Contains: `PROJECT.md`, `STATE.md`, `ROADMAP.md`, phase folders, codebase docs, and todo lists.
- Key files: `.planning/STATE.md`, `.planning/codebase/*.md`.

**.github/**
- Purpose: repo metadata, issue prompts, and CI workflows.
- Contains: GitHub Actions and repo-scoped templates.
- Key files: `.github/workflows/`, `.github/prompts/`, `.github/ISSUE_TEMPLATE/`.

## Key File Locations

**Entry Points:**
- `cli/src/index.ts` - CLI runtime entry.
- `hub/src/index.ts` - Hub server bootstrap.
- `web/src/main.tsx` - Web app entry.
- `website/src/server/index.ts` - Marketing site server entry.

**Configuration:**
- `package.json` - Root workspace scripts and orchestration.
- `cli/package.json`, `hub/package.json`, `web/package.json`, `shared/package.json`, `docs/package.json`, `website/package.json` - package-level scripts and dependencies.
- `cli/tsconfig.json`, `hub/tsconfig.json`, `web/tsconfig.json`, `shared/tsconfig.json`, `website/tsconfig.json` - TypeScript per package.
- `web/vite.config.ts`, `web/tailwind.config.ts`, `web/vitest.config.ts`, `website/vite.config.ts` - frontend build/test config.

**Core Logic:**
- `cli/src/commands/` - command dispatch and subcommand handlers.
- `cli/src/runner/` - background runner, control server, worktree logic, preview manager.
- `hub/src/web/routes/` - REST endpoints.
- `hub/src/socket/handlers/` - Socket.IO event handling.
- `hub/src/sync/` - session/message/task orchestration.
- `hub/src/store/` - persistence and table-specific stores.
- `web/src/routes/` - routed UI pages.
- `web/src/routes/projects/` - project/task workbench UI.
- `shared/src/schemas.ts` and `shared/src/actions.ts` - protocol validation and project action contracts.

**Testing:**
- `cli/src/**/*.test.ts` - CLI unit and integration-style tests.
- `hub/src/**/*.test.ts` - hub tests around store, sync, routes, and automation.
- `web/src/**/*.test.tsx` and `web/src/test/` - React component and helper tests.
- `shared/src/**/*.test.ts` - shared protocol tests where present.

**Documentation:**
- `README.md` - repo overview and getting started.
- `cli/README.md`, `hub/README.md`, `web/README.md` - package docs.
- `docs/guide/` - user-facing guides.
- `cli/src/runner/README.md` - runner lifecycle and control-flow notes.

## Naming Conventions

**Files:**
- `*.ts` for TypeScript modules.
- `*.tsx` for React components and route views.
- `*.test.ts` and `*.test.tsx` for colocated tests.
- `README.md` for package-level overviews and operational notes.

**Directories:**
- `src/` for package source roots.
- `routes/` for routed UI or HTTP endpoint groups.
- `components/` for reusable UI pieces.
- `hooks/` for React hooks.
- `store/`, `sync/`, `socket/`, `web/` for hub server concerns.

**Special Patterns:**
- `index.ts` for package or directory exports and bootstrap modules.
- `__tests__` for isolated test suites when colocated tests are not enough.
- `*.generated.*` for generated artifacts such as embedded asset maps.

## Where to Add New Code

**New CLI command:**
- Primary code: `cli/src/commands/`
- Runtime wiring: `cli/src/commands/registry.ts` and `cli/src/index.ts`
- Tests: colocated `*.test.ts` files under `cli/src/`

**New hub API route or realtime event:**
- HTTP handlers: `hub/src/web/routes/`
- Socket handlers: `hub/src/socket/handlers/`
- Shared event types: `shared/src/socket.ts` or the relevant shared schema module
- Tests: colocated `hub/src/**/*.test.ts`

**New web page or component:**
- Route file: `web/src/routes/`
- Shared UI: `web/src/components/`
- Data hooks: `web/src/hooks/queries/` or `web/src/hooks/mutations/`
- Tests: `web/src/**/*.test.tsx`

**New project/task automation behavior:**
- Hub orchestration: `hub/src/sync/`
- Persistence: `hub/src/store/projects.ts`, `hub/src/store/workspaces.ts`, `hub/src/store/tasks.ts`
- API layer: `hub/src/web/routes/projects.ts`, `hub/src/web/routes/tasks.ts`, `hub/src/web/routes/workspaces.ts`
- UI: `web/src/routes/projects/`
- Contract/schema changes: `shared/src/actions.ts`, `shared/src/schemas.ts`, `shared/src/index.ts`

**Shared protocol or schema:**
- Definitions: `shared/src/`
- Exports: `shared/src/index.ts`
- Consumer updates: every package that imports the affected contract

**Docs or public content:**
- User docs: `docs/guide/`
- Internal documentation: `docs/internal/`
- Marketing content: `website/src/` and `website/public/`

## Special Directories

**web/dist/**
- Purpose: built PWA output served by the hub or static hosting.
- Source: `web/src/` build via `web/package.json`.
- Committed: generated output.

**docs/.vitepress/dist/**
- Purpose: built docs site.
- Source: `docs/.vitepress/` and `docs/guide/`.
- Committed: generated output.

**website/dist/**
- Purpose: built marketing site assets and server bundle.
- Source: `website/src/` and `website/public/`.
- Committed: generated output.

**hub/.tmp/**
- Purpose: temporary runtime artifacts.
- Source: hub runtime and scripts.
- Committed: no; runtime-only workspace.

**.planning/codebase/**
- Purpose: current codebase map for planning and execution.
- Source: manually maintained refreshes.
- Committed: yes.

*Structure analysis: 2026-03-29*
*Update when directory structure changes*
