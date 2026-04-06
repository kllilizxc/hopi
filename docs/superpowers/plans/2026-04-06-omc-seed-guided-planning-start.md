# OMC Seed Guided Planning Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a seed-only dashboard planning entrypoint so freshly attached OMC projects can submit the first guided-planning brief, observe queued/running state, retry failures, and automatically transition into the normal dashboard once plans exist.

**Architecture:** Extend the live API client with guided-planning control calls, surface planning metadata through the live store, render a dashboard-local `SeedPlanningPanel` for seed-only programs, and verify the behavior with focused API/component/store tests before running the full `omc-prototype` verification pass.

**Tech Stack:** React 19, TypeScript, TanStack Router, Vitest, Testing Library, existing hub OMC REST endpoints.

---

### Task 1: Add Guided-Planning Control API Methods

**Files:**
- Modify: `omc-prototype/src/prototype/remoteApi.tsx`
- Modify: `omc-prototype/src/prototype/remoteApi.test.ts`

- [ ] **Step 1: Write the failing API client tests**

Add two tests to `omc-prototype/src/prototype/remoteApi.test.ts` that assert:

```ts
await api.startGuidedPlanning('program-123', {
    productIntent: 'Ship a card game MVP',
    firstSlice: 'Create a playable local prototype with turn flow and win conditions',
})

expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:3006/api/omc/programs/program-123/planning-run/start',
    expect.objectContaining({
        method: 'POST',
        headers: {
            authorization: 'Bearer jwt-token',
            'content-type': 'application/json',
        },
        body: JSON.stringify({
            brief: {
                productIntent: 'Ship a card game MVP',
                firstSlice: 'Create a playable local prototype with turn flow and win conditions',
            },
        }),
    }),
)
```

and:

```ts
await api.retryGuidedPlanning('program-123')

expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:3006/api/omc/programs/program-123/planning-run/retry',
    expect.objectContaining({
        method: 'POST',
        headers: {
            authorization: 'Bearer jwt-token',
        },
    }),
)
```

- [ ] **Step 2: Run the API tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/remoteApi.test.ts
```

Expected:

- FAIL because `PrototypeRemoteApiClient` does not yet expose `startGuidedPlanning()` or `retryGuidedPlanning()`

- [ ] **Step 3: Implement the minimal API methods**

Add to `omc-prototype/src/prototype/remoteApi.tsx`:

```ts
async startGuidedPlanning(
    programId: string,
    brief: OmcGuidedPlanningBrief,
): Promise<OmcGuidedPlanningControlResponse> {
    return await this.request<OmcGuidedPlanningControlResponse>(
        `/api/omc/programs/${encodeURIComponent(programId)}/planning-run/start`,
        {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({ brief }),
        },
    )
}

async retryGuidedPlanning(programId: string): Promise<OmcGuidedPlanningControlResponse> {
    return await this.request<OmcGuidedPlanningControlResponse>(
        `/api/omc/programs/${encodeURIComponent(programId)}/planning-run/retry`,
        { method: 'POST' },
    )
}
```

Also import the protocol types:

```ts
type {
    OmcGuidedPlanningBrief,
    OmcGuidedPlanningControlResponse,
}
```

- [ ] **Step 4: Run the API tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/remoteApi.test.ts
```

Expected:

- PASS with the new guided-planning API tests green

### Task 2: Surface Seed-Only Planning Metadata Through the Live Store

**Files:**
- Modify: `omc-prototype/src/prototype/store.tsx`
- Modify: `omc-prototype/src/prototype/store.live.test.tsx`

- [ ] **Step 1: Write the failing live-store test**

Add a live-store test that mounts `PrototypeStoreProvider`, waits for the initial live projection, and asserts the exposed store contains:

```ts
expect(result.current.live?.planning).toEqual(
    expect.objectContaining({
        status: 'seeded',
        hasPlanning: true,
        hasPlans: false,
    }),
)
expect(result.current.live?.planningRun).toEqual(
    expect.objectContaining({
        status: 'queued',
        stage: 'brief',
    }),
)
```

Use a fake API where:

```ts
getGuidedPlanningState.mockResolvedValue({
    programId: 'omc-fresh',
    planning: {
        status: 'seeded',
        planningRoot: '/tmp/omc-fresh/.planning',
        hasPlanning: true,
        hasPlans: false,
        phaseCount: 0,
        planCount: 0,
        seedFiles: ['PROJECT.md'],
    },
    run: {
        id: 'run-1',
        programId: 'omc-fresh',
        status: 'queued',
        stage: 'brief',
        summary: 'Queued for the first guided planning pass.',
        createdAt: 100,
        updatedAt: 100,
        startedAt: null,
        completedAt: null,
        failedAt: null,
        canceledAt: null,
        brief: {
            productIntent: 'Ship a card game MVP',
            firstSlice: 'Create a playable prototype',
        },
    },
})
```

- [ ] **Step 2: Run the live-store test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/store.live.test.tsx
```

Expected:

- FAIL because `usePrototypeStore().live` does not yet expose `planning` or `planningRun`

- [ ] **Step 3: Implement the live metadata exposure**

Update `omc-prototype/src/prototype/store.tsx` so `PrototypeStoreValue['live']` includes:

```ts
planning: projection?.overview.planning ?? null
planningRun: projection?.planningRun ?? null
```

This must be wired through both:

- the `PrototypeStoreValue` type
- the live-provider `value`

Do not change the demo-store `live: null` path.

- [ ] **Step 4: Run the live-store test to verify it passes**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/store.live.test.tsx
```

Expected:

- PASS with the new seed-only metadata assertion green

### Task 3: Build the Seed-Only Dashboard Planning Panel

**Files:**
- Create: `omc-prototype/src/components/SeedPlanningPanel.tsx`
- Create: `omc-prototype/src/components/SeedPlanningPanel.test.tsx`
- Modify: `omc-prototype/src/index.css`

- [ ] **Step 1: Write the failing panel tests**

Create `omc-prototype/src/components/SeedPlanningPanel.test.tsx` with focused tests for:

1. idle state submit:

```tsx
await user.type(screen.getByLabelText('产品意图'), 'Ship a card game MVP')
await user.type(screen.getByLabelText('第一刀'), 'Create a playable local prototype')
await user.click(screen.getByRole('button', { name: '开始规划' }))

expect(api.startGuidedPlanning).toHaveBeenCalledWith('program-123', {
    productIntent: 'Ship a card game MVP',
    firstSlice: 'Create a playable local prototype',
})
expect(actions.selectProgram).toHaveBeenCalledWith('program-123')
```

2. disabled submit when either field is blank

3. running state:

```tsx
expect(screen.getByText('规划进行中')).toBeInTheDocument()
expect(screen.queryByLabelText('产品意图')).not.toBeInTheDocument()
expect(screen.getByText('plan')).toBeInTheDocument()
```

4. failed state retry:

```tsx
await user.click(screen.getByRole('button', { name: '重试规划' }))
expect(api.retryGuidedPlanning).toHaveBeenCalledWith('program-123')
expect(actions.selectProgram).toHaveBeenCalledWith('program-123')
```

5. start failure preserves typed values and shows inline error

- [ ] **Step 2: Run the panel tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/SeedPlanningPanel.test.tsx
```

Expected:

- FAIL because `SeedPlanningPanel` does not exist yet

- [ ] **Step 3: Implement the minimal panel**

Create `omc-prototype/src/components/SeedPlanningPanel.tsx` with:

- local `productIntent` and `firstSlice` state
- request-local `pending` and `error` state
- idle form that trims and submits values
- running/queued display based on `planningRun.status`
- failed/canceled recovery display with retry

Use these integration points:

```tsx
const api = usePrototypeRemoteApi()
const { actions } = usePrototypeStore()
```

Start handler:

```ts
await api.startGuidedPlanning(programId, {
    productIntent: productIntent.trim(),
    firstSlice: firstSlice.trim(),
})
actions.selectProgram?.(programId)
```

Retry handler:

```ts
await api.retryGuidedPlanning(programId)
actions.selectProgram?.(programId)
```

Render status badges with existing styling primitives such as `MetaBadge` where helpful. Keep the card layout aligned with current dashboard glass-panel styling.

- [ ] **Step 4: Add the panel styles**

Add focused CSS in `omc-prototype/src/index.css` for:

- `.prototype-seed-panel`
- `.prototype-seed-panel__form`
- `.prototype-seed-panel__field`
- `.prototype-seed-panel__status`
- `.prototype-seed-panel__error`
- `.prototype-seed-panel__actions`

Requirements:

- fits existing panel language
- no horizontal overflow
- good mobile stacking under the current responsive breakpoints

- [ ] **Step 5: Run the panel tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/SeedPlanningPanel.test.tsx
```

Expected:

- PASS with all seed-panel tests green

### Task 4: Wire the Seed Panel Into the Dashboard

**Files:**
- Modify: `omc-prototype/src/screens/DashboardPage.tsx`
- Optionally Modify: `omc-prototype/src/components/DashboardPanels.tsx`
- Create or Modify Test: `omc-prototype/src/screens/DashboardPage.test.tsx` or `omc-prototype/src/components/SeedPlanningPanel.test.tsx`

- [ ] **Step 1: Write the failing dashboard integration test**

Add a render test that supplies a live-store shape equivalent to:

```ts
live: {
    programs: [{ id: 'program-123', name: 'CardGame', repoRoot: '/tmp/card-game' }],
    selectedProgramId: 'program-123',
    error: null,
    planning: {
        status: 'seeded',
        planningRoot: '/tmp/card-game/.planning',
        hasPlanning: true,
        hasPlans: false,
        phaseCount: 0,
        planCount: 0,
        seedFiles: ['PROJECT.md'],
    },
    planningRun: null,
}
```

and asserts:

```tsx
expect(screen.getByText('开始规划')).toBeInTheDocument()
expect(screen.queryByText('执行流')).not.toBeInTheDocument()
```

Also add a counterpart case where `hasPlans: true` still shows the normal `执行流` panel.

- [ ] **Step 2: Run the dashboard test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/screens/DashboardPage.test.tsx
```

Expected:

- FAIL because the dashboard still renders the normal empty portfolio panels for seed-only programs

- [ ] **Step 3: Implement the dashboard switch**

Update `omc-prototype/src/screens/DashboardPage.tsx`:

```tsx
const isSeedOnly = Boolean(
    state.attachedProgramId
    && live?.planning?.hasPlanning
    && !live.planning.hasPlans,
)

return (
    <div className="prototype-dashboard">
        <section className="prototype-dashboard-hero prototype-panel">
            ...
        </section>

        {isSeedOnly ? (
            <SeedPlanningPanel
                programId={state.attachedProgramId}
                planning={live?.planning ?? null}
                planningRun={live?.planningRun ?? null}
            />
        ) : (
            <>
                <GoalPortfolioPanel ... />
                <DailyDigestPanel ... />
                <StreamsOverviewPanel ... />
            </>
        )}
    </div>
)
```

Keep the hero visible in both modes. Do not change goal/stream rendering for demo mode or for live programs that already have plans.

- [ ] **Step 4: Run the dashboard integration test to verify it passes**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/screens/DashboardPage.test.tsx
```

Expected:

- PASS with seed-only dashboard behavior locked

### Task 5: Run Focused and Full Verification

**Files:**
- Modify only if failures require it

- [ ] **Step 1: Run the focused verification suite**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- \
    src/prototype/remoteApi.test.ts \
    src/prototype/store.live.test.tsx \
    src/components/SeedPlanningPanel.test.tsx \
    src/screens/DashboardPage.test.tsx \
    src/components/LiveWorkspaceBar.test.tsx \
    src/components/NewProjectModal.test.tsx
```

Expected:

- PASS with the new planning-entry coverage green and no regressions in the new-project flow

- [ ] **Step 2: Run typecheck**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run typecheck
```

Expected:

- PASS

- [ ] **Step 3: Run the full test suite**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test
```

Expected:

- PASS

- [ ] **Step 4: Run the production build**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run build
```

Expected:

- PASS
