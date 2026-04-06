# OMC Seed Guided Planning Start Design

Date: 2026-04-06
Status: Approved for implementation
Scope: add a real `seed-only -> 开始规划` entry inside `omc-prototype` so freshly attached projects can launch guided planning from the dashboard

## Summary

Add a dedicated dashboard empty-state for live OMC programs whose planning tree exists but does not yet contain executable plans.

Chosen scope:

- detect `seed-only` live programs from real planning metadata
- replace the current blank dashboard sections with a focused `开始规划` panel
- collect the same two guided-planning brief fields the backend already requires:
  - `产品意图`
  - `第一刀`
- call the real hub route `POST /api/omc/programs/:programId/planning-run/start`
- surface queued/running/failed guided-planning states directly in the panel
- allow retry from the same panel when a planning run fails or is canceled
- automatically fall back to the normal dashboard once real `PLAN.md` files appear

Deliberately out of scope for this slice:

- changing the new-project modal to collect brief fields
- auto-starting planning as part of project bootstrap
- editing roadmap or requirements documents from the UI
- exposing full guided-planning transcripts or agent internals
- moving the start-planning entry into the global header

## Problem

The new `新建项目` flow now attaches real repos and creates a planning seed when needed, but a fresh seeded project still lands on a mostly empty dashboard.

Current state after attach + seed:

- repo is attached as a real OMC program
- `.planning/*` seed files exist
- no `*-PLAN.md` files exist yet
- no goals, streams, or inbox threads appear
- no obvious next action appears in the product

This causes two product failures:

1. dead-end onboarding
   Operators finish project creation but cannot continue testing from the UI.

2. misleading silence
   The empty dashboard looks broken or incomplete even though the backend is waiting for a guided-planning brief.

## Goals

- give seed-only programs a single obvious next step
- reuse the real guided-planning backend contract without inventing a second workflow
- keep the interaction inside the dashboard, where the empty state already appears
- show enough planning-run state that operators can tell the system is doing real work
- recover cleanly from failed guided-planning runs
- preserve the existing normal dashboard for programs that already have plans

## Non-Goals

- detailed planning-run timeline or trace visualization
- canceling a queued/running planning run from the dashboard
- freeform editing of generated planning artifacts
- background auto-refresh rules beyond the current SSE-driven live projection reload
- broader redesign of dashboard information architecture

## User Story

As an operator who just attached a new repo,
I want the dashboard to tell me exactly how to start planning and let me submit the first brief right there,
so I can move from seed files to real executable plans without leaving the product.

## Chosen Approach

Use a dashboard-local `SeedPlanningPanel` that appears only for live programs with planning seed material but no plans yet.

Why this approach:

- meets the user exactly where the current dead-end happens
- preserves the existing header and new-project flow
- keeps the start-planning action contextual instead of globally visible everywhere
- aligns with the real state machine:
  - attached/seeded but no plans => ask for brief
  - planning run queued/running => show live planning status
  - plans detected => return to normal dashboard

Rejected alternatives:

1. header-level `开始规划`
   Too global. It stays visible even when the project already has plans, which weakens the signal of the real empty state.

2. chaining a second modal after `新建项目`
   Makes project creation heavy again and couples attach/bootstrap with planning input, which we explicitly split apart in the previous slice.

3. auto-start guided planning with generated defaults
   Fastest technically, but it hides intent capture from the operator and makes the first planning run feel opaque.

## UX Design

### Seed-Only Detection

Treat a live program as `seed-only` when:

- `live.planning.hasPlanning === true`
- `live.planning.hasPlans === false`

The panel may appear whether planning status is `attached` or `seeded`.

The panel must not appear when:

- the product is in demo mode
- no live program is attached
- any real plans exist

### Idle State

When the program is seed-only and no guided-planning run is currently queued/running, replace the empty goal/stream surface with one primary panel.

Panel content:

- title: `开始规划`
- helper copy:
  - project has been attached
  - planning seed exists
  - the next step is to provide the first brief
- two inputs:
  - `产品意图`
  - `第一刀`
- primary action:
  - `开始规划`

Field behavior:

- both fields required after trimming
- preserve user input while request is in flight or after request failure
- submitting with `Enter` should trigger the form unless the focused control is a button

### Queued / Running State

When guided planning is `queued` or `running`, replace the form with a progress-focused status card.

Show:

- state label:
  - `规划排队中` for `queued`
  - `规划进行中` for `running`
- current stage badge if present:
  - `brief`
  - `discuss`
  - `plan`
  - `handoff`
- latest summary text if present
- compact note that the dashboard will switch to normal execution view after the first plans are generated

While queued/running:

- do not show editable brief inputs
- do not offer retry

### Failed / Canceled State

When the most recent guided-planning run is `failed` or `canceled`, show the same panel in recovery mode.

Show:

- failure headline:
  - `规划未完成`
- latest summary or error message if present
- secondary explanation that the operator can retry with the same seed materials
- action:
  - `重试规划`

Retry behavior:

- call `POST /planning-run/retry`
- clear stale error state before retry begins
- after retry succeeds, transition back to queued/running state through the normal live refresh path

### Success Transition

No success toast is required for this slice.

Once the next live projection reports `planning.hasPlans === true`, the seed panel disappears automatically and the dashboard returns to:

- hero
- goals
- daily digest
- streams

## Product Behavior Rules

### Start Rule

Use the existing hub route:

- `POST /api/omc/programs/:programId/planning-run/start`

Payload:

- `brief.productIntent`
- `brief.firstSlice`

The UI must not synthesize or omit these fields.

### Retry Rule

Use the existing hub route:

- `POST /api/omc/programs/:programId/planning-run/retry`

Retry is only available when the latest run status is `failed` or `canceled`.

### Refresh Rule

After starting or retrying guided planning:

- trigger the same-program live refresh path immediately
- continue relying on existing SSE refreshes for subsequent updates

This keeps queued/running state visible without requiring a separate polling mechanism.

### Fallback Rule

If `planning-run/start` or `planning-run/retry` fails:

- keep the panel visible
- preserve the last entered brief text
- show the backend error inline
- do not navigate

## Architecture

### Remote API Layer

Extend the existing `PrototypeRemoteApiClient` with guided-planning control methods already supported by hub:

- `startGuidedPlanning(programId, { productIntent, firstSlice })`
- `retryGuidedPlanning(programId)`

The client already exposes `getGuidedPlanningState`, so this slice only needs control methods, not new read models.

### Live Store Layer

Expose enough live planning metadata through `usePrototypeStore()` for dashboard rendering:

- current program planning summary
- current guided-planning run

The store should continue to own refresh behavior. The new panel should request actions through the store/API pair, then rely on store refresh to reflect the new state.

### Dashboard Layer

Add a dashboard-specific component, `SeedPlanningPanel`, responsible for:

- rendering idle/running/recovery states
- managing brief input local state
- invoking start/retry actions
- showing inline request errors

`DashboardPage` remains the place that decides whether to show:

- normal portfolio panels
- or the seed-only planning panel

## Data Flow

### Start Planning

1. user lands on a seed-only live program
2. dashboard renders `SeedPlanningPanel`
3. user fills `产品意图` and `第一刀`
4. panel calls `api.startGuidedPlanning(programId, brief)`
5. panel asks store to refresh the current program
6. live store reloads `planning-run`
7. dashboard re-renders queued/running state
8. later SSE refreshes pull in new planning status or first plans
9. once `hasPlans === true`, normal dashboard takes over

### Retry Planning

1. live store reports run status `failed` or `canceled`
2. dashboard renders recovery state
3. user clicks `重试规划`
4. panel calls `api.retryGuidedPlanning(programId)`
5. panel asks store to refresh current program
6. queued/running state appears through refreshed live projection

## Error Handling

Cases to handle explicitly:

1. start request fails
   Show backend message inline. Keep the brief text intact.

2. retry request fails
   Show backend message inline. Keep the panel in recovery mode.

3. live refresh fails after start/retry
   Reuse the existing live store error path. The panel should not invent a second global error model.

4. run state returns without summary
   Render the status/stage UI without requiring summary text.

## Testing Strategy

### API Client

Add unit tests for:

- `startGuidedPlanning()` request path and payload
- `retryGuidedPlanning()` request path

### Component

Add focused component tests for:

- idle form submission with trimmed brief values
- disabled submit when either field is empty
- queued/running state hides the form and shows planning status
- failed/canceled state shows retry action
- start failure keeps inputs and shows inline error

### Store / Integration

Add or extend live-store/dashboard tests to cover:

- seed-only live projection surfaces planning metadata
- dashboard switches from empty state to planning panel for seed-only programs
- same-program refresh is used after start/retry so UI can move immediately into queued/running state

## Acceptance Criteria

- A newly attached + seeded project no longer lands on a dead-end empty dashboard.
- Seed-only live programs show a clear `开始规划` panel on the dashboard.
- The panel collects `产品意图` and `第一刀` and calls the real guided-planning start endpoint.
- Queued/running guided-planning runs show visible status inside the same panel.
- Failed/canceled runs expose `重试规划`.
- Once real plans exist, the seed panel disappears and the normal dashboard view returns.
