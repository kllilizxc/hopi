# OMC New Project Bootstrap Design

Date: 2026-04-06
Status: Draft for review
Scope: add a real "new project" entry inside `omc-prototype` for attaching an existing local git repo into OMC

## Summary

Add a first-class `新建项目` flow to `omc-prototype` so an operator can connect a real local repository to OMC without leaving the product or using manual `curl`.

Chosen scope:

- user selects an already-existing local git repo
- user may optionally provide a display name
- OMC attaches the repo as a real program
- if planning is missing, OMC automatically creates a minimal repo-local planning seed
- on success, UI switches to the new program and refreshes the live projection

Deliberately out of scope for this slice:

- creating a brand-new repo on disk
- attaching an explicit custom planning root during this flow
- collecting guided-planning brief fields during project creation
- auto-starting guided planning

## Problem

`omc-prototype` can now render real OMC programs, but it still lacks the first operational entry point an operator needs for testing:

- create or attach a fresh project from inside the UI

Current state:

- the header can switch between existing programs
- the backend already supports:
  - `attach-local-repo`
  - `create-planning-seed`
  - guided planning follow-up
- the prototype still forces users to leave the product and hit APIs manually

This creates two practical issues:

1. product gap
   The runtime looks real, but the first setup step still feels like developer-only plumbing.

2. misleading testing path
   users trying to validate the product naturally land on old attached programs instead of starting from a clean project they control

## Goals

- add a clear product-native `新建项目` action in live mode
- support the shortest useful onboarding path for testing real OMC behavior
- keep the flow aligned with existing hub OMC contracts
- automatically seed `.planning/*` only when planning is actually missing
- preserve the current live dashboard shell and program selector
- surface backend validation and failure messages clearly

## Non-Goals

- filesystem picker integration
- local repo creation
- non-git directory bootstrap
- custom planning-root branching in the first-step modal
- guided-planning launch in the same submit action
- replacing or redesigning the full dashboard shell

## User Story

As an operator testing OMC,
I want to click `新建项目`, point OMC at an existing local repo, and land in a clean attached program,
so I can validate real attach/bootstrap behavior without manual API calls.

## Chosen Approach

Use a header-level button plus a lightweight modal.

Why this approach:

- keeps project creation close to the existing program selector
- works whether or not other programs already exist
- requires minimal routing and state churn
- matches the current "live runtime inside one shell" posture

Rejected alternatives:

1. dashboard-only empty state
   Too hidden once any program already exists.

2. dedicated onboarding route
   More flexible long-term, but too heavy for the first real product-native attach path.

## UX Design

### Entry Point

In live mode, place a `新建项目` button in the header near the program selector.

Behavior:

- visible only when remote API context is active
- opens a modal on click
- does not navigate away from the current page

### Modal Structure

Modal title:

- `新建项目`

Helper copy:

- explain that OMC will attach an existing local git repo
- explain that a planning seed will be created automatically only if planning is missing

Fields:

1. `Repo 路径`
   - required
   - absolute local path
   - free text input for v1

2. `项目名`
   - optional
   - if empty, backend derives name from repo path

Primary action:

- `创建项目`

Secondary action:

- `取消`

### Happy Path

On submit:

1. call `attach-local-repo`
2. inspect returned planning state
3. if planning state is `missing`, call `create-planning-seed`
4. refresh live projection
5. select the new program
6. close modal
7. show a short success banner/toast

Success copy:

- attach only: `项目已接入`
- attach + seed: `项目已接入，并已创建 planning seed`

### Failure Handling

Failures stay inside the modal. User input remains intact.

Cases:

1. attach fails before program creation
   - show backend error inline
   - examples: invalid repo path, not a git repo, repo already attached

2. attach succeeds but auto-seed fails
   - do not lose the created program
   - keep the modal open with a partial-success message
   - expose a retry action for seed creation against the newly created program

3. refresh fails after attach/seed
   - show inline error
   - do not pretend success
   - keep enough local result state to allow retry

## Product Behavior Rules

### Attach Rule

Use the existing hub route:

- `POST /api/omc/programs/attach-local-repo`

Payload:

- `repoRoot`
- optional `name`

### Auto-Seed Rule

Only auto-create planning seed when attach response reports planning as missing.

Do not create seed when:

- planning status is already `detected`
- planning status is already `attached`
- planning tree already exists

This protects existing planning work and keeps the flow non-destructive.

### Program Selection Rule

After successful attach flow:

- switch local selected program id to the new program id
- trigger the same live projection refresh path used by manual program switching
- allow the normal SSE updates to take over afterward

### Partial Success Rule

If attach succeeded but seed failed:

- the new program remains valid and selectable
- UI must not roll selection back to the previous program automatically
- operator can retry seed from the modal state

## Architecture

### Remote API Layer

Extend `omc-prototype` remote API client with bootstrap methods already present in hub contracts:

- `attachLocalRepo({ repoRoot, name? })`
- `createPlanningSeed(programId)`

Return types should match shared OMC bootstrap contracts.

### UI State Layer

Keep modal state local to the root live shell rather than storing it in the projection store.

Reasoning:

- this is transient UI workflow state
- it does not belong to the world-model projection
- it should not pollute decision-topic or dashboard state

Local modal state should include:

- open/closed
- repo path
- optional name
- pending status
- error message
- partial-success metadata for seed retry if needed

### Store Integration

Reuse existing live refresh infrastructure.

Needed behavior:

- after successful bootstrap, request a fresh projection
- set selected program id to the returned program id
- let existing `loadLiveProjection()` rebuild live snapshot from hub truth

No new dashboard projection model is needed.

## Component Boundaries

### Root Header

Responsibilities:

- show `新建项目` button in live mode
- open/close creation modal
- display short success feedback after completion

Should not:

- own bootstrap networking logic directly

### Project Creation Modal

Responsibilities:

- collect repo path and optional name
- manage pending/error/partial-success presentation
- call submit handler passed from parent

Should not:

- know about dashboard projection internals
- fetch portfolio data itself

### Bootstrap Action Helper

Small helper function or hook.

Responsibilities:

- execute attach request
- branch into optional auto-seed
- normalize result for UI

Suggested result shape:

- `programId`
- `seedCreated`
- `planningStatus`
- `errorPhase` such as `attach` or `seed`

## Error Copy Principles

- keep raw backend detail when it is already actionable
- prefer direct language over generic failure banners
- distinguish:
  - `项目未接入`
  - `项目已接入，但 planning seed 创建失败`

Avoid vague copy like:

- `Something went wrong`
- `Could not create project`

unless no better server detail exists

## Testing Strategy

### Unit Tests

Add tests for remote API client bootstrap methods:

- attach local repo request shape
- create planning seed request shape

### Component Tests

Add UI tests for:

1. open modal from live header
2. submit valid repo path and optional name
3. attach success without seed
4. attach success followed by auto-seed
5. attach failure shows inline error
6. seed failure shows partial-success state and retry affordance

### Regression Expectations

Existing live-mode behavior must keep working:

- program switching
- SSE-driven refresh
- dashboard rendering for existing programs
- old demo mode shell when no remote API provider exists

## File Impact

Expected primary files:

- modify `omc-prototype/src/prototype/remoteApi.tsx`
- modify `omc-prototype/src/router.tsx`
- modify `omc-prototype/src/index.css`
- create `omc-prototype/src/components/NewProjectModal.tsx`
- add tests near the touched UI/API files

No hub changes required for this slice because required routes already exist.

## Acceptance Criteria

- live header shows a `新建项目` action
- user can submit an existing local git repo path from `omc-prototype`
- backend attach uses real OMC API
- missing planning automatically triggers real planning seed creation
- successful flow switches to the new program without manual refresh
- attach errors and seed errors are shown clearly inline
- existing program selector and live dashboard continue to work

## Open Questions

No blocking open questions remain for this slice.

Future follow-up candidates:

- add repo picker UX
- expose custom planning-root attach path
- offer optional guided-planning brief immediately after seed
- support repo creation for greenfield projects
