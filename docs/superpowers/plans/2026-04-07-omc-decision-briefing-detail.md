# OMC Decision Briefing Detail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make real OMC decision threads understandable without prior background by replacing demo-only titles, translating runtime failures into operator-facing Chinese briefings, and moving raw evidence into a collapsed evidence section with direct log/trace entry points.

**Architecture:** Add a small decision-briefing projection layer between live OMC runtime data and thread rendering. Keep the existing `threads -> store -> MessageWorkspace -> ThreadConversation` flow, but enrich live threads with typed briefing/evidence metadata and render that metadata above the transcript through a dedicated briefing card instead of relying on the first chat bubble.

**Tech Stack:** React 19, TypeScript, Vitest, Testing Library, Vite, `@assistant-ui/react`

---

### Task 1: Add typed decision briefing and evidence models

**Files:**
- Modify: `omc-prototype/src/prototype/types.ts`
- Create: `omc-prototype/src/prototype/decisionBriefing.ts`
- Create: `omc-prototype/src/prototype/decisionBriefing.test.ts`
- Test: `omc-prototype/src/prototype/decisionBriefing.test.ts`

- [ ] **Step 1: Write the failing translation tests**

```ts
// omc-prototype/src/prototype/decisionBriefing.test.ts
import { describe, expect, it } from 'vitest'
import { buildDecisionBriefing } from './decisionBriefing'

describe('decision briefing projection', () => {
    it('translates session-inactive runtime failures into operator-facing Chinese copy', () => {
        const briefing = buildDecisionBriefing({
            kind: 'approval',
            threadId: 'approval:01-01',
            liveContext: {
                projectLabel: 'CardGame',
                goalLabel: '01 First Playable Expedition',
                planLabel: 'Establish expedition domain',
                attemptNumber: 3,
                sessionId: 'session-cardgame-1',
                latestSummary: 'The linked session became inactive before the attempt reported a structured outcome.',
                terminationReason: 'session-inactive',
                nextSuggestedStep: 'Inspect the session history, then resume the loop when the machine is stable.',
                evidenceFingerprint: 'session-inactive',
            },
        })

        expect(briefing.title).toBe('执行中断，等待恢复确认')
        expect(briefing.summaryRows.whatHappened).toContain('CardGame')
        expect(briefing.summaryRows.whatHappened).toContain('Establish expedition domain')
        expect(briefing.summaryRows.recommendedAction).toContain('查看')
        expect(briefing.rawEvidence.summary).toBe('The linked session became inactive before the attempt reported a structured outcome.')
        expect(briefing.rawEvidence.defaultExpanded).toBe(false)
    })

    it('keeps product approval copy separate from runtime interruption copy', () => {
        const briefing = buildDecisionBriefing({
            kind: 'approval',
            threadId: 'approval:01-02',
            liveContext: {
                projectLabel: 'CardGame',
                goalLabel: '01 First Playable Expedition',
                planLabel: 'Promote expedition proof',
                attemptNumber: 2,
                sessionId: 'session-review-1',
                latestSummary: 'Reviewer accepted the work but wants a human release decision.',
                terminationReason: null,
                nextSuggestedStep: null,
                evidenceFingerprint: null,
            },
        })

        expect(briefing.title).toBe('确认是否继续当前计划')
        expect(briefing.summaryRows.whyEscalated).toContain('人工确认')
        expect(briefing.primaryAction?.label).toContain('继续')
        expect(briefing.secondaryAction?.label).toContain('保持')
    })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
bun run test -- src/prototype/decisionBriefing.test.ts
```

Expected: FAIL with `Cannot find module './decisionBriefing'` and missing decision briefing types.

- [ ] **Step 3: Add the new thread-level briefing types**

```ts
// omc-prototype/src/prototype/types.ts
export type DecisionSummaryRows = {
    whatHappened: string
    whyEscalated: string
    recommendedAction: string
    currentImpact: string
}

export type DecisionEvidence = {
    summary: string | null
    terminationReason: string | null
    nextSuggestedStep: string | null
    failureFingerprint: string | null
    defaultExpanded: boolean
}

export type DecisionActionHint = {
    label: string
    helper: string
}

export type DecisionIdentity = {
    projectLabel: string | null
    goalLabel: string | null
    planLabel: string | null
    attemptNumber: number | null
    sessionId: string | null
}

export type DecisionBriefing = {
    title: string
    identity: DecisionIdentity
    summaryRows: DecisionSummaryRows
    primaryAction: DecisionActionHint | null
    secondaryAction: DecisionActionHint | null
    rawEvidence: DecisionEvidence
}

export type OperatorThread = {
    id: string
    kind: OperatorThreadKind
    goalId: string | null
    title: string
    preview: string
    updatedAt: string
    lifecycle: ThreadLifecycleState
    priority: ThreadPriority
    tone: OperatorThreadTone
    unread: boolean
    passive: boolean
    refs: ThreadContextRef[]
    detailSections: ThreadDetailSection[]
    firstMessage: OperatorFirstMessage
    quickActions: QuickActionSpec[]
    statusLabel: string
    briefing?: DecisionBriefing | null
}
```

- [ ] **Step 4: Implement the translation module**

```ts
// omc-prototype/src/prototype/decisionBriefing.ts
import type { DecisionBriefing, OperatorThreadKind } from './types'

type BuildDecisionBriefingInput = {
    kind: OperatorThreadKind
    threadId: string
    liveContext: {
        projectLabel: string | null
        goalLabel: string | null
        planLabel: string | null
        attemptNumber: number | null
        sessionId: string | null
        latestSummary: string | null
        terminationReason: string | null
        nextSuggestedStep: string | null
        evidenceFingerprint: string | null
    }
}

function buildInterruptionBriefing(input: BuildDecisionBriefingInput): DecisionBriefing {
    const planLabel = input.liveContext.planLabel ?? '当前计划'
    const projectLabel = input.liveContext.projectLabel ?? '当前项目'

    return {
        title: '执行中断，等待恢复确认',
        identity: {
            projectLabel,
            goalLabel: input.liveContext.goalLabel,
            planLabel,
            attemptNumber: input.liveContext.attemptNumber,
            sessionId: input.liveContext.sessionId,
        },
        summaryRows: {
            whatHappened: `${projectLabel} 的「${planLabel}」在执行中失去了关联 session，这一轮还没来得及上报结果。`,
            whyEscalated: '系统现在无法判断这轮应该继续、重试，还是改方向，所以需要你确认下一步。',
            recommendedAction: '先查看这轮日志；如果只是 session 意外断开，可以在机器稳定后恢复执行。',
            currentImpact: '这张计划卡暂时不会继续自动推进，直到你确认如何处理。',
        },
        primaryAction: {
            label: '查看日志后重试',
            helper: '先打开这轮 session log 判断中断原因；确认环境稳定后再恢复自动执行。',
        },
        secondaryAction: {
            label: '先保持现状',
            helper: '保留当前状态，不恢复自动推进，这条话题继续留在收件箱。',
        },
        rawEvidence: {
            summary: input.liveContext.latestSummary,
            terminationReason: input.liveContext.terminationReason,
            nextSuggestedStep: input.liveContext.nextSuggestedStep,
            failureFingerprint: input.liveContext.evidenceFingerprint,
            defaultExpanded: false,
        },
    }
}

export function buildDecisionBriefing(input: BuildDecisionBriefingInput): DecisionBriefing {
    if (input.liveContext.terminationReason === 'session-inactive') {
        return buildInterruptionBriefing(input)
    }

    return {
        title: '确认是否继续当前计划',
        identity: {
            projectLabel: input.liveContext.projectLabel,
            goalLabel: input.liveContext.goalLabel,
            planLabel: input.liveContext.planLabel,
            attemptNumber: input.liveContext.attemptNumber,
            sessionId: input.liveContext.sessionId,
        },
        summaryRows: {
            whatHappened: `「${input.liveContext.planLabel ?? '当前计划'}」已经到达人工边界。`,
            whyEscalated: '当前 review / merge 结果需要人工确认，系统不会直接越过这条边界。',
            recommendedAction: input.liveContext.latestSummary ?? '按当前建议继续，或明确告诉系统要调整什么。',
            currentImpact: '在你确认前，这条计划不会继续自动推进。',
        },
        primaryAction: {
            label: '按当前建议继续',
            helper: '系统会按当前 review 结论继续推进，必要时离开收件箱。',
        },
        secondaryAction: {
            label: '先保持现状',
            helper: '不改变当前计划状态，保留这条话题等待后续处理。',
        },
        rawEvidence: {
            summary: input.liveContext.latestSummary,
            terminationReason: input.liveContext.terminationReason,
            nextSuggestedStep: input.liveContext.nextSuggestedStep,
            failureFingerprint: input.liveContext.evidenceFingerprint,
            defaultExpanded: false,
        },
    }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
bun run test -- src/prototype/decisionBriefing.test.ts
```

Expected: PASS with 2 tests passing.

- [ ] **Step 6: Commit**

```bash
git add omc-prototype/src/prototype/types.ts omc-prototype/src/prototype/decisionBriefing.ts omc-prototype/src/prototype/decisionBriefing.test.ts
git commit -m "feat: add OMC decision briefing projection"
```

### Task 2: Map live OMC runtime data into real thread titles and briefing metadata

**Files:**
- Modify: `omc-prototype/src/prototype/omcProjection.ts`
- Modify: `omc-prototype/src/prototype/threads.ts`
- Modify: `omc-prototype/src/prototype/omcProjection.test.ts`
- Modify: `omc-prototype/src/prototype/threads.test.ts`
- Test: `omc-prototype/src/prototype/omcProjection.test.ts`
- Test: `omc-prototype/src/prototype/threads.test.ts`

- [ ] **Step 1: Write the failing projection assertions**

```ts
// omc-prototype/src/prototype/omcProjection.test.ts
it('keeps real OMC approval titles instead of demo scenario labels', () => {
    const snapshot = buildPrototypeSnapshotFromOmc({
        overview: createProgramOverview(),
        index: createPlanningIndex(),
        runtimes: createPlanRuntimes().map((runtime) => (
            runtime.planKey === '01-01'
                ? {
                    ...runtime,
                    reviewRequired: true,
                    latestEvidenceSummary: 'The linked session became inactive before the attempt reported a structured outcome.',
                    mergeStatus: 'idle',
                }
                : runtime
        )),
        details: {
            ...createPlanDetails(createPlanRuntimes()),
            '01-01': {
                ...createPlanDetails(createPlanRuntimes())['01-01'],
                attempts: [
                    {
                        ...createPlanDetails(createPlanRuntimes())['01-01'].attempts[0],
                        terminationReason: 'session-inactive',
                        nextSuggestedStep: 'Inspect the session history, then resume the loop when the machine is stable.',
                    },
                ],
            },
        },
    })

    expect(snapshot.approvalBatches.today.items.find((item) => item.id === '01-01')?.title).toBe('Lock runtime foundation')
})
```

```ts
// omc-prototype/src/prototype/threads.test.ts
it('attaches live briefing metadata to approval threads from OMC data', () => {
    const snapshot = buildPrototypeSnapshotFromOmc({
        overview: createProgramOverview(),
        index: createPlanningIndex(),
        runtimes: createPlanRuntimes().map((runtime) => (
            runtime.planKey === '01-01'
                ? {
                    ...runtime,
                    reviewRequired: true,
                    latestEvidenceSummary: 'The linked session became inactive before the attempt reported a structured outcome.',
                }
                : runtime
        )),
        details: {
            ...createPlanDetails(createPlanRuntimes()),
            '01-01': {
                ...createPlanDetails(createPlanRuntimes())['01-01'],
                attempts: [
                    {
                        ...createPlanDetails(createPlanRuntimes())['01-01'].attempts[0],
                        terminationReason: 'session-inactive',
                    },
                ],
            },
        },
    })

    const thread = buildOperatorThreadSeeds(snapshot).find((candidate) => candidate.id === 'approval:01-01')

    expect(thread?.title).toBe('执行中断，等待恢复确认')
    expect(thread?.briefing?.summaryRows.whatHappened).toContain('Lock runtime foundation')
    expect(thread?.briefing?.rawEvidence.summary).toBe('The linked session became inactive before the attempt reported a structured outcome.')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
bun run test -- src/prototype/omcProjection.test.ts src/prototype/threads.test.ts
```

Expected: FAIL because live approval items still use generic approval framing and threads have no `briefing`.

- [ ] **Step 3: Add live metadata to snapshot approval items and thread construction**

```ts
// omc-prototype/src/prototype/omcProjection.ts
function createApprovalItem(bundle: PlanBundle): PrototypeApprovalItem | null {
    const latest = latestAttempt(bundle.detail)
    const summary =
        bundle.runtime?.mergeStatus === 'blocked' || bundle.runtime?.mergeStatus === 'conflict'
            ? bundle.runtime?.mergeBlockedReason ?? bundle.runtime?.latestEvidenceSummary ?? bundle.plan.summary
            : bundle.runtime?.latestEvidenceSummary ?? `Review 接受了 ${bundle.plan.planTitle}，需要你决定是否继续。`

    return {
        id: bundle.plan.planKey,
        goalId: bundle.phase.phaseKey,
        title: bundle.plan.planTitle,
        kind: approvalKind(bundle.runtime!),
        summary,
        branchName: bundle.runtime?.currentBranch ?? null,
        requestedAt: toIsoString(bundle.runtime?.updatedAt ?? bundle.plan.lastModifiedAt),
        state: 'pending',
    }
}
```

```ts
// omc-prototype/src/prototype/threads.ts
import { buildDecisionBriefing } from './decisionBriefing'

function createLiveApprovalBriefing(snapshot: PrototypeScenarioSnapshot, item: PrototypeApprovalItem): DecisionBriefing | null {
    const programLabel = snapshot.program.name
    const goal = snapshot.goals.find((goal) => goal.id === item.goalId)

    if (!snapshot.program.id.startsWith('omc-') && !item.id.match(/^\d{2}-\d{2}$/)) {
        return null
    }

    return buildDecisionBriefing({
        kind: 'approval',
        threadId: `approval:${item.id}`,
        liveContext: {
            projectLabel: programLabel,
            goalLabel: goal?.title ?? null,
            planLabel: item.title,
            attemptNumber: null,
            sessionId: null,
            latestSummary: item.summary,
            terminationReason: item.summary.includes('structured outcome') ? 'session-inactive' : null,
            nextSuggestedStep: null,
            evidenceFingerprint: null,
        },
    })
}
```

- [ ] **Step 4: Replace live thread title/action copy when live briefing exists**

```ts
// omc-prototype/src/prototype/threads.ts
const liveBriefing = createLiveApprovalBriefing(snapshot, item)

return {
    id: `approval:${item.id}`,
    kind: 'approval',
    goalId: item.goalId,
    title: liveBriefing?.title ?? approvalThreadTitle(item),
    preview: liveBriefing?.summaryRows.whatHappened ?? item.summary,
    briefing: liveBriefing,
    // keep existing quick action wiring, but prefer briefing action labels for display
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
bun run test -- src/prototype/omcProjection.test.ts src/prototype/threads.test.ts
```

Expected: PASS with live OMC approval titles and thread briefing metadata asserted.

- [ ] **Step 6: Commit**

```bash
git add omc-prototype/src/prototype/omcProjection.ts omc-prototype/src/prototype/threads.ts omc-prototype/src/prototype/omcProjection.test.ts omc-prototype/src/prototype/threads.test.ts
git commit -m "feat: map live OMC decisions to briefing metadata"
```

### Task 3: Render the briefing card and collapsed raw evidence section above the transcript

**Files:**
- Create: `omc-prototype/src/components/operator/DecisionBriefingCard.tsx`
- Create: `omc-prototype/src/components/operator/DecisionBriefingCard.test.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadHeader.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadHeader.test.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadConversation.tsx`
- Modify: `omc-prototype/src/components/operator/ThreadConversation.test.tsx`
- Modify: `omc-prototype/src/components/operator/MessageWorkspace.tsx`
- Modify: `omc-prototype/src/components/operator/MessageWorkspace.test.tsx`
- Modify: `omc-prototype/src/index.css`
- Test: `omc-prototype/src/components/operator/DecisionBriefingCard.test.tsx`
- Test: `omc-prototype/src/components/operator/ThreadConversation.test.tsx`
- Test: `omc-prototype/src/components/operator/ThreadHeader.test.tsx`
- Test: `omc-prototype/src/components/operator/MessageWorkspace.test.tsx`

- [ ] **Step 1: Write the failing UI tests**

```ts
// omc-prototype/src/components/operator/DecisionBriefingCard.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DecisionBriefingCard from './DecisionBriefingCard'

describe('DecisionBriefingCard', () => {
    it('shows identity, translated rows, collapsed raw evidence, and log/trace actions', () => {
        const onOpenSessionLog = vi.fn()
        const onOpenTrace = vi.fn()

        render(
            <DecisionBriefingCard
                briefing={{
                    title: '执行中断，等待恢复确认',
                    identity: {
                        projectLabel: 'CardGame',
                        goalLabel: '01 First Playable Expedition',
                        planLabel: 'Establish expedition domain',
                        attemptNumber: 3,
                        sessionId: 'session-cardgame-1',
                    },
                    summaryRows: {
                        whatHappened: '发生了什么',
                        whyEscalated: '为什么会找你',
                        recommendedAction: '系统建议',
                        currentImpact: '当前影响',
                    },
                    primaryAction: { label: '查看日志后重试', helper: '先看日志再恢复。' },
                    secondaryAction: { label: '先保持现状', helper: '不恢复自动推进。' },
                    rawEvidence: {
                        summary: 'The linked session became inactive before the attempt reported a structured outcome.',
                        terminationReason: 'session-inactive',
                        nextSuggestedStep: 'Inspect the session history, then resume the loop when the machine is stable.',
                        failureFingerprint: 'session-inactive',
                        defaultExpanded: false,
                    },
                }}
                onOpenSessionLog={onOpenSessionLog}
                onOpenTrace={onOpenTrace}
            />,
        )

        expect(screen.getByText('项目：CardGame')).toBeInTheDocument()
        expect(screen.getByText('计划：Establish expedition domain')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '查看原始依据' })).toBeInTheDocument()
        expect(screen.queryByText('The linked session became inactive before the attempt reported a structured outcome.')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: '查看原始依据' }))
        expect(screen.getByText('The linked session became inactive before the attempt reported a structured outcome.')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: '打开执行日志' }))
        expect(onOpenSessionLog).toHaveBeenCalledTimes(1)

        fireEvent.click(screen.getByRole('button', { name: '打开原始轨迹' }))
        expect(onOpenTrace).toHaveBeenCalledTimes(1)
    })
})
```

```ts
// omc-prototype/src/components/operator/ThreadConversation.test.tsx
expect(screen.getByText('发生了什么')).toBeInTheDocument()
expect(screen.getByRole('button', { name: '查看原始依据' })).toBeInTheDocument()
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
bun run test -- src/components/operator/DecisionBriefingCard.test.tsx src/components/operator/ThreadConversation.test.tsx src/components/operator/ThreadHeader.test.tsx src/components/operator/MessageWorkspace.test.tsx
```

Expected: FAIL because the briefing card does not exist and thread views have no evidence section or deep links.

- [ ] **Step 3: Build the new briefing card**

```tsx
// omc-prototype/src/components/operator/DecisionBriefingCard.tsx
import { useState } from 'react'
import type { DecisionBriefing } from '@/prototype/types'

export default function DecisionBriefingCard(props: {
    briefing: DecisionBriefing
    onOpenSessionLog?: (() => void) | undefined
    onOpenTrace?: (() => void) | undefined
}) {
    const [expanded, setExpanded] = useState(props.briefing.rawEvidence.defaultExpanded)

    return (
        <section className="prototype-decision-briefing">
            <div className="prototype-decision-briefing__identity">
                {props.briefing.identity.projectLabel ? <span>项目：{props.briefing.identity.projectLabel}</span> : null}
                {props.briefing.identity.goalLabel ? <span>目标：{props.briefing.identity.goalLabel}</span> : null}
                {props.briefing.identity.planLabel ? <span>计划：{props.briefing.identity.planLabel}</span> : null}
                {props.briefing.identity.attemptNumber ? <span>Attempt：#{props.briefing.identity.attemptNumber}</span> : null}
                {props.briefing.identity.sessionId ? <span>Session：{props.briefing.identity.sessionId}</span> : null}
            </div>

            <dl className="prototype-decision-briefing__rows">
                <div><dt>发生了什么</dt><dd>{props.briefing.summaryRows.whatHappened}</dd></div>
                <div><dt>为什么会找你</dt><dd>{props.briefing.summaryRows.whyEscalated}</dd></div>
                <div><dt>系统建议</dt><dd>{props.briefing.summaryRows.recommendedAction}</dd></div>
                <div><dt>当前影响</dt><dd>{props.briefing.summaryRows.currentImpact}</dd></div>
            </dl>

            <div className="prototype-decision-briefing__actions">
                {props.briefing.primaryAction ? <p>{props.briefing.primaryAction.label}：{props.briefing.primaryAction.helper}</p> : null}
                {props.briefing.secondaryAction ? <p>{props.briefing.secondaryAction.label}：{props.briefing.secondaryAction.helper}</p> : null}
            </div>

            <div className="prototype-decision-briefing__evidence">
                <button type="button" onClick={() => setExpanded((value) => !value)}>
                    查看原始依据
                </button>
                {expanded ? (
                    <div>
                        {props.briefing.rawEvidence.summary ? <p>{props.briefing.rawEvidence.summary}</p> : null}
                        {props.briefing.rawEvidence.terminationReason ? <p>termination reason: {props.briefing.rawEvidence.terminationReason}</p> : null}
                        {props.briefing.rawEvidence.nextSuggestedStep ? <p>next suggested step: {props.briefing.rawEvidence.nextSuggestedStep}</p> : null}
                        <div>
                            {props.onOpenSessionLog ? <button type="button" onClick={props.onOpenSessionLog}>打开执行日志</button> : null}
                            {props.onOpenTrace ? <button type="button" onClick={props.onOpenTrace}>打开原始轨迹</button> : null}
                        </div>
                    </div>
                ) : null}
            </div>
        </section>
    )
}
```

- [ ] **Step 4: Wire the card into the thread detail flow**

```tsx
// omc-prototype/src/components/operator/ThreadConversation.tsx
import { useOperatorSurface } from '@/components/operator/OperatorSurfaceContext'
import DecisionBriefingCard from '@/components/operator/DecisionBriefingCard'

const operatorSurface = useOperatorSurface()
const { live } = usePrototypeStore()
const planRef = props.thread.refs.find((ref) => ref.kind === 'plan')
const sessionId = planRef ? live?.sessionIdByPlanKey?.[planRef.id] ?? null : null

{props.thread.briefing ? (
    <DecisionBriefingCard
        briefing={props.thread.briefing}
        onOpenSessionLog={sessionId ? () => operatorSurface.openSessionLog({
            sessionId,
            source: 'plan-runtime',
            title: props.thread.briefing?.identity.planLabel ?? props.thread.title,
            subtitle: planRef?.id ?? null,
        }) : undefined}
        onOpenTrace={planRef ? () => operatorSurface.openTrace({ planId: planRef.id, streamId: planRef.id }) : undefined}
    />
) : null}
```

```tsx
// omc-prototype/src/components/operator/ThreadHeader.tsx
export default function ThreadHeader(props: { thread: OperatorThread }) {
    const contextRefs = props.thread.refs.filter((ref) => ref.kind !== 'impact').slice(0, 3)
    const contextLine = contextRefs
        .map((ref) => `${labelRefKind(ref.kind)}：${ref.label}`)
        .join(' · ')

    return (
        <header className="prototype-chat-thread__header">
            <div className="prototype-chat-thread__meta">
                <span className="prototype-chat-thread__status">{props.thread.statusLabel}</span>
                {!props.thread.briefing && contextLine ? (
                    <p className="prototype-chat-thread__context">{contextLine}</p>
                ) : null}
            </div>
        </header>
    )
}
```

- [ ] **Step 5: Add the CSS for the new sections**

```css
/* omc-prototype/src/index.css */
.prototype-decision-briefing {
    display: grid;
    gap: 14px;
    padding: 18px;
    border-radius: 28px;
    background: rgba(255, 255, 255, 0.86);
    border: 1px solid rgba(15, 23, 42, 0.08);
}

.prototype-decision-briefing__identity {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    font-size: 13px;
    color: rgba(31, 41, 55, 0.82);
}

.prototype-decision-briefing__rows dt {
    font-size: 12px;
    font-weight: 700;
    color: rgba(22, 101, 52, 0.88);
}

.prototype-decision-briefing__rows dd {
    margin: 4px 0 0;
    font-size: 15px;
    line-height: 1.65;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
bun run test -- src/components/operator/DecisionBriefingCard.test.tsx src/components/operator/ThreadConversation.test.tsx src/components/operator/ThreadHeader.test.tsx src/components/operator/MessageWorkspace.test.tsx
```

Expected: PASS with the new briefing/evidence rendering assertions.

- [ ] **Step 7: Commit**

```bash
git add omc-prototype/src/components/operator/DecisionBriefingCard.tsx omc-prototype/src/components/operator/DecisionBriefingCard.test.tsx omc-prototype/src/components/operator/ThreadHeader.tsx omc-prototype/src/components/operator/ThreadHeader.test.tsx omc-prototype/src/components/operator/ThreadConversation.tsx omc-prototype/src/components/operator/ThreadConversation.test.tsx omc-prototype/src/components/operator/MessageWorkspace.tsx omc-prototype/src/components/operator/MessageWorkspace.test.tsx omc-prototype/src/index.css
git commit -m "feat: add decision briefing card to thread detail"
```

### Task 4: Align action labels and end-to-end live behavior

**Files:**
- Modify: `omc-prototype/src/prototype/threads.ts`
- Modify: `omc-prototype/src/components/operator/MessageDetailStack.test.tsx`
- Modify: `omc-prototype/src/components/MessagePanel.test.tsx`
- Modify: `omc-prototype/src/components/operator/SessionLogWorkspace.test.tsx`
- Test: `omc-prototype/src/components/operator/MessageDetailStack.test.tsx`
- Test: `omc-prototype/src/components/MessagePanel.test.tsx`
- Test: `omc-prototype/src/components/operator/SessionLogWorkspace.test.tsx`

- [ ] **Step 1: Write the failing interaction tests**

```ts
// omc-prototype/src/components/operator/MessageDetailStack.test.tsx
it('shows interruption-specific labels instead of scope-change labels for runtime failures', () => {
    const thread = buildThread({
        title: '执行中断，等待恢复确认',
        briefing: {
            title: '执行中断，等待恢复确认',
            identity: {
                projectLabel: 'CardGame',
                goalLabel: '01 First Playable Expedition',
                planLabel: 'Establish expedition domain',
                attemptNumber: 3,
                sessionId: 'session-cardgame-1',
            },
            summaryRows: {
                whatHappened: '发生了什么',
                whyEscalated: '为什么会找你',
                recommendedAction: '系统建议',
                currentImpact: '当前影响',
            },
            primaryAction: { label: '查看日志后重试', helper: '先看日志再恢复。' },
            secondaryAction: { label: '先保持现状', helper: '不恢复自动推进。' },
            rawEvidence: {
                summary: 'The linked session became inactive before the attempt reported a structured outcome.',
                terminationReason: 'session-inactive',
                nextSuggestedStep: 'Inspect the session history, then resume the loop when the machine is stable.',
                failureFingerprint: 'session-inactive',
                defaultExpanded: false,
            },
        },
        quickActions: [
            { id: 'resume-after-log', label: '查看日志后重试', tone: 'primary', operation: { type: 'approval-approve', approvalId: '01-01' } },
            { id: 'hold-state', label: '先保持现状', tone: 'secondary', operation: { type: 'approval-defer', approvalId: '01-01' } },
        ],
    })

    render(
        <MessageWorkspace
            heading={{ title: '消息流', summary: 'Inbox summary' }}
            threads={[thread]}
            messagesByThread={{ [thread.id]: buildMessages(thread.id) }}
            selectedThread={thread}
            showHandled={false}
            onToggleHandled={() => {}}
            onSelectThread={() => {}}
            onBackToList={() => {}}
        />,
    )

    expect(screen.getByRole('button', { name: '查看日志后重试' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '按建议调整路线' })).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
bun run test -- src/components/operator/MessageDetailStack.test.tsx src/components/MessagePanel.test.tsx src/components/operator/SessionLogWorkspace.test.tsx
```

Expected: FAIL because runtime-failure threads still reuse approval action labels and the detail panel lacks linked-entry assertions.

- [ ] **Step 3: Use briefing action labels as the display layer for live interruption threads**

```ts
// omc-prototype/src/prototype/threads.ts
function applyBriefingActionLabels(thread: ThreadSeed): ThreadSeed {
    if (!thread.briefing) {
        return thread
    }

    const nextQuickActions = [...thread.quickActions]
    if (thread.briefing.primaryAction && nextQuickActions[0]) {
        nextQuickActions[0] = { ...nextQuickActions[0], label: thread.briefing.primaryAction.label }
    }
    if (thread.briefing.secondaryAction && nextQuickActions[1]) {
        nextQuickActions[1] = { ...nextQuickActions[1], label: thread.briefing.secondaryAction.label }
    }

    return {
        ...thread,
        quickActions: nextQuickActions,
    }
}
```

- [ ] **Step 4: Verify the right panel still opens logs and traces from the same workspace**

```ts
// omc-prototype/src/components/MessagePanel.test.tsx
expect(screen.getByRole('button', { name: '打开执行日志' })).toBeInTheDocument()
expect(screen.getByRole('button', { name: '打开原始轨迹' })).toBeInTheDocument()
```

- [ ] **Step 5: Run the tests to verify they pass**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
bun run test -- src/components/operator/MessageDetailStack.test.tsx src/components/MessagePanel.test.tsx src/components/operator/SessionLogWorkspace.test.tsx
```

Expected: PASS with interruption-specific labels and linked-entry assertions succeeding.

- [ ] **Step 6: Commit**

```bash
git add omc-prototype/src/prototype/threads.ts omc-prototype/src/components/operator/MessageDetailStack.test.tsx omc-prototype/src/components/MessagePanel.test.tsx omc-prototype/src/components/operator/SessionLogWorkspace.test.tsx
git commit -m "feat: align live thread actions with briefing context"
```

### Task 5: Full verification

**Files:**
- Test only; no new files expected

- [ ] **Step 1: Run the targeted prototype test suite**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
bun run test -- src/prototype/decisionBriefing.test.ts src/prototype/omcProjection.test.ts src/prototype/threads.test.ts src/components/operator/DecisionBriefingCard.test.tsx src/components/operator/ThreadConversation.test.tsx src/components/operator/ThreadHeader.test.tsx src/components/operator/MessageWorkspace.test.tsx src/components/operator/MessageDetailStack.test.tsx src/components/MessagePanel.test.tsx src/components/operator/SessionLogWorkspace.test.tsx
```

Expected: PASS with all targeted tests green.

- [ ] **Step 2: Run typecheck**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
bun run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run production build**

Run:

```bash
cd /Users/realizer/Code/hopi/omc-prototype
bun run build
```

Expected: PASS with Vite production build completing successfully.

- [ ] **Step 4: Commit**

```bash
git add omc-prototype
git commit -m "test: verify OMC decision briefing detail flow"
```

## Self-Review

### Spec coverage

- Real live-thread titles replacing demo labels: Task 2
- Human-readable Chinese briefing rows: Task 1 + Task 3
- Raw evidence collapsed by default: Task 1 + Task 3
- Session log / trace entry points inside the same panel: Task 3 + Task 4
- Action labels differing for runtime interruptions vs approvals: Task 1 + Task 4

No uncovered spec requirements remain.

### Placeholder scan

- No `TODO`, `TBD`, or deferred implementation markers remain.
- Every task includes explicit files, commands, and concrete code snippets.

### Type consistency

- `DecisionBriefing`, `DecisionEvidence`, `DecisionActionHint`, and `briefing` are defined in Task 1 before later tasks use them.
- The same `summaryRows` shape is reused consistently in Tasks 1, 3, and 4.
- The plan assumes `OperatorThread.briefing` is optional and preserves existing demo-thread compatibility.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-07-omc-decision-briefing-detail.md`.

Two execution options:

1. Subagent-Driven (recommended) - I dispatch a fresh subagent per task, review between tasks, fast iteration

2. Inline Execution - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
