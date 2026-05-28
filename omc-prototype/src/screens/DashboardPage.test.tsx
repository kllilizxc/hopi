import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrototypeCheckpointId } from '@/prototype/types'
import DashboardPage from './DashboardPage'

const mockUsePrototypeStore = vi.fn()
const mockUseOperatorSurface = vi.fn()
const mockUseSearch = vi.fn()

vi.mock('@/prototype/store', () => ({
    usePrototypeStore: () => mockUsePrototypeStore(),
}))

vi.mock('@tanstack/react-router', () => ({
    useSearch: () => mockUseSearch(),
}))

vi.mock('@/components/operator/OperatorSurfaceContext', () => ({
    useOperatorSurface: () => mockUseOperatorSurface(),
}))

vi.mock('@/components/DemoAttachPanel', () => ({
    default: () => <div data-testid="demo-attach-panel">demo attach</div>,
}))

vi.mock('@/components/DashboardPanels', () => ({
    GoalPortfolioPanel: (props: { selectedGoalId: string | null }) => (
        <div data-testid="goal-portfolio-panel">{`goal portfolio:${props.selectedGoalId ?? 'none'}`}</div>
    ),
    DailyDigestPanel: () => <div data-testid="daily-digest-panel">daily digest</div>,
}))

vi.mock('@/components/StrategyPanel', () => ({
    default: (props: { goal: { id: string } }) => <div data-testid="strategy-panel">{`strategy:${props.goal.id}`}</div>,
}))

vi.mock('@/components/ExecutionBoard', () => ({
    default: (props: { planCards: Array<{ id: string }> }) => <div data-testid="execution-board">{`board:${props.planCards.length}`}</div>,
}))

vi.mock('@/components/SeedPlanningPanel', () => ({
    default: () => <div data-testid="seed-planning-panel">seed planning panel</div>,
}))

type DashboardStoreMockInput = {
    attachedProgramId: string | null
    hasPlans: boolean
    planningSessionId?: string | null
    portfolioGoals?: Array<{
        id: string
        title: string
        confidence: number
        priority: 'highest' | 'high' | 'medium' | 'low'
    }>
}

function createDashboardStoreMock(input: DashboardStoreMockInput) {
    const checkpointId: PrototypeCheckpointId = 'intake'

    return {
        state: {
            attachedProgramId: input.attachedProgramId,
            decisionTopics: {},
        },
        dataSource: {
            getPortfolio: () => ({
                checkpoint: {
                    id: checkpointId,
                    label: '目标接入',
                    synopsis: '系统刚接到目标，先收窄边界与主路线。',
                    stamp: '2026-04-06T12:00:00.000Z',
                },
                program: {
                    id: 'program-123',
                    name: 'CardGame',
                    repoRoot: '/tmp/card-game',
                },
                goals: input.portfolioGoals?.map((goal) => ({
                    id: goal.id,
                    programId: 'program-123',
                    title: goal.title,
                    summary: 'summary',
                    successSignal: 'signal',
                    status: 'on-track',
                    confidence: goal.confidence,
                    priority: goal.priority,
                    direction: 'maintain',
                    headline: 'headline',
                    progressLabel: 'progress',
                    needsApproval: false,
                    lastWorkedAt: '2026-04-07T12:00:00.000Z',
                })) ?? [],
                planCards: [],
                digest: {
                    window: 'today',
                },
            }),
            getGoal: (goalId: string) => ({
                goal: {
                    id: goalId,
                    programId: 'program-123',
                    title: goalId,
                    summary: 'summary',
                    successSignal: 'signal',
                    status: 'on-track',
                    confidence: 90,
                    priority: 'highest',
                    direction: 'maintain',
                    headline: 'headline',
                    progressLabel: 'progress',
                    needsApproval: false,
                    lastWorkedAt: '2026-04-07T12:00:00.000Z',
                },
                strategy: {
                    goalId,
                    thesis: 'thesis',
                    reason: 'reason',
                    changedAt: '2026-04-07T12:00:00.000Z',
                    confidenceDelta: '+1',
                    focusAreas: [],
                    todayMoves: [],
                    nextQuestions: [],
                },
                streams: [],
                phases: [
                    {
                        id: `phase:${goalId}`,
                        goalId,
                        streamId: `stream:${goalId}`,
                        title: 'Phase 01',
                        status: 'Running',
                        summary: 'phase summary',
                    },
                ],
                planCards: [
                    {
                        id: `plan:${goalId}`,
                        goalId,
                        streamId: `stream:${goalId}`,
                        phaseId: `phase:${goalId}`,
                        title: 'Plan',
                        column: 'Running',
                        summary: 'plan summary',
                        signal: 'signal',
                        updatedAt: 'today',
                        badges: [],
                    },
                ],
                risks: [],
                digest: {
                    window: 'today',
                    headline: 'Today',
                    summary: 'digest',
                    highlights: [],
                    decisions: [],
                    watchlist: [],
                },
            }),
        },
        live: input.attachedProgramId ? {
            programs: [
                {
                    id: 'program-123',
                    name: 'CardGame',
                    repoRoot: '/tmp/card-game',
                },
            ],
            selectedProgramId: 'program-123',
            error: null,
            planning: {
                status: 'seeded',
                planningRoot: '/tmp/card-game/.planning',
                hasPlanning: true,
                hasPlans: input.hasPlans,
                phaseCount: input.hasPlans ? 1 : 0,
                planCount: input.hasPlans ? 1 : 0,
                seedFiles: ['PROJECT.md'],
            },
            planningRun: null,
        } : null,
    }
}

describe('DashboardPage', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockUseSearch.mockReturnValue({})
        mockUseOperatorSurface.mockReturnValue({
            openSessionLog: vi.fn(),
        })
    })

    it('shows the seed planning panel for a seed-only live program', () => {
        mockUsePrototypeStore.mockReturnValue(createDashboardStoreMock({
            attachedProgramId: 'program-123',
            hasPlans: false,
        }))

        render(<DashboardPage />)

        expect(screen.getByTestId('seed-planning-panel')).toBeInTheDocument()
        expect(screen.queryByTestId('plan-cards-overview-panel')).not.toBeInTheDocument()
        expect(screen.queryByTestId('goal-portfolio-panel')).not.toBeInTheDocument()
    })

    it('defaults to the first goal workspace once plans exist', () => {
        mockUsePrototypeStore.mockReturnValue(createDashboardStoreMock({
            attachedProgramId: 'program-123',
            hasPlans: true,
            planningSessionId: 'planning-session-1',
            portfolioGoals: [
                {
                    id: 'goal-portfolio-foundation',
                    title: 'Portfolio Foundation',
                    confidence: 90,
                    priority: 'highest',
                },
            ],
        }))

        render(<DashboardPage />)

        expect(screen.queryByTestId('seed-planning-panel')).not.toBeInTheDocument()
        expect(screen.getByTestId('goal-portfolio-panel')).toHaveTextContent('goal portfolio:goal-portfolio-foundation')
        expect(screen.getByTestId('strategy-panel')).toHaveTextContent('strategy:goal-portfolio-foundation')
        expect(screen.getByTestId('daily-digest-panel')).toBeInTheDocument()
        expect(screen.getByTestId('execution-board')).toHaveTextContent('board:1')
        expect(screen.queryByTestId('plan-cards-overview-panel')).not.toBeInTheDocument()
    })

    it('renders the selected goal workspace inline on the root page when a goal query is present', () => {
        const checkpointId: PrototypeCheckpointId = 'intake'
        mockUseSearch.mockReturnValue({
            goal: 'goal-weekly-brief',
        })
        mockUsePrototypeStore.mockReturnValue({
            ...createDashboardStoreMock({
                attachedProgramId: 'program-123',
                hasPlans: true,
            }),
            dataSource: {
                getPortfolio: () => ({
                    checkpoint: {
                        id: checkpointId,
                        label: '目标接入',
                        synopsis: '系统刚接到目标，先收窄边界与主路线。',
                        stamp: '2026-04-06T12:00:00.000Z',
                    },
                    program: {
                        id: 'program-123',
                        name: 'CardGame',
                        repoRoot: '/tmp/card-game',
                    },
                    goals: [
                        {
                            id: 'goal-portfolio-foundation',
                            programId: 'program-123',
                            title: 'portfolio',
                            summary: 'summary',
                            successSignal: 'signal',
                            status: 'on-track',
                            confidence: 90,
                            priority: 'highest',
                            direction: 'maintain',
                            headline: 'headline',
                            progressLabel: 'progress',
                            needsApproval: false,
                            lastWorkedAt: '2026-04-07T12:00:00.000Z',
                        },
                        {
                            id: 'goal-weekly-brief',
                            programId: 'program-123',
                            title: 'brief',
                            summary: 'summary',
                            successSignal: 'signal',
                            status: 'on-track',
                            confidence: 80,
                            priority: 'high',
                            direction: 'maintain',
                            headline: 'headline',
                            progressLabel: 'progress',
                            needsApproval: false,
                            lastWorkedAt: '2026-04-07T12:00:00.000Z',
                        },
                    ],
                    planCards: [],
                    digest: {
                        window: 'today',
                    },
                }),
                getGoal: createDashboardStoreMock({
                    attachedProgramId: 'program-123',
                    hasPlans: true,
                }).dataSource.getGoal,
            },
        })

        render(<DashboardPage />)

        expect(screen.getByTestId('goal-portfolio-panel')).toHaveTextContent('goal portfolio:goal-weekly-brief')
        expect(screen.getByTestId('strategy-panel')).toHaveTextContent('strategy:goal-weekly-brief')
        expect(screen.getByTestId('execution-board')).toHaveTextContent('board:1')
    })

    it('keeps a persistent planning-log entry point in the hero when the latest run has a session id', () => {
        const openSessionLog = vi.fn()
        mockUseOperatorSurface.mockReturnValue({
            openSessionLog,
        })
        mockUsePrototypeStore.mockReturnValue({
            ...createDashboardStoreMock({
                attachedProgramId: 'program-123',
                hasPlans: true,
                planningSessionId: 'planning-session-1',
            }),
            live: {
                ...createDashboardStoreMock({
                    attachedProgramId: 'program-123',
                    hasPlans: true,
                }).live,
                planningRun: {
                    id: 'run-1',
                    programId: 'program-123',
                    status: 'running',
                    stage: 'plan',
                    sessionId: 'planning-session-1',
                    brief: {
                        productIntent: 'Ship a card game MVP',
                        firstSlice: 'Create a playable local prototype',
                    },
                    summary: 'Planning is generating the first executable plan pack.',
                    error: null,
                    generatedPlanPaths: [],
                    createdAt: 1,
                    updatedAt: 1,
                    completedAt: null,
                },
            },
        })

        render(<DashboardPage />)

        fireEvent.click(screen.getByRole('button', { name: '查看规划日志' }))
        expect(openSessionLog).toHaveBeenCalledWith({
            sessionId: 'planning-session-1',
            source: 'planning-run',
            title: 'CardGame',
            subtitle: 'guided planning',
        })
    })
})
