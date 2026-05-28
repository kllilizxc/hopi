# Projects — Worktree Sessions + Merge (Design Plan)

Date: 2026-02-26
Status: planning draft

## Goal

- Project setting: default sessions = `worktree` (vs `simple`)
- Task start-session: create git worktree first; agent works in worktree path
- Review flow: “Merge” button; merge worktree branch → target branch
- Guardrails: safe defaults; clear errors; no silent repo mutation

## Decisions (2026-02-26)

- Target branch default: project setting (`Project.worktreeTargetBranch`)
- Auto-commit: per conversation (1 user prompt → agent “ready” / stop responding)
- Merge strategy: TBD (merge commit vs squash; see “Merge strategy”)

## Non-goals (v1)

- Git hosting integration (PRs, reviews, CI)
- Auto-push / remote auth management
- Fancy conflict UI (beyond “conflict detected + instructions”)
- Multi-repo workspaces in one project (assume 1 repo per workspace path)

## Terminology

- **basePath**: git repo root (original workspace; `git rev-parse --show-toplevel`)
- **worktreePath**: new checkout path created by `git worktree add`
- **worktree branch**: branch created for worktree (current: `hopi-<name>`)
- **target branch**: branch user wants to merge into (project default; overrideable)

## Existing building blocks (reuse)

Already present:

- Worktree metadata on sessions: `shared/src/schemas.ts` (`WorktreeMetadataSchema`)
- Spawn API supports worktrees:
    - Web client: `web/src/api/client.ts` `spawnSession({ sessionType, worktreeName })`
    - Hub route: `hub/src/web/routes/machines.ts` `POST /api/machines/:id/spawn`
    - Hub sync: `hub/src/sync/syncEngine.ts` forwards `sessionType/worktreeName`
- Runner creates worktree + sets env + runs agent in worktree path:
    - `cli/src/runner/worktree.ts` (`createWorktree`)
    - `cli/src/runner/run.ts` (`sessionType === 'worktree'`)
- Session reads env → session metadata:
    - `cli/src/utils/worktreeEnv.ts`
    - `cli/src/agent/sessionFactory.ts` (adds `metadata.worktree`)

Implication:

- “Project worktree mode” mostly = pick `sessionType: 'worktree'` automatically for task sessions.

## Product UX (proposal)

### Project settings

Add section: “Worktree mode”

- Toggle: “Start task sessions in a worktree”
    - Default: off (no behavior change)
- Target branch (project setting; optional):
    - Input: `main` / `develop` / etc
    - Default behavior if unset: prompt user at merge time (don’t guess)
- Auto-commit mode:
    - Default: off
    - Option: “Auto-commit after each conversation”
        - definition: 1 user prompt + agent finished responding (session `thinking` false + “ready” event)
- Cleanup after merge:
    - Default: off
    - Option: “Remove worktree after successful merge”

### Task / session UI

When session has `metadata.worktree`:

- Show badge: “worktree”
- Show details (tooltip or collapsible):
    - branch (source): `metadata.worktree.branch`
    - basePath
    - worktree name
- Button: “Merge to <target>”
    - Disabled if session `thinking=true` (merge while agent running = risky)
    - Confirmation modal:
        - source branch, target branch
        - changed files count (+/-) if cheap to compute
        - warning if base repo dirty / worktree dirty (see merge semantics)

## Data model changes (shared + hub DB)

### Project fields (add)

Prefer explicit enum (future-proof):

- `defaultSessionType?: 'simple' | 'worktree'`
    - default = `simple`
- `worktreeTargetBranch?: string | null`
    - default = null (meaning “ask at merge time”)

Optional v1.1 fields (nice-to-have):

- `worktreeAutoCommitMode?: 'off' | 'per_conversation'`
- `worktreeCleanupAfterMerge?: boolean`

Shared updates:

- `shared/src/schemas.ts` `ProjectSchema` + derived `Project` type
- Web forms + API payloads
- Hub DB migration: add columns or JSON field (match existing store style)

## Task session spawn changes (hub)

Where:

- Task “start session” path (likely `hub/src/sync/taskSessionService.ts` or equivalent)
- Auto-run scheduler “start next planned” path

Behavior:

- Determine `sessionType`:
    - from project setting `defaultSessionType`
    - fallback `simple`
- If worktree:
    - pass `worktreeName` hint derived from task

Worktree name hint algorithm:

- Inputs: task id + task title
- Output: slug-ish, short, stable
- Example: `task-<taskId8>-<titleSlug>`
    - runner already normalizes + de-dupes (random suffix on collision)

Failure modes:

- Workspace path not a git repo:
    - v1: return actionable error (“Worktree requires git repo at <path>”)
    - optional: “fallback to simple session” (configurable; later)

## Auto-commit (per conversation)

Intent:

- Worktree branch always “merge-ready” (no uncommitted changes)
- Review granularity: 1 prompt → 1 commit (roughly)

Trigger (hub):

- On “conversation boundary”:
    - user prompt sent (real prompt; exclude automation/CLI-origin)
    - later: agent finished that prompt (session `thinking=false` + “ready” event after that prompt)
- Only when:
    - session has `metadata.worktree`
    - project `worktreeAutoCommitMode === 'per_conversation'`

Implementation sketch:

- Reuse same boundary detection as task status automation (`in_progress` → `in_review`)
- After boundary: hub RPC → CLI session process

RPC (new):

- `git-autocommit-worktree`
    - Inputs: `worktreePath`, `commitMessage`
    - Output:
        - `ok`
        - `commitHash?`
        - `skippedReason?` (`clean`)
        - `error?`

CLI semantics:

- If no changes: return `skippedReason: 'clean'`
- If mid-merge/rebase: error; do not proceed
- `git add -A`
- `git commit -m "<message>" --no-gpg-sign`
    - If git identity missing: actionable error (or temporary identity; decide later)

Commit message template (proposal):

- `HOPI: task <taskId8> — <task title>`
- optional: include timestamp or prompt id

## Merge feature architecture

### API surface (web → hub)

New endpoint (task-centric):

- `POST /api/tasks/:taskId/worktree/merge`
    - Body:
        - `targetBranch?: string` (optional; default project setting; if unset → require explicit)
        - `autoCommit?: boolean` (optional; default false; commit dirty worktree right before merge)
        - `cleanup?: boolean` (optional; default false)

Alternative (session-centric):

- `POST /api/sessions/:sessionId/worktree/merge`

Decision: prefer task route (fits “project/tasks drive sessions” mental model).

### Hub behavior (hub → cli RPC)

Preflight (hub):

- Resolve task → `activeSessionId`
- Load session; require `session.metadata.worktree` present
- Ensure machine online; ensure session active or at least reachable by RPC
- Enforce guard: refuse merge if session `thinking=true` unless explicit override

RPC:

- Add new RPC method: `git-merge-worktree`
    - Payload includes:
        - `basePath`, `worktreePath?`, `sourceBranch`, `targetBranch?`
        - `autoCommit`, `cleanup`
    - Return:
        - `ok: boolean`
        - `message` (human text)
        - `details` (stdout/stderr tail, commit hashes, conflict files)

Reason: existing `git-status` / `git-diff-*` likely scoped to session cwd; merge needs `basePath` access (outside worktreePath).

### CLI behavior (git ops)

Implement handler in CLI session process:

- Source of truth: session metadata `worktree` (or RPC payload cross-check)
- Safety:
    - only allow operations inside `basePath` git repo
    - never accept arbitrary paths from user without validating against metadata

Proposed merge semantics (v1)

Preflight:

- Validate git repo:
    - `git -C basePath rev-parse --show-toplevel` matches basePath
- Validate branches exist:
    - source: `worktree.branch`
    - target: resolved (explicit → project setting; else error)
- Validate basePath working tree clean:
    - if dirty → error + instructions (don’t auto-stash in v1)
- Validate worktree changes committed:
    - check `git -C worktreePath status --porcelain`
    - if dirty:
        - if `autoCommit=false` → error (“commit first or enable auto-commit”)
        - if `autoCommit=true`:
            - `git add -A`
            - `git commit -m "HOPI: <task title>"`
            - pass `--no-gpg-sign` to reduce surprises

Merge execution:

- Remember current branch in basePath (`git symbolic-ref --short HEAD`)
- `git -C basePath switch <targetBranch>`
- `git -C basePath merge --no-ff <sourceBranch>`
    - On conflict:
        - collect `git diff --name-only --diff-filter=U`
        - return error: conflict list + instructions (“open repo; resolve; commit; retry”)
- Optional: switch back to original branch (if different)

Cleanup (optional):

- `git -C basePath worktree remove --force <worktreePath>`
- Optional later: delete source branch (`git branch -D <sourceBranch>`) after successful merge

Notes / risks:

- target branch might be checked out in another worktree; checkout will fail
    - v1: surface error + instructions
    - later: detect path of checked-out branch via `git worktree list --porcelain`

## Observability + safety

- Hub logs:
    - merge requested: taskId, sessionId, source/target, autoCommit/cleanup flags
    - merge result: ok + conflict summary (no full diffs)
- UI:
    - show merge output tail on failure (copy-to-clipboard)
- Permissions:
    - merge is explicit user action; do not auto-trigger from agent output

## Test plan

Hub:

- Project setting persisted + returned (`ProjectSchema` validation)
- Start-session respects `defaultSessionType` (task start + auto-run)
- Merge endpoint:
    - rejects if no `activeSessionId`
    - rejects if session has no worktree metadata
    - calls RPC with expected payload

CLI:

- Unit tests for merge handler:
    - happy path (mock git exec)
    - dirty basePath → error
    - dirty worktree + autoCommit false → error
    - merge conflict → returns conflict files list

Manual:

- Real repo smoke:
    - enable project worktree mode
    - start task session → verify worktree directory created in `<repo>-worktrees/`
    - make change; commit; merge button → base branch gets commit

## Acceptance standard (v1)

Notation:

- `[ ]` todo / not accepted
- `[x]` accepted

### A0. Release gates

- [ ] No regression: existing `simple` sessions unchanged
- [ ] No crash: project without git workspace still usable (worktree mode off)

### A1. Project worktree mode

- [ ] Toggle exists in project settings
    - Accept: setting persisted; reload shows same value
- [ ] Start task session uses worktree when enabled
    - Accept: new session `metadata.worktree` present
    - Accept: session `metadata.path` points to worktreePath (not basePath)
    - Accept: base repo working tree not modified by agent edits

### A2. Merge button

- [ ] Merge button visible only when session has worktree metadata
- [ ] Merge disabled while session `thinking=true`
- [ ] Merge success path
    - Accept: target branch receives merge commit (or fast-forward)
    - Accept: UI shows success + new commit hash
- [ ] Merge failure path (conflicts / dirty repo)
    - Accept: UI shows actionable error + conflict file list if applicable

## Merge strategy

Two viable strategies; tradeoffs.

### Option A: merge commit (`git merge --no-ff`)

Effect:

- Target branch gets a merge commit.
- Source branch commits preserved on target (includes per-conversation auto-commits).

Pros:

- Full history kept; good for debug/bisect.
- Easy “revert entire feature” (revert merge commit).
- Explicit branch boundary in git log.

Cons:

- Noisy target history if auto-commit creates many small commits.
- Non-linear history (some teams dislike).

### Option B: squash merge (`git merge --squash` + commit)

Effect:

- Target branch gets 1 new commit with the combined diff.
- Source branch history not preserved on target.

Pros:

- Clean, linear target history.
- Pairs well with per-conversation auto-commit (commits stay on worktree branch for review).
- Single commit revert.

Cons:

- Harder to bisect on target (only 1 commit).
- Intermediate commit detail lost on target.
