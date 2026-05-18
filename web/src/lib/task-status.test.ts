import { describe, expect, it } from 'vitest'
import type { Task } from '@/types/api'
import { GOAL_TASK_LANES, KANBAN_COLUMNS, getTaskLane, hasTaskDerivedBlocker } from '@/lib/task-status'

function createTask(overrides: Partial<Task> = {}): Task {
    return {
        id: overrides.id ?? 'task-1',
        projectId: overrides.projectId ?? 'project-1',
        goalId: overrides.goalId ?? 'goal-1',
        title: overrides.title ?? 'Inspect state projection',
        description: overrides.description ?? null,
        status: overrides.status ?? 'planned',
        priority: overrides.priority ?? null,
        sortKey: overrides.sortKey ?? 1,
        activeSessionId: overrides.activeSessionId ?? null,
        workspaceId: overrides.workspaceId ?? null,
        agentFlavor: overrides.agentFlavor ?? 'codex',
        permissionMode: overrides.permissionMode ?? null,
        model: overrides.model ?? null,
        modelMode: overrides.modelMode ?? null,
        attachments: overrides.attachments ?? null,
        source: overrides.source ?? null,
        sourceTaskId: overrides.sourceTaskId ?? null,
        contract: overrides.contract ?? null,
        handoff: overrides.handoff ?? null,
        evidence: overrides.evidence ?? null,
        workflowProfile: overrides.workflowProfile ?? 'default',
        workflowPhase: overrides.workflowPhase ?? null,
        subTasks: overrides.subTasks ?? null,
        subTasksUpdatedAt: overrides.subTasksUpdatedAt ?? null,
        worktreeMergedAt: overrides.worktreeMergedAt ?? null,
        worktreeMergeCommit: overrides.worktreeMergeCommit ?? null,
        mergedDiffSnapshot: overrides.mergedDiffSnapshot ?? null,
        mergeRuntime: overrides.mergeRuntime ?? null,
        previewRuntime: overrides.previewRuntime ?? null,
        initRuntime: overrides.initRuntime ?? null,
        createdAt: overrides.createdAt ?? 1,
        updatedAt: overrides.updatedAt ?? 2,
        finishedAt: overrides.finishedAt ?? null,
        archivedAt: overrides.archivedAt ?? null
    }
}

describe('task lane projection', () => {
    it('uses the unified five-lane board order', () => {
        const statuses = KANBAN_COLUMNS.map((column) => column.status)

        expect(statuses).toEqual([...GOAL_TASK_LANES])
        expect(statuses).not.toContain('blocked')
    })

    it('maps legacy planning statuses into planned', () => {
        expect(getTaskLane(createTask({ status: 'planning' }))).toBe('planned')
        expect(getTaskLane(createTask({ status: 'planned' }))).toBe('planned')
    })

    it('projects blocked merge work into the merging lane and keeps blocker state derived', () => {
        const task = createTask({
            status: 'blocked',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'merge-1',
                updatedAt: 20,
                requestedAt: 10,
                startedAt: 15,
                completedAt: 20,
                retryCount: 1,
                failureFingerprint: 'merge-blocked',
                latestNote: 'Merge conflict remains.',
                blockedReason: 'Need manual conflict resolution.'
            }
        })

        expect(getTaskLane(task)).toBe('merging')
        expect(hasTaskDerivedBlocker(task)).toBe(true)
    })

    it('projects blocked preview work back into the in-progress lane', () => {
        const task = createTask({
            status: 'blocked',
            previewRuntime: {
                status: 'blocked',
                sessionId: 'preview-1',
                updatedAt: 30,
                requestedAt: 10,
                startedAt: 20,
                completedAt: 30,
                retryCount: 1,
                failureFingerprint: 'preview-blocked',
                latestNote: 'Preview failed.',
                blockedReason: 'Server exited with code 1'
            }
        })

        expect(getTaskLane(task)).toBe('in_progress')
        expect(hasTaskDerivedBlocker(task)).toBe(true)
    })

    it('treats a succeeded merge runtime as done even before status backfill finishes', () => {
        const task = createTask({
            status: 'in_review',
            mergeRuntime: {
                status: 'succeeded',
                sessionId: 'merge-2',
                updatedAt: 40,
                requestedAt: 10,
                startedAt: 20,
                completedAt: 40,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Merged cleanly.',
                blockedReason: null
            }
        })

        expect(getTaskLane(task)).toBe('done')
    })
})
