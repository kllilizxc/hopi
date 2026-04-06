import { describe, expect, it } from 'vitest'
import type { OmcPlanRuntime } from '@hopi/protocol/types'
import { resolveThreadIntent } from './omcThreadIntents'
import type { OperatorThread } from './types'

function createThread(input: Partial<OperatorThread> & Pick<OperatorThread, 'id' | 'kind' | 'title' | 'preview' | 'updatedAt' | 'lifecycle' | 'priority' | 'tone' | 'unread' | 'passive' | 'refs' | 'detailSections' | 'firstMessage' | 'quickActions' | 'statusLabel'>): OperatorThread {
    return {
        goalId: null,
        ...input,
    }
}

function createRuntime(input: Partial<OmcPlanRuntime> & Pick<OmcPlanRuntime, 'programId' | 'planKey' | 'planPath' | 'phaseKey' | 'phaseLabel' | 'column' | 'loopStatus' | 'attemptCount' | 'reviewRequired'>): OmcPlanRuntime {
    return {
        currentLoopRunId: null,
        currentWorktreePath: null,
        currentBranch: null,
        targetBranch: null,
        consecutiveFailureCount: 0,
        lastFailureFingerprint: null,
        reviewApprovedAt: null,
        mergeStatus: 'idle',
        mergeBlockedReason: null,
        lastMergeAttemptAt: null,
        mergeApprovedAt: null,
        doneAt: null,
        latestEvidenceSummary: null,
        lastAttemptAt: null,
        updatedAt: null,
        ...input,
    }
}

describe('OMC thread intents', () => {
    const baseThread = createThread({
        id: 'approval:01-02',
        kind: 'approval',
        title: '放行 review lane',
        preview: 'Reviewer accepted the work and wants a decision.',
        updatedAt: '2026-04-06T10:00:00.000Z',
        lifecycle: 'pending',
        priority: 'critical',
        tone: 'accent',
        unread: true,
        passive: false,
        refs: [],
        detailSections: [],
        firstMessage: {
            currentStatus: '需要你决定是否继续。',
            background: 'Review 已经完成。',
            whyNow: '这是一个真实边界。',
            suggestedAction: '可以批准 review，或者要求再跑一轮。',
            freeformInvite: '直接回复也可以。',
        },
        quickActions: [],
        statusLabel: '待处理',
    })

    it('treats approval language as review approval before merge is ready', () => {
        const intent = resolveThreadIntent({
            thread: baseThread,
            text: '可以，先放行 review',
            runtime: createRuntime({
                programId: 'omc-default',
                planKey: '01-02',
                planPath: 'plan.md',
                phaseKey: '01-foundation',
                phaseLabel: '01 Foundation',
                column: 'Review',
                loopStatus: 'review',
                attemptCount: 2,
                reviewRequired: true,
                mergeStatus: 'idle',
            }),
            sessionId: 'session-review',
        })

        expect(intent).toEqual({
            kind: 'approve-review',
            planKey: '01-02',
        })
    })

    it('treats merge language as merge approval once review is already approved', () => {
        const intent = resolveThreadIntent({
            thread: baseThread,
            text: '好，直接合并',
            runtime: createRuntime({
                programId: 'omc-default',
                planKey: '01-02',
                planPath: 'plan.md',
                phaseKey: '01-foundation',
                phaseLabel: '01 Foundation',
                column: 'Review',
                loopStatus: 'review',
                attemptCount: 2,
                reviewRequired: false,
                reviewApprovedAt: 123,
                mergeStatus: 'ready',
            }),
            sessionId: 'session-review',
        })

        expect(intent).toEqual({
            kind: 'approve-merge',
            planKey: '01-02',
        })
    })

    it('turns rework language into a resume-loop review reopen', () => {
        const intent = resolveThreadIntent({
            thread: baseThread,
            text: '别合了，再加固一轮',
            runtime: createRuntime({
                programId: 'omc-default',
                planKey: '01-02',
                planPath: 'plan.md',
                phaseKey: '01-foundation',
                phaseLabel: '01 Foundation',
                column: 'Review',
                loopStatus: 'review',
                attemptCount: 2,
                reviewRequired: true,
            }),
            sessionId: 'session-review',
        })

        expect(intent).toEqual({
            kind: 'reopen-review',
            planKey: '01-02',
            action: 'resume_loop',
        })
    })

    it('falls back to sending the directive into the real session when the thread maps to a live attempt', () => {
        const statusThread = createThread({
            ...baseThread,
            id: 'status:01-foundation',
            kind: 'status',
            title: '当前主线',
            tone: 'default',
            passive: true,
        })

        const intent = resolveThreadIntent({
            thread: statusThread,
            text: '把这条线收紧一点，先别扩范围',
            runtime: createRuntime({
                programId: 'omc-default',
                planKey: '01-01',
                planPath: 'plan.md',
                phaseKey: '01-foundation',
                phaseLabel: '01 Foundation',
                column: 'Running',
                loopStatus: 'running',
                attemptCount: 1,
                reviewRequired: false,
            }),
            sessionId: 'session-running',
        })

        expect(intent).toEqual({
            kind: 'send-session-message',
            sessionId: 'session-running',
            text: '把这条线收紧一点，先别扩范围',
        })
    })
})
