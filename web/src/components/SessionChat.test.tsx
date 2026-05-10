import { describe, expect, it } from 'vitest'
import type { Task } from '@/types/api'
import { SESSION_CHAT_SURFACE_CLASS_NAME } from '@/components/SessionChat'
import {
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

describe('SessionChat runtime summaries', () => {
    it('renders the message stream as a raised surface above surrounding project content', () => {
        expect(SESSION_CHAT_SURFACE_CLASS_NAME).toContain('app-shadow-chat-surface')
        expect(SESSION_CHAT_SURFACE_CLASS_NAME).toContain('z-10')
        expect(SESSION_CHAT_SURFACE_CLASS_NAME).toContain('bg-[var(--app-bg)]')
    })

    it('builds merge summaries from durable runtime state', () => {
        const task = createTask({
            status: 'in_review',
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
            status: 'in_review',
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
            status: 'in_review',
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
