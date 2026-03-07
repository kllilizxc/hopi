# Technology Stack

**Analysis Date:** 2026-03-07

## Languages

**Primary:**
- TypeScript (strict) - all core packages (`tsconfig.base.json`, `cli/src/`, `hub/src/`, `web/src/`, `shared/src/`)

**Secondary:**
- TSX/JSX - React render layers (CLI TUI + web PWA) (`web/src/**/*.tsx`, `cli/src/**/*.tsx`)
- HTML - web entry + hub static serving (`web/index.html`, `hub/src/web/server.ts`)
- CSS - Tailwind-based UI styling (`web/tailwind.config.ts`, `web/src/`)
- Markdown - docs + guides (`README.md`, `docs/guide/`, `cli/src/runner/README.md`)

## Runtime

**Environment:**
- Bun (primary) - hub + CLI execution (`cli/src/index.ts`, `hub/package.json`)
- Bun PTY requirement: >= 1.3.5 for terminal streaming (`cli/src/terminal/TerminalManager.ts`)
- Browser (modern) - PWA runtime (`web/src/main.tsx`, `web/vite.config.ts`)
- Node.js (secondary) - website server build/start + misc scripts (`website/package.json`, `cli/package.json` `postinstall`)

**Package Manager:**
- Bun workspaces - monorepo (`package.json`, `bun.lock`)
- Lockfile: `bun.lock`

## Frameworks

**Core:**
- Hub HTTP: Hono ^4.11.x (`hub/package.json`, `hub/src/web/server.ts`)
- Hub realtime: Socket.IO ^4.8.x + `@socket.io/bun-engine` (`hub/package.json`, `hub/src/socket/server.ts`)
- Hub persistence: SQLite via `bun:sqlite` (`hub/src/store/index.ts`)
- CLI UI: Ink ^6.6.x + React ^19 (`cli/package.json`, `cli/src/ui/`)
- Web UI: React ^19 + TanStack Router/Query (`web/package.json`, `web/src/router.tsx`, `web/src/hooks/`)
- Runner control API: Fastify ^5.6.x + `fastify-type-provider-zod` (`cli/package.json`, `cli/src/runner/run.ts`)

**Testing:**
- Vitest ^4.x - CLI + web (`cli/package.json`, `web/vitest.config.ts`)
- Bun test - hub (`hub/package.json`, `hub/src/**/*.test.ts`)
- Typecheck: `tsc --noEmit` (`package.json`, `tsconfig.base.json`)

**Build/Dev:**
- Vite ^7.x - web + website (`web/vite.config.ts`, `website/package.json`)
- Bun build - hub build output (`hub/package.json`)
- Workbox ^7.x - PWA caching + SW plumbing (`web/package.json`)
- VitePress - docs site (`docs/package.json`)

## Key Dependencies

**Critical:**
- `@hopi/protocol` (workspace) - shared types/schemas/brand/env keys (`shared/package.json`, `shared/src/brand.ts`)
- `zod` ^4.2.1 - runtime schemas/validation (`shared/src/schemas.ts`, `cli/package.json`, `hub/package.json`, `web/package.json`)
- `socket.io` / `socket.io-client` ^4.8.x - realtime transport CLI↔hub↔web (`hub/package.json`, `cli/package.json`, `web/package.json`)
- `grammy` ^1.38.x - Telegram bot (`hub/package.json`, `hub/src/telegram/bot.ts`)
- `web-push` ^3.6.x - Web Push (VAPID) notifications (`hub/package.json`, `hub/src/push/pushService.ts`)
- `@modelcontextprotocol/sdk` ^1.25.x - MCP server/bridge (`cli/src/claude/utils/startHappyServer.ts`, `cli/src/codex/happyMcpStdioBridge.ts`)
- `@assistant-ui/react` ^0.11.x - chat UI components (`web/package.json`, `web/src/routes/`)
- `@xterm/xterm` ^6.x - web terminal view (`web/package.json`)
- `shiki` ^3.20.x - syntax highlighting (`web/package.json`)

**Infrastructure / Bundled Tools:**
- ripgrep binary wrapper - packaged search tooling (`cli/src/modules/ripgrep/`, `cli/src/runtime/embeddedAssets.bun.ts`)
- difftastic binary wrapper - packaged diff tooling (`cli/src/modules/difftastic/`, `cli/src/runtime/embeddedAssets.bun.ts`)

## Configuration

**Environment:**
- Hub config priority: env > `settings.json` > defaults; auto-persist env into file (`hub/src/configuration.ts`, `hub/src/config/settings.ts`)
- Product env keys + defaults: `HOPI_*` (`shared/src/brand.ts`)
- Web build env example: `VITE_REQUIRE_HUB_URL` (GH Pages deploy) (`.github/workflows/webapp.yml`)

**Build:**
- Base TS config: `tsconfig.base.json`
- Per-package TS config: `cli/tsconfig.json`, `hub/tsconfig.json`, `web/tsconfig.json`
- CLI Bun path aliases: `cli/bunfig.toml`
- Web tooling: `web/vite.config.ts`, `web/postcss.config.cjs`, `web/tailwind.config.ts`

## Platform Requirements

**Development:**
- Bun installed; root scripts assume `bun` (`package.json`)
- Full feature set needs external agent CLIs installed: `claude`, `codex`, `gemini`, `opencode` (`cli/src/claude/`, `cli/src/codex/`, `cli/src/gemini/`, `cli/src/opencode/`)

**Production:**
- Install options:
  - npm bin wrapper (`cli/package.json` `bin/hopi.cjs`)
  - prebuilt single-exe bundles (multi-platform) (`.github/workflows/release.yml`, `cli/scripts/build-executable.ts`)
- Optional relay mode needs `tunwg` binaries (download + bundled) (`hub/scripts/download-tunwg.ts`, `hub/src/tunnel/tunnelManager.ts`)

---

*Stack analysis: 2026-03-07*
*Update after major dependency changes*

