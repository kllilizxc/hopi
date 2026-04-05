import { describe, expect, it } from 'bun:test'
import type { OmcPlanDetailResponse, OmcProgram } from '@hopi/protocol/types'
import { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { OmcReviewController } from './reviewController'

function makePlan(): OmcPlanDetailResponse['plan'] {
    return {
        planKey: '03-02',
        planPath: 'docs/design/omc-planning-seed/03-02-PLAN.md',
        phaseKey: '03-review-and-merge-cockpit',
        phaseLabel: '03 Review and Merge Cockpit',
        planTitle: 'Implement merge approval controller',
        summary: 'Execute merge approval and keep failures in review.',
        checklist: [
            { text: 'Add merge controller', checked: true },
            { text: 'Handle merge conflicts', checked: true }
        ],
        refs: {
            projectPath: 'docs/design/omc-planning-seed/PROJECT.md',
            roadmapPath: 'docs/design/omc-planning-seed/ROADMAP.md'
        },
        lastModifiedAt: 1_000
    }
}

function seedReviewReadyPlan(store: Store): {
    program: OmcProgram
    plan: OmcPlanDetailResponse['plan']
} {
    const program = store.omcRuntime.upsertProgram({
        id: 'program-1',
        namespace: 'default',
        machineId: 'machine-1',
        name: 'OMC Workspace',
        repoRoot: '/repo',
        planningRoot: '/repo/.planning',
        primaryBranch: 'main',
        targetBranch: 'main'
    })
    const plan = makePlan()

    store.omcRuntime.upsertPlanRuntime('default', {
        programId: program.id,
        planKey: plan.planKey,
        planPath: plan.planPath,
        phaseKey: plan.phaseKey,
        phaseLabel: plan.phaseLabel,
        column: 'Review',
        loopStatus: 'review',
        currentLoopRunId: 'loop-1',
        currentWorktreePath: '/repo-worktree',
        currentBranch: 'omc/03-02',
        targetBranch: 'main',
        attemptCount: 1,
        reviewRequired: false,
        reviewApprovedAt: 1_000,
        mergeStatus: 'ready',
        mergeBlockedReason: null,
        lastMergeAttemptAt: null,
        mergeApprovedAt: null,
        doneAt: null,
        latestEvidenceSummary: 'Ready for merge approval.',
        lastAttemptAt: 1_000,
        updatedAt: 1_000
    })
    store.omcRuntime.addAttempt('default', {
        id: 'attempt-1',
        programId: program.id,
        planKey: plan.planKey,
        planPath: plan.planPath,
        loopRunId: 'loop-1',
        sessionId: 'session-1',
        attemptNumber: 1,
        status: 'completed',
        summary: 'Review APIs and packet builder are ready.',
        terminationReason: 'structured-completion',
        changedFiles: ['hub/src/web/routes/omc.ts'],
        completedAt: 1_000
    })

    return { program, plan }
}

function makeEngine(overrides?: {
    gitMergeWorktreeState?: () => Promise<{
        success: boolean
        targetBranch?: string
        sourceBranch?: string
        hasWorkingTreeChanges?: boolean
        committedChangedCount?: number
        mergeable?: boolean
        stdout?: string
        stderr?: string
        error?: string
    }>
    gitMergeWorktree?: () => Promise<{
        success: boolean
        commitHash?: string
        skippedReason?: 'no_changes'
        conflictFiles?: string[]
        stdout?: string
        stderr?: string
        error?: string
    }>
}): SyncEngine {
    return {
        getSessionByNamespace() {
            return {
                metadata: {
                    path: '/repo',
                    machineId: 'machine-1',
                    worktree: {
                        basePath: '/repo',
                        worktreePath: '/repo-worktree',
                        branch: 'omc/03-02'
                    }
                }
            }
        },
        async gitMergeWorktreeState() {
            return await overrides?.gitMergeWorktreeState?.() ?? {
                success: true,
                targetBranch: 'main',
                sourceBranch: 'omc/03-02',
                hasWorkingTreeChanges: false,
                committedChangedCount: 2,
                mergeable: true
            }
        },
        async gitMergeWorktree() {
            return await overrides?.gitMergeWorktree?.() ?? {
                success: true,
                commitHash: 'abc123'
            }
        },
        handleRealtimeEvent() {
            return
        }
    } as unknown as SyncEngine
}

describe('OmcReviewController', () => {
    it('marks a review-approved plan as merged after merge approval succeeds', async () => {
        const store = new Store(':memory:')
        const { program, plan } = seedReviewReadyPlan(store)
        const controller = new OmcReviewController({
            store,
            engine: makeEngine(),
            namespace: 'default'
        })

        const result = await controller.approveMerge({ program, plan })

        expect(result.merge.outcome).toBe('merged')
        expect(result.merge.commitHash).toBe('abc123')
        expect(result.runtime.column).toBe('Done')
        expect(result.runtime.loopStatus).toBe('done')
        expect(result.runtime.mergeStatus).toBe('merged')
        expect(typeof result.runtime.mergeApprovedAt).toBe('number')
        expect(typeof result.runtime.doneAt).toBe('number')
        expect(result.packet.blockers).not.toContain('Review has not been approved yet.')

        const evidence = store.omcRuntime.listEvidenceForPlan(program.id, plan.planKey, 'default')
        expect(evidence[0]?.label).toBe('merge-succeeded')
    })

    it('keeps merge failures in review as a blocked merge state', async () => {
        const store = new Store(':memory:')
        const { program, plan } = seedReviewReadyPlan(store)
        const controller = new OmcReviewController({
            store,
            engine: makeEngine({
                gitMergeWorktree: async () => ({
                    success: false,
                    error: 'Base repository has uncommitted changes; commit/stash first'
                })
            }),
            namespace: 'default'
        })

        const result = await controller.approveMerge({ program, plan })

        expect(result.merge.outcome).toBe('blocked')
        expect(result.runtime.column).toBe('Review')
        expect(result.runtime.loopStatus).toBe('review')
        expect(result.runtime.mergeStatus).toBe('blocked')
        expect(result.runtime.mergeBlockedReason).toBe('Base repository has uncommitted changes; commit/stash first')
        expect(result.packet.blockers).toContain('Base repository has uncommitted changes; commit/stash first')

        const evidence = store.omcRuntime.listEvidenceForPlan(program.id, plan.planKey, 'default')
        expect(evidence[0]?.label).toBe('merge-blocked')
    })

    it('surfaces merge conflicts with conflict files and takeover linkage', async () => {
        const store = new Store(':memory:')
        const { program, plan } = seedReviewReadyPlan(store)
        const controller = new OmcReviewController({
            store,
            engine: makeEngine({
                gitMergeWorktree: async () => ({
                    success: false,
                    stderr: 'CONFLICT (content): Merge conflict in hub/src/web/routes/omc.ts',
                    conflictFiles: ['hub/src/web/routes/omc.ts']
                })
            }),
            namespace: 'default'
        })

        const result = await controller.approveMerge({ program, plan })

        expect(result.merge.outcome).toBe('conflict')
        expect(result.merge.conflictFiles).toEqual(['hub/src/web/routes/omc.ts'])
        expect(result.merge.sessionId).toBe('session-1')
        expect(result.merge.sessionUrl).toBe('/sessions/session-1/terminal')
        expect(result.runtime.column).toBe('Review')
        expect(result.runtime.mergeStatus).toBe('conflict')

        const evidence = store.omcRuntime.listEvidenceForPlan(program.id, plan.planKey, 'default')
        expect(evidence[0]?.label).toBe('merge-conflict')
        expect(evidence[0]?.payload).toEqual(expect.objectContaining({
            conflictFiles: ['hub/src/web/routes/omc.ts'],
            sessionUrl: '/sessions/session-1/terminal'
        }))
    })
})
