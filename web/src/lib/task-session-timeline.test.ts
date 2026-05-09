import { describe, expect, it } from 'vitest'
import type { SessionSummary, Task } from '@/types/api'
import { buildTaskReviewStage, buildTaskSessionTimeline, resolveTaskSessionSelection } from './task-session-timeline'

function createTask(overrides: Partial<Task> = {}): Task {
    const now = 1_700_000_000_000
    return {
        id: overrides.id ?? 'task-1',
        projectId: overrides.projectId ?? 'project-1',
        goalId: overrides.goalId ?? 'goal-1',
        title: overrides.title ?? 'Task',
        description: overrides.description ?? null,
        status: overrides.status ?? 'finished',
        source: overrides.source ?? 'evaluator',
        priority: overrides.priority ?? 'medium',
        sortKey: overrides.sortKey ?? now,
        activeSessionId: overrides.activeSessionId ?? 'generator-session',
        workspaceId: overrides.workspaceId ?? null,
        agentFlavor: overrides.agentFlavor ?? 'codex',
        permissionMode: overrides.permissionMode ?? 'safe-yolo',
        modelMode: overrides.modelMode ?? null,
        model: overrides.model ?? 'gpt-5.5',
        workflowProfile: overrides.workflowProfile ?? 'default',
        workflowPhase: overrides.workflowPhase ?? null,
        contract: overrides.contract ?? null,
        handoff: overrides.handoff ?? null,
        evidence: overrides.evidence ?? null,
        attachments: overrides.attachments ?? [],
        subTasks: overrides.subTasks ?? [],
        previewRuntime: overrides.previewRuntime ?? null,
        mergeRuntime: overrides.mergeRuntime ?? null,
        initRuntime: overrides.initRuntime ?? null,
        worktreeMergedAt: overrides.worktreeMergedAt ?? null,
        worktreeMergeCommit: overrides.worktreeMergeCommit ?? null,
        mergedDiffSnapshot: overrides.mergedDiffSnapshot ?? null,
        archivedAt: overrides.archivedAt ?? null,
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now
    }
}

function createSession(overrides: Partial<SessionSummary> & { id: string; taskId?: string; createdAt: number }): SessionSummary {
    return {
        id: overrides.id,
        active: overrides.active ?? false,
        thinking: overrides.thinking ?? false,
        createdAt: overrides.createdAt,
        activeAt: overrides.activeAt ?? overrides.createdAt,
        updatedAt: overrides.updatedAt ?? overrides.createdAt,
        metadata: overrides.metadata ?? {
            path: '/repo',
            projectId: 'project-1',
            taskId: overrides.taskId ?? 'task-1',
            flavor: 'codex'
        },
        todoProgress: overrides.todoProgress ?? null,
        pendingRequestsCount: overrides.pendingRequestsCount ?? 0,
        modelMode: overrides.modelMode
    }
}

describe('buildTaskSessionTimeline', () => {
    it('filters task sessions by metadata taskId, sorts by creation time, and identifies review fallback sessions', () => {
        const task = createTask()
        const timeline = buildTaskSessionTimeline(task, [
            createSession({ id: 'other-session', taskId: 'other-task', createdAt: 30 }),
            createSession({ id: 'review-session', createdAt: 20 }),
            createSession({ id: 'generator-session', createdAt: 10 })
        ])

        expect(timeline.map((item) => item.session.id)).toEqual(['generator-session', 'review-session'])
        expect(timeline[0]?.roleLabel).toBe('Generator')
        expect(timeline[1]?.roleLabel).toBe('Evaluator')
        expect(timeline[0]?.isActiveTaskSession).toBe(true)
        expect(timeline[1]?.isActiveTaskSession).toBe(false)
    })

    it('prefers explicit session role metadata when available', () => {
        const task = createTask({ status: 'in_review', source: 'manual' })
        const timeline = buildTaskSessionTimeline(task, [
            createSession({
                id: 'review-session',
                createdAt: 20,
                metadata: {
                    path: '/repo',
                    projectId: 'project-1',
                    taskId: 'task-1',
                    flavor: 'codex',
                    hopiTaskRole: 'evaluator'
                }
            })
        ])

        expect(timeline[0]?.roleLabel).toBe('Evaluator')
    })

    it('defaults session selection to the latest task session when no current selection exists', () => {
        const task = createTask({ activeSessionId: 'generator-session' })
        const timeline = buildTaskSessionTimeline(task, [
            createSession({ id: 'review-session', createdAt: 20 }),
            createSession({ id: 'generator-session', createdAt: 10 })
        ])

        expect(resolveTaskSessionSelection(timeline, null)).toBe('review-session')
    })

    it('falls back to the active task session before timeline sessions are loaded', () => {
        const task = createTask({ activeSessionId: 'generator-session' })

        expect(resolveTaskSessionSelection([], null, task.activeSessionId)).toBe('generator-session')
    })

    it('includes the merge runtime session and defaults to it when it is the latest session', () => {
        const task = createTask({
            activeSessionId: 'generator-session',
            mergeRuntime: {
                status: 'retrying',
                sessionId: 'merge-session',
                updatedAt: 40,
                requestedAt: 30,
                startedAt: 31,
                completedAt: null,
                retryCount: 1,
                failureFingerprint: 'merge_conflict:test',
                latestNote: 'Platform merge found conflicts. Resolving them in the linked session before retry.',
                blockedReason: null
            }
        })
        const timeline = buildTaskSessionTimeline(task, [
            createSession({
                id: 'merge-session',
                createdAt: 30,
                metadata: {
                    path: '/repo',
                    projectId: 'project-1',
                    flavor: 'codex'
                }
            }),
            createSession({ id: 'generator-session', createdAt: 10 })
        ])

        expect(timeline.map((item) => item.session.id)).toEqual(['generator-session', 'merge-session'])
        expect(timeline.map((item) => item.roleLabel)).toEqual(['Generator', 'Merge'])
        expect(timeline.map((item) => item.isMergeRuntimeSession)).toEqual([false, true])
        expect(resolveTaskSessionSelection(timeline, null)).toBe('merge-session')
    })

    it('prefers a merge runtime session before the session list includes it', () => {
        const task = createTask({
            activeSessionId: 'generator-session',
            mergeRuntime: {
                status: 'running',
                sessionId: 'merge-session',
                updatedAt: 40,
                requestedAt: 30,
                startedAt: 31,
                completedAt: null,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: null,
                blockedReason: null
            }
        })
        const timeline = buildTaskSessionTimeline(task, [
            createSession({ id: 'review-session', createdAt: 20 }),
            createSession({ id: 'generator-session', createdAt: 10 })
        ])

        expect(resolveTaskSessionSelection(timeline, null, task.activeSessionId, task.mergeRuntime?.sessionId)).toBe('merge-session')
    })

    it('keeps the selected task session while it still belongs to the task timeline', () => {
        const task = createTask({ activeSessionId: 'generator-session' })
        const timeline = buildTaskSessionTimeline(task, [
            createSession({ id: 'review-session', createdAt: 20 }),
            createSession({ id: 'generator-session', createdAt: 10 })
        ])

        expect(resolveTaskSessionSelection(timeline, 'generator-session')).toBe('generator-session')
    })
})

describe('buildTaskReviewStage', () => {
    it('reports review queued when an in-review task has no evaluator session yet', () => {
        const task = createTask({ status: 'in_review', source: 'manual' })
        const timeline = buildTaskSessionTimeline(task, [
            createSession({
                id: 'generator-session',
                createdAt: 10,
                metadata: {
                    path: '/repo',
                    projectId: 'project-1',
                    taskId: 'task-1',
                    flavor: 'codex',
                    hopiTaskRole: 'generator'
                }
            })
        ])

        expect(buildTaskReviewStage(task, timeline)).toEqual({
            state: 'queued',
            evaluatorSessionId: null
        })
    })

    it('reports evaluator running when the review session is active or thinking', () => {
        const task = createTask({ status: 'in_review', source: 'manual' })
        const timeline = buildTaskSessionTimeline(task, [
            createSession({
                id: 'generator-session',
                createdAt: 10,
                metadata: {
                    path: '/repo',
                    projectId: 'project-1',
                    taskId: 'task-1',
                    flavor: 'codex',
                    hopiTaskRole: 'generator'
                }
            }),
            createSession({
                id: 'review-session',
                createdAt: 20,
                active: true,
                thinking: true,
                metadata: {
                    path: '/repo',
                    projectId: 'project-1',
                    taskId: 'task-1',
                    flavor: 'codex',
                    hopiTaskRole: 'evaluator'
                }
            })
        ])

        expect(buildTaskReviewStage(task, timeline)).toEqual({
            state: 'running',
            evaluatorSessionId: 'review-session'
        })
    })

    it('reports review result pending when the evaluator session is inactive but the task is still in review', () => {
        const task = createTask({ status: 'in_review', source: 'manual' })
        const timeline = buildTaskSessionTimeline(task, [
            createSession({
                id: 'review-session',
                createdAt: 20,
                active: false,
                thinking: false,
                metadata: {
                    path: '/repo',
                    projectId: 'project-1',
                    taskId: 'task-1',
                    flavor: 'codex',
                    hopiTaskRole: 'evaluator'
                }
            })
        ])

        expect(buildTaskReviewStage(task, timeline)).toEqual({
            state: 'result_pending',
            evaluatorSessionId: 'review-session'
        })
    })

    it('does not report a review stage after the task leaves review', () => {
        const task = createTask({ status: 'finished', source: 'evaluator' })
        const timeline = buildTaskSessionTimeline(task, [
            createSession({
                id: 'review-session',
                createdAt: 20,
                metadata: {
                    path: '/repo',
                    projectId: 'project-1',
                    taskId: 'task-1',
                    flavor: 'codex',
                    hopiTaskRole: 'evaluator'
                }
            })
        ])

        expect(buildTaskReviewStage(task, timeline)).toBeNull()
    })

    it('reports merge retrying after merge conflict repair starts', () => {
        const task = createTask({
            status: 'in_review',
            source: 'evaluator',
            mergeRuntime: {
                status: 'retrying',
                sessionId: 'merge-session',
                updatedAt: 40,
                requestedAt: 30,
                startedAt: 31,
                completedAt: null,
                retryCount: 1,
                failureFingerprint: 'merge_conflict:test',
                latestNote: 'Platform merge found conflicts. Resolving them in the linked session before retry.',
                blockedReason: null
            }
        })
        const timeline = buildTaskSessionTimeline(task, [
            createSession({
                id: 'merge-session',
                createdAt: 30,
                active: true,
                thinking: true,
                metadata: {
                    path: '/repo',
                    projectId: 'project-1',
                    taskId: 'task-1',
                    flavor: 'codex',
                    hopiTaskRole: 'evaluator'
                }
            })
        ])

        expect(timeline[0]?.roleLabel).toBe('Merge')
        expect(buildTaskReviewStage(task, timeline)).toEqual({
            state: 'merge_retrying',
            evaluatorSessionId: null,
            mergeSessionId: 'merge-session',
            retryCount: 1,
            latestNote: 'Platform merge found conflicts. Resolving them in the linked session before retry.',
            blockedReason: null
        })
    })

    it('reports merge blocked when auto-merge needs manual intervention', () => {
        const task = createTask({
            status: 'in_review',
            source: 'evaluator',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'merge-session',
                updatedAt: 40,
                requestedAt: 30,
                startedAt: 31,
                completedAt: null,
                retryCount: 2,
                failureFingerprint: 'merge_conflict:test',
                latestNote: 'Auto-merge blocked: Merge conflicts detected; manual resolution required.',
                blockedReason: 'Merge conflicts detected; manual resolution required.'
            }
        })
        const timeline = buildTaskSessionTimeline(task, [
            createSession({
                id: 'merge-session',
                createdAt: 30,
                active: false,
                thinking: false,
                metadata: {
                    path: '/repo',
                    projectId: 'project-1',
                    taskId: 'task-1',
                    flavor: 'codex'
                }
            })
        ])

        expect(buildTaskReviewStage(task, timeline)).toEqual({
            state: 'merge_blocked',
            evaluatorSessionId: null,
            mergeSessionId: 'merge-session',
            retryCount: 2,
            latestNote: 'Auto-merge blocked: Merge conflicts detected; manual resolution required.',
            blockedReason: 'Merge conflicts detected; manual resolution required.'
        })
    })
})
