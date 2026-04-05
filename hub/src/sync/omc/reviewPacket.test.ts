import { describe, expect, it } from 'bun:test'
import type { OmcAttempt, OmcEvidence, OmcPlanDetailResponse, OmcPlanRuntime, OmcProgram } from '@hopi/protocol/types'
import { buildOmcMergePacket } from './reviewPacket'

describe('buildOmcMergePacket', () => {
    it('builds a decision-first merge packet from runtime, attempts, and evidence', () => {
        const program: OmcProgram = {
            id: 'program-1',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'OMC Workspace',
            repoRoot: '/repo',
            planningRoot: '/repo/.planning',
            primaryBranch: 'main',
            targetBranch: 'main',
            createdAt: 1,
            updatedAt: 1
        }
        const plan: OmcPlanDetailResponse['plan'] = {
            planKey: '03-01',
            planPath: '.planning/phases/03-review/03-01-PLAN.md',
            phaseKey: '03-review',
            phaseLabel: '03 Review',
            planTitle: 'Review and merge cockpit contract',
            summary: 'Introduce the review packet.',
            checklist: [{ text: 'Ship API contract', checked: true }],
            refs: {
                projectPath: '.planning/PROJECT.md',
                roadmapPath: '.planning/ROADMAP.md'
            },
            lastModifiedAt: 1
        }
        const runtime: OmcPlanRuntime = {
            programId: 'program-1',
            planKey: '03-01',
            planPath: plan.planPath,
            phaseKey: plan.phaseKey,
            phaseLabel: plan.phaseLabel,
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: 'loop-1',
            currentWorktreePath: '/repo-worktree',
            currentBranch: 'omc/03-01',
            targetBranch: 'main',
            attemptCount: 2,
            consecutiveFailureCount: 0,
            lastFailureFingerprint: null,
            reviewRequired: false,
            reviewApprovedAt: 1000,
            mergeStatus: 'ready',
            mergeBlockedReason: null,
            lastMergeAttemptAt: null,
            mergeApprovedAt: null,
            doneAt: null,
            latestEvidenceSummary: 'Ready for review.',
            lastAttemptAt: 1000,
            updatedAt: 1000
        }
        const attempts: OmcAttempt[] = [{
            id: 'attempt-2',
            programId: 'program-1',
            planKey: '03-01',
            planPath: plan.planPath,
            loopRunId: 'loop-1',
            sessionId: 'session-1',
            attemptNumber: 2,
            status: 'completed',
            summary: 'All review APIs are in place.',
            failureFingerprint: null,
            terminationReason: 'structured-completion',
            changedFiles: ['hub/src/web/routes/omc.ts'],
            checks: [
                { label: 'bun run typecheck:hub', result: 'passed', detail: 'Hub types are green.' },
                { label: 'bun test hub/src/web/routes/omc.test.ts', result: 'warning', detail: 'Route tests not added yet.' }
            ],
            nextSuggestedStep: 'Request human review.',
            contextPack: null,
            createdAt: 900,
            updatedAt: 1000,
            completedAt: 1000
        }]
        const evidence: OmcEvidence[] = [{
            id: 'evidence-1',
            programId: 'program-1',
            planKey: '03-01',
            attemptId: 'attempt-2',
            kind: 'diff',
            label: 'diff-summary',
            status: 'info',
            summary: '2 files currently changed in the worktree.',
            payload: {
                files: [
                    { fullPath: 'hub/src/web/routes/omc.ts' },
                    { fullPath: 'hub/src/sync/omc/reviewPacket.ts' }
                ]
            },
            createdAt: 1000
        }]

        const packet = buildOmcMergePacket({
            program,
            plan,
            runtime,
            attempts,
            evidence
        })

        expect(packet.phaseLabel).toBe('03 Review')
        expect(packet.planKey).toBe('03-01')
        expect(packet.planTitle).toBe('Review and merge cockpit contract')
        expect(packet.sourceBranch).toBe('omc/03-01')
        expect(packet.targetBranch).toBe('main')
        expect(packet.worktreePath).toBe('/repo-worktree')
        expect(packet.attemptCount).toBe(2)
        expect(packet.changedFilesSummary.totalFiles).toBe(2)
        expect(packet.changedFilesSummary.files).toContain('hub/src/sync/omc/reviewPacket.ts')
        expect(packet.checksSummary.passed).toBe(1)
        expect(packet.checksSummary.warning).toBe(1)
        expect(packet.completionSummary.summary).toBe('All review APIs are in place.')
        expect(packet.warnings).toContain('1 checks reported warnings.')
        expect(packet.blockers).toHaveLength(0)
        expect(packet.preconditions.find((item) => item.key === 'review-approval')?.status).toBe('ready')
    })
})
