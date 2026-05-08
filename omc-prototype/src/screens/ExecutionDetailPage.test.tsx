import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ExecutionDetailPage from './ExecutionDetailPage'

const mockUsePrototypeStore = vi.fn()
const mockUseOperatorSurface = vi.fn()

vi.mock('@tanstack/react-router', () => ({
    Navigate: function MockNavigate(props: {
        to: string
        search?: Record<string, string>
    }) {
        return <div data-testid="navigate-target">{`${props.to}?goal=${props.search?.goal ?? ''}`}</div>
    },
}))

vi.mock('@/prototype/store', () => ({
    usePrototypeStore: () => mockUsePrototypeStore(),
}))

vi.mock('@/components/operator/OperatorSurfaceContext', () => ({
    useOperatorSurface: () => mockUseOperatorSurface(),
}))

describe('ExecutionDetailPage', () => {
    it('collapses a legacy plan-card page back into the goal workspace and opens the trace panel', async () => {
        const openTrace = vi.fn()
        mockUseOperatorSurface.mockReturnValue({
            openTrace,
        })
        mockUsePrototypeStore.mockReturnValue({
            dataSource: {
                getPlanDrilldown: () => ({
                    goal: {
                        id: 'goal-portfolio-foundation',
                        programId: 'program-1',
                        title: 'Goal title',
                        summary: 'Goal summary',
                        successSignal: 'Stable import',
                        status: 'on-track',
                        confidence: 82,
                        priority: 'highest',
                        direction: 'maintain',
                        headline: 'headline',
                        progressLabel: 'progress',
                        needsApproval: false,
                        lastWorkedAt: '2026-04-07T12:00:00.000Z',
                    },
                    strategy: {
                        goalId: 'goal-portfolio-foundation',
                        thesis: 'Lock scope first.',
                        reason: 'reason',
                        changedAt: '2026-04-07T12:00:00.000Z',
                        confidenceDelta: '+4',
                        focusAreas: [],
                        todayMoves: [],
                        nextQuestions: [],
                    },
                    planCard: {
                        id: 'plan-ingest-proof',
                        goalId: 'goal-portfolio-foundation',
                        streamId: 'stream-ingest-contracts',
                        phaseId: 'phase-ingest-1',
                        title: 'Lock first broker CSV contract',
                        column: 'Running',
                        summary: 'Lock the narrow parsing contract.',
                        signal: 'Parser seams mapped.',
                        updatedAt: 'Day 1 · 09:06',
                        badges: ['critical-path'],
                    },
                    phases: [],
                    siblingPlanCards: [],
                }),
            },
        })

        render(
            <ExecutionDetailPage
                goalId="goal-portfolio-foundation"
                planId="plan-ingest-proof"
            />,
        )

        await waitFor(() => expect(openTrace).toHaveBeenCalledWith({
            planId: 'plan-ingest-proof',
            streamId: 'stream-ingest-contracts',
        }))
        expect(screen.getByTestId('navigate-target')).toHaveTextContent('/?goal=goal-portfolio-foundation')
    })
})
