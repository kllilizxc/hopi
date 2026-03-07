# HOPI

## What This Is

HOPI is a local-first platform for running coding agents on your own machine and controlling them remotely through web, PWA, and related surfaces. This brownfield iteration focuses on making project actions feel like normal agent work inside the conversation flow instead of brittle, fixed backend workflows.

## Core Value

Project actions should feel as flexible and self-correcting as normal agent work: agent sees tool output, adapts, fixes, retries.

## Requirements

### Validated

- ✓ Local agent sessions can be started on the machine and controlled remotely through hub + web surfaces — existing
- ✓ Projects, tasks, workspaces, and task-linked sessions already exist as the main work-management model — existing
- ✓ Worktree-aware task flows already support explicit Merge and Preview actions in the product — existing
- ✓ Project-scoped automation scripts under `.hopi/` already exist as a product concept for init / merge / preview — existing

### Active

- [ ] Merge action becomes conversation-native: clicking Merge should trigger a normal agent-driven action flow instead of a brittle detached workflow
- [ ] First action attempt should be running the project's merge script/tool path inside the workspace sandbox using normal tool-call semantics
- [ ] Agent must observe success/failure directly from tool-call output and decide follow-up steps without special-cased hidden backend logic
- [ ] On failure, agent should stay in the loop: inspect git state, resolve conflicts, fix `.hopi/merge.sh` or related workspace files, and retry until merge succeeds or a real blocker is reached
- [ ] The design must preserve project-level flexibility; no single fixed init / merge / preview workflow can be assumed across repos

### Out of Scope

- Full parity for Preview in this first slice — defer until merge-first loop proves out
- Full parity for Init in this first slice — defer until merge-first loop proves out
- A generic action framework for every future project action on day one — likely direction, but not committed for merge-first v1

## Context

HOPI already has most building blocks for this direction, but in fragmented form. The hub creates an "Initialize project scripts" bootstrap task that asks the agent to create `.hopi/init.sh`, `.hopi/merge.sh`, and `.hopi/preview.sh`. Starting a task session will attempt to run `.hopi/init.sh` if present before sending the kickoff prompt. Merge and Preview are currently exposed as explicit UI actions, and both have partial automation: Preview can ask the agent to create/fix `.hopi/preview.sh` when no runnable command is found, and Merge can ask the agent to run/fix `.hopi/merge.sh` before falling back to built-in merge behavior.

The problem is product feel and reliability. Today these scripts often fail, the recovery loop is inconsistent, and failures are not handled like ordinary agent work. The desired direction is that action execution should happen in the same observable conversation/tool-call loop as any normal agent task, so the agent naturally reacts to stdout/stderr, edits scripts when needed, and retries.

This is a brownfield Bun-workspaces monorepo with shared protocol types, a Hub server coordinating sessions and actions, a CLI/runner hosting agents and preview processes, and a Web UI exposing task actions. Existing code already contains workflow profiles, worktree task flows, and partial project-script automation that can be evolved instead of replaced.

## Constraints

- **Sandbox**: All automatic fixes and retries must stay inside the workspace sandbox — no outside-workspace magic
- **Product fit**: Must support highly customized project workflows; fixed universal script semantics will break on real repos
- **UX**: Action execution should look like normal agent flow with normal tool calls and visible reasoning from outputs
- **Brownfield**: Must integrate with existing projects/tasks/worktrees/session model instead of replacing the current architecture
- **Reliability**: System should stop only on real blockers that require human judgment or work outside the sandbox

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Start with Merge first | Highest pain point and clearest closed loop for proving the conversation-native action model | — Pending |
| Keep execution inside workspace sandbox | Preserves safety boundary and matches how users already trust normal agent work | — Pending |
| Use normal tool-call flow as the action runtime | Agent should react to real command output instead of backend-only status transitions | — Pending |
| Let agent repair scripts and retry | Project automation is too customized for a fixed workflow to succeed broadly | — Pending |

---
*Last updated: 2026-03-07 after initialization*
