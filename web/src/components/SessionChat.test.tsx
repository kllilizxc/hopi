import { describe, expect, it } from 'vitest'
import type { Session, Task } from '@/types/api'
import type { NormalizedMessage } from '@/chat/types'
import {
    SESSION_CHAT_SURFACE_CLASS_NAME,
    shouldQuerySessionMergeState,
    shouldShowContinueActionForTask,
    shouldTreatSessionAsRunningFallback,
    shouldTreatSessionThinkingAsRunning
} from '@/components/SessionChat'
import {
    buildTaskBlockedStatusSummary,
    buildInitStatusSummary,
    buildMergeRuntimeSummary,
    buildPreviewStatusSummary,
    buildRecoveredBlockedMergeSummary,
    isActiveMergeRuntimeStatus,
    shouldShowInitRuntimeInSession,
    shouldShowMergeActionButton,
    shouldTreatBlockedMergeAsRecoveredSuccess
} from '@/lib/task-action-runtime'

function createTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'task-1',
        projectId: 'project-1',
        title: 'Init summary task',
        status: 'in_progress',
        workflowProfile: 'default',
        activeSessionId: 'session-1',
        createdAt: 1,
        updatedAt: 1,
        ...overrides,
    }
}

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadata: null,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 1,
        ...overrides,
    } as Session
}

function createUserMessage(createdAt: number): NormalizedMessage {
    return {
        id: `message-${createdAt}`,
        localId: `local-${createdAt}`,
        role: 'user',
        createdAt,
        isSidechain: false,
        content: { type: 'text', text: 'continue' },
        meta: { sentFrom: 'webapp' }
    }
}

describe('SessionChat runtime summaries', () => {
    it('renders the message stream as a raised surface above surrounding project content', () => {
        expect(SESSION_CHAT_SURFACE_CLASS_NAME).toContain('app-shadow-chat-surface')
        expect(SESSION_CHAT_SURFACE_CLASS_NAME).toContain('z-10')
        expect(SESSION_CHAT_SURFACE_CLASS_NAME).toContain('bg-[var(--app-bg)]')
    })

    it('does not keep Goal Assistant controllers loading via the runner fallback', () => {
        const session = createSession({
            metadata: {
                path: '/repo',
                host: 'localhost',
                startedBy: 'runner',
                startedFromRunner: true,
                hopiController: true,
                projectId: 'project-1',
                goalId: 'goal-1'
            }
        })

        expect(shouldTreatSessionAsRunningFallback(session, [createUserMessage(Date.now() - 1_000)])).toBe(false)
    })

    it('keeps the runner fallback for task sessions that have not reported ready yet', () => {
        const session = createSession({
            metadata: {
                path: '/repo',
                host: 'localhost',
                startedBy: 'runner',
                startedFromRunner: true,
                projectId: 'project-1',
                taskId: 'task-1'
            }
        })

        expect(shouldTreatSessionAsRunningFallback(session, [createUserMessage(Date.now() - 1_000)])).toBe(true)
    })

    it('does not keep detached old task sessions loading when another active session owns the task', () => {
        const session = createSession({
            id: 'old-session',
            thinking: true,
            metadata: {
                path: '/repo',
                host: 'localhost',
                projectId: 'project-1',
                taskId: 'task-1'
            }
        })

        expect(shouldTreatSessionThinkingAsRunning(session, { activeSessionId: 'new-session' }, false)).toBe(false)
    })

    it('builds merge summaries from durable runtime state', () => {
        const task = createTask({
            status: 'blocked',
            worktreeMergeCommit: 'abc123',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 2,
                failureFingerprint: 'merge:abc123',
                latestNote: 'Same blocker repeated with no repo progress: merge conflict. Resolve the repo blocker, then retry merge.',
                blockedReason: 'merge conflict'
            }
        })

        const summary = buildMergeRuntimeSummary(task, task.mergeRuntime)

        expect(summary).toMatchObject({
            title: 'Merge 受阻（已重试 2 次）',
            tone: 'error'
        })
        expect(summary?.detail).toContain('retry merge')
    })

    it('keeps retry merge action visible after a merge-blocked task stays on the review lane', () => {
        const task = createTask({
            status: 'review',
            blockedSource: 'merge',
            blockedReason: 'merge conflict',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 2,
                failureFingerprint: 'merge:abc123',
                latestNote: 'Auto-merge blocked: merge conflict.',
                blockedReason: 'merge conflict'
            }
        })

        expect(shouldShowMergeActionButton({
            task,
            hasActiveMergeRuntime: false,
            mergeRuntimeStatus: task.mergeRuntime?.status,
            canStartMerge: false
        })).toBe(true)
    })

    it('queries merge state for goal tasks from the canonical review lane, not raw status aliases', () => {
        const task = createTask({
            status: 'review',
            goalCanonicalStatus: 'in_review'
        })

        expect(shouldQuerySessionMergeState(task, false)).toBe(true)
        expect(shouldQuerySessionMergeState(task, true)).toBe(false)
    })

    it('shows continue for goal tasks from the canonical review lane, not raw status aliases', () => {
        const task = createTask({
            status: 'review',
            goalCanonicalStatus: 'in_review'
        })

        expect(shouldShowContinueActionForTask(task, {
            hasPendingRequests: false,
            effectiveIsRunning: false
        })).toBe(true)
        expect(shouldShowContinueActionForTask(task, {
            hasPendingRequests: true,
            effectiveIsRunning: false
        })).toBe(false)
    })

    it('keeps blocked summaries scoped to review when only lane-preserving blocker metadata remains', () => {
        const task = createTask({
            status: 'review',
            blockedReason: 'Waiting for evaluator follow-up',
            blockedSource: null,
            mergeRuntime: null,
            previewRuntime: null,
            initRuntime: null
        })

        expect(buildTaskBlockedStatusSummary(task)).toEqual({
            title: 'Review 受阻',
            detail: 'Waiting for evaluator follow-up',
            tone: 'error'
        })
    })

    it('describes conflict repair retrying state as agent work, not generic loading', () => {
        const task = createTask({
            status: 'in_review',
            mergeRuntime: {
                status: 'retrying',
                sessionId: 'session-1',
                updatedAt: 30,
                requestedAt: 10,
                startedAt: 20,
                completedAt: null,
                retryCount: 3,
                failureFingerprint: 'merge_conflict:test',
                latestNote: 'Platform merge found conflicts. Resolving them in the linked session before retry.',
                blockedReason: null
            }
        })

        const summary = buildMergeRuntimeSummary(task, task.mergeRuntime)

        expect(summary).toMatchObject({
            title: 'Merge 冲突修复中（已重试 3 次）',
            detail: '已把冲突交给 linked session 里的 agent 修复；完成后 HOPI 会自动重试 merge。',
            tone: 'info',
            busy: true
        })
    })

    it('keeps retry merge action visible after a canceled merge runtime', () => {
        const task = createTask({
            status: 'in_review',
            mergeRuntime: {
                status: 'canceled',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Merge canceled from the task action.',
                blockedReason: null
            }
        })

        expect(isActiveMergeRuntimeStatus(task.mergeRuntime?.status)).toBe(false)
        expect(shouldShowMergeActionButton({
            task,
            hasActiveMergeRuntime: false,
            mergeRuntimeStatus: task.mergeRuntime?.status,
            canStartMerge: false
        })).toBe(true)
    })

    it('treats blocked merge as recovered success when target already contains the task', () => {
        const task = createTask({
            status: 'blocked',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 1,
                failureFingerprint: 'merge:verification',
                latestNote: 'Merge finished, but repo-truth verification failed.',
                blockedReason: 'Base repository has uncommitted changes; commit/stash first'
            }
        })
        const mergeState = {
            ok: true as const,
            canMerge: false,
            reason: 'already_merged' as const,
            targetBranch: 'main',
            sourceBranch: 'task-branch',
            hasWorkingTreeChanges: false,
            committedChangedCount: 0,
            mergedAt: null,
            mergeCommit: null,
            error: null
        }

        expect(shouldTreatBlockedMergeAsRecoveredSuccess(task.mergeRuntime, mergeState)).toBe(true)
        expect(shouldShowMergeActionButton({
            task,
            hasActiveMergeRuntime: false,
            mergeRuntimeStatus: task.mergeRuntime?.status,
            canStartMerge: false
        })).toBe(true)
        expect(buildRecoveredBlockedMergeSummary(task.mergeRuntime, mergeState)).toEqual({
            title: 'Merge 已完成',
            detail: '目标分支已包含当前任务变更。',
            tone: 'success'
        })
    })

    it('keeps blocked merge visible when the source branch has no committed changes', () => {
        const task = createTask({
            status: 'blocked',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 1,
                failureFingerprint: 'merge:no_changes',
                latestNote: 'Auto-merge blocked: No committed changes are waiting to merge.',
                blockedReason: 'No committed changes are waiting to merge.'
            }
        })
        const mergeState = {
            ok: true as const,
            canMerge: false,
            reason: 'no_changes' as const,
            targetBranch: 'main',
            sourceBranch: 'task-branch',
            hasWorkingTreeChanges: false,
            committedChangedCount: 0,
            mergedAt: null,
            mergeCommit: null,
            error: null
        }

        expect(shouldTreatBlockedMergeAsRecoveredSuccess(task.mergeRuntime, mergeState)).toBe(false)
        expect(buildRecoveredBlockedMergeSummary(task.mergeRuntime, mergeState)).toBeNull()
    })

    it('prefers live ready preview state over stale waiting runtime', () => {
        const task = createTask({
            previewRuntime: {
                status: 'waiting',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: null,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Preview is booting and waiting to report ready.',
                blockedReason: null
            }
        })

        const summary = buildPreviewStatusSummary(task.previewRuntime, {
            active: true,
            status: 'ready',
            taskId: task.id,
            sessionId: 'session-1',
            url: 'http://localhost:3000',
            updatedAt: 25,
            logTail: ['stdout: ready']
        })

        expect(summary).toEqual({
            title: 'Preview 已就绪',
            detail: '服务已就绪，可直接打开链接。',
            tone: 'success',
            url: 'http://localhost:3000'
        })
    })

    it('builds preview ready summaries from durable runtime state and live preview data', () => {
        const task = createTask({
            previewRuntime: {
                status: 'ready',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: null,
                retryCount: 1,
                failureFingerprint: null,
                latestNote: 'Preview is ready at http://localhost:3000.',
                blockedReason: null
            }
        })

        const summary = buildPreviewStatusSummary(task.previewRuntime, {
            active: true,
            status: 'ready',
            taskId: task.id,
            sessionId: 'session-1',
            url: 'http://localhost:3000',
            updatedAt: 20,
            logTail: []
        })

        expect(summary).toEqual({
            title: 'Preview 已就绪',
            detail: '服务已就绪，可直接打开链接。',
            tone: 'success',
            url: 'http://localhost:3000'
        })
    })

    it('builds blocked init summaries from durable task runtime state', () => {
        const task = createTask({
            initRuntime: {
                status: 'blocked',
                sessionId: 'session-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 20,
                retryCount: 1,
                failureFingerprint: 'init:abc123',
                latestNote: 'Same blocker repeated with no repo progress: npm install failed. Fix dependency mirror, then retry init.',
                blockedReason: 'npm install failed'
            }
        })

        const summary = buildInitStatusSummary(task)

        expect(summary).toMatchObject({
            title: 'Init 受阻（已重试 1 次）',
            tone: 'error'
        })
        expect(summary?.detail).toContain('Fix dependency mirror, then retry init.')
    })

    it('surfaces runner recovery waits as auto-resuming infra holds', () => {
        const task = createTask({
            status: 'in_review',
            initRuntime: {
                status: 'waiting',
                sessionId: null,
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 11,
                completedAt: null,
                retryCount: 0,
                failureFingerprint: 'start:runner_offline',
                latestNote: 'Runner 当前离线。HOPI 会在 machine runner 恢复后自动重试。',
                blockedReason: 'Runner offline',
                failure: {
                    code: 'runner_offline',
                    message: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
                    blockedReason: 'Runner offline',
                    retry: {
                        count: 0,
                        action: 'wait_then_retry_start',
                        available: true
                    }
                }
            }
        })

        const summary = buildInitStatusSummary(task)

        expect(summary).toEqual({
            title: '等待 Runner 恢复',
            detail: 'Runner 当前离线。HOPI 会在 machine runner 恢复后自动重试。',
            tone: 'info',
            busy: true
        })
    })

    it('marks running init as visible only for the linked session', () => {
        const task = createTask({
            initRuntime: {
                status: 'running',
                sessionId: 'session-1',
                updatedAt: 12,
                requestedAt: 10,
                startedAt: 11,
                completedAt: null,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Running .hopi/init.sh before kickoff.',
                blockedReason: null
            }
        })

        expect(shouldShowInitRuntimeInSession(task, 'session-1')).toBe(true)
        expect(shouldShowInitRuntimeInSession(task, 'session-2')).toBe(false)
        expect(buildInitStatusSummary(task)).toMatchObject({
            title: 'Init 进行中',
            busy: true,
            tone: 'info'
        })
    })

    it('rehydrates success summaries on task re-entry without transcript lookup', () => {
        const task = createTask({
            initRuntime: {
                status: 'succeeded',
                sessionId: 'session-1',
                updatedAt: 30,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 30,
                retryCount: 1,
                failureFingerprint: null,
                latestNote: 'Init repair succeeded; kickoff resumed.',
                blockedReason: null
            }
        })

        const summary = buildInitStatusSummary(task)

        expect(shouldShowInitRuntimeInSession(task, 'session-1')).toBe(false)
        expect(summary).toEqual({
            title: 'Init 已完成',
            detail: 'Init repair succeeded; kickoff resumed.',
            tone: 'success'
        })
    })

    it('shows bootstrap scaffold summaries as informational instead of completed init', () => {
        const task = createTask({
            source: 'project_init',
            initRuntime: {
                status: 'succeeded',
                sessionId: 'session-1',
                updatedAt: 30,
                requestedAt: 10,
                startedAt: 11,
                completedAt: 30,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Bootstrap task skipped setup preflight so it can create or repair `.hopi/actions.yaml`. Starter scaffold written.',
                blockedReason: null
            }
        })

        expect(buildInitStatusSummary(task)).toEqual({
            title: 'Bootstrap scaffold 已写入',
            detail: 'Bootstrap task skipped setup preflight so it can create or repair `.hopi/actions.yaml`. Starter scaffold written.',
            tone: 'info'
        })
    })
})
