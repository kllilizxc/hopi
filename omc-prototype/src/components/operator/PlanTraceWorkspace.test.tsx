import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import PlanTraceWorkspace from './PlanTraceWorkspace'
import type {
    DecisionTopic,
    PlanTraceInspection,
    WorkOrder,
} from '@/prototype/types'

vi.mock('./SessionLogWorkspace', () => ({
    default: function MockSessionLogWorkspace(props: {
        selection: {
            sessionId: string
            source: string
            title: string
            subtitle?: string | null
        }
    }) {
        return (
            <div data-testid="mock-session-log-workspace">
                Session log · {props.selection.sessionId} · {props.selection.source} · {props.selection.title}
            </div>
        )
    },
}))

vi.mock('./PlanTraceDiffWorkspace', () => ({
    default: function MockPlanTraceDiffWorkspace(props: {
        sessionId?: string | null
        planTitle: string
    }) {
        return (
            <div data-testid="mock-plan-diff-workspace">
                Diff workspace · {props.sessionId ?? 'no-session'} · {props.planTitle}
            </div>
        )
    },
}))

function buildInspectionFixture(
    overrides: Partial<PlanTraceInspection> = {},
): PlanTraceInspection {
    const workOrder = {
        id: 'work-order:approval-branch-ingest',
        goalId: 'goal-portfolio-foundation',
        streamId: 'stream-ingest-contracts',
        phaseId: 'phase-ingest-3',
        planId: 'plan-approval-1',
        summary: '推进导入证明分支，直到进入放行边界。',
        state: 'waiting_user',
        constraints: [],
        loop: {
            round: 2,
            reviewerVerdict: 'needs_decision',
            lastDriverSummary: '已补齐导入夹具与回归校验。',
            lastReviewerSummary: '代码层面已接近可放行，但跨过经营边界。',
            lastDecisionSummary: '等待你确认是否放行。',
        },
        waitingOnTopicId: 'topic:approval-linked',
    } satisfies WorkOrder

    const linkedTopic = {
        id: 'topic:approval-linked',
        kind: 'approval',
        title: '放行导入分支',
        goalId: 'goal-portfolio-foundation',
        workOrderId: workOrder.id,
        lifecycle: 'pending',
        unread: true,
        messages: ['Awaiting the batch decision.'],
    } satisfies DecisionTopic

    return {
        planId: 'plan-approval-1',
        planTitle: 'Lock broker CSV contract',
        mappingConfidence: 'exact',
        match: { kind: 'exact', label: '直连关联' },
        workOrder,
        round: 2,
        events: [
            {
                id: 'evt-reviewer-1',
                createdAt: 'Day 1 · 18:34',
                role: 'reviewer',
                kind: 'ReviewerVerdict',
                summary: 'needs_decision · 需要你拍板',
                raw: {
                    id: 'evt-reviewer-1',
                    kind: 'ReviewerVerdict',
                    workOrderId: workOrder.id,
                    emittedBy: 'reviewer',
                    createdAt: 'Day 1 · 18:34',
                    payload: {
                        verdict: 'needs_decision',
                        summary: '需要你拍板',
                    },
                },
            },
            {
                id: 'evt-driver-1',
                createdAt: 'Day 1 · 18:32',
                role: 'driver',
                kind: 'Observation',
                summary: '已补齐导入夹具与回归校验。',
                raw: {
                    id: 'evt-driver-1',
                    kind: 'Observation',
                    workOrderId: workOrder.id,
                    emittedBy: 'driver',
                    createdAt: 'Day 1 · 18:32',
                    payload: {
                        summary: '已补齐导入夹具与回归校验。',
                    },
                },
            },
        ],
        stateTransitions: [
            'queued -> executing',
            'reviewer_check -> waiting_user',
        ],
        linkedTopics: [linkedTopic],
        emptyState: null,
        ...overrides,
    }
}

describe('PlanTraceWorkspace', () => {
    it('renders Logs / Events / State / JSON / Diff tabs and defaults to Logs', () => {
        const inspection = buildInspectionFixture()

        render(
            <PlanTraceWorkspace
                inspection={inspection}
                sessionId="session-runtime-1"
                onBackToInbox={() => {}}
                onOpenThread={() => {}}
            />,
        )

        expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByTestId('mock-session-log-workspace')).toHaveTextContent('session-runtime-1')

        fireEvent.click(screen.getByRole('tab', { name: 'Events' }))
        expect(screen.getByText('ReviewerVerdict')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('tab', { name: 'State' }))
        expect(screen.getByText('queued -> executing')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('tab', { name: 'JSON' }))
        expect(screen.getByText('work-order:approval-branch-ingest')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('tab', { name: 'Diff' }))
        expect(screen.getByTestId('mock-plan-diff-workspace')).toHaveTextContent('Lock broker CSV contract')
    })

    it('supports keyboard tab switching with linked tabpanel semantics', () => {
        const inspection = buildInspectionFixture()

        render(
            <PlanTraceWorkspace
                inspection={inspection}
                onBackToInbox={() => {}}
                onOpenThread={() => {}}
            />,
        )

        const logsTab = screen.getByRole('tab', { name: 'Logs' })
        fireEvent.keyDown(logsTab, { key: 'ArrowRight' })

        const eventsTab = screen.getByRole('tab', { name: 'Events' })
        expect(eventsTab).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByRole('tabpanel', { name: /events/i })).toHaveAttribute('aria-labelledby', 'prototype-trace-tab-events')

        fireEvent.keyDown(eventsTab, { key: 'End' })
        expect(screen.getByRole('tab', { name: 'Diff' })).toHaveAttribute('aria-selected', 'true')
    })

    it('shows inferred-match warning and linked decision topics', () => {
        const inspection = buildInspectionFixture({
            mappingConfidence: 'inferred',
            match: { kind: 'inferred', label: '推断关联' },
        })

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

    it('keeps tabs usable when the events tab is in empty-state mode', () => {
        const inspection = buildInspectionFixture({
            events: [],
            emptyState: {
                title: '这张卡还没有运行态输出，当前只有计划信息。',
                detail: '当前只有计划态，没有原始事件。',
            },
        })

        render(
            <PlanTraceWorkspace
                inspection={inspection}
                onBackToInbox={() => {}}
                onOpenThread={() => {}}
            />,
        )

        fireEvent.click(screen.getByRole('tab', { name: 'Events' }))
        expect(screen.getByText('这张卡还没有运行态输出，当前只有计划信息。')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('tab', { name: 'State' }))
        expect(screen.getByRole('tabpanel', { name: /state/i })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('tab', { name: 'JSON' }))
        expect(screen.getByRole('tabpanel', { name: /json/i })).toBeInTheDocument()
    })

    it('explains in the default Logs tab that raw runtime logs appear only after a real attempt session exists', () => {
        const inspection = buildInspectionFixture({
            events: [],
            emptyState: {
                title: '这张卡还没有运行态输出，当前只有计划信息。',
                detail: '当前只有计划态，没有原始事件。',
            },
        })

        render(
            <PlanTraceWorkspace
                inspection={inspection}
                onBackToInbox={() => {}}
                onOpenThread={() => {}}
            />,
        )

        expect(screen.getByRole('tab', { name: 'Logs' })).toHaveAttribute('aria-selected', 'true')
        expect(screen.getByText('这张 plan 还没创建 runtime session。真正启动执行后，才会出现底层日志。')).toBeInTheDocument()
    })

    it('still offers a standalone session-log entry point when a runtime session is available', () => {
        const inspection = buildInspectionFixture()
        const onOpenSessionLog = vi.fn()

        render(
            <PlanTraceWorkspace
                inspection={inspection}
                sessionId="session-runtime-1"
                onOpenSessionLog={onOpenSessionLog}
                onBackToInbox={() => {}}
                onOpenThread={() => {}}
            />,
        )

        fireEvent.click(screen.getByRole('button', { name: '独立打开日志' }))
        expect(onOpenSessionLog).toHaveBeenCalledTimes(1)
    })

    it('keeps the tab content inside a dedicated trace scroll shell', () => {
        const inspection = buildInspectionFixture()

        render(
            <PlanTraceWorkspace
                inspection={inspection}
                onBackToInbox={() => {}}
                onOpenThread={() => {}}
            />,
        )

        expect(screen.getByTestId('trace-scroll-shell')).toBeInTheDocument()
    })
})
