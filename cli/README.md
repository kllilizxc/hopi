# hopi CLI

Run Claude Code, Codex, Gemini, or OpenCode sessions from your terminal and control them remotely through the hopi hub.

## What it does

- Starts Claude Code sessions and registers them with hopi-hub.
- Starts Codex mode for OpenAI-based sessions.
- Starts Gemini mode via ACP (Anthropic Code Plugins).
- Starts OpenCode mode via ACP and its plugin hook system.
- Provides an MCP stdio bridge for external tools.
- Manages a background runner for long-running sessions.
- Includes diagnostics and auth helpers.

## Typical flow

1. Start the hub and set env vars (see ../hub/README.md).
2. Set the same CLI_API_TOKEN on this machine or run `hopi auth login`.
3. Run `hopi` to start a session.
4. Use the web app or Telegram Mini App to monitor and control.

## Commands

### Session commands

- `hopi` - Start a Claude Code session (passes through Claude CLI flags). See `src/index.ts`.
- `hopi codex` - Start Codex mode. See `src/codex/runCodex.ts`.
- `hopi codex resume <sessionId>` - Resume existing Codex session.
- `hopi gemini` - Start Gemini mode via ACP. See `src/agent/runners/runAgentSession.ts`.
  Note: Gemini runs in remote mode only; it waits for messages from the hub UI/Telegram.
- `hopi opencode` - Start OpenCode mode via ACP. See `src/opencode/runOpencode.ts`.
  Note: OpenCode supports local and remote modes; local mode streams via OpenCode plugins.

### Authentication

- `hopi auth status` - Show authentication configuration and token source.
- `hopi auth login` - Interactively enter and save CLI_API_TOKEN.
- `hopi auth logout` - Clear saved credentials.

See `src/commands/auth.ts`.

### Runner management

- `hopi runner start` - Start runner as detached process.
- `hopi runner stop` - Stop runner gracefully.
- `hopi runner status` - Show runner diagnostics.
- `hopi runner list` - List active sessions managed by runner.
- `hopi runner stop-session <sessionId>` - Terminate specific session.
- `hopi runner logs` - Print path to latest runner log file.

See `src/runner/run.ts`.

### Diagnostics

- `hopi doctor` - Show full diagnostics (version, runner status, logs, processes).
- `hopi doctor clean` - Kill runaway HOPI processes.

See `src/ui/doctor.ts`.

### Other

- `hopi hub` - Start the bundled hub (single binary workflow).
- `hopi server` - Alias for `hopi hub`.

## Configuration

See `src/configuration.ts` for all options.

### Required

- `CLI_API_TOKEN` - Shared secret; must match the hub. Can be set via env or `~/.hopi/settings.json` (env wins).
- `HOPI_API_URL` - Hub base URL (default: http://localhost:3006).

### Optional

- `HOPI_HOME` - Config/data directory (default: ~/.hopi).
- `HOPI_EXPERIMENTAL` - Enable experimental features (true/1/yes).
- `HOPI_CLAUDE_PATH` - Path to a specific `claude` executable.

### Runner

- `HOPI_RUNNER_HEARTBEAT_INTERVAL` - Heartbeat interval in ms (default: 60000).
- `HOPI_RUNNER_HTTP_TIMEOUT` - HTTP timeout for runner control in ms (default: 10000).

### Worktree (set by runner)

- `HOPI_WORKTREE_BASE_PATH` - Base repository path.
- `HOPI_WORKTREE_BRANCH` - Current branch name.
- `HOPI_WORKTREE_NAME` - Worktree name.
- `HOPI_WORKTREE_PATH` - Full worktree path.
- `HOPI_WORKTREE_CREATED_AT` - Creation timestamp (ms).

## Storage

Data is stored in `~/.hopi/` (or `$HOPI_HOME`):

- `settings.json` - User settings (machineId, token, onboarding flag). See `src/persistence.ts`.
- `runner.state.json` - Runner state (pid, port, version, heartbeat).
- `logs/` - Log files.

## Requirements

- Claude CLI installed and logged in (`claude` on PATH).
- OpenCode CLI installed (`opencode` on PATH).
- Bun for building from source.

## Build from source

From the repo root:

```bash
bun install
bun run build:cli
bun run build:cli:exe
```

For an all-in-one binary that also embeds the web app:

```bash
bun run build:single-exe
```

## Source structure

- `src/api/` - Bot communication (Socket.IO + REST).
- `src/claude/` - Claude Code integration.
- `src/codex/` - Codex mode integration.
- `src/agent/` - Multi-agent support (Gemini via ACP).
- `src/opencode/` - OpenCode ACP + hook integration.
- `src/runner/` - Background service.
- `src/commands/` - CLI command handlers.
- `src/ui/` - User interface and diagnostics.
- `src/modules/` - Tool implementations (ripgrep, difftastic, git).

## Related docs

- `../hub/README.md`
- `../web/README.md`
