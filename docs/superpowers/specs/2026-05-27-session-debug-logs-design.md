# Session Debug Logs Design

## Context

HOPI sessions already have durable SQLite messages, but debugging message flow often needs a raw chronological trace across the web app, hub, Socket.IO, and the local agent. The debug trace should be easy to correlate from the UI, but the raw log contents should remain local to the hub machine.

The hub is the right logging boundary because it sees both directions:

- Web and Telegram prompts enter through `MessageService.sendMessage()` and `MessageService.injectMessage()`.
- Agent output enters through the CLI Socket.IO `message` handler.
- Session lifecycle and metadata/state updates enter through the CLI session handlers and `SessionCache`.

## Goals

- Write one log file per session in a temporary hub-local directory.
- Capture raw message-flow payloads for Claude, Codex, Gemini, and OpenCode without per-agent duplication.
- Give every session a short debug id that is visible and copyable in the UI.
- Keep logs bounded by total size and file count.
- Keep raw logs out of the web API and out of SQLite.

## Non-Goals

- No in-app log viewer.
- No HTTP endpoint for downloading raw logs.
- No redaction or schema-specific payload rewriting in the first version.
- No long-term archival guarantee.

## Approach

Add a hub-side `SessionDebugLogger` service. The service appends JSONL records under:

```text
${HOPI_HOME}/session-debug-logs
```

Each session maps to one log file. The filename includes a stable short debug id and a short session id prefix:

```text
S-8f3a2c1d-4b91e2a0.jsonl
```

The debug id is derived deterministically from the stored session id, so it does not require a database migration and stays stable after hub restarts. Collision risk is low for local debug use; if a collision is ever observed, the full session id remains in each log line.

Default retention:

- Max total directory size: 200 MB.
- Max log files: 200.
- Cleanup order: oldest file by mtime first.

Configuration:

- `HOPI_SESSION_DEBUG_LOGS=0` disables the logger.
- `HOPI_SESSION_DEBUG_LOG_MAX_BYTES` overrides the 200 MB default.
- `HOPI_SESSION_DEBUG_LOG_MAX_FILES` overrides the 200 file default.

## Log Record Format

Each line is one JSON object:

```json
{
    "ts": "2026-05-27T12:34:56.789Z",
    "time": 1780000496789,
    "sessionId": "4b91e2a0-...",
    "debugId": "S-8f3a2c1d",
    "namespace": "default",
    "event": "message.received",
    "direction": "cli-to-hub",
    "seq": 42,
    "localId": "optional-local-id",
    "payload": {}
}
```

Events to record:

- `session.created_or_loaded` when CLI creates or loads a session through `/cli/sessions`.
- `message.injected` for web or Telegram prompts sent to the agent.
- `message.received` for CLI/agent messages received by the hub.
- `session.metadata_update` for CLI metadata updates.
- `session.agent_state_update` for CLI agent-state updates.
- `session.alive` and `session.end` for lifecycle tracking.
- `session.deleted` and `session.merged` for destructive session operations.

## Backend Integration

Create `hub/src/sync/sessionDebugLogger.ts` with:

- `getSessionDebugId(sessionId: string): string`
- `createSessionDebugLogger(options)`
- `append(record)`
- retention cleanup helpers

Wire it into `SyncEngine` and pass it into:

- `MessageService` for injected web/Telegram messages.
- `registerSessionHandlers` for CLI message, metadata, state, alive, and end events.
- `SessionCache` or `SyncEngine` lifecycle methods for delete and merge records.

The logger must never throw into the session path. Filesystem failures are console warnings only, because debug logging must not break agent control.

## UI Integration

Expose `debugId` on both `Session` and `SessionSummary` protocol types.

Render the debug id in:

- Session list item metadata line.
- Session header metadata line.

Clicking the debug id copies it to clipboard. The UI only shows the short id; it does not show the local file path. The local operator can search the hub log directory by debug id.

## Privacy and Security

The logs intentionally store raw payloads. They can include prompts, tool inputs, tool results, paths, filenames, and attachment metadata. To keep the boundary clear:

- Logs stay in the hub data directory.
- Logs are not served by web routes.
- Logs are disabled with one environment variable.
- Retention is bounded by default.

## Testing

Backend tests:

- Debug id is stable for the same session id and has the expected prefix.
- Appending creates a JSONL file containing session id, debug id, event, direction, seq/local id, and payload.
- Cleanup removes oldest files when count exceeds the configured maximum.
- Cleanup removes oldest files when total size exceeds the configured maximum.
- `MessageService.injectMessage()` and CLI session handler message flow append to the same session log file.
- Logger failures do not prevent message persistence or event publishing.

Shared/web tests:

- `toSessionSummary()` includes `debugId`.
- Session list renders the debug id.
- Session header renders the debug id.

## Rollout

This is a breaking-change-friendly repo, but the change is additive. Existing sessions get debug ids automatically because ids are derived from the existing session id. Existing logs are not migrated.

