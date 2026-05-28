# HOPI

## What This Is

HOPI is a local-first platform for running coding agents on your own machine and controlling them remotely through web, PWA, and related surfaces. The next milestone extends the now-proven merge action runtime so Preview and Init feel like the same normal agent conversation flow instead of special-case automation.

## Core Value

Project actions should feel as flexible and self-correcting as normal agent work: agent sees tool output, adapts, fixes, retries.

## Requirements

### Validated

- ✓ Merge action can run inside the linked task conversation instead of a detached backend workflow — v1.0
- ✓ Merge now tries the repo-owned `.hopi/merge.sh` path first inside the workspace sandbox — v1.0
- ✓ Merge failures feed transcript-visible CLI output back into the same agent session for repair and retry — v1.0
- ✓ Merge completion is guarded by repo-truth verification instead of trusting script exit alone — v1.0
- ✓ Merge runtime state persists across refresh/reconnect with durable running/blocked/succeeded/canceled status — v1.0

### Active

- [ ] Preview action should use the same direct-run-first, conversation-native repair loop as Merge
- [ ] Preview should expose durable running/retrying/blocked/ready state plus cancel or retry controls across task and thread surfaces
- [ ] Init should become a first-class action runtime inside the started task session instead of a special pre-kickoff bootstrap path
- [ ] Init failures should keep the session alive, show transcript-visible CLI output, and let the agent repair or retry before continuing task work
- [ ] Merge, Preview, and Init should share one compact action-state contract so future repo-defined actions can reuse the same envelope

### Out of Scope

- Generic custom action framework beyond Merge, Preview, and Init — defer until parity proves the shared runtime shape
- Script manifests, health checks, or drift self-tests — useful later, but not needed to prove Preview or Init parity
- New hosted preview or deployment infrastructure — this milestone is about action-runtime parity, not new preview backends

## Context

The merge-first milestone is now complete: clicking Merge can run the repo-owned script directly in the linked session, append CLI-style results into the thread, hand off to the agent only when needed, verify repo truth before success, and stop repeated identical blockers with a clear manual next step. Preview already has partial direct-start and repair behavior, and Init already keeps failed starts alive in-session, but both still feel more special-cased than Merge. The next milestone should remove that product inconsistency by reusing the same runtime model, visible transcript style, retry semantics, and durable state vocabulary across Preview and Init.

This remains a brownfield Bun-workspaces monorepo with shared protocol types, a Hub server coordinating sessions and actions, a CLI/runner hosting agents and preview processes, and a Web UI exposing task actions. The best path is to reuse the action-runtime patterns already proven in Merge instead of inventing a second orchestration model.

## Constraints

- **Sandbox**: All automatic fixes and retries must stay inside the workspace sandbox — no outside-workspace magic
- **Product fit**: Must support highly customized project workflows; fixed universal script semantics will break on real repos
- **UX**: Action execution should look like normal agent flow with normal tool calls and transcript-visible outputs
- **Brownfield**: Must integrate with existing projects/tasks/worktrees/session model instead of replacing current architecture
- **Continuity**: Preview and Init work must reuse the merge-first runtime patterns without regressing the shipped Merge behavior

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Start with Merge first | Highest pain point and clearest closed loop for proving the conversation-native action model | ✓ Good |
| Keep execution inside workspace sandbox | Preserves safety boundary and matches how users already trust normal agent work | ✓ Good |
| Use normal tool-call flow as the action runtime | Agent should react to real command output instead of backend-only status transitions | ✓ Good |
| Let agent repair scripts and retry | Project automation is too customized for a fixed workflow to succeed broadly | ✓ Good |
| Do Preview parity before Init parity | Preview already has partial runtime hooks and should be the fastest path to visible product consistency | — Pending |
| Keep generic custom actions deferred until Preview and Init parity ship | Avoid overbuilding the framework before the three core actions share one proven contract | — Pending |

---
*Last updated: 2026-03-08 after v1.1 milestone kickoff*
