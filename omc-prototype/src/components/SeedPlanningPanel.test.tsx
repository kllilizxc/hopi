import type { ComponentProps } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OmcGuidedPlanningRun, OmcProgramPlanningState } from '@hopi/protocol/types'
import SeedPlanningPanel from './SeedPlanningPanel'

const mockUsePrototypeRemoteApi = vi.fn()
const mockUsePrototypeStore = vi.fn()
const mockUseOperatorSurface = vi.fn()

vi.mock('@/prototype/remoteApi', () => ({
    usePrototypeRemoteApi: () => mockUsePrototypeRemoteApi(),
}))

vi.mock('@/prototype/store', () => ({
    usePrototypeStore: () => mockUsePrototypeStore(),
}))

vi.mock('@/components/operator/OperatorSurfaceContext', () => ({
    useOperatorSurface: () => mockUseOperatorSurface(),
}))

function createPlanning(overrides: Partial<OmcProgramPlanningState> = {}): OmcProgramPlanningState {
    return {
        status: 'seeded',
        planningRoot: '/tmp/card-game/.planning',
        hasPlanning: true,
        hasPlans: false,
        phaseCount: 0,
        planCount: 0,
        seedFiles: ['PROJECT.md', 'STATE.md'],
        ...overrides,
    }
}

function createRun(overrides: Partial<OmcGuidedPlanningRun> = {}): OmcGuidedPlanningRun {
    return {
        id: 'run-1',
        programId: 'program-123',
        status: 'running',
        stage: 'plan',
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
        ...overrides,
    }
}

describe('SeedPlanningPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockUsePrototypeStore.mockReturnValue({
            actions: {
                selectProgram: vi.fn(),
            },
        })
        mockUsePrototypeRemoteApi.mockReturnValue({
            startGuidedPlanning: vi.fn().mockResolvedValue({}),
            retryGuidedPlanning: vi.fn().mockResolvedValue({}),
        })
        mockUseOperatorSurface.mockReturnValue({
            openSessionLog: vi.fn(),
        })
    })

    function renderPanel(overrides: Partial<ComponentProps<typeof SeedPlanningPanel>> = {}) {
        return render(
            <SeedPlanningPanel
                programId="program-123"
                programName="CardGame"
                planning={createPlanning()}
                planningRun={null}
                {...overrides}
            />,
        )
    }

    it('submits the trimmed guided-planning brief and refreshes the current program', async () => {
        const api = {
            startGuidedPlanning: vi.fn().mockResolvedValue({}),
            retryGuidedPlanning: vi.fn(),
        }
        const selectProgram = vi.fn()

        mockUsePrototypeRemoteApi.mockReturnValue(api)
        mockUsePrototypeStore.mockReturnValue({
            actions: {
                selectProgram,
            },
        })

        renderPanel()

        fireEvent.change(screen.getByLabelText('产品意图'), {
            target: { value: '  Ship a card game MVP  ' },
        })
        fireEvent.change(screen.getByLabelText('第一刀'), {
            target: { value: '  Create a playable local prototype  ' },
        })

        fireEvent.click(screen.getByRole('button', { name: '开始规划' }))

        await waitFor(() => {
            expect(api.startGuidedPlanning).toHaveBeenCalledWith('program-123', {
                productIntent: 'Ship a card game MVP',
                firstSlice: 'Create a playable local prototype',
            })
        })
        expect(selectProgram).toHaveBeenCalledWith('program-123')
    })

    it('disables submit until both brief fields contain text', () => {
        renderPanel()

        const submitButton = screen.getByRole('button', { name: '开始规划' })
        expect(submitButton).toBeDisabled()

        fireEvent.change(screen.getByLabelText('产品意图'), {
            target: { value: 'Ship a card game MVP' },
        })
        expect(submitButton).toBeDisabled()

        fireEvent.change(screen.getByLabelText('第一刀'), {
            target: { value: 'Create a playable local prototype' },
        })
        expect(submitButton).toBeEnabled()
    })

    it('shows queued or running planning status instead of the form', () => {
        renderPanel({
            planningRun: createRun({
                status: 'running',
                stage: 'plan',
            }),
        })

        expect(screen.getAllByText('规划进行中')).toHaveLength(2)
        expect(screen.queryByLabelText('产品意图')).not.toBeInTheDocument()
        expect(screen.getByText('plan')).toBeInTheDocument()
        expect(screen.getByText('Planning is generating the first executable plan pack.')).toBeInTheDocument()
    })

    it('retries a failed planning run and refreshes the current program', async () => {
        const api = {
            startGuidedPlanning: vi.fn(),
            retryGuidedPlanning: vi.fn().mockResolvedValue({}),
        }
        const selectProgram = vi.fn()

        mockUsePrototypeRemoteApi.mockReturnValue(api)
        mockUsePrototypeStore.mockReturnValue({
            actions: {
                selectProgram,
            },
        })

        renderPanel({
            planningRun: createRun({
                status: 'failed',
                stage: 'plan',
                summary: 'Planning stalled while assembling the first plan pack.',
                error: 'planning failed',
            }),
        })

        fireEvent.click(screen.getByRole('button', { name: '重试规划' }))

        await waitFor(() => {
            expect(api.retryGuidedPlanning).toHaveBeenCalledWith('program-123')
        })
        expect(selectProgram).toHaveBeenCalledWith('program-123')
    })

    it('keeps the typed brief and shows the backend error when start fails', async () => {
        const api = {
            startGuidedPlanning: vi.fn().mockRejectedValue(new Error('Planning start failed')),
            retryGuidedPlanning: vi.fn(),
        }

        mockUsePrototypeRemoteApi.mockReturnValue(api)

        renderPanel()

        const productIntent = screen.getByLabelText('产品意图')
        const firstSlice = screen.getByLabelText('第一刀')

        fireEvent.change(productIntent, {
            target: { value: 'Ship a card game MVP' },
        })
        fireEvent.change(firstSlice, {
            target: { value: 'Create a playable local prototype' },
        })

        fireEvent.click(screen.getByRole('button', { name: '开始规划' }))

        expect(await screen.findByRole('alert')).toHaveTextContent('Planning start failed')
        expect(productIntent).toHaveValue('Ship a card game MVP')
        expect(firstSlice).toHaveValue('Create a playable local prototype')
    })

    it('opens the raw planning session log when the run exposes a session id', () => {
        const openSessionLog = vi.fn()
        mockUseOperatorSurface.mockReturnValue({
            openSessionLog,
        })

        renderPanel({
            planningRun: createRun({
                status: 'running',
                sessionId: 'planning-session-1',
            }),
        })

        fireEvent.click(screen.getByRole('button', { name: '查看底层日志' }))
        expect(openSessionLog).toHaveBeenCalledWith({
            sessionId: 'planning-session-1',
            source: 'planning-run',
            title: 'CardGame',
            subtitle: 'guided planning',
        })
    })
})
