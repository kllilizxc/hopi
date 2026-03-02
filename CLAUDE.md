# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

HAPI — local-first platform for running AI coding agents (Claude Code, Codex, Gemini, OpenCode) with remote control via web/PWA/Telegram Mini App. CLI wraps agents and connects to hub; hub serves web app and handles real-time sync.

## Repo Layout

```
cli/     - CLI binary, agent wrappers, runner daemon (@twsxtd/hapi, Bun + Ink)
hub/     - HTTP API + Socket.IO + SSE + Telegram bot (Hono + better-sqlite3)
web/     - React 19 PWA for remote control (TanStack Router/Query, Tailwind 4, assistant-ui)
shared/  - Common types, Zod schemas, Socket.IO event types (@hapi/protocol)
docs/    - VitePress documentation
website/ - Marketing site
```

Bun workspaces; `shared` consumed by cli, hub, web.

## Commands

```bash
bun install                 # install all deps
bun run dev                 # hub + web concurrently (don't run from Claude Code)
bun run build               # build cli + hub + web
bun run build:single-exe    # all-in-one binary with embedded web assets
bun typecheck               # typecheck all packages
bun run typecheck:cli       # typecheck cli only
bun run typecheck:hub       # typecheck hub only
bun run typecheck:web       # typecheck web only
bun run test                # run all tests (cli + hub + web)
bun run test:cli            # cli tests only
bun run test:hub            # hub tests only
bun run test:web            # web tests only
```

Single test file: `cd <package> && bunx vitest run src/path/to/file.test.ts`

## Architecture

```
CLI (agent wrapper) ←Socket.IO→ Hub (server) ←SSE/REST→ Web (PWA)
```

1. CLI spawns agent, connects to hub via Socket.IO
2. Agent events → CLI → hub → DB + SSE broadcast
3. Web subscribes to SSE `/api/events`, receives live updates
4. User actions → Web → hub REST API → RPC to CLI → agent

Key patterns:
- **RPC gateway**: CLI registers handlers (`rpc-register`), hub routes requests via `rpcGateway.ts`
- **Versioned updates**: optimistic concurrency — CLI sends `update-metadata`/`update-state` with version; hub rejects stale
- **Session modes**: `local` (terminal) vs `remote` (web-controlled); switchable mid-session
- **Permission modes**: `default`, `acceptEdits`, `bypassPermissions`, `plan`
- **Namespaces**: multi-user isolation via token suffix

## Code Conventions

- TypeScript strict mode; no untyped code
- Path alias `@/*` → `./src/*` in each package
- 4-space indentation
- Zod for runtime validation (schemas in `shared/src/schemas.ts`)
- No backward compatibility concerns — breaking old formats freely
- No linter configured; rely on TypeScript strict checks
- Test files: `*.test.ts` colocated next to source (Vitest)

## Key Source Locations

| Task | Where to look |
|------|---------------|
| Add CLI command | `cli/src/commands/`, `cli/src/index.ts` |
| Add API endpoint | `hub/src/web/routes/`, register in `hub/src/web/index.ts` |
| Add Socket.IO event | `hub/src/socket/handlers/cli/`, `shared/src/socket.ts` |
| Add web route | `web/src/routes/`, `web/src/router.tsx` |
| Modify session logic | `hub/src/sync/sessionCache.ts`, `hub/src/sync/syncEngine.ts` |
| Modify message handling | `hub/src/sync/messageService.ts` |
| Add shared type/schema | `shared/src/types.ts`, `shared/src/schemas.ts` |

## Reference Docs

Each package has its own README with detailed docs:
- `cli/README.md` — CLI commands, config, runner
- `hub/README.md` — Hub config, HTTP API, Socket.IO events
- `web/README.md` — Routes, components, hooks
