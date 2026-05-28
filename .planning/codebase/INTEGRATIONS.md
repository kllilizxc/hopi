# External Integrations

**Analysis Date:** 2026-03-29

## APIs & External Services

**AI Coding Agents:**
- Claude Code (Anthropic) - spawned locally as `claude` and driven through the CLI runner (`cli/src/claude/`, `cli/src/commands/claude.ts`)
  - Auth: `CLAUDE_CODE_OAUTH_TOKEN` injected by the runner when available (`cli/src/runner/README.md`)
  - Transport: local process + Socket.IO bridge to the hub
- Codex CLI (OpenAI) - spawned locally as `codex` (`cli/src/codex/`, `cli/src/codex/codexLocal.ts`)
  - Auth: temporary `CODEX_HOME` with `auth.json` created by the runner (`cli/src/runner/README.md`)
  - Transport: local process + hub RPC bridge
- Gemini CLI (Google) - spawned locally as `gemini` (`cli/src/gemini/`, `cli/src/gemini/geminiLocal.ts`)
  - Env wiring: `GEMINI_PROJECT_DIR`, `GEMINI_CLI_SYSTEM_SETTINGS_PATH`, plus optional `GEMINI_API_KEY` / `GOOGLE_API_KEY` passthroughs (`cli/src/gemini/utils/config.ts`, `cli/src/terminal/TerminalManager.ts`)
- OpenCode - spawned locally with MCP hooks and configured via the runner (`cli/src/opencode/`, `cli/src/opencode/opencodeLocalLauncher.ts`)

**Voice Assistant:**
- ElevenLabs ConvAI API - agent lookup/create + conversation token flow (`hub/src/web/routes/voice.ts`, `shared/src/voice.ts`)
  - SDK/client: `@elevenlabs/react` in the web app (`web/package.json`, `web/src/realtime/RealtimeVoiceSession.tsx`)
  - Auth: `ELEVENLABS_API_KEY` and optional `ELEVENLABS_AGENT_ID` (`hub/src/configuration.ts`, `hub/src/web/routes/voice.ts`)

**Messaging / Notifications:**
- Telegram Bot API - bot notifications and Mini App entrypoint (`hub/package.json`, `hub/src/telegram/bot.ts`)
  - Auth: `TELEGRAM_BOT_TOKEN` (`hub/src/configuration.ts`)
  - Callbacks: inline keyboard callback queries in `hub/src/telegram/callbacks.ts`
- Web Push - browser push notifications to subscribed endpoints (`hub/package.json`, `hub/src/push/pushService.ts`)
  - Keys: VAPID keypair generated and persisted under the hub data directory (`hub/src/config/vapidKeys.ts`, `hub/src/config/settings.ts`)
  - API routes: `hub/src/web/routes/push.ts`

**Relay / Tunneling:**
- `tunwg` + relay API - public access tunnel and encrypted relay mode (`hub/src/tunnel/tunnelManager.ts`, `hub/src/index.ts`)
  - Default relay domain: `relay.hopi.run` via `shared/src/brand.ts`
  - Env knobs: `HOPI_RELAY_API`, `HOPI_RELAY_AUTH`, `HOPI_RELAY_FORCE_TCP` (`hub/src/configuration.ts`)
  - TLS readiness gate: `hub/src/tunnel/tlsGate.ts`
  - Binary acquisition: `hub/scripts/download-tunwg.ts`

## Data Storage

**Databases:**
- Local SQLite - primary hub persistence (`hub/src/store/index.ts`)
  - Client: `bun:sqlite`
  - Default location: `~/.hopi/hopi.db` unless `DB_PATH` overrides it (`hub/src/configuration.ts`, `shared/src/brand.ts`)
  - Schema coverage: sessions, machines, messages, users, push subscriptions, projects, workspaces, tasks (`hub/src/store/index.ts`)

**File Storage:**
- Hub settings and secrets under `~/.hopi` / `HOPI_HOME` (`hub/src/config/settings.ts`, `hub/src/configuration.ts`)
  - `settings.json` - persisted server config
  - `access.key` / runner state files - CLI runner persistence (`cli/src/persistence.ts`)
  - `runner.state.json`, logs, and lockfiles - runner lifecycle state (`cli/src/persistence.ts`)
- Embedded or build-time web assets in `web/dist` or bundled into the single executable (`hub/src/web/server.ts`)

## Authentication & Identity

**Hub auth:**
- JWT access tokens - issued and verified with `jose` (`hub/package.json`, `hub/src/web/middleware/auth.ts`)
  - Secret lifecycle: generated/persisted in `hub/src/config/jwtSecret.ts`
- CLI shared secret: `CLI_API_TOKEN` (`hub/src/configuration.ts`, `hub/src/config/cliApiToken.ts`)
  - Browser and CLI clients can use `CLI_API_TOKEN[:namespace]`; namespace suffix is parsed server-side

**Telegram identity:**
- Telegram initData verification for auth and binding (`hub/src/web/routes/auth.ts`, `hub/src/web/routes/bind.ts`)
  - Namespace binding uses `CLI_API_TOKEN:<namespace>` semantics

## Monitoring & Observability

- Logging is stdout/stderr only in the hub and CLI (`hub/src/web/server.ts`, `cli/src/ui/logger.ts`)
- No dedicated error-tracking or analytics SaaS is wired in the current packages

## CI/CD & Deployment

**CI Pipeline:**
- GitHub Actions - test/typecheck/build flows (`.github/workflows/test.yml`, `.github/workflows/release.yml`, `.github/workflows/webapp.yml`)

**Hosting:**
- GitHub Pages - public web app deployment (`.github/workflows/webapp.yml`, `shared/src/brand.ts`)
- GitHub Releases - binary distribution artifacts (`.github/workflows/release.yml`)
- Homebrew formula update path - release automation step (`cli/scripts/update-homebrew-formula.ts`)

## Environment Configuration

**Hub:**
- `HOPI_HOME`, `DB_PATH`, `HOPI_LISTEN_HOST`, `HOPI_LISTEN_PORT`, `HOPI_PUBLIC_URL`, `CORS_ORIGINS` (`hub/src/configuration.ts`)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_NOTIFICATION` (`hub/src/configuration.ts`)
- `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID` (`hub/src/web/routes/voice.ts`)
- `HOPI_RELAY_API`, `HOPI_RELAY_AUTH`, `HOPI_RELAY_FORCE_TCP` (`hub/src/configuration.ts`)
- `VAPID_SUBJECT` (`hub/src/index.ts`, `hub/src/configuration.ts`)

**CLI / Runner:**
- `HOPI_API_URL` - hub base URL for direct connect (`cli/src/configuration.ts`)
- `CLI_API_TOKEN` - shared secret for hub auth and runner RPC (`cli/src/configuration.ts`, `cli/src/api/auth.ts`)
- `HOPI_HOME` - local config/data root (`cli/src/configuration.ts`, `cli/src/persistence.ts`)
- Runner env: `HOPI_RUNNER_HEARTBEAT_INTERVAL`, `HOPI_RUNNER_HTTP_TIMEOUT`, `HOPI_WORKTREE_*`, `HOPI_CLAUDE_PATH`, `HOPI_HTTP_MCP_URL` (`cli/src/configuration.ts`, `cli/src/runner/README.md`)

**Web:**
- `HOPI_HUB_URL`, `HOPI_LISTEN_PORT`, `HOPI_WEB_PORT`, `VITE_BASE_URL` drive local dev/proxy behavior (`web/vite.config.ts`)

## Webhooks & Callbacks

**Incoming:**
- Telegram callback queries from inline buttons (`hub/src/telegram/bot.ts`, `hub/src/telegram/callbacks.ts`)
- Runner session webhook `POST /session-started` to the local control server (`cli/src/runner/README.md`, `cli/src/runner/run.ts`)

**Outgoing:**
- ElevenLabs REST calls for agent discovery/create/token issuance (`hub/src/web/routes/voice.ts`)
- Web Push notifications to browser endpoints managed by push subscription APIs (`hub/src/push/pushService.ts`, `hub/src/web/routes/push.ts`)

---

*Integration audit: 2026-03-29*
*Update when adding/removing external services*
