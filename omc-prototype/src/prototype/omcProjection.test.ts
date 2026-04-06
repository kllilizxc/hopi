import { describe, expect, it } from 'vitest'
import type {
    OmcAttempt,
    OmcEvidence,
    OmcGuidedPlanningRun,
    OmcPlanDetailResponse,
    OmcPlanRuntime,
    OmcPlanningIndexResponse,
    OmcProgramOverviewResponse,
} from '@hopi/protocol/types'
import { buildPrototypeSnapshotFromOmc, buildWorldModelFromOmc } from './omcProjection'

function createProgramOverview(): OmcProgramOverviewResponse {
    return {
        program: {
            id: 'omc-default',
            namespace: 'default',
            name: 'HOPI Workspace',
            repoRoot: '/Users/realizer/Code/hopi',
            planningRoot: '/Users/realizer/Code/hopi/docs/design/omc-planning-seed',
            primaryBranch: 'main',
            targetBranch: 'main',
            createdAt: 1,
            updatedAt: 10,
            counts: {
                Planning: 1,
                Running: 1,
                Review: 1,
                Done: 0,
            },
            lastActivityAt: 10,
        },
        planning: {
            status: 'detected',
            planningRoot: '/Users/realizer/Code/hopi/docs/design/omc-planning-seed',
            hasPlanning: true,
            hasPlans: true,
            phaseCount: 2,
            planCount: 3,
            seedFiles: [],
        },
    }
}

function createPlanningIndex(): OmcPlanningIndexResponse {
    return {
        program: {
            id: 'omc-default',
            name: 'HOPI Workspace',
            repoRoot: '/Users/realizer/Code/hopi',
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
                        checklistTotal: 4,
                        checklistDone: 2,
                        checklistOpen: 2,
                        firstOpenItem: 'Capture one more evidence round before review.',
                        lastModifiedAt: 100,
                    },
                    {
                        planKey: '01-02',
                        planPath: 'docs/design/omc-planning-seed/phases/01-foundation/01-02-PLAN.md',
                        phaseKey: '01-foundation',
                        phaseLabel: '01 Foundation',
                        planTitle: 'Harden review lane',
                        summary: 'Keep the review lane deterministic.',
                        checklistTotal: 5,
                        checklistDone: 3,
                        checklistOpen: 2,
                        firstOpenItem: 'Finish the merge packet.',
                        lastModifiedAt: 120,
                    },
                ],
            },
            {
                phaseKey: '02-ux',
                phaseLabel: '02 Ux',
                plans: [
                    {
                        planKey: '02-01',
                        planPath: 'docs/design/omc-planning-seed/phases/02-ux/02-01-PLAN.md',
                        phaseKey: '02-ux',
                        phaseLabel: '02 Ux',
                        planTitle: 'Refresh operator workspace',
                        summary: 'Turn the workspace into a calmer decision surface.',
                        checklistTotal: 3,
                        checklistDone: 1,
                        checklistOpen: 2,
                        firstOpenItem: 'Tighten the risk presentation.',
                        lastModifiedAt: 140,
                    },
                ],
            },
        ],
    }
}

function createPlanRuntimes(): OmcPlanRuntime[] {
    return [
        {
            programId: 'omc-default',
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
        {
            programId: 'omc-default',
            planKey: '01-02',
            planPath: 'docs/design/omc-planning-seed/phases/01-foundation/01-02-PLAN.md',
            phaseKey: '01-foundation',
            phaseLabel: '01 Foundation',
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: 'loop-2',
            currentWorktreePath: '/tmp/worktrees/01-02',
            currentBranch: 'omc/01-02',
            targetBranch: 'main',
            attemptCount: 2,
            consecutiveFailureCount: 0,
            lastFailureFingerprint: null,
            reviewRequired: true,
            reviewApprovedAt: null,
            mergeStatus: 'idle',
            mergeBlockedReason: null,
            lastMergeAttemptAt: null,
            mergeApprovedAt: null,
            doneAt: null,
            latestEvidenceSummary: 'Reviewer accepted the work but wants a human release decision.',
            lastAttemptAt: 240,
            updatedAt: 250,
        },
        {
            programId: 'omc-default',
            planKey: '02-01',
            planPath: 'docs/design/omc-planning-seed/phases/02-ux/02-01-PLAN.md',
            phaseKey: '02-ux',
            phaseLabel: '02 Ux',
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: 'loop-3',
            currentWorktreePath: '/tmp/worktrees/02-01',
            currentBranch: 'omc/02-01',
            targetBranch: 'main',
            attemptCount: 3,
            consecutiveFailureCount: 2,
            lastFailureFingerprint: 'ui-noise',
            reviewRequired: false,
            reviewApprovedAt: 280,
            mergeStatus: 'blocked',
            mergeBlockedReason: 'Merge conflicts remain in the workspace.',
            lastMergeAttemptAt: 281,
            mergeApprovedAt: null,
            doneAt: null,
            latestEvidenceSummary: 'The review lane is blocked by merge conflicts.',
            lastAttemptAt: 275,
            updatedAt: 282,
        },
    ]
}

function createAttempt(input: Partial<OmcAttempt> & Pick<OmcAttempt, 'id' | 'programId' | 'planKey' | 'planPath' | 'attemptNumber' | 'status' | 'createdAt' | 'updatedAt'>): OmcAttempt {
    return {
        loopRunId: null,
        sessionId: null,
        summary: null,
        failureFingerprint: null,
        terminationReason: null,
        changedFiles: [],
        checks: [],
        nextSuggestedStep: null,
        contextPack: null,
        completedAt: null,
        ...input,
    }
}

function createEvidence(input: Partial<OmcEvidence> & Pick<OmcEvidence, 'id' | 'programId' | 'planKey' | 'kind' | 'label' | 'status' | 'summary' | 'createdAt'>): OmcEvidence {
    return {
        attemptId: null,
        payload: null,
        ...input,
    }
}

function createPlanDetail(
    planKey: string,
    phaseKey: string,
    phaseLabel: string,
    planTitle: string,
    summary: string,
    runtime: OmcPlanRuntime,
    attempts: OmcAttempt[],
    evidence: OmcEvidence[],
): OmcPlanDetailResponse {
    return {
        programId: 'omc-default',
        plan: {
            planKey,
            planPath: runtime.planPath,
            phaseKey,
            phaseLabel,
            planTitle,
            summary,
            checklist: [
                { text: 'first step', checked: attempts.length > 0 },
                { text: 'second step', checked: runtime.column === 'Done' },
            ],
            refs: {
                projectPath: 'docs/design/omc-planning-seed/PROJECT.md',
                roadmapPath: 'docs/design/omc-planning-seed/ROADMAP.md',
            },
            lastModifiedAt: runtime.updatedAt ?? 0,
        },
        runtime,
        attempts,
        evidence,
    }
}

function createPlanDetails(runtimes: OmcPlanRuntime[]): Record<string, OmcPlanDetailResponse> {
    return {
        '01-01': createPlanDetail(
            '01-01',
            '01-foundation',
            '01 Foundation',
            'Lock runtime foundation',
            'Make the first control-plane loop reliable.',
            runtimes[0]!,
            [
                createAttempt({
                    id: 'attempt-01-01',
                    programId: 'omc-default',
                    planKey: '01-01',
                    planPath: runtimes[0]!.planPath,
                    sessionId: 'session-running',
                    attemptNumber: 1,
                    status: 'running',
                    summary: 'Driver is tightening the runtime seams.',
                    createdAt: 200,
                    updatedAt: 210,
                }),
            ],
            [
                createEvidence({
                    id: 'evidence-01-01',
                    programId: 'omc-default',
                    planKey: '01-01',
                    attemptId: 'attempt-01-01',
                    kind: 'summary',
                    label: 'driver-summary',
                    status: 'info',
                    summary: 'Driver tightened the runtime seams and is running one more check.',
                    createdAt: 211,
                }),
            ],
        ),
        '01-02': createPlanDetail(
            '01-02',
            '01-foundation',
            '01 Foundation',
            'Harden review lane',
            'Keep the review lane deterministic.',
            runtimes[1]!,
            [
                createAttempt({
                    id: 'attempt-01-02',
                    programId: 'omc-default',
                    planKey: '01-02',
                    planPath: runtimes[1]!.planPath,
                    sessionId: 'session-review',
                    attemptNumber: 2,
                    status: 'completed',
                    summary: 'Reviewer accepted the work and is waiting for a release decision.',
                    createdAt: 230,
                    updatedAt: 240,
                    completedAt: 240,
                }),
            ],
            [
                createEvidence({
                    id: 'evidence-01-02',
                    programId: 'omc-default',
                    planKey: '01-02',
                    attemptId: 'attempt-01-02',
                    kind: 'review',
                    label: 'review-verdict',
                    status: 'passed',
                    summary: 'Reviewer says the loop is accepted but crosses a user boundary.',
                    createdAt: 241,
                }),
            ],
        ),
        '02-01': createPlanDetail(
            '02-01',
            '02-ux',
            '02 Ux',
            'Refresh operator workspace',
            'Turn the workspace into a calmer decision surface.',
            runtimes[2]!,
            [
                createAttempt({
                    id: 'attempt-02-01',
                    programId: 'omc-default',
                    planKey: '02-01',
                    planPath: runtimes[2]!.planPath,
                    sessionId: 'session-blocked',
                    attemptNumber: 3,
                    status: 'blocked',
                    summary: 'Merge conflicts block the review lane.',
                    failureFingerprint: 'ui-noise',
                    createdAt: 260,
                    updatedAt: 275,
                    completedAt: 275,
                }),
            ],
            [
                createEvidence({
                    id: 'evidence-02-01',
                    programId: 'omc-default',
                    planKey: '02-01',
                    attemptId: 'attempt-02-01',
                    kind: 'review',
                    label: 'merge-conflict',
                    status: 'warning',
                    summary: 'Merge conflicts remain in the workspace.',
                    createdAt: 281,
                }),
            ],
        ),
    }
}

describe('OMC runtime projection', () => {
    it('projects live OMC planning data into a prototype snapshot with approval and risk surfaces', () => {
        const overview = createProgramOverview()
        const index = createPlanningIndex()
        const runtimes = createPlanRuntimes()
        const planningRun: OmcGuidedPlanningRun | null = null
        const details = createPlanDetails(runtimes)

        const snapshot = buildPrototypeSnapshotFromOmc({
            overview,
            index,
            runtimes,
            planningRun,
            details,
        })

        expect(snapshot.checkpoint.id).toBe('approval')
        expect(snapshot.program.id).toBe('omc-default')
        expect(snapshot.goals.map((goal) => goal.id)).toEqual(['01-foundation', '02-ux'])
        expect(snapshot.streams.map((stream) => stream.id)).toEqual(['01-01', '01-02', '02-01'])
        expect(snapshot.approvalBatches.today.items.map((item) => item.id)).toContain('01-02')
        expect(snapshot.approvalBatches.today.items.map((item) => item.id)).toContain('02-01')
        expect(snapshot.risks.some((risk) => risk.id === 'risk:02-01')).toBe(true)
    })

    it('projects live plan runtimes into work orders, decision topics, and traceable agent events', () => {
        const overview = createProgramOverview()
        const index = createPlanningIndex()
        const runtimes = createPlanRuntimes()
        const details = createPlanDetails(runtimes)

        const world = buildWorldModelFromOmc({
            overview,
            index,
            runtimes,
            details,
        })

        expect(world.currentFocus.goalId).toBe('01-foundation')
        expect(world.currentFocus.streamId).toBe('01-02')
        expect(world.workOrders['01-01']?.state).toBe('executing')
        expect(world.workOrders['01-02']?.state).toBe('waiting_user')
        expect(world.workOrders['01-02']?.waitingOnTopicId).toBe('approval:01-02')
        expect(world.workOrders['02-01']?.state).toBe('blocked')
        expect(world.decisionTopics['approval:01-02']?.kind).toBe('approval')
        expect(world.decisionTopics['approval:01-02']?.lifecycle).toBe('pending')
        expect(world.decisionTopics['risk:02-01']?.kind).toBe('risk')
        expect(world.agentEvents.some((event) => event.workOrderId === '01-02' && event.kind === 'ReviewerVerdict')).toBe(true)
        expect(world.agentEvents.some((event) => event.workOrderId === '01-01' && event.kind === 'Observation')).toBe(true)
        expect(world.agentEvents.some((event) => event.workOrderId === '02-01' && event.kind === 'Conflict')).toBe(true)
    })
})
