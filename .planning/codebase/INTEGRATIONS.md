# External Integrations

**Analysis Date:** 2026-03-07

## APIs & External Services

**AI Coding Agents (spawned local CLIs):**
- Claude Code (Anthropic) - spawned as `claude` (`cli/src/claude/claudeLocal.ts`, `cli/src/commands/claude.ts`)
  - Auth injection (runner): `CLAUDE_CODE_OAUTH_TOKEN` (`cli/src/runner/README.md`)
  - Install dependency: `claude` executable on PATH (`cli/src/commands/claude.ts`)
- Codex CLI (OpenAI) - spawned as `codex` (`cli/src/codex/codexLocal.ts`)
  - Auth injection (runner): temp `CODEX_HOME` with `auth.json` (`cli/src/runner/README.md`)
- Gemini CLI (Google) - spawned as `gemini` (`cli/src/gemini/geminiLocal.ts`)
  - Env wiring: `GEMINI_PROJECT_DIR`, `GEMINI_CLI_SYSTEM_SETTINGS_PATH` (`cli/src/gemini/geminiLocal.ts`)
  - Secrets commonly present (filtered from remote terminals): `GEMINI_API_KEY`, `GOOGLE_API_KEY` (`cli/src/terminal/TerminalManager.ts`)
- OpenCode - spawned and configured with MCP hooks (`cli/src/opencode/opencodeLocalLauncher.ts`, `cli/src/opencode/utils/opencodeConfig.ts`)

**Voice Assistant:**
- ElevenLabs ConvAI API - agent auto-create + conversation tokens (`hub/src/web/routes/voice.ts`, `shared/src/voice.ts`)
  - Base URL: `https://api.elevenlabs.io/v1` (`shared/src/voice.ts`)
  - Auth: `ELEVENLABS_API_KEY` (optional `ELEVENLABS_AGENT_ID`) (`hub/src/web/routes/voice.ts`)
  - Endpoints used: agents list/create + conversation token (`hub/src/web/routes/voice.ts`)
  - Web client SDK: `@elevenlabs/react` (`web/package.json`, `web/src/realtime/RealtimeVoiceSession.tsx`)

**Messaging / Notifications:**
- Telegram Bot API - notifications + Mini App entrypoint (`hub/package.json` `grammy`, `hub/src/telegram/bot.ts`)
  - Auth: `TELEGRAM_BOT_TOKEN` (`hub/src/configuration.ts`)
  - Callback actions: `callback_query:data` routing (`hub/src/telegram/bot.ts`, `hub/src/telegram/callbacks.ts`)
- Web Push (browser push services) - push notifications to browser endpoints (`hub/package.json` `web-push`)
  - VAPID keys: generated/persisted under data dir (`hub/src/config/vapidKeys.ts`, `hub/src/config/settings.ts`)
  - Subscription + send flow: `hub/src/push/pushService.ts`, API routes `hub/src/web/routes/push.ts`

**Relay / Tunneling:**
- `tunwg` subprocess + relay API - public access tunnel (`hub/src/tunnel/tunnelManager.ts`, `hub/src/index.ts`)
  - Default relay API domain: `relay.hopi.run` (`shared/src/brand.ts`)
  - Env knobs: `HOPI_RELAY_API`, `HOPI_RELAY_AUTH`, `HOPI_RELAY_FORCE_TCP` (`hub/src/configuration.ts`, `hub/src/index.ts`)
  - `tunwg` env: `TUNWG_API`, `TUNWG_AUTH`, `TUNWG_RELAY`, `TUNWG_PATH` (`hub/src/tunnel/tunnelManager.ts`)
  - TLS readiness gate: certificate validation polling (`hub/src/tunnel/tlsGate.ts`)
  - Binary acquisition: GitHub Releases download script (`hub/scripts/download-tunwg.ts`)

## Data Storage

**Databases:**
- Local SQLite - hub primary persistence (`hub/src/store/index.ts`, `hub/src/configuration.ts`)
  - Client: `bun:sqlite` (`hub/src/store/index.ts`)
  - Default path: `${HOPI_HOME}/hopi.db` via `PRODUCT_DB_FILENAME` (`shared/src/brand.ts`, `hub/src/configuration.ts`)
  - Migration/validation tests: `hub/src/store/schemaMigration.test.ts`

**File Storage (local):**
- Hub settings file: `settings.json` under product home (`hub/src/config/settings.ts`)
- CLI runner state + locks under product home (`cli/src/runner/run.ts`, `shared/src/brand.ts`)

## Authentication & Identity

**Hub auth (web + API clients):**
- JWT - signing/verification via `jose` (`hub/package.json`, `hub/src/web/middleware/auth.ts`)
  - Secret generation/persistence: `hub/src/config/jwtSecret.ts`, `hub/src/config/settings.ts`

**CLI ↔ hub trust:**
- Shared token: `CLI_API_TOKEN` (`hub/src/configuration.ts`, `hub/src/config/cliApiToken.ts`)

## Monitoring & Observability

- Logging: stdout/stderr; Hono request logger middleware (`hub/src/web/server.ts`)
- No dedicated error tracking/metrics SDK observed (none in root `package.json` / `hub/package.json` / `web/package.json`)

## CI/CD & Deployment

**CI Pipeline:**
- GitHub Actions - install/typecheck/test (`.github/workflows/test.yml`)
  - Tooling: `oven-sh/setup-bun@v2` (`.github/workflows/test.yml`)

**Hosting / Deployment:**
- Web app → GitHub Pages, custom domain `app.hopi.run` (`.github/workflows/webapp.yml`, `shared/src/brand.ts`)
- Releases → GitHub Releases assets (`.github/workflows/release.yml`)
- Homebrew formula update (best-effort) (`.github/workflows/release.yml`, `cli/scripts/update-homebrew-formula.ts`)

## Environment Configuration

**Hub (direct connect):**
- Core: `HOPI_HOME`, `DB_PATH`, `HOPI_LISTEN_HOST`, `HOPI_LISTEN_PORT`, `HOPI_PUBLIC_URL`, `CORS_ORIGINS` (`hub/src/configuration.ts`)
- Telegram: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_NOTIFICATION` (`hub/src/configuration.ts`)
- Voice: `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` (`hub/src/web/routes/voice.ts`)
- Relay: `HOPI_RELAY_API`, `HOPI_RELAY_AUTH`, `HOPI_RELAY_FORCE_TCP` (`hub/src/configuration.ts`)
- Push: `VAPID_SUBJECT` (+ persisted VAPID keys) (`hub/src/configuration.ts`, `hub/src/config/vapidKeys.ts`)

**CLI / Runner:**
- Hub URL: `HOPI_API_URL` (`.github/workflows/test.yml`, `shared/src/brand.ts`)
- Token: `CLI_API_TOKEN` (`.github/workflows/test.yml`)

## Webhooks & Callbacks

**Incoming:**
- Telegram callback queries (InlineKeyboard buttons) (`hub/src/telegram/bot.ts`, `hub/src/telegram/callbacks.ts`)
- Runner local webhook: session self-report POST `/session-started` (control server) (`cli/src/runner/README.md`, `cli/src/runner/run.ts`)

**Outgoing:**
- ElevenLabs REST calls (agent discovery/create + token) (`hub/src/web/routes/voice.ts`)
- Web Push sends to subscription endpoints (vendor-managed) (`hub/src/push/pushService.ts`)

---

*Integration audit: 2026-03-07*
*Update when adding/removing external services*

