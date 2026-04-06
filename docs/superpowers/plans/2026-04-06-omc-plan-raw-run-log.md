# OMC Plan Raw Run Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users click a kanban plan card and inspect the raw `WorkOrder` / `AgentEvent` trail in the existing right-side operator workspace.

**Architecture:** Add a `trace` mode to the operator workspace instead of creating a new page. Project `PrototypePlanCard + WorldModel.workOrders + WorldModel.agentEvents + DecisionTopics` into a new `PlanTraceInspection` view model, then render that projection in a dedicated right-side trace viewer with `Events / State / JSON` tabs and linked-thread handoff.

**Tech Stack:** React, TanStack Router, local reducer store, Vitest, TypeScript strict, existing `omc-prototype` operator workspace shell

---

### Task 1: Add Plan Trace Projection Model

**Files:**
- Create: `/Users/realizer/Code/hopi/omc-prototype/src/prototype/planTrace.ts`
- Create: `/Users/realizer/Code/hopi/omc-prototype/src/prototype/planTrace.test.ts`
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/prototype/types.ts`
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/prototype/scenario.ts`

- [ ] **Step 1: Write the failing projection tests**

```ts
import { describe, expect, it } from 'vitest'
import { buildPlanTraceInspection } from './planTrace'
import { createSeededWorldModel, getPrototypeSnapshot } from './scenario'

describe('buildPlanTraceInspection', () => {
    it('prefers exact planId matches over inferred stream/phase matches', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const world = createSeededWorldModel(snapshot)
        const card = snapshot.planCards.find((item) => item.id === 'plan-ingest-proof')!

        world.workOrders['exact-order'] = {
            ...world.workOrders['work-order:approval-branch-ingest'],
            id: 'exact-order',
            planId: card.id,
        }
        world.workOrders['inferred-order'] = {
            ...world.workOrders['work-order:approval-branch-ingest'],
            id: 'inferred-order',
            planId: null,
            streamId: card.streamId,
            phaseId: card.phaseId,
        }

        const inspection = buildPlanTraceInspection({
            planCard: card,
            worldModel: world,
            decisionTopics: world.decisionTopics,
        })

        expect(inspection.match.kind).toBe('exact')
        expect(inspection.workOrder?.id).toBe('exact-order')
    })

    it('falls back to planning-only mode when no runtime match exists', () => {
        const snapshot = getPrototypeSnapshot('strategy')
        const world = createSeededWorldModel(snapshot)
        const card = snapshot.planCards.find((item) => item.id === 'plan-brief-outline')!

        const inspection = buildPlanTraceInspection({
            planCard: card,
            worldModel: world,
            decisionTopics: world.decisionTopics,
        })

        expect(inspection.match.kind).toBe('none')
        expect(inspection.events).toEqual([])
        expect(inspection.emptyState?.title).toBe('这张卡还没有运行态输出，当前只有计划信息。')
    })

    it('groups related events and linked decision topics for the matched work order', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const world = createSeededWorldModel(snapshot)
        const card = snapshot.planCards.find((item) => item.id === 'plan-ingest-proof')!

        const inspection = buildPlanTraceInspection({
            planCard: card,
            worldModel: world,
            decisionTopics: world.decisionTopics,
        })

        expect(inspection.events.length).toBeGreaterThan(0)
        expect(inspection.stateTransitions.length).toBeGreaterThan(0)
        expect(inspection.linkedTopics.some((topic) => topic.kind === 'approval')).toBe(true)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TMPDIR=/tmp bun run test -- src/prototype/planTrace.test.ts`  
Expected: FAIL with `Cannot find module './planTrace'` or missing export/type errors.

- [ ] **Step 3: Add the new trace types in the prototype model**

```ts
export type PlanTraceMatch =
    | { kind: 'exact'; label: '直连关联' }
    | { kind: 'inferred'; label: '推断关联' }
    | { kind: 'none'; label: '无运行态输出' }

export type PlanTraceTab = 'events' | 'state' | 'json'

export type PlanTraceEventView = {
    id: string
    createdAt: string
    role: AgentRole
    kind: AgentEvent['kind']
    summary: string
    raw: AgentEvent
}

export type PlanTraceInspection = {
    planId: string
    planTitle: string
    match: PlanTraceMatch
    workOrder: WorkOrder | null
    round: number | null
    events: PlanTraceEventView[]
    stateTransitions: string[]
    linkedTopics: DecisionTopic[]
    emptyState: null | {
        title: string
        detail: string
    }
}
```

- [ ] **Step 4: Implement the trace projection**

```ts
export function buildPlanTraceInspection(input: {
    planCard: PrototypePlanCard
    worldModel: WorldModel
    decisionTopics: Record<string, DecisionTopic>
}): PlanTraceInspection {
    const exact = Object.values(input.worldModel.workOrders).find(
        (order) => order.planId === input.planCard.id,
    )

    const inferred = exact
        ?? Object.values(input.worldModel.workOrders).find((order) =>
            order.goalId === input.planCard.goalId
            && order.streamId === input.planCard.streamId
            && order.phaseId === input.planCard.phaseId,
        )

    const workOrder = exact ?? inferred ?? null
    const match: PlanTraceMatch = exact
        ? { kind: 'exact', label: '直连关联' }
        : inferred
            ? { kind: 'inferred', label: '推断关联' }
            : { kind: 'none', label: '无运行态输出' }

    if (!workOrder) {
        return {
            planId: input.planCard.id,
            planTitle: input.planCard.title,
            match,
            workOrder: null,
            round: null,
            events: [],
            stateTransitions: [],
            linkedTopics: [],
            emptyState: {
                title: '这张卡还没有运行态输出，当前只有计划信息。',
                detail: input.planCard.summary,
            },
        }
    }

    const events = input.worldModel.agentEvents
        .filter((event) => event.workOrderId === workOrder.id)
        .slice()
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map((event) => ({
            id: event.id,
            createdAt: event.createdAt,
            role: event.emittedBy,
            kind: event.kind,
            summary: 'payload' in event ? JSON.stringify(event.payload) : '',
            raw: event,
        }))

    const linkedTopics = Object.values(input.decisionTopics).filter(
        (topic) => topic.workOrderId === workOrder.id,
    )

    return {
        planId: input.planCard.id,
        planTitle: input.planCard.title,
        match,
        workOrder,
        round: workOrder.loop.round,
        events,
        stateTransitions: buildStateTransitions(workOrder, events),
        linkedTopics,
        emptyState: events.length === 0
            ? {
                title: '这张卡已经进入运行态，但还没有记录到原始事件。',
                detail: workOrder.summary,
            }
            : null,
    }
}
```

- [ ] **Step 5: Seed meaningful raw events into the scenario world model**

```ts
const approvalOrder = createWorkOrder({
    id: 'work-order:approval-branch-ingest',
    goalId: 'goal-portfolio-foundation',
    streamId: 'stream-ingest-contracts',
    phaseId: 'phase-ingest-2',
    planId: 'plan-ingest-proof',
    summary: '推进导入证明分支，直到进入放行边界。',
})

world.agentEvents.push(
    {
        id: 'evt-driver-1',
        kind: 'Observation',
        workOrderId: approvalOrder.id,
        emittedBy: 'driver',
        createdAt: snapshot.checkpoint.stamp,
        payload: { summary: '已补齐导入夹具与回归校验。' },
    },
    {
        id: 'evt-review-1',
        kind: 'ReviewerVerdict',
        workOrderId: approvalOrder.id,
        emittedBy: 'reviewer',
        createdAt: snapshot.checkpoint.stamp,
        payload: { verdict: 'needs_decision', summary: '代码层面已接近可放行，但跨过经营边界。' },
    },
)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `TMPDIR=/tmp bun run test -- src/prototype/planTrace.test.ts`  
Expected: PASS with all trace projection cases green.

- [ ] **Step 7: Commit**

```bash
git add /Users/realizer/Code/hopi/omc-prototype/src/prototype/types.ts \
    /Users/realizer/Code/hopi/omc-prototype/src/prototype/scenario.ts \
    /Users/realizer/Code/hopi/omc-prototype/src/prototype/planTrace.ts \
    /Users/realizer/Code/hopi/omc-prototype/src/prototype/planTrace.test.ts
git commit -m "feat: add raw plan trace projection"
```

### Task 2: Add Trace Mode To Operator Workspace

**Files:**
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/components/operator/OperatorSurfaceContext.tsx`
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/router.tsx`
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/components/MessagePanel.tsx`
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/prototype/store.tsx`
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/prototype/types.ts`
- Test: `/Users/realizer/Code/hopi/omc-prototype/src/components/MessagePanel.test.tsx`

- [ ] **Step 1: Write the failing workspace-mode test**

```ts
it('opens trace mode when a plan is selected from the operator surface', async () => {
    const { default: MessagePanel } = await import('./MessagePanel')

    storeState.state.traceSelection = {
        planId: 'plan-ingest-proof',
        streamId: 'stream-ingest-contracts',
    }

    render(<MessagePanel />)

    expect(screen.getByTestId('workspace-mode')).toHaveTextContent('trace:plan-ingest-proof')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TMPDIR=/tmp bun run test -- src/components/MessagePanel.test.tsx`  
Expected: FAIL because trace selection mode does not exist yet.

- [ ] **Step 3: Extend store state and actions for operator workspace selection**

```ts
type TraceSelection = {
    planId: string
    streamId: string
}

type PrototypeUiState = {
    // ...
    traceSelection: TraceSelection | null
}

export interface PrototypeActionDispatcher {
    // ...
    openPlanTrace(input: { planId: string; streamId: string }): void
    clearPlanTrace(): void
}
```

- [ ] **Step 4: Route the operator surface through one shared controller**

```ts
const operatorSurface = useMemo(() => ({
    openInbox() {
        actions.clearPlanTrace()
        setMessagePanelOpen(true)
    },
    openThread(threadId: string) {
        actions.clearPlanTrace()
        actions.setActiveThread(threadId)
        setMessagePanelOpen(true)
    },
    openTrace(input: { planId: string; streamId: string }) {
        actions.openPlanTrace(input)
        setMessagePanelOpen(true)
    },
    closePanel() {
        setMessagePanelOpen(false)
    },
    isOpen: messagePanelOpen,
}), [actions, messagePanelOpen])
```

- [ ] **Step 5: Select `trace` mode inside `MessagePanel`**

```ts
const traceSelection = state.traceSelection
const selectedThread = traceSelection
    ? null
    : activeThread && activeThreadSelectionId !== dismissedThreadSelectionId
        ? activeThread
        : null

return (
    <MessageWorkspace
        mode={traceSelection ? 'trace' : selectedThread ? 'thread' : 'inbox'}
        traceSelection={traceSelection}
        // existing props...
    />
)
```

- [ ] **Step 6: Run test to verify it passes**

Run: `TMPDIR=/tmp bun run test -- src/components/MessagePanel.test.tsx`  
Expected: PASS with inbox/thread/trace mode switching covered.

- [ ] **Step 7: Commit**

```bash
git add /Users/realizer/Code/hopi/omc-prototype/src/components/operator/OperatorSurfaceContext.tsx \
    /Users/realizer/Code/hopi/omc-prototype/src/router.tsx \
    /Users/realizer/Code/hopi/omc-prototype/src/components/MessagePanel.tsx \
    /Users/realizer/Code/hopi/omc-prototype/src/prototype/store.tsx \
    /Users/realizer/Code/hopi/omc-prototype/src/prototype/types.ts \
    /Users/realizer/Code/hopi/omc-prototype/src/components/MessagePanel.test.tsx
git commit -m "feat: add operator trace mode"
```

### Task 3: Build The Raw Trace Viewer UI

**Files:**
- Create: `/Users/realizer/Code/hopi/omc-prototype/src/components/operator/PlanTraceWorkspace.tsx`
- Create: `/Users/realizer/Code/hopi/omc-prototype/src/components/operator/PlanTraceTabs.tsx`
- Create: `/Users/realizer/Code/hopi/omc-prototype/src/components/operator/PlanTraceWorkspace.test.tsx`
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/components/operator/MessageWorkspace.tsx`
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/index.css`

- [ ] **Step 1: Write the failing trace-view tests**

```ts
it('renders Events / State / JSON tabs and defaults to Events', () => {
    const inspection = buildInspectionFixture()

    render(
        <PlanTraceWorkspace
            inspection={inspection}
            onBackToInbox={() => {}}
            onOpenThread={() => {}}
        />,
    )

    expect(screen.getByRole('tab', { name: 'Events' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('ReviewerVerdict')).toBeInTheDocument()
})

it('shows inferred-match warning and linked decision topics', () => {
    const inspection = buildInspectionFixture({ match: { kind: 'inferred', label: '推断关联' } })

    render(
        <PlanTraceWorkspace
            inspection={inspection}
            onBackToInbox={() => {}}
            onOpenThread={() => {}}
        />,
    )

    expect(screen.getByText('当前输出按 stream/phase 推断关联，不是 plan 直连。')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '打开相关线程：放行导入分支' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TMPDIR=/tmp bun run test -- src/components/operator/PlanTraceWorkspace.test.tsx`  
Expected: FAIL because trace workspace components do not exist yet.

- [ ] **Step 3: Implement the trace workspace**

```tsx
export default function PlanTraceWorkspace(props: {
    inspection: PlanTraceInspection
    onBackToInbox: () => void
    onOpenThread: (threadId: string) => void
}) {
    const [activeTab, setActiveTab] = useState<PlanTraceTab>('events')

    return (
        <section className="prototype-trace-shell">
            <header className="prototype-trace-shell__head">
                <button type="button" onClick={props.onBackToInbox}>返回</button>
                <div>
                    <h2>{props.inspection.planTitle}</h2>
                    <p>
                        <span>{props.inspection.match.label}</span>
                        {props.inspection.workOrder ? <span>{props.inspection.workOrder.id}</span> : null}
                        {props.inspection.round !== null ? <span>Round {props.inspection.round}</span> : null}
                    </p>
                </div>
            </header>

            <PlanTraceTabs activeTab={activeTab} onChange={setActiveTab} />

            {activeTab === 'events' ? <PlanTraceEvents inspection={props.inspection} /> : null}
            {activeTab === 'state' ? <PlanTraceState inspection={props.inspection} /> : null}
            {activeTab === 'json' ? <PlanTraceJson inspection={props.inspection} /> : null}

            <footer className="prototype-trace-shell__links">
                {props.inspection.linkedTopics.map((topic) => (
                    <button key={topic.id} type="button" onClick={() => props.onOpenThread(topic.id)}>
                        打开相关线程：{topic.title}
                    </button>
                ))}
            </footer>
        </section>
    )
}
```

- [ ] **Step 4: Switch `MessageWorkspace` to render trace mode**

```tsx
if (props.mode === 'trace' && props.traceInspection) {
    return (
        <aside className={className}>
            <PlanTraceWorkspace
                inspection={props.traceInspection}
                onBackToInbox={props.onBackToList}
                onOpenThread={props.onSelectThread}
            />
        </aside>
    )
}
```

- [ ] **Step 5: Add compact trace-view styling**

```css
.prototype-trace-shell {
    display: grid;
    gap: 12px;
    min-height: 100%;
}

.prototype-trace-event-row {
    display: grid;
    gap: 4px;
    padding: 12px 0;
    border-bottom: 1px solid var(--prototype-line);
}

.prototype-trace-json {
    font-family: var(--prototype-mono);
    font-size: 12px;
    white-space: pre-wrap;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `TMPDIR=/tmp bun run test -- src/components/operator/PlanTraceWorkspace.test.tsx src/components/operator/MessageWorkspace.test.tsx`  
Expected: PASS with trace-mode rendering and tab switching green.

- [ ] **Step 7: Commit**

```bash
git add /Users/realizer/Code/hopi/omc-prototype/src/components/operator/PlanTraceWorkspace.tsx \
    /Users/realizer/Code/hopi/omc-prototype/src/components/operator/PlanTraceTabs.tsx \
    /Users/realizer/Code/hopi/omc-prototype/src/components/operator/PlanTraceWorkspace.test.tsx \
    /Users/realizer/Code/hopi/omc-prototype/src/components/operator/MessageWorkspace.tsx \
    /Users/realizer/Code/hopi/omc-prototype/src/index.css
git commit -m "feat: render raw plan trace workspace"
```

### Task 4: Wire Kanban Cards To Trace Mode

**Files:**
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/components/ExecutionBoard.tsx`
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/screens/ExecutionDetailPage.tsx`
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/components/operator/OperatorSurfaceContext.tsx`
- Test: `/Users/realizer/Code/hopi/omc-prototype/src/components/ExecutionBoard.test.tsx`

- [ ] **Step 1: Write the failing kanban-click test**

```ts
it('opens raw trace mode when a plan card is clicked', () => {
    const openTrace = vi.fn()

    render(
        <OperatorSurfaceProvider value={{ openInbox: vi.fn(), openThread: vi.fn(), openTrace, closePanel: vi.fn(), isOpen: false }}>
            <ExecutionBoard phases={[phaseFixture]} planCards={[planFixture]} />
        </OperatorSurfaceProvider>,
    )

    fireEvent.click(screen.getByRole('button', { name: /确定首个券商导入范围/i }))

    expect(openTrace).toHaveBeenCalledWith({
        planId: 'plan-ingest-proof',
        streamId: 'stream-ingest-contracts',
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TMPDIR=/tmp bun run test -- src/components/ExecutionBoard.test.tsx`  
Expected: FAIL because plan cards are not clickable trace triggers yet.

- [ ] **Step 3: Make plan cards open the operator trace**

```tsx
const operatorSurface = useOperatorSurface()

<button
    type="button"
    className="prototype-plan-card prototype-card"
    onClick={() => operatorSurface.openTrace({ planId: card.id, streamId: card.streamId })}
>
    <div className="prototype-plan-card__header">
        <div className="prototype-icon-pill">
            <Glyph name="kanban" />
        </div>
        <span>{card.updatedAt}</span>
    </div>
    <h4>{view.title}</h4>
    <p className="prototype-plan-card__summary">{card.summary}</p>
</button>
```

- [ ] **Step 4: Highlight the selected card while trace mode is open**

```tsx
const selectedPlanId = operatorSurface.activeTrace?.planId ?? null

className={`prototype-plan-card prototype-card${selectedPlanId === card.id ? ' is-selected' : ''}`}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `TMPDIR=/tmp bun run test -- src/components/ExecutionBoard.test.tsx`  
Expected: PASS with click-through opening trace mode.

- [ ] **Step 6: Commit**

```bash
git add /Users/realizer/Code/hopi/omc-prototype/src/components/ExecutionBoard.tsx \
    /Users/realizer/Code/hopi/omc-prototype/src/screens/ExecutionDetailPage.tsx \
    /Users/realizer/Code/hopi/omc-prototype/src/components/operator/OperatorSurfaceContext.tsx \
    /Users/realizer/Code/hopi/omc-prototype/src/components/ExecutionBoard.test.tsx
git commit -m "feat: open raw trace from kanban cards"
```

### Task 5: Full Verification And Spec Coverage Check

**Files:**
- Modify: `/Users/realizer/Code/hopi/omc-prototype/src/components/MessagePanel.test.tsx`
- Modify: `/Users/realizer/Code/hopi/docs/superpowers/plans/2026-04-06-omc-plan-raw-run-log.md`

- [ ] **Step 1: Run the full prototype test suite**

Run: `TMPDIR=/tmp bun run test`  
Expected: PASS with all `omc-prototype` tests green, including new trace coverage.

- [ ] **Step 2: Run typecheck**

Run: `TMPDIR=/tmp bun run typecheck`  
Expected: PASS with zero TypeScript errors.

- [ ] **Step 3: Run production build**

Run: `TMPDIR=/tmp bun run build`  
Expected: PASS; Vite chunk warning acceptable unless it becomes a hard error.

- [ ] **Step 4: Manual sanity-check in browser**

Run: `TMPDIR=/tmp bun run dev`  
Check:
- open a goal
- open execution detail
- click a kanban card
- confirm right workspace switches to `trace`
- switch tabs between `Events / State / JSON`
- jump from trace to linked thread
- return to inbox cleanly

Expected: trace mode behaves like the same operator workspace, not a separate page.

- [ ] **Step 5: Commit**

```bash
git add /Users/realizer/Code/hopi/omc-prototype
git commit -m "feat: add raw run log trace workspace"
```

## Self-Review

### Spec Coverage

- right-side `trace` mode: Task 2 + Task 3
- `PlanCard -> WorkOrder -> AgentEvent[]` mapping: Task 1
- `exact / inferred / none` match handling: Task 1 + Task 3
- `Events / State / JSON` tabs: Task 3
- linked decision-topic jumps: Task 3
- plan-card click opening trace mode: Task 4
- no-match / no-event degraded states: Task 1 + Task 3

No uncovered spec sections found.

### Placeholder Scan

- no `TODO/TBD/FIXME`
- code snippets present in every code-writing step
- commands and expected outcomes included

### Type Consistency

- `PlanTraceInspection`, `PlanTraceMatch`, and `PlanTraceTab` defined before use
- `openTrace` added to operator-surface controller before UI tasks use it
- `traceSelection` introduced in store before `MessagePanel` / `MessageWorkspace` consume it

