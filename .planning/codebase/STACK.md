# Technology Stack

**Analysis Date:** 2026-03-29

## Languages

**Primary:**
- TypeScript 5.x - application code across `cli/src/`, `hub/src/`, `web/src/`, `shared/src/` with strict settings from `tsconfig.base.json`

**Secondary:**
- TSX/JSX - React UI layers in `web/src/**/*.tsx` and Ink screens in `cli/src/ui/**/*.tsx`
- HTML/CSS/JSON/Markdown - web entrypoints, styling, package metadata, and docs (`web/index.html`, `web/src/styles/`, `README.md`, `docs/guide/`)
- JavaScript/ESM - build and runtime glue in package scripts and config files (`website/package.json`, `docs/package.json`)

## Runtime

**Environment:**
- Bun 1.3.5 - primary runtime for the CLI, hub, and workspace scripts (`package.json`, `cli/package.json`, `hub/package.json`)
- Browser - runtime for the React PWA served from `web/dist` or embedded in the single executable (`web/vite.config.ts`, `hub/src/web/server.ts`)
- Node.js - used for the marketing site and docs site build/start flows (`website/package.json`, `docs/package.json`)

**Package Manager:**
- Bun workspaces - monorepo package layout (`package.json`)
- Lockfile: `bun.lock`

## Frameworks

**Core:**
- Hono - hub HTTP server and route composition (`hub/src/web/server.ts`)
- Socket.IO + `@socket.io/bun-engine` - realtime CLI, terminal, and web transport (`hub/src/socket/server.ts`)
- `bun:sqlite` - local SQLite persistence layer (`hub/src/store/index.ts`)
- React 19 + TanStack Router/Query - web app routing and data fetching (`web/src/router.tsx`, `web/package.json`)
- Ink + React - terminal UI for CLI commands and diagnostics (`cli/package.json`, `cli/src/ui/`)

**Testing:**
- Vitest 4.x - CLI and web test suites (`cli/vitest.config.ts`, `web/vitest.config.ts`)
- Bun test - hub tests (`hub/package.json`, `hub/src/**/*.test.ts`)

**Build/Dev:**
- Vite 7.x + `vite-plugin-pwa` - web app bundling and service worker generation (`web/vite.config.ts`)
- Bun build - hub executable and CLI packaging (`hub/package.json`, `cli/scripts/build-executable.ts`)
- VitePress - documentation site (`docs/package.json`)
- esbuild - marketing site server bundle (`website/package.json`)

## Key Dependencies

**Critical:**
- `@hopi/protocol` - shared brand constants, env keys, schemas, and domain types (`shared/src/index.ts`, `shared/src/brand.ts`, `shared/src/schemas.ts`)
- `zod` - runtime validation in shared schemas and HTTP route validation (`shared/src/schemas.ts`)
- `socket.io` / `socket.io-client` - realtime synchronization between CLI, hub, and web (`hub/package.json`, `cli/package.json`, `web/package.json`)
- `grammy` - Telegram bot runtime (`hub/package.json`, `hub/src/telegram/bot.ts`)
- `web-push` - browser push notifications with VAPID support (`hub/package.json`, `hub/src/push/`)
- `@modelcontextprotocol/sdk` - MCP bridge and stdio integration for external tools (`cli/package.json`, `cli/src/codex/happyMcpStdioBridge.ts`)
- `@assistant-ui/react` - assistant/chat UI composition (`web/package.json`, `web/src/components/AssistantChat/`)
- `@xterm/xterm` - terminal display in the web app (`web/package.json`)
- `shiki` - code highlighting in the web file views (`web/package.json`)
- `fastify` + `fastify-type-provider-zod` - runner control server for local session management (`cli/package.json`, `cli/src/runner/run.ts`)

**Infrastructure:**
- `cross-spawn`, `ps-list`, `chalk`, `axios` - process orchestration and CLI plumbing in the runner and command layers (`cli/package.json`)

## Configuration

**Environment:**
- Env-first configuration with persisted fallback in the hub (`hub/src/configuration.ts`, `hub/src/config/serverSettings.ts`)
- Product env family: `HOPI_*` from `shared/src/brand.ts`
- Key knobs: `CLI_API_TOKEN`, `HOPI_API_URL`, `HOPI_HOME`, `HOPI_LISTEN_PORT`, `HOPI_PUBLIC_URL`, `CORS_ORIGINS`, `HOPI_RELAY_API`, `TELEGRAM_BOT_TOKEN`, `ELEVENLABS_API_KEY`, `VAPID_SUBJECT`
- CLI local config and runner state live under `~/.hopi` unless `HOPI_HOME` overrides it (`cli/src/configuration.ts`, `cli/src/persistence.ts`)

**Build:**
- Root workspace scripts in `package.json`
- Per-package TypeScript configs: `cli/tsconfig.json`, `hub/tsconfig.json`, `web/tsconfig.json`, `shared/tsconfig.json`
- Web build/dev config: `web/vite.config.ts`, `web/vitest.config.ts`
- Website build config: `website/package.json`

## Platform Requirements

**Development:**
- Bun installed and on PATH for the main workspace commands
- External agent CLIs required for full feature coverage: `claude`, `codex`, `gemini`, `opencode` (`cli/src/claude/`, `cli/src/codex/`, `cli/src/gemini/`, `cli/src/opencode/`)

**Production:**
- CLI ships as an npm bin and as packaged executables (`cli/package.json`, `cli/scripts/build-executable.ts`)
- Hub can run as a Bun binary or single executable with embedded web assets (`hub/package.json`, `hub/src/web/server.ts`)
- Web app is deployed as static assets or embedded output (`web/dist`, `hub/src/web/server.ts`)
- Relay mode depends on `tunwg` binaries and the relay API infrastructure (`hub/src/tunnel/`, `hub/scripts/download-tunwg.ts`)

---

*Stack analysis: 2026-03-29*
*Update after major dependency changes*
