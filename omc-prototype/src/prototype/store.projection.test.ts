import { describe, expect, it } from 'vitest'
import type {
    OmcPlanRuntime,
    OmcPlanningIndexResponse,
    OmcProgramRuntimeStateResponse,
} from '@hopi/protocol/types'
import { buildLiveThreadPlanKeyMap, buildRuntimeSessionIdByPlanKey, rankLivePlan } from './store'
import type { PrototypeScenarioSnapshot } from './types'

function createSnapshot(): PrototypeScenarioSnapshot {
    return {
        checkpoint: {
            id: 'execution',
            label: '静默执行',
            stamp: '2026-04-09T00:00:00.000Z',
            synopsis: 'Execution is underway.',
        },
        program: {
            id: 'program-1',
            name: 'CardGame',
            repoRoot: '/tmp/card-game',
            primaryBranch: 'main',
            summary: 'CardGame runtime',
        },
        goals: [],
        strategies: [],
        streams: [],
        digests: {
            today: { window: 'today', headline: '', summary: '', highlights: [], decisions: [], watchlist: [] },
            yesterday: { window: 'yesterday', headline: '', summary: '', highlights: [], decisions: [], watchlist: [] },
            last24h: { window: 'last24h', headline: '', summary: '', highlights: [], decisions: [], watchlist: [] },
        },
        approvalBatches: {
            today: { id: 'batch-today', window: 'today', title: '', summary: '', items: [] },
            yesterday: { id: 'batch-yesterday', window: 'yesterday', title: '', summary: '', items: [] },
            last24h: { id: 'batch-last24h', window: 'last24h', title: '', summary: '', items: [] },
        },
        risks: [],
        phases: [],
        planCards: [],
    }
}

function createIndex(): OmcPlanningIndexResponse {
    return {
        program: {
            id: 'program-1',
            name: 'CardGame',
            repoRoot: '/tmp/card-game',
        },
        phases: [
            {
                phaseKey: '01-first-playable-expedition',
                phaseLabel: '01 First Playable Expedition',
                plans: [
                    {
                        planKey: '01-01',
                        planPath: '.planning/phases/01-first-playable-expedition/01-01-PLAN.md',
                        phaseKey: '01-first-playable-expedition',
                        phaseLabel: '01 First Playable Expedition',
                        dependsOn: [],
                        planTitle: 'Establish the expedition domain',
                        summary: 'Foundation first.',
                        checklistTotal: 1,
                        checklistDone: 0,
                        checklistOpen: 1,
                        firstOpenItem: 'Foundation first.',
                        lastModifiedAt: 100,
                    },
                    {
                        planKey: '01-02',
                        planPath: '.planning/phases/01-first-playable-expedition/01-02-PLAN.md',
                        phaseKey: '01-first-playable-expedition',
                        phaseLabel: '01 First Playable Expedition',
                        dependsOn: ['01-01'],
                        planTitle: 'Create the expedition entry scene',
                        summary: 'Entry flow next.',
                        checklistTotal: 1,
                        checklistDone: 0,
                        checklistOpen: 1,
                        firstOpenItem: 'Entry flow next.',
                        lastModifiedAt: 200,
                    },
                ],
            },
        ],
    }
}

function createRuntimeByPlanKey(): Record<string, OmcPlanRuntime> {
    return {
        '01-01': {
            programId: 'program-1',
            planKey: '01-01',
            planPath: '.planning/phases/01-first-playable-expedition/01-01-PLAN.md',
            phaseKey: '01-first-playable-expedition',
            phaseLabel: '01 First Playable Expedition',
            column: 'Running',
            loopStatus: 'running',
            currentLoopRunId: 'loop-1',
            currentWorktreePath: '/tmp/worktree-01-01',
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
            latestEvidenceSummary: 'Still looks running if you only read plan runtime.',
            lastAttemptAt: 100,
            updatedAt: 101,
        },
        '01-02': {
            programId: 'program-1',
            planKey: '01-02',
            planPath: '.planning/phases/01-first-playable-expedition/01-02-PLAN.md',
            phaseKey: '01-first-playable-expedition',
            phaseLabel: '01 First Playable Expedition',
            column: 'Planning',
            loopStatus: 'idle',
            currentLoopRunId: null,
            currentWorktreePath: null,
            currentBranch: null,
            targetBranch: 'main',
            attemptCount: 0,
            consecutiveFailureCount: 0,
            lastFailureFingerprint: null,
            reviewRequired: false,
            reviewApprovedAt: null,
            mergeStatus: 'idle',
            mergeBlockedReason: null,
            lastMergeAttemptAt: null,
            mergeApprovedAt: null,
            doneAt: null,
            latestEvidenceSummary: null,
            lastAttemptAt: null,
            updatedAt: null,
        },
    }
}

function createRuntimeState(): OmcProgramRuntimeStateResponse {
    return {
        programId: 'program-1',
        mailbox: [],
        workOrders: [
            {
                id: '01-01',
                programId: 'program-1',
                goalId: '01-first-playable-expedition',
                planKey: '01-01',
                title: 'Establish the expedition domain',
                owner: null,
                status: 'done',
                currentAttemptId: 'driver-1',
                reviewerVerdict: 'accepted',
                blockedReason: null,
                latestAcceptedAttemptId: 'driver-1',
                createdAt: 100,
                updatedAt: 150,
            },
            {
                id: '01-02',
                programId: 'program-1',
                goalId: '01-first-playable-expedition',
                planKey: '01-02',
                title: 'Create the expedition entry scene',
                owner: 'driver',
                status: 'in_progress',
                currentAttemptId: 'driver-2',
                reviewerVerdict: null,
                blockedReason: null,
                latestAcceptedAttemptId: null,
                createdAt: 151,
                updatedAt: 160,
            },
        ],
        workAttempts: [],
        agents: [],
        directives: [],
    }
}

describe('live projection helpers', () => {
    it('prefers task-board progress over stale plan-runtime rank when choosing the primary phase thread plan', () => {
        const mapping = buildLiveThreadPlanKeyMap({
            snapshot: createSnapshot(),
            index: createIndex(),
            runtimeByPlanKey: createRuntimeByPlanKey(),
            runtimeState: createRuntimeState(),
        })

        expect(mapping['status:01-first-playable-expedition']).toBe('01-02')
        expect(mapping['direction:01-first-playable-expedition']).toBe('01-02')
    })

    it('ranks an active task-board card ahead of a stale running runtime from the previous card', () => {
        const runtimeByPlanKey = createRuntimeByPlanKey()
        const runtimeState = createRuntimeState()
        const workOrder01 = runtimeState.workOrders.find((workOrder) => workOrder.planKey === '01-01') ?? null
        const workOrder02 = runtimeState.workOrders.find((workOrder) => workOrder.planKey === '01-02') ?? null

        expect(rankLivePlan({
            runtime: runtimeByPlanKey['01-02'],
            workOrder: workOrder02,
        })).toBeLessThan(rankLivePlan({
            runtime: runtimeByPlanKey['01-01'],
            workOrder: workOrder01,
        }))
    })

    it('only exposes a transcript session when the task board still points at a live attempt', () => {
        const runtimeState = createRuntimeState()
        runtimeState.workAttempts = [
            {
                id: 'driver-1',
                programId: 'program-1',
                workOrderId: '01-01',
                role: 'driver',
                sessionId: 'session-archived-01-01',
                status: 'accepted',
                summary: 'Old accepted run.',
                sourceMailboxMessageId: null,
                createdAt: 110,
                updatedAt: 150,
                completedAt: 150,
            },
            {
                id: 'driver-2-old',
                programId: 'program-1',
                workOrderId: '01-02',
                role: 'driver',
                sessionId: 'session-archived-01-02',
                status: 'accepted',
                summary: 'Old archived run.',
                sourceMailboxMessageId: null,
                createdAt: 151,
                updatedAt: 165,
                completedAt: 165,
            },
            {
                id: 'driver-2',
                programId: 'program-1',
                workOrderId: '01-02',
                role: 'driver',
                sessionId: 'session-live-01-02',
                status: 'running',
                summary: 'Current live run.',
                sourceMailboxMessageId: null,
                createdAt: 166,
                updatedAt: 180,
                completedAt: null,
            },
        ]
        runtimeState.agents = [
            {
                programId: 'program-1',
                role: 'driver',
                busy: true,
                currentWorkOrderId: '01-02',
                activeSessionId: 'session-live-01-02',
                model: 'codex',
                mode: 'default',
                lastHeartbeat: 181,
            },
        ]

        const mapping = buildRuntimeSessionIdByPlanKey({
            runtimeState,
            details: {
                '01-01': {
                    programId: 'program-1',
                    plan: {
                        planKey: '01-01',
                        planPath: '.planning/phases/01-first-playable-expedition/01-01-PLAN.md',
                        phaseKey: '01-first-playable-expedition',
                        phaseLabel: '01 First Playable Expedition',
                        planTitle: 'Establish the expedition domain',
                        summary: 'Foundation first.',
                        checklist: [],
                        refs: {
                            projectPath: '.planning/PROJECT.md',
                            roadmapPath: '.planning/ROADMAP.md',
                        },
                        lastModifiedAt: 100,
                    },
                    runtime: createRuntimeByPlanKey()['01-01'],
                    attempts: [
                        {
                            id: 'legacy-attempt-01-01',
                            loopRunId: null,
                            programId: 'program-1',
                            planKey: '01-01',
                            planPath: '.planning/phases/01-first-playable-expedition/01-01-PLAN.md',
                            sessionId: 'session-legacy-01-01',
                            attemptNumber: 1,
                            status: 'completed',
                            summary: 'Legacy detail should not win once task-board data exists.',
                            failureFingerprint: null,
                            terminationReason: null,
                            changedFiles: [],
                            checks: [],
                            nextSuggestedStep: null,
                            contextPack: null,
                            createdAt: 100,
                            updatedAt: 150,
                            completedAt: 150,
                        },
                    ],
                    evidence: [],
                },
            },
        })

        expect(mapping['01-01'] ?? null).toBeNull()
        expect(mapping['01-02']).toBe('session-live-01-02')
    })
})
