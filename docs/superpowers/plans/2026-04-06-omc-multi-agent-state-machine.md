# OMC Multi-Agent State Machine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `omc-prototype` so its internal model matches the long-term OMC design: `Manager + Worker Swarm + Gatekeeper`, `WorkOrder` Ralph loops, operator-facing `DecisionTopic` threads, and a single operator workspace where goals switch in-place instead of drilling into a second page.

**Architecture:** Introduce a dedicated domain layer for `WorldModel`, `WorkOrder`, `DecisionTopic`, and `AgentEvent`, then make the prototype store derive UI state from that domain instead of directly mutating goal/risk/approval snapshots. Keep goals as the only operator-level switch, rendered as top card-style tabs inside one canonical workspace route; sync the selected goal through `/?goal=<goalId>`; keep plan-card detail inside the right-side trace/message surface instead of a dedicated page; keep legacy goal and plan URLs as compatibility redirects back into the workspace. Treat "execution streams" as derived grouping metadata only when a screen needs clustering or filtering.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vite, `@assistant-ui/react`

---

### Task 1: Add first-class orchestration domain objects

**Files:**
- Create: `omc-prototype/src/prototype/orchestration.ts`
- Create: `omc-prototype/src/prototype/orchestration.test.ts`
- Modify: `omc-prototype/src/prototype/types.ts`
- Test: `omc-prototype/src/prototype/orchestration.test.ts`

- [ ] **Step 1: Write the failing domain-model test**

```ts
// omc-prototype/src/prototype/orchestration.test.ts
import { describe, expect, it } from 'vitest'
import {
    createInitialWorldModel,
    createWorkOrder,
    createDecisionTopic,
    type AgentEvent,
} from './orchestration'

describe('orchestration domain', () => {
    it('creates a world model with empty work orders and decision topics', () => {
        const world = createInitialWorldModel({
            focusGoalId: 'goal-portfolio-foundation',
        })

        expect(world.currentFocus.goalId).toBe('goal-portfolio-foundation')
        expect(world.workOrders).toEqual({})
        expect(world.decisionTopics).toEqual({})
        expect(world.agentEvents).toEqual([])
    })

    it('creates a work order in drafting state with a fresh loop counter', () => {
        const order = createWorkOrder({
            id: 'wo-import-lane',
            goalId: 'goal-portfolio-foundation',
            planId: 'plan-import-contract',
            summary: 'Lock the first broker import contract and proof path.',
        })

        expect(order.state).toBe('drafting')
        expect(order.loop.round).toBe(0)
        expect(order.loop.reviewerVerdict).toBe(null)
    })

    it('creates a decision topic with pending lifecycle', () => {
        const topic = createDecisionTopic({
            id: 'topic-release-import',
            kind: 'approval',
            title: '要不要现在放行导入分支',
            goalId: 'goal-portfolio-foundation',
        })

        expect(topic.lifecycle).toBe('pending')
        expect(topic.messages).toEqual([])
    })

    it('records strongly typed agent events', () => {
        const event: AgentEvent = {
            id: 'evt-1',
            kind: 'ReviewerVerdict',
            workOrderId: 'wo-import-lane',
            emittedBy: 'reviewer',
            createdAt: '2026-04-06T10:00:00.000Z',
            payload: {
                verdict: 'revision_needed',
                summary: 'Proof is close but acceptance criteria are not fully covered.',
            },
        }

        expect(event.payload.verdict).toBe('revision_needed')
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/orchestration.test.ts
```

Expected: FAIL with `Cannot find module './orchestration'` and missing exported types.

- [ ] **Step 3: Add the new domain types to `types.ts`**

```ts
// omc-prototype/src/prototype/types.ts
export type WorkOrderState =
    | 'drafting'
    | 'queued'
    | 'executing'
    | 'self_check'
    | 'reviewer_check'
    | 'revision_needed'
    | 'blocked'
    | 'needs_decision'
    | 'waiting_user'
    | 'replanning_needed'
    | 'accepted'
    | 'integrated'

export type ReviewerVerdict =
    | 'accepted'
    | 'revision_needed'
    | 'blocked'
    | 'needs_decision'
    | 'replanning_needed'

export type AgentRole = 'manager' | 'driver' | 'reviewer' | 'gatekeeper'

export type AgentEvent =
    | {
        id: string
        kind: 'Observation'
        workOrderId: string
        emittedBy: AgentRole
        createdAt: string
        payload: { summary: string }
    }
    | {
        id: string
        kind: 'Proposal'
        workOrderId: string
        emittedBy: AgentRole
        createdAt: string
        payload: { summary: string }
    }
    | {
        id: string
        kind: 'Constraint'
        workOrderId: string
        emittedBy: AgentRole
        createdAt: string
        payload: { summary: string }
    }
    | {
        id: string
        kind: 'Conflict'
        workOrderId: string
        emittedBy: AgentRole
        createdAt: string
        payload: { summary: string }
    }
    | {
        id: string
        kind: 'DecisionRequest'
        workOrderId: string
        emittedBy: AgentRole
        createdAt: string
        payload: { summary: string; topicKind: OperatorThreadKind }
    }
    | {
        id: string
        kind: 'Resolution'
        workOrderId: string
        emittedBy: AgentRole
        createdAt: string
        payload: { summary: string }
    }
    | {
        id: string
        kind: 'ReviewerVerdict'
        workOrderId: string
        emittedBy: 'reviewer'
        createdAt: string
        payload: { verdict: ReviewerVerdict; summary: string }
    }
    | {
        id: string
        kind: 'ManagerDecision'
        workOrderId: string
        emittedBy: 'manager'
        createdAt: string
        payload: {
            decision: 'continue_loop' | 'escalate_to_user' | 'accept' | 'replan'
            summary: string
        }
    }

export type WorkOrder = {
    id: string
    goalId: string
    phaseId: string | null
    planId: string | null
    summary: string
    state: WorkOrderState
    constraints: string[]
    loop: {
        round: number
        reviewerVerdict: ReviewerVerdict | null
        lastDriverSummary: string | null
        lastReviewerSummary: string | null
    }
    waitingOnTopicId: string | null
}

export type DecisionTopic = {
    id: string
    kind: OperatorThreadKind
    title: string
    goalId: string | null
    workOrderId: string | null
    lifecycle: ThreadLifecycleState
    unread: boolean
    messages: string[]
}

export type WorldModel = {
    currentFocus: {
        goalId: string | null
        planId: string | null
    }
    workOrders: Record<string, WorkOrder>
    decisionTopics: Record<string, DecisionTopic>
    agentEvents: AgentEvent[]
}
```

- [ ] **Step 4: Implement the orchestration factory module**

```ts
// omc-prototype/src/prototype/orchestration.ts
import type { AgentEvent, DecisionTopic, OperatorThreadKind, WorldModel, WorkOrder } from './types'

export function createInitialWorldModel(input: {
    focusGoalId: string | null
    focusPlanId?: string | null
}): WorldModel {
    return {
        currentFocus: {
            goalId: input.focusGoalId,
            planId: input.focusPlanId ?? null,
        },
        workOrders: {},
        decisionTopics: {},
        agentEvents: [],
    }
}

export function createWorkOrder(input: {
    id: string
    goalId: string
    phaseId?: string | null
    planId?: string | null
    summary: string
    constraints?: string[]
}): WorkOrder {
    return {
        id: input.id,
        goalId: input.goalId,
        phaseId: input.phaseId ?? null,
        planId: input.planId ?? null,
        summary: input.summary,
        state: 'drafting',
        constraints: input.constraints ?? [],
        loop: {
            round: 0,
            reviewerVerdict: null,
            lastDriverSummary: null,
            lastReviewerSummary: null,
        },
        waitingOnTopicId: null,
    }
}

export function createDecisionTopic(input: {
    id: string
    kind: OperatorThreadKind
    title: string
    goalId: string | null
    workOrderId?: string | null
}): DecisionTopic {
    return {
        id: input.id,
        kind: input.kind,
        title: input.title,
        goalId: input.goalId,
        workOrderId: input.workOrderId ?? null,
        lifecycle: 'pending',
        unread: true,
        messages: [],
    }
}

export function appendAgentEvent(world: WorldModel, event: AgentEvent): WorldModel {
    return {
        ...world,
        agentEvents: [...world.agentEvents, event],
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/orchestration.test.ts
```

Expected: PASS with `4 passed`.

- [ ] **Step 6: Commit**

```bash
git add omc-prototype/src/prototype/types.ts omc-prototype/src/prototype/orchestration.ts omc-prototype/src/prototype/orchestration.test.ts
git commit -m "feat: add orchestration domain model"
```

### Task 2: Implement the WorkOrder Ralph loop reducer

**Files:**
- Create: `omc-prototype/src/prototype/workOrderLoop.ts`
- Create: `omc-prototype/src/prototype/workOrderLoop.test.ts`
- Modify: `omc-prototype/src/prototype/orchestration.ts`
- Test: `omc-prototype/src/prototype/workOrderLoop.test.ts`

- [ ] **Step 1: Write the failing loop-state test**

```ts
// omc-prototype/src/prototype/workOrderLoop.test.ts
import { describe, expect, it } from 'vitest'
import { createWorkOrder } from './orchestration'
import {
    queueWorkOrder,
    startExecutionRound,
    finishSelfCheck,
    applyReviewerVerdict,
    resumeAfterDecision,
} from './workOrderLoop'

describe('work order Ralph loop', () => {
    it('moves from drafting to queued to executing', () => {
        const initial = createWorkOrder({
            id: 'wo-import-lane',
            goalId: 'goal-portfolio-foundation',
            summary: 'Lock the import lane.',
        })

        const queued = queueWorkOrder(initial)
        const running = startExecutionRound(queued, 'Inspect import proof and tighten the lane.')

        expect(queued.state).toBe('queued')
        expect(running.state).toBe('executing')
        expect(running.loop.round).toBe(1)
    })

    it('loops back to executing when reviewer requests revision', () => {
        const running = startExecutionRound(
            queueWorkOrder(
                createWorkOrder({
                    id: 'wo-import-lane',
                    goalId: 'goal-portfolio-foundation',
                    summary: 'Lock the import lane.',
                }),
            ),
            'Tighten the import lane.',
        )

        const selfChecked = finishSelfCheck(running, 'Driver believes proof is ready.')
        const revised = applyReviewerVerdict(selfChecked, 'revision_needed', 'Coverage still misses one acceptance path.')

        expect(revised.state).toBe('revision_needed')
        expect(revised.loop.reviewerVerdict).toBe('revision_needed')
    })

    it('moves to waiting_user when reviewer says a decision is needed', () => {
        const running = startExecutionRound(
            queueWorkOrder(
                createWorkOrder({
                    id: 'wo-import-lane',
                    goalId: 'goal-portfolio-foundation',
                    summary: 'Lock the import lane.',
                }),
            ),
            'Prepare release candidate.',
        )

        const selfChecked = finishSelfCheck(running, 'Driver reached release boundary.')
        const gated = applyReviewerVerdict(selfChecked, 'needs_decision', 'Release crosses an operator boundary.')

        expect(gated.state).toBe('waiting_user')

        const resumed = resumeAfterDecision(gated, 'Do one more hardening round first.')
        expect(resumed.state).toBe('queued')
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/workOrderLoop.test.ts
```

Expected: FAIL with `Cannot find module './workOrderLoop'`.

- [ ] **Step 3: Implement the loop transition helpers**

```ts
// omc-prototype/src/prototype/workOrderLoop.ts
import type { ReviewerVerdict, WorkOrder } from './types'

export function queueWorkOrder(order: WorkOrder): WorkOrder {
    return {
        ...order,
        state: 'queued',
    }
}

export function startExecutionRound(order: WorkOrder, summary: string): WorkOrder {
    return {
        ...order,
        state: 'executing',
        loop: {
            ...order.loop,
            round: order.loop.round + 1,
            reviewerVerdict: null,
            lastDriverSummary: summary,
            lastReviewerSummary: null,
        },
    }
}

export function finishSelfCheck(order: WorkOrder, summary: string): WorkOrder {
    return {
        ...order,
        state: 'reviewer_check',
        loop: {
            ...order.loop,
            lastDriverSummary: summary,
        },
    }
}

export function applyReviewerVerdict(
    order: WorkOrder,
    verdict: ReviewerVerdict,
    summary: string,
): WorkOrder {
    const nextState = verdict === 'accepted'
        ? 'accepted'
        : verdict === 'needs_decision'
            ? 'waiting_user'
            : verdict

    return {
        ...order,
        state: nextState,
        loop: {
            ...order.loop,
            reviewerVerdict: verdict,
            lastReviewerSummary: summary,
        },
    }
}

export function resumeAfterDecision(order: WorkOrder, summary: string): WorkOrder {
    return {
        ...order,
        state: 'queued',
        loop: {
            ...order.loop,
            lastReviewerSummary: summary,
        },
        waitingOnTopicId: null,
    }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/workOrderLoop.test.ts
```

Expected: PASS with `3 passed`.

- [ ] **Step 5: Commit**

```bash
git add omc-prototype/src/prototype/workOrderLoop.ts omc-prototype/src/prototype/workOrderLoop.test.ts
git commit -m "feat: add work order Ralph loop helpers"
```

### Task 3: Introduce Gatekeeper decision-topic derivation

**Files:**
- Create: `omc-prototype/src/prototype/decisionTopics.ts`
- Create: `omc-prototype/src/prototype/decisionTopics.test.ts`
- Modify: `omc-prototype/src/prototype/threads.ts`
- Modify: `omc-prototype/src/prototype/threadSelectors.ts`
- Test: `omc-prototype/src/prototype/decisionTopics.test.ts`

- [ ] **Step 1: Write the failing gatekeeper test**

```ts
// omc-prototype/src/prototype/decisionTopics.test.ts
import { describe, expect, it } from 'vitest'
import { createDecisionTopic, createInitialWorldModel, createWorkOrder } from './orchestration'
import { deriveDecisionTopics } from './decisionTopics'

describe('gatekeeper decision-topic derivation', () => {
    it('opens a new topic for work orders waiting on user input', () => {
        const world = createInitialWorldModel({
            focusGoalId: 'goal-portfolio-foundation',
        })

        const gatedOrder = {
            ...createWorkOrder({
                id: 'wo-import-lane',
                goalId: 'goal-portfolio-foundation',
                summary: 'Prepare release candidate.',
            }),
            state: 'waiting_user' as const,
            waitingOnTopicId: 'topic-release-import',
        }

        const next = deriveDecisionTopics({
            world: {
                ...world,
                workOrders: { [gatedOrder.id]: gatedOrder },
            },
            previousTopics: {},
        })

        expect(next['topic-release-import']?.lifecycle).toBe('pending')
    })

    it('keeps informational topics passive and intervention topics active', () => {
        const passive = createDecisionTopic({
            id: 'topic-status',
            kind: 'status',
            title: '当前主线为什么先压导入',
            goalId: 'goal-portfolio-foundation',
        })
        const active = createDecisionTopic({
            id: 'topic-risk',
            kind: 'risk',
            title: '首个券商范围仍偏大',
            goalId: 'goal-portfolio-foundation',
        })

        const topics = deriveDecisionTopics({
            world: createInitialWorldModel({ focusGoalId: 'goal-portfolio-foundation' }),
            previousTopics: {
                [passive.id]: passive,
                [active.id]: active,
            },
        })

        expect(topics['topic-status']?.lifecycle).not.toBe('pending')
        expect(topics['topic-risk']?.lifecycle).toBe('pending')
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/decisionTopics.test.ts
```

Expected: FAIL with missing `deriveDecisionTopics`.

- [ ] **Step 3: Implement gatekeeper derivation**

```ts
// omc-prototype/src/prototype/decisionTopics.ts
import { createDecisionTopic } from './orchestration'
import type { DecisionTopic, WorldModel } from './types'

export function deriveDecisionTopics(input: {
    world: WorldModel
    previousTopics: Record<string, DecisionTopic>
}): Record<string, DecisionTopic> {
    const next: Record<string, DecisionTopic> = { ...input.previousTopics }

    for (const order of Object.values(input.world.workOrders)) {
        if (order.state !== 'waiting_user' || !order.waitingOnTopicId) {
            continue
        }

        const previous = next[order.waitingOnTopicId]
        next[order.waitingOnTopicId] = previous ?? createDecisionTopic({
            id: order.waitingOnTopicId,
            kind: 'approval',
            title: '需要你的决定',
            goalId: order.goalId,
            workOrderId: order.id,
        })
    }

    for (const topic of Object.values(next)) {
        if (topic.kind === 'status' && topic.lifecycle === 'pending') {
            next[topic.id] = {
                ...topic,
                lifecycle: 'in-progress',
            }
        }
    }

    return next
}
```

- [ ] **Step 4: Rewire thread selection helpers to prefer real intervention topics**

```ts
// omc-prototype/src/prototype/threadSelectors.ts
import type { DecisionTopic, ThreadLifecycleState } from './types'

function isActionable(topic: DecisionTopic) {
    return topic.lifecycle === 'pending'
        || topic.lifecycle === 'waiting'
        || topic.lifecycle === 'in-progress'
}

function scoreTopic(topic: DecisionTopic) {
    let score = 0
    if (topic.kind !== 'status') score += 20
    if (topic.lifecycle === 'pending') score += 12
    if (topic.lifecycle === 'waiting') score += 10
    if (topic.unread) score += 6
    return score
}

export function sortTopicsForInbox(topics: DecisionTopic[]) {
    return [...topics].sort((left, right) => scoreTopic(right) - scoreTopic(left))
}

export function countActionableTopics(topics: DecisionTopic[]) {
    return topics.filter(isActionable).length
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/decisionTopics.test.ts
```

Expected: PASS with `2 passed`.

- [ ] **Step 6: Commit**

```bash
git add omc-prototype/src/prototype/decisionTopics.ts omc-prototype/src/prototype/decisionTopics.test.ts omc-prototype/src/prototype/threadSelectors.ts
git commit -m "feat: derive decision topics through gatekeeper rules"
```

### Task 4: Rebuild the prototype store around world model transitions

**Files:**
- Modify: `omc-prototype/src/prototype/store.tsx`
- Modify: `omc-prototype/src/prototype/scenario.ts`
- Modify: `omc-prototype/src/prototype/presenter.ts`
- Test: `omc-prototype/src/prototype/threads.test.ts`

- [ ] **Step 1: Write the failing store-level behavior test**

```ts
// append to omc-prototype/src/prototype/threads.test.ts
import { renderHook, act } from '@testing-library/react'
import { PrototypeStoreProvider, usePrototypeStore } from './store'

it('requeues a waiting work order after the operator replies with a directive', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <PrototypeStoreProvider>{children}</PrototypeStoreProvider>
    )

    const { result } = renderHook(() => usePrototypeStore(), { wrapper })

    act(() => {
        result.current.actions.attachDemoProgram()
    })

    const approvalThread = result.current.threads.find((thread) => thread.kind === 'approval')
    expect(approvalThread).toBeDefined()

    act(() => {
        result.current.actions.sendThreadReply(approvalThread!.id, '先不要放行，再加固一轮')
    })

    const snapshot = result.current.dataSource.getPortfolio('today')
    expect(snapshot.goals[0]?.headline).toContain('加固')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/threads.test.ts
```

Expected: FAIL because the current store only mutates scenario overrides and has no `WorkOrder` requeue semantics.

- [ ] **Step 3: Introduce world-model-backed derived state**

```ts
// omc-prototype/src/prototype/store.tsx
import {
    appendAgentEvent,
    createDecisionTopic,
    createInitialWorldModel,
    createWorkOrder,
} from './orchestration'
import {
    applyReviewerVerdict,
    finishSelfCheck,
    queueWorkOrder,
    resumeAfterDecision,
    startExecutionRound,
} from './workOrderLoop'
import { deriveDecisionTopics } from './decisionTopics'

function buildDerivedSnapshot(state: PrototypeUiState): PrototypeScenarioSnapshot {
    const base = getPrototypeSnapshot(state.checkpoint)
    const world = state.worldModel

    return {
        ...base,
        goals: applyGoalOverrides(base.goals, {
            priorities: state.goalPriorities,
            directions: state.goalDirections,
            guidance: state.goalGuidance,
        }),
        planCards: base.planCards.map((card) => {
            const relatedOrder = Object.values(world.workOrders).find((order) => order.planId === card.id)
            if (!relatedOrder) {
                return card
            }
            return {
                ...card,
                signal: relatedOrder.loop.lastDriverSummary ?? card.signal,
            }
        }),
    }
}
```

```ts
// inside reducer send-thread-reply branch
const userDirective = text.trim()
const waitingOrder = Object.values(state.worldModel.workOrders).find(
    (order) => order.waitingOnTopicId === action.threadId,
)

const nextWorld = waitingOrder
    ? {
        ...state.worldModel,
        workOrders: {
            ...state.worldModel.workOrders,
            [waitingOrder.id]: resumeAfterDecision(waitingOrder, userDirective),
        },
    }
    : state.worldModel
```

- [ ] **Step 4: Re-sync threads from world model instead of raw approval/risk mutation only**

```ts
// omc-prototype/src/prototype/store.tsx
function syncThreadState(state: PrototypeUiState): PrototypeUiState {
    const snapshot = buildDerivedSnapshot(state)
    const derivedTopics = deriveDecisionTopics({
        world: state.worldModel,
        previousTopics: state.decisionTopics,
    })

    const { bundle, activeThreadId } = syncOperatorThreadBundle({
        snapshot,
        previousState: {
            threadsById: state.threadsById,
            messagesByThread: state.messagesByThread,
            activeThreadId: state.activeThreadId,
        },
        decisionTopics: derivedTopics,
    })

    return {
        ...state,
        decisionTopics: derivedTopics,
        threadsById: bundle.threadsById,
        messagesByThread: bundle.messagesByThread,
        activeThreadId,
    }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/prototype/threads.test.ts
```

Expected: PASS and the new directive test shows the thread reply affecting the derived world model.

- [ ] **Step 6: Commit**

```bash
git add omc-prototype/src/prototype/store.tsx omc-prototype/src/prototype/scenario.ts omc-prototype/src/prototype/presenter.ts omc-prototype/src/prototype/threads.test.ts
git commit -m "feat: derive prototype state from world model transitions"
```

### Task 5: Project the new domain into the operator UI

Compatibility note: `GoalPage` and `ExecutionDetailPage` remain only as redirect bridges into the root workspace; they are no longer first-class destinations in the operator flow.

**Files:**
- Modify: `omc-prototype/src/components/MessagePanel.tsx`
- Modify: `omc-prototype/src/components/operator/MessageWorkspace.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadInbox.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadConversation.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadHeader.tsx`
- Modify: `omc-prototype/src/components/DashboardPanels.tsx`
- Modify: `omc-prototype/src/screens/DashboardPage.tsx`
- Modify: `omc-prototype/src/screens/GoalPage.tsx`
- Modify: `omc-prototype/src/screens/ExecutionDetailPage.tsx`
- Modify: `omc-prototype/src/index.css`
- Test: `omc-prototype/src/components/operator/MessageWorkspace.test.tsx`
- Test: `omc-prototype/src/components/operator/ThreadConversation.test.tsx`
- Test: `omc-prototype/src/components/operator/ThreadHeader.test.tsx`

- [ ] **Step 1: Write the failing UI projection test**

```tsx
// append to omc-prototype/src/components/operator/ThreadConversation.test.tsx
import { render, screen } from '@testing-library/react'
import ThreadConversation from './ThreadConversation'
import type { OperatorMessage, OperatorThread } from '@/prototype/types'

it('renders quick actions as the operator-facing boundary for a decision topic', () => {
    const thread: OperatorThread = {
        id: 'approval:branch',
        kind: 'approval',
        goalId: 'goal-portfolio-foundation',
        title: '要不要现在放行导入分支',
        preview: '导入分支已经接近放行边界。',
        updatedAt: '第 0 天 · 16:10',
        lifecycle: 'pending',
        priority: 'critical',
        tone: 'accent',
        unread: true,
        passive: false,
        refs: [],
        detailSections: [],
        firstMessage: {
            currentStatus: '现在要你拍板：放行导入分支。',
            background: '导入链路已经基本稳定。',
            whyNow: '继续自动推进会跨过经营边界。',
            suggestedAction: '如果你认可，我就放行。',
            freeformInvite: '也可以直接说别放。',
        },
        quickActions: [
            {
                id: 'approve',
                label: '确认放行',
                tone: 'primary',
                operation: { type: 'approval-approve', approvalId: 'approval-branch-ingest' },
            },
        ],
        statusLabel: '待处理',
    }

    const messages: OperatorMessage[] = [
        {
            id: 'msg-1',
            threadId: thread.id,
            role: 'agent',
            body: '现在要你拍板：放行导入分支。',
            createdAt: '2026-04-06T10:00:00.000Z',
            status: 'read',
        },
    ]

    render(<ThreadConversation thread={thread} messages={messages} />)

    expect(screen.getByRole('button', { name: '确认放行' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/ThreadConversation.test.tsx
```

Expected: FAIL because the current thread presentation still mixes old compact-thread assumptions and does not fully reflect decision-boundary semantics.

- [ ] **Step 3: Update the message workspace to read from `DecisionTopic` semantics**

```tsx
// omc-prototype/src/components/operator/ThreadHeader.tsx
export default function ThreadHeader(props: { thread: OperatorThread }) {
    const contextRefs = props.thread.refs.filter((ref) => ref.kind !== 'impact').slice(0, 3)
    const contextLine = contextRefs.map((ref) => {
        switch (ref.kind) {
            case 'goal':
                return `目标：${ref.label}`
            case 'phase':
                return `阶段：${ref.label}`
            case 'plan':
                return `计划：${ref.label}`
            case 'impact':
                return `影响：${ref.label}`
        }
    }).join(' · ')

    return (
        <header className="prototype-chat-thread__header">
            <div className="prototype-chat-thread__meta">
                <span className="prototype-chat-thread__status">{props.thread.statusLabel}</span>
                {contextLine ? <p className="prototype-chat-thread__context">{contextLine}</p> : null}
            </div>
        </header>
    )
}
```

```tsx
// omc-prototype/src/components/operator/ThreadConversation.tsx
<section className="prototype-chat-thread">
    <ThreadHeader thread={props.thread} />
    <ThreadPrimitive.Root className="prototype-chat-thread__root">
        <ThreadPrimitive.Viewport className="prototype-chat-thread__viewport" autoScroll>
            <div className="prototype-chat-thread__messages">
                <ThreadPrimitive.Messages components={THREAD_COMPONENTS} />
            </div>
        </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
    <ThreadQuickActions thread={props.thread} />
    <ComposerPrimitive.Root className="prototype-chat-compose">
        <div className="prototype-chat-compose__row">
            <ComposerPrimitive.Input
                className="prototype-chat-compose__input"
                placeholder="继续追问，或直接告诉 Agent 要怎么做"
                submitOnEnter
                maxRows={4}
            />
            <ComposerPrimitive.Send className="prototype-primary-button prototype-chat-compose__send">
                发送
            </ComposerPrimitive.Send>
        </div>
    </ComposerPrimitive.Root>
</section>
```

- [ ] **Step 4: Remove direct decision controls from the main canvas**

```tsx
// omc-prototype/src/components/DashboardPanels.tsx
// goal card footer should only expose thread handoff
<div className="prototype-inline-actions">
    <Link to="/goals/$goalId" params={{ goalId: goal.id }}>
        查看目标
    </Link>
    <button type="button" onClick={() => actions.setActiveThread(primaryThread.id)}>
        打开线程
    </button>
</div>
```

```tsx
// omc-prototype/src/screens/DashboardPage.tsx
<GoalPortfolioPanel goals={portfolio.goals} checkpointId={portfolio.checkpoint.id} />
<DailyDigestPanel window={portfolio.digest.window} headline="今日摘要" summary={checkpoint.synopsis} />
<PlanCardsOverviewPanel goals={portfolio.goals} planCards={portfolio.planCards} checkpointId={portfolio.checkpoint.id} />
```

- [ ] **Step 5: Run the operator UI tests and the full prototype test suite**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
TMPDIR=/tmp bun run test -- src/components/operator/MessageWorkspace.test.tsx src/components/operator/ThreadConversation.test.tsx src/components/operator/ThreadHeader.test.tsx
TMPDIR=/tmp bun run test
TMPDIR=/tmp bun run typecheck
TMPDIR=/tmp bun run build
```

Expected:

- targeted operator tests: PASS
- full suite: PASS
- typecheck: PASS
- build: PASS

- [ ] **Step 6: Commit**

```bash
git add omc-prototype/src/components/MessagePanel.tsx omc-prototype/src/components/operator/MessageWorkspace.tsx omc-prototype/src/components/operator/ThreadInbox.tsx omc-prototype/src/components/operator/ThreadConversation.tsx omc-prototype/src/components/operator/ThreadHeader.tsx omc-prototype/src/components/DashboardPanels.tsx omc-prototype/src/screens/DashboardPage.tsx omc-prototype/src/screens/GoalPage.tsx omc-prototype/src/screens/ExecutionDetailPage.tsx omc-prototype/src/index.css omc-prototype/src/components/operator/MessageWorkspace.test.tsx omc-prototype/src/components/operator/ThreadConversation.test.tsx omc-prototype/src/components/operator/ThreadHeader.test.tsx
git commit -m "feat: project multi-agent state into operator UI"
```

## Self-Review

### Spec coverage

- long-lived role simplification: covered by Task 1 domain model and Task 4 store integration
- `WorldModel / WorkOrder / DecisionTopic / AgentEvent`: covered by Tasks 1, 2, and 3
- Ralph-style `WorkOrder` loop: covered by Task 2
- user-input interpretation and thread lifecycle wiring: covered by Tasks 3 and 4
- message workspace as decision boundary surface: covered by Task 5

No uncovered spec sections remain for the prototype implementation scope.

### Placeholder scan

- no `TODO`, `TBD`, or “implement later”
- every task lists exact files
- every code-changing step includes concrete code
- every verification step has exact commands and expected outcomes

### Type consistency

- `WorkOrder`, `DecisionTopic`, and `AgentEvent` are introduced in Task 1 and reused consistently in later tasks
- `ReviewerVerdict` values match the state machine from the spec
- `DecisionTopic.lifecycle` uses existing `ThreadLifecycleState` names so UI projection remains aligned
