import { createElement, type ReactNode } from 'react'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
    OmcGuidedPlanningStateResponse,
    OmcPlanDetailResponse,
    OmcPlanRuntimeListResponse,
    OmcPlanningIndexResponse,
    OmcProgramListResponse,
    OmcProgramOverviewResponse,
} from '@hopi/protocol/types'
import { PrototypeRemoteApiClient, PrototypeRemoteApiProvider } from './remoteApi'
import { PrototypeStoreProvider, usePrototypeStore } from './store'

class FakeEventSource {
    onmessage: ((event: MessageEvent<string>) => void) | null = null

    close() {
    }
}

function createDeferred<T>() {
    let resolve!: (value: T) => void
    let reject!: (reason?: unknown) => void
    const promise = new Promise<T>((nextResolve, nextReject) => {
        resolve = nextResolve
        reject = nextReject
    })

    return {
        promise,
        resolve,
        reject,
    }
}

type TestProgram = {
    id: string
    name: string
    repoRoot: string
}

function createTestProgram(
    id = 'omc-fresh',
    name = 'Fresh Program',
    repoRoot = '/tmp/omc-fresh',
): TestProgram {
    return {
        id,
        name,
        repoRoot,
    }
}

function createProgramList(programs: TestProgram[] = [createTestProgram()]): OmcProgramListResponse {
    return {
        programs: programs.map((program, index) => ({
            id: program.id,
            namespace: 'default',
            name: program.name,
            repoRoot: program.repoRoot,
            planningRoot: `${program.repoRoot}/planning`,
            primaryBranch: 'main',
            targetBranch: 'main',
            createdAt: index + 1,
            updatedAt: 10 + index,
            counts: {
                Planning: 1,
                Running: 0,
                Review: 0,
                Done: 0,
            },
            lastActivityAt: 10 + index,
        })),
    }
}

function createProgramOverview(program: TestProgram = createTestProgram()): OmcProgramOverviewResponse {
    return {
        program: {
            id: program.id,
            namespace: 'default',
            name: program.name,
            repoRoot: program.repoRoot,
            planningRoot: `${program.repoRoot}/planning`,
            primaryBranch: 'main',
            targetBranch: 'main',
            createdAt: 1,
            updatedAt: 10,
            counts: {
                Planning: 1,
                Running: 0,
                Review: 0,
                Done: 0,
            },
            lastActivityAt: 10,
        },
        planning: {
            status: 'detected',
            planningRoot: `${program.repoRoot}/planning`,
            hasPlanning: true,
            hasPlans: true,
            phaseCount: 1,
            planCount: 1,
            seedFiles: [],
        },
    }
}

function createPlanningState(program: TestProgram = createTestProgram()): OmcGuidedPlanningStateResponse {
    return {
        programId: program.id,
        planning: createProgramOverview(program).planning,
        run: null,
    }
}

function createPlanningIndex(program: TestProgram = createTestProgram()): OmcPlanningIndexResponse {
    return {
        program: {
            id: program.id,
            name: program.name,
            repoRoot: program.repoRoot,
        },
        phases: [
            {
                phaseKey: '01-foundation',
                phaseLabel: '01 Foundation',
                plans: [
                    {
                        planKey: '01-01',
                        planPath: 'docs/design/omc-planning-seed/phases/01-foundation/01-01-PLAN.md',
                        phaseKey: '01-foundation',
                        phaseLabel: '01 Foundation',
                        planTitle: 'Lock runtime foundation',
                        summary: 'Make the first control-plane loop reliable.',
                        checklistTotal: 2,
                        checklistDone: 1,
                        checklistOpen: 1,
                        firstOpenItem: 'Capture one more evidence round before review.',
                        lastModifiedAt: 100,
                    },
                ],
            },
        ],
    }
}

function createPlanRuntimes(program: TestProgram = createTestProgram()): OmcPlanRuntimeListResponse {
    return {
        programId: program.id,
        runtimes: [
            {
                programId: program.id,
                planKey: '01-01',
                planPath: 'docs/design/omc-planning-seed/phases/01-foundation/01-01-PLAN.md',
                phaseKey: '01-foundation',
                phaseLabel: '01 Foundation',
                column: 'Running',
                loopStatus: 'running',
                currentLoopRunId: 'loop-1',
                currentWorktreePath: '/tmp/worktrees/01-01',
                currentBranch: 'omc/01-01',
                targetBranch: 'main',
                attemptCount: 1,
                consecutiveFailureCount: 0,
                lastFailureFingerprint: null,
                reviewRequired: false,
                reviewApprovedAt: null,
                mergeStatus: 'idle',
                mergeBlockedReason: null,
                lastMergeAttemptAt: null,
                mergeApprovedAt: null,
                doneAt: null,
                latestEvidenceSummary: 'Driver is tightening the runtime seams.',
                lastAttemptAt: 200,
                updatedAt: 210,
            },
        ],
    }
}

function createPlanDetail(program: TestProgram = createTestProgram()): OmcPlanDetailResponse {
    return {
        programId: program.id,
        plan: {
            planKey: '01-01',
            planPath: 'docs/design/omc-planning-seed/phases/01-foundation/01-01-PLAN.md',
            phaseKey: '01-foundation',
            phaseLabel: '01 Foundation',
            planTitle: 'Lock runtime foundation',
            summary: 'Make the first control-plane loop reliable.',
            checklist: [
                { text: 'first step', checked: true },
                { text: 'second step', checked: false },
            ],
            refs: {
                projectPath: 'docs/design/omc-planning-seed/PROJECT.md',
                roadmapPath: 'docs/design/omc-planning-seed/ROADMAP.md',
            },
            lastModifiedAt: 210,
        },
        runtime: createPlanRuntimes(program).runtimes[0]!,
        attempts: [
            {
                id: 'attempt-01-01',
                loopRunId: null,
                programId: program.id,
                planKey: '01-01',
                planPath: 'docs/design/omc-planning-seed/phases/01-foundation/01-01-PLAN.md',
                sessionId: 'session-running',
                attemptNumber: 1,
                status: 'running',
                summary: 'Driver is tightening the runtime seams.',
                failureFingerprint: null,
                terminationReason: null,
                changedFiles: [],
                checks: [],
                nextSuggestedStep: null,
                contextPack: null,
                createdAt: 200,
                updatedAt: 210,
                completedAt: null,
            },
        ],
        evidence: [
            {
                id: 'evidence-01-01',
                attemptId: 'attempt-01-01',
                programId: 'omc-fresh',
                planKey: '01-01',
                kind: 'summary',
                label: 'driver-summary',
                status: 'info',
                summary: 'Driver tightened the runtime seams and is running one more check.',
                payload: null,
                createdAt: 211,
            },
        ],
    }
}

function createFakeLiveApi() {
    const api = new PrototypeRemoteApiClient('http://localhost', 'test-token')
    const getPrograms = vi.spyOn(api, 'getPrograms').mockResolvedValue(createProgramList())
    const getProgram = vi.spyOn(api, 'getProgram').mockResolvedValue(createProgramOverview())
    vi.spyOn(api, 'getGuidedPlanningState').mockResolvedValue(createPlanningState())
    vi.spyOn(api, 'getPlanningIndex').mockResolvedValue(createPlanningIndex())
    vi.spyOn(api, 'getPlanRuntimes').mockResolvedValue(createPlanRuntimes())
    vi.spyOn(api, 'getPlanDetail').mockResolvedValue(createPlanDetail())

    return {
        api,
        getPrograms,
        getProgram,
    }
}

describe('live prototype store', () => {
    const originalEventSource = globalThis.EventSource

    beforeEach(() => {
        localStorage.clear()
        vi.stubGlobal('EventSource', FakeEventSource)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        if (originalEventSource) {
            globalThis.EventSource = originalEventSource
        }
    })

    it('reloads the live projection when selecting the already-active program', async () => {
        const { api, getProgram } = createFakeLiveApi()
        const wrapper = ({ children }: { children: ReactNode }) => (
            createElement(
                PrototypeRemoteApiProvider,
                { api, children: createElement(PrototypeStoreProvider, { children }) },
            )
        )

        const { result } = renderHook(() => usePrototypeStore(), { wrapper })

        await waitFor(() => {
            expect(result.current.live?.selectedProgramId).toBe('omc-fresh')
        })
        await waitFor(() => {
            expect(getProgram).toHaveBeenCalledTimes(1)
        })

        const selectProgram = result.current.actions.selectProgram
        if (!selectProgram) {
            throw new Error('selectProgram action is unavailable')
        }

        act(() => {
            selectProgram('omc-fresh')
        })

        await waitFor(() => {
            expect(getProgram).toHaveBeenCalledTimes(2)
        })
    })

    it('surfaces seed-only planning metadata through the live store', async () => {
        const queuedProgram = createTestProgram('omc-seed', 'Seed Program', '/tmp/omc-seed')
        const api = new PrototypeRemoteApiClient('http://localhost', 'test-token')

        vi.spyOn(api, 'getPrograms').mockResolvedValue(createProgramList([queuedProgram]))
        vi.spyOn(api, 'getProgram').mockResolvedValue({
            program: createProgramOverview(queuedProgram).program,
            planning: {
                status: 'seeded',
                planningRoot: `${queuedProgram.repoRoot}/planning`,
                hasPlanning: true,
                hasPlans: false,
                phaseCount: 0,
                planCount: 0,
                seedFiles: ['PROJECT.md'],
            },
        })
        vi.spyOn(api, 'getGuidedPlanningState').mockResolvedValue({
            programId: queuedProgram.id,
            planning: {
                status: 'seeded',
                planningRoot: `${queuedProgram.repoRoot}/planning`,
                hasPlanning: true,
                hasPlans: false,
                phaseCount: 0,
                planCount: 0,
                seedFiles: ['PROJECT.md'],
            },
            run: {
                id: 'run-queued',
                programId: queuedProgram.id,
                status: 'queued',
                stage: 'brief',
                brief: {
                    productIntent: 'Ship a card game MVP',
                    firstSlice: 'Create a playable prototype',
                },
                summary: 'Queued for the first guided planning pass.',
                error: null,
                generatedPlanPaths: [],
                createdAt: 100,
                updatedAt: 100,
                completedAt: null,
            },
        })
        vi.spyOn(api, 'getPlanningIndex').mockResolvedValue({
            program: {
                id: queuedProgram.id,
                name: queuedProgram.name,
                repoRoot: queuedProgram.repoRoot,
            },
            phases: [],
        })
        vi.spyOn(api, 'getPlanRuntimes').mockResolvedValue({
            programId: queuedProgram.id,
            runtimes: [],
        })
        vi.spyOn(api, 'getPlanDetail').mockResolvedValue(createPlanDetail(queuedProgram))

        const wrapper = ({ children }: { children: ReactNode }) => (
            createElement(
                PrototypeRemoteApiProvider,
                { api, children: createElement(PrototypeStoreProvider, { children }) },
            )
        )

        const { result } = renderHook(() => usePrototypeStore(), { wrapper })

        await waitFor(() => {
            expect(result.current.live?.selectedProgramId).toBe(queuedProgram.id)
        })

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
                summary: 'Queued for the first guided planning pass.',
            }),
        )
    })

    it('keeps the live shell mounted while a different program reloads', async () => {
        const currentProgram = createTestProgram()
        const nextProgram = createTestProgram('omc-next', 'Next Program', '/tmp/omc-next')
        const nextOverview = createDeferred<OmcProgramOverviewResponse>()
        const api = new PrototypeRemoteApiClient('http://localhost', 'test-token')

        vi.spyOn(api, 'getPrograms').mockResolvedValue(createProgramList([currentProgram, nextProgram]))
        vi.spyOn(api, 'getProgram').mockImplementation(async (programId) => {
            if (programId === nextProgram.id) {
                return nextOverview.promise
            }

            return createProgramOverview(currentProgram)
        })
        vi.spyOn(api, 'getGuidedPlanningState').mockImplementation(async (programId) => (
            createPlanningState(programId === nextProgram.id ? nextProgram : currentProgram)
        ))
        vi.spyOn(api, 'getPlanningIndex').mockImplementation(async (programId) => (
            createPlanningIndex(programId === nextProgram.id ? nextProgram : currentProgram)
        ))
        vi.spyOn(api, 'getPlanRuntimes').mockImplementation(async (programId) => (
            createPlanRuntimes(programId === nextProgram.id ? nextProgram : currentProgram)
        ))
        vi.spyOn(api, 'getPlanDetail').mockImplementation(async (programId) => (
            createPlanDetail(programId === nextProgram.id ? nextProgram : currentProgram)
        ))

        function LiveShellProbe() {
            const store = usePrototypeStore()

            return (
                <div>
                    <button type="button" onClick={() => store.actions.selectProgram?.(nextProgram.id)}>
                        switch
                    </button>
                    <p data-testid="selected-program">{store.live?.selectedProgramId ?? 'none'}</p>
                    <p data-testid="attached-program">{store.state.attachedProgramId ?? 'none'}</p>
                    <p data-testid="program-count">{String(store.live?.programs.length ?? 0)}</p>
                </div>
            )
        }

        render(
            <PrototypeRemoteApiProvider api={api}>
                <PrototypeStoreProvider>
                    <LiveShellProbe />
                </PrototypeStoreProvider>
            </PrototypeRemoteApiProvider>,
        )

        await waitFor(() => {
            expect(screen.getByTestId('selected-program')).toHaveTextContent(currentProgram.id)
        })
        expect(screen.getByTestId('attached-program')).toHaveTextContent(currentProgram.id)

        fireEvent.click(screen.getByRole('button', { name: 'switch' }))

        expect(screen.getByTestId('selected-program')).toHaveTextContent(currentProgram.id)
        expect(screen.getByTestId('attached-program')).toHaveTextContent(currentProgram.id)
        expect(screen.getByTestId('program-count')).toHaveTextContent('2')
        expect(screen.queryByText('正在接入真实 OMC runtime…')).not.toBeInTheDocument()

        nextOverview.resolve(createProgramOverview(nextProgram))

        await waitFor(() => {
            expect(screen.getByTestId('selected-program')).toHaveTextContent(nextProgram.id)
        })
        await waitFor(() => {
            expect(screen.getByTestId('attached-program')).toHaveTextContent(nextProgram.id)
        })
    })

    it('rolls the visible selection back and surfaces an error when switching programs fails', async () => {
        const currentProgram = createTestProgram()
        const nextProgram = createTestProgram('omc-next', 'Next Program', '/tmp/omc-next')
        const nextOverview = createDeferred<OmcProgramOverviewResponse>()
        const api = new PrototypeRemoteApiClient('http://localhost', 'test-token')

        vi.spyOn(api, 'getPrograms').mockResolvedValue(createProgramList([currentProgram, nextProgram]))
        vi.spyOn(api, 'getProgram').mockImplementation(async (programId) => {
            if (programId === nextProgram.id) {
                return nextOverview.promise
            }

            return createProgramOverview(currentProgram)
        })
        vi.spyOn(api, 'getGuidedPlanningState').mockImplementation(async (programId) => (
            createPlanningState(programId === nextProgram.id ? nextProgram : currentProgram)
        ))
        vi.spyOn(api, 'getPlanningIndex').mockImplementation(async (programId) => (
            createPlanningIndex(programId === nextProgram.id ? nextProgram : currentProgram)
        ))
        vi.spyOn(api, 'getPlanRuntimes').mockImplementation(async (programId) => (
            createPlanRuntimes(programId === nextProgram.id ? nextProgram : currentProgram)
        ))
        vi.spyOn(api, 'getPlanDetail').mockImplementation(async (programId) => (
            createPlanDetail(programId === nextProgram.id ? nextProgram : currentProgram)
        ))

        function LiveShellProbe() {
            const store = usePrototypeStore()

            return (
                <div>
                    <button type="button" onClick={() => store.actions.selectProgram?.(nextProgram.id)}>
                        switch
                    </button>
                    <p data-testid="selected-program">{store.live?.selectedProgramId ?? 'none'}</p>
                    <p data-testid="attached-program">{store.state.attachedProgramId ?? 'none'}</p>
                    <p data-testid="live-error">{store.live?.error ?? 'none'}</p>
                </div>
            )
        }

        render(
            <PrototypeRemoteApiProvider api={api}>
                <PrototypeStoreProvider>
                    <LiveShellProbe />
                </PrototypeStoreProvider>
            </PrototypeRemoteApiProvider>,
        )

        await waitFor(() => {
            expect(screen.getByTestId('selected-program')).toHaveTextContent(currentProgram.id)
        })
        expect(screen.getByTestId('attached-program')).toHaveTextContent(currentProgram.id)

        fireEvent.click(screen.getByRole('button', { name: 'switch' }))

        expect(screen.getByTestId('selected-program')).toHaveTextContent(currentProgram.id)
        expect(screen.getByTestId('attached-program')).toHaveTextContent(currentProgram.id)

        nextOverview.reject(new Error('Next program failed to load'))

        await waitFor(() => {
            expect(screen.getByTestId('selected-program')).toHaveTextContent(currentProgram.id)
        })
        expect(screen.getByTestId('attached-program')).toHaveTextContent(currentProgram.id)
        expect(screen.getByTestId('live-error')).toHaveTextContent('Next program failed to load')
        expect(screen.queryByText('正在接入真实 OMC runtime…')).not.toBeInTheDocument()
    })
})
