import { render, screen } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrototypeCheckpointId } from '@/prototype/types'
import DashboardPage from './DashboardPage'

const mockUsePrototypeStore = vi.fn()
const mockUseOperatorSurface = vi.fn()

vi.mock('@/prototype/store', () => ({
    usePrototypeStore: () => mockUsePrototypeStore(),
}))

vi.mock('@/components/operator/OperatorSurfaceContext', () => ({
    useOperatorSurface: () => mockUseOperatorSurface(),
}))

vi.mock('@/components/DemoAttachPanel', () => ({
    default: () => <div data-testid="demo-attach-panel">demo attach</div>,
}))

vi.mock('@/components/DashboardPanels', () => ({
    GoalPortfolioPanel: () => <div data-testid="goal-portfolio-panel">goal portfolio</div>,
    DailyDigestPanel: () => <div data-testid="daily-digest-panel">daily digest</div>,
    StreamsOverviewPanel: () => <div data-testid="streams-overview-panel">streams overview</div>,
}))

vi.mock('@/components/SeedPlanningPanel', () => ({
    default: () => <div data-testid="seed-planning-panel">seed planning panel</div>,
}))

type DashboardStoreMockInput = {
    attachedProgramId: string | null
    hasPlans: boolean
    planningSessionId?: string | null
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
                goals: [],
                streams: [],
                digest: {
                    window: 'today',
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
        expect(screen.queryByTestId('streams-overview-panel')).not.toBeInTheDocument()
        expect(screen.queryByTestId('goal-portfolio-panel')).not.toBeInTheDocument()
    })

    it('keeps the normal dashboard panels once plans exist', () => {
        mockUsePrototypeStore.mockReturnValue(createDashboardStoreMock({
            attachedProgramId: 'program-123',
            hasPlans: true,
            planningSessionId: 'planning-session-1',
        }))

        render(<DashboardPage />)

        expect(screen.queryByTestId('seed-planning-panel')).not.toBeInTheDocument()
        expect(screen.getByTestId('goal-portfolio-panel')).toBeInTheDocument()
        expect(screen.getByTestId('daily-digest-panel')).toBeInTheDocument()
        expect(screen.getByTestId('streams-overview-panel')).toBeInTheDocument()
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
