# Project Autopilot MVP

Goal: turn one project into a reliable "night shift engineer" loop before expanding into a bigger "AI company" surface.

## Product Scope

- One project
- One owner
- One backlog
- Existing `project_init` onboarding stays the default path
- Existing worktree support stays in place
- Product promise: get small, explicit tasks to review-ready with low operator overhead

## What MVP Is Not

- Not a full "company OS"
- Not auto-merge by default
- Not fully autonomous task discovery + execution loops on day one
- Not a rewrite of current `project_init` / worktree automation

## Milestones

### M0: Project Takeover Stabilization

- Reuse current `project_init` bootstrap task as the primary onboarding path
- Add project-level automation readiness state
- Add "Verify automation" action around `.hopi/actions.yaml`
- Show readiness and latest verification summary in project settings
- Gate auto-run on readiness, while still allowing `project_init` to run before readiness is green

### M1: Safe Auto-Run

- Keep worktree support; do not remove parallelism infrastructure
- Default MVP execution to one lane for predictable behavior
- Add task automation policy: `manual_only | safe_auto`
- Add verification gate before tasks become review-ready / finished
- Normalize blocked reasons
- Generate review summary automatically

### M2: Controlled Self-Iteration

- Keep improvements scan
- Improvements create suggestion tasks first
- Auto-generated tasks default to `manual_only`
- Manual promotion enables safe auto-run
- Add dedupe and generation limits

### M3: Night Shift Reliability

- Daily/nightly project run summary
- Pause / resume autopilot
- Repeated-failure fuse
- Timeout / stall detection
- Consolidated operator inbox for approvals and blockers

## M0 TODO

- [ ] Persist project readiness state: `unknown | checking | ready | degraded | blocked`
- [ ] Persist latest readiness summary and verification timestamp
- [ ] Add `POST /api/projects/:id/verify-automation`
- [ ] Verify default workspace path exists on the project machine
- [ ] Verify `.hopi/actions.yaml` exists and parses
- [ ] Surface bootstrap task status in verification summary when helpful
- [ ] Show readiness card in project settings
- [ ] Gate auto-run on readiness while exempting `project_init`
- [ ] Add focused tests for readiness verification and auto-run gating

## M1 TODO

- [ ] Add task automation policy
- [ ] Add task verification policy
- [ ] Limit MVP default auto-run to one lane
- [ ] Add verification gate before review-ready / finished
- [ ] Standardize blocked reason codes
- [ ] Auto-generate review summaries
- [ ] Add retry action for blocked task runs

## Current Execution Plan

1. Land this document.
2. Implement M0 readiness model + verification API.
3. Add M0 settings UI.
4. Add M0 auto-run gate.
5. Run focused tests.
