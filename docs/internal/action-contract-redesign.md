# Action Contract Redesign

This document replaces the old mental model of "three unstable project scripts" with a new model:

- `setup` = multi-step setup workflow
- `preview` = multi-service runtime stack
- `merge` = platform-owned landing workflow with AI conflict resolution

## Goals

- Deterministic execution
- Structured state and errors
- No hidden command guessing
- No agent "self-repair" inside the critical execution path
- Safe support for complex repos with submodules, multiple services, and merge conflicts

## Core Strategy

### 1. Declarative Contract

Projects declare automation in `.hopi/actions.yaml`.

The contract is the platform API. Shell scripts become implementation details, not the source of truth.

### 2. Setup Workflow

- Multi-step
- Cacheable
- Resumable
- Supports built-in steps like `git_submodule`
- Supports explicit `run` steps

### 3. Preview Stack

- Multi-service
- Explicit commands only
- Per-service readiness checks
- One declared primary URL
- No package.json guessing

### 4. Merge Workflow

- Platform-owned merge / land flow
- Optional AI conflict-resolution subflow
- Verification required before landing
- Project config only declares strategy and policy

## TODO

- [x] Add shared `actions.yaml` schema and exported types
- [x] Add contract loader / validator in hub
- [x] Surface contract validation in project verification
- [x] Remove legacy script fallback from the target design
- [x] Design setup runner state machine
- [x] Design preview stack runner state machine
- [x] Design merge landing workflow with AI conflict-resolution state machine
- [x] Replace legacy preview command guessing
- [x] Move merge logic from repo script orchestration to platform-native flow
- [x] Remove dead merge-script helpers from hub route code
- [x] Add contract-driven merge verify command execution
- [x] Normalize bootstrap failure handling when agent sessions exit unexpectedly
- [x] Surface structured agent exit errors in the UI instead of raw event JSON
- [ ] Add migration docs from legacy `.hopi/*.sh` to `.hopi/actions.yaml`

## Current Status

- `setup` task start is now contract-only in `startSessionFromTask`
- Contract discovery now skips root-path candidates that are outside the session working directory and continues to the actual worktree root
- `project_init` bootstrap tasks now bypass contract/setup preflight so they can create or repair `.hopi/actions.yaml` from scratch
- `project_init` now seeds a starter `.hopi/actions.yaml` scaffold when the manifest is missing; scaffold stays intentionally incomplete so readiness does not go green by accident
- Bootstrap tasks no longer masquerade as successful init runs when the agent exits early; launcher exits now block the task with a concrete note
- Agent exit events are now normalized across launcher, hub, and web so `process-exited` shows as a readable error instead of raw JSON and still blocks the linked task
- `project_init` can no longer close on a bare ready event while `.hopi/actions.yaml` is still invalid; bootstrap now re-validates the contract, auto-prompts the agent to repair it, and only blocks after repair attempts are exhausted
- Worktree/base-root resolution is now shared across task start, bootstrap, preview, and merge entrypoints so contract lookup always prefers the live worktree root
- New worktree task sessions now branch from the project's configured target branch instead of the base repo's current `HEAD`
- Platform merge and worktree git operations now resolve a concrete git executable path instead of assuming `git` is available on the process PATH
- Merge verify `run` failures now use the same AI repair loop as merge conflicts instead of blocking immediately on the first failed check
- Missing or invalid setup contract now blocks task start directly
- `preview` start is now contract-only and uses declarative multi-service stack execution
- `merge` now loads `.hopi/actions.yaml`, uses platform-owned git merge strategies, and only hands conflicts to AI repair prompts
- `merge.verify` run checks now execute before landing; snapshot verification remains contract-controlled
- Remaining cleanup: write migration docs from legacy `.hopi/*.sh` to `.hopi/actions.yaml`

## Implementation Order

1. Contract schema
2. Contract validation and readiness visibility
3. Setup runner
4. Preview stack runner
5. Merge landing workflow
6. Legacy-path removal
