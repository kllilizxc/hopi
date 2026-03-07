# Codebase Concerns

**Analysis Date:** 2026-03-07

## Tech Debt

**Runner state + lifecycle bookkeeping (local files):**
- Issue: `runner.state.json` written non-atomically; deleted on stop/exit; inconsistent caller envelopes; stale/corrupt state not first-class
- Files: `cli/src/persistence.ts`, `cli/src/runner/controlClient.ts`, `cli/src/runner/controlServer.ts`, `cli/src/runner/README.md`
- Why: pragmatic first pass; optimized for “works on my machine” local runner control
- Impact: corrupted state => “runner not running” false negatives; poor diagnostics; runner upgrades + spawn requests edge cases; hard to recover safely
- Fix approach: atomic write (tmp + rename) for `writeRunnerState`; keep state file w/ `status` + `reason`; typed envelopes for control client; explicit corrupted-file handling (quarantine + recreate)

**Mixed “happy” legacy naming in core runtime paths:**
- Issue: inconsistent naming (happy/hopi) in critical code paths and types; cognitive overhead + grepping pitfalls
- Files: `cli/src/claude/utils/startHappyServer.ts`, `cli/src/claude/utils/startHookServer.ts`, `cli/src/modules/common/hooks/generateHookSettings.ts`, `cli/src/runner/README.md`
- Why: brand rename + incremental refactors; keeping old function names to reduce churn
- Impact: onboarding friction; misreads during incident response; higher chance of wiring wrong env/paths when adding features
- Fix approach: rename hot-path symbols + filenames; add lightweight “naming map” doc; keep compatibility via re-export shims (repo allows breaking formats, but internal naming still matters)

**Schema migrations embedded in a single Store class (SQLite):**
- Issue: schema creation + migrations in one large file; migrations rely on column-existence checks; limited observability; no rollback strategy
- Files: `hub/src/store/index.ts`, `hub/src/store/schemaMigration.test.ts`
- Why: fast iteration; Bun `bun:sqlite` simplicity; avoid external migration tooling
- Impact: high-risk edits to SQL string; hard to reason about partial-migrate states; future schema bumps more brittle
- Fix approach: split migrations into versioned modules; add explicit “fromVersion -> toVersion” runner with logging; snapshot tests for schema shape

**RPC boundary tight-coupling (hub ⇄ cli) via string method keys + JSON params:**
- Issue: RPC method naming convention `sessionId:method`; params JSON stringified; registry last-writer-wins; poor backpressure story
- Files: `hub/src/sync/rpcGateway.ts`, `hub/src/socket/rpcRegistry.ts`, `hub/src/socket/server.ts`
- Why: quick to ship; Socket.IO acks as transport; avoid shared RPC framework
- Impact: fragile when multiple CLIs connect / reconnect; opaque failures (“handler not registered”); difficult to evolve methods safely
- Fix approach: centralize RPC method constants in `shared/src/socket.ts` (or similar); add handler health/heartbeat; add structured error codes + retries where safe

## Known Bugs

**`debugLargeJson()` claims to skip in production but still logs object:**
- Symptoms: large JSON written to local logs even when `DEBUG` unset; log spam / disk growth; potential accidental sensitive data capture
- Trigger: any call site using `logger.debugLargeJson()` (e.g. startup env logging)
- Files: `cli/src/ui/logger.ts`, `cli/src/claude/runClaude.ts`
- Workaround: avoid calling `debugLargeJson` in prod paths; set `DEBUG` only when needed (still logs though)
- Root cause: missing early `return` in `debugLargeJson()` when `!process.env.DEBUG`

**Runner control client swallows actionable errors:**
- Symptoms: commands like “list sessions” quietly return `[]` when runner unreachable / stale; user sees “nothing” vs “error”
- Trigger: stale `runner.state.json` or runner not running
- Files: `cli/src/runner/controlClient.ts`
- Workaround: run doctor / inspect logs; manually remove `~/.hopi/runner.state.json`
- Root cause: `runnerPost()` returns `{ error } | any`; callers assume success shape and default to empty results

**Silent mode coercion on runner-spawned interactive sessions:**
- Symptoms: runner-started sessions requested as `local` become `remote` without error; confusing UX; hard to debug “why local doesn’t work”
- Trigger: `startedBy === 'runner'` + `startingMode === 'local'`
- Files: `cli/src/claude/runClaude.ts`
- Workaround: explicitly request `startingMode: 'remote'` for runner spawn
- Root cause: compatibility hack; TODO notes intent to error instead

## Security Considerations

**Local secrets + tokens stored under `~/.hopi` without enforced strict permissions:**
- Risk: `settings.json`, `access.key`, `runner.state.json`, hook settings may be readable by other local users on shared machines (depends on umask + existing dir perms)
- Files: `cli/src/configuration.ts`, `cli/src/persistence.ts`, `cli/src/modules/common/hooks/generateHookSettings.ts`, `hub/src/configuration.ts`, `hub/src/config/settings.ts`
- Current mitigation: some dirs created with `mode: 0o700` in hub store; warnings about weak tokens
- Recommendations: create/chmod data dirs to `0o700`; write secret files as `0o600`; audit for any secret-bearing temp files; add a startup “permissions doctor” check

**Opt-in remote logging can exfiltrate sensitive data (no redaction):**
- Risk: enabling `DANGEROUSLY_LOG_TO_SERVER_FOR_AI_AUTO_DEBUGGING` sends logs to `${API_URL}/logs-combined-from-cli-and-mobile-for-simple-ai-debugging`; may include paths, prompts, attachments metadata, etc.
- Files: `cli/src/ui/logger.ts`
- Current mitigation: off by default; requires env var + `HOPI_API_URL`
- Recommendations: add redaction (tokens, keys, file contents); require explicit allowlist of fields; force HTTPS-only endpoints; show loud UI warning with exact destination URL

**Runner control HTTP server has no auth (localhost-only but still multi-user risk):**
- Risk: any local process can stop/spawn sessions if it can reach the random localhost port; state file reveals port; on multi-user hosts this is privilege boundary
- Files: `cli/src/runner/controlServer.ts`, `cli/src/runner/controlClient.ts`, `cli/src/persistence.ts`
- Current mitigation: binds to `127.0.0.1` only; port randomized
- Recommendations: require per-runner auth token (header); store token in runner state with strict perms; optionally bind to Unix socket where available

**Supply-chain risk: downloads “latest” `tunwg` binaries without integrity verification:**
- Risk: compromised GitHub release / MITM / tampered artifacts => shipped binary executes as part of relay mode; non-reproducible builds
- Files: `hub/scripts/download-tunwg.ts`
- Current mitigation: HTTPS + GitHub redirects; none for checksum/signature pinning
- Recommendations: pin exact version + SHA256; verify checksums; prefer vendored releases or GitHub provenance/SLSA verification; allow offline builds

**Single shared secret (`CLI_API_TOKEN`) is high blast-radius:**
- Risk: token leak grants full CLI + web access for that namespace; no per-device revocation
- Files: `hub/src/web/routes/auth.ts`, `hub/src/socket/server.ts`, `hub/src/config/cliApiToken.ts`
- Current mitigation: strong random default token generation; weak-token warning
- Recommendations: add token rotation + multiple tokens; per-device tokens; revoke list; audit log for auth events

## Performance Bottlenecks

**Base64 uploads in JSON (50MB cap) => memory spikes + overhead:**
- Problem: request body carries base64 string; decoded into Buffer; copies in memory; 50MB binary ≈ 67MB base64 string + parse overhead
- Files: `hub/src/web/routes/sessions.ts`, `hub/src/sync/rpcGateway.ts`, `cli/src/modules/common/handlers/uploads.ts`
- Measurement: not measured; worst-case multi-upload can exceed typical Bun/Node memory headroom on small VPS
- Cause: JSON API simplicity; no streaming multipart; cross-transport via RPC
- Improvement path: switch to multipart upload or chunked streaming; enforce `maxRequestBodySize` explicitly; add per-namespace rate limiting + concurrency limits

**Unbounded SQLite growth (messages, logs, uploads) with limited retention strategy:**
- Problem: `messages.content` stored as JSON TEXT; no TTL; session/history accumulates; WAL files can grow
- Files: `hub/src/store/index.ts`, `hub/src/store/messages.ts`, `hub/src/sync/messageService.ts`, `cli/src/ui/logger.ts`, `cli/src/modules/common/handlers/uploads.ts`
- Measurement: not measured; long-running usage likely GBs over months
- Cause: local-first persistence; no pruning policy; debug logs always-on to file
- Improvement path: add retention settings (max sessions/messages/bytes); periodic vacuum/checkpoint; log rotation; upload dir cleanup on session end

**SessionCache todo backfill scans recent messages per session on first load:**
- Problem: on first refresh of a session with `todos === null`, loads up to 200 messages and scans backwards for todo-write content
- Files: `hub/src/sync/sessionCache.ts`
- Measurement: not measured; O(num_sessions * 200) JSON parses on cold start
- Cause: backwards-compat todo migration strategy
- Improvement path: migrate todos in DB with one-time migration job; store todo events separately; clear backfill tracking maps on session removal

## Fragile Areas

**Cascading “best-effort” error swallowing in persistence + store setup:**
- Why fragile: many `try { chmodSync(...) } catch {}` patterns; failures become silent misconfig (permissions, missing dirs, etc.)
- Common failures: secrets/files created with wrong perms; DB or settings dir not writable; hard-to-debug runtime errors later
- Safe modification: add structured logging for failures; keep behavior but emit warnings once; add doctor checks
- Test coverage: limited targeted tests for permissions scenarios

**Runner/CLI version drift handling is explicitly “naive”:**
- Why fragile: runner might keep running after CLI upgrade; spawn requests may route to old binary; current logic mostly boolean checks
- Common failures: runner spawns sessions with mismatched protocol; confusing “handler not registered”; stale runner state files
- Files: `cli/src/runner/controlClient.ts`, `cli/src/runner/run.ts`, `cli/src/runner/README.md`
- Safe modification: implement explicit “runner needs restart” state; handshake protocol version; migrate runner state file format atomically
- Test coverage: integration tests exist but missing corrupted state + uninstall scenarios (`cli/src/runner/runner.integration.test.ts`)

## Scaling Limits

**SSE + Socket.IO fanout is in-memory and linear per connection:**
- Current capacity: depends on machine; each broadcast loops all SSE connections + Socket.IO rooms
- Limit: high connection counts (many phones/browsers) => event loop overhead; memory retention if unsubscribe not triggered
- Symptoms at limit: delayed updates; heartbeats lag; forced disconnects
- Scaling path: per-namespace connection caps; backpressure/queueing; shard by namespace; consider Redis pubsub only if needed
- Files: `hub/src/sse/sseManager.ts`, `hub/src/socket/server.ts`, `hub/src/sync/eventPublisher.ts`

## Dependencies at Risk

**`@socket.io/bun-engine` is early (`^0.1.0`):**
- Risk: breaking changes / edge-case bugs under load; Bun runtime differences vs Node
- Impact: realtime disconnects; terminal/SSE reliability; upgrade churn
- Migration plan: pin exact versions; add soak tests; keep a Node engine fallback option
- Files: `hub/package.json`, `hub/src/socket/server.ts`

**Bun runtime surface (bun:sqlite, Bun.serve) version sensitivity:**
- Risk: behavior changes in `bun:sqlite` or server limits; packaging differences in compiled mode
- Impact: data corruption edge cases; request body size mismatches; platform-specific bugs
- Migration plan: pin Bun version; CI matrix; add smoke tests around uploads + sqlite migrations
- Files: `hub/src/store/index.ts`, `hub/src/web/server.ts`

**MCP SDK integration (`@modelcontextprotocol/sdk`) moving target:**
- Risk: protocol/tooling changes can break `change_title` tool or HTTP transport assumptions
- Impact: Claude integration regressions; silent failures in title tool
- Migration plan: pin SDK; contract tests; feature-flag MCP server startup
- Files: `cli/src/claude/utils/startHappyServer.ts`

## Missing Critical Features

**Security hardening defaults for “exposed hub” deployments:**
- Problem: easy to bind hub to non-loopback without TLS/rate limits; shared token auth; no IP allowlist
- Current workaround: recommended local-first + relay; user-managed tunnels
- Blocks: safe self-host on public internet for non-expert users
- Implementation complexity: medium; middleware + docs + config validation
- Files: `hub/src/web/server.ts`, `hub/src/socket/server.ts`, `hub/src/configuration.ts`

**Explicit retention + cleanup policy for logs/uploads/db:**
- Problem: local-first persistence grows unbounded; cleanup script exists but not automatic
- Current workaround: manual `bun run clean-session` / manual file deletion
- Blocks: long-lived installs; low-storage devices; shared machines
- Implementation complexity: medium; background jobs + config; careful defaults
- Files: `package.json`, `hub/scripts/cleanup-sessions.ts`, `cli/src/ui/logger.ts`, `cli/src/modules/common/handlers/uploads.ts`

## Test Coverage Gaps

**Runner persistence corruption + recovery paths:**
- What's not tested: corrupted `runner.state.json`, partial writes, lock-file stale recovery, uninstall/reinstall scenarios
- Risk: user stuck in broken runner state; opaque UX; accidental orphan processes
- Priority: High
- Difficulty to test: medium; needs filesystem fault injection / temp dirs
- Files: `cli/src/persistence.ts`, `cli/src/runner/runner.integration.test.ts`

**End-to-end realtime flows (auth → SSE/socket → RPC) lack true integration tests:**
- What's not tested: browser/webapp auth + SSE subscription + terminal socket + RPC errors/timeout handling under reconnect
- Risk: regressions slip through; flakey remote control experience
- Priority: Medium
- Difficulty to test: high; needs multi-process harness or playwright-style tests
- Files: `hub/src/web/routes/events.ts`, `hub/src/socket/server.ts`, `hub/src/sync/rpcGateway.ts`, `web/src/hooks/useSSE.ts`

---

*Concerns audit: 2026-03-07*
*Update as issues are fixed or new ones discovered*

