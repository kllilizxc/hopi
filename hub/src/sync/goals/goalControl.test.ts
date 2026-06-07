import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../../store'
import { listGoalDecisionTopicsFromDocs } from './goalDecisionStore'
import { createGoalDecisionTopic, requestGoalTaskLane, resolveGoalDecisionTopic } from './goalControl'
import type { SyncEngine } from '../syncEngine'

const tempDirs: string[] = []

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-goal-control-'))
    tempDirs.push(path)
    return path
}

function cleanupTempDirs(): void {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
}

describe('requestGoalTaskLane', () => {
    it('returns the docs-projected goal task view after lane requests update a stale overlay row', () => {
        try {
            const store = new Store(':memory:')
            const namespace = 'default'
            const projectId = 'project-goal-control-lane-request'
            const goalId = 'goal-goal-control-lane-request'
            const goalKey = 'goal-control-lane-request'
            const taskId = 'goal-control-lane-request-task'
            const workspacePath = createTempWorkspace()
            const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
            mkdirSync(goalDir, { recursive: true })
            writeFileSync(join(goalDir, 'todo.yml'), [
                'version: 1',
                'goal:',
                `  goalKey: ${goalKey}`,
                `  goalId: ${goalId}`,
                '  title: Goal control lane request',
                'items:',
                `  - ref: ${taskId}`,
                '    kind: engineering',
                '    status: in_review',
                '    title: Canonical lane request title',
                '    description: Canonical lane request description.'
            ].join('\n'), 'utf8')

            store.projects.createProject({
                id: projectId,
                namespace,
                machineId: 'machine-1',
                name: 'Project',
                defaultWorkspaceId: 'workspace-1'
            })
            store.workspaces.createWorkspace({
                id: 'workspace-1',
                projectId,
                path: workspacePath
            })
            store.goals.createGoal({
                id: goalId,
                projectId,
                namespace,
                goalKey,
                title: 'Goal control lane request'
            })
            store.tasks.createTask({
                id: taskId,
                projectId,
                goalId,
                goalTodoRef: taskId,
                title: 'Stale overlay lane request title',
                description: 'Stale overlay lane request description.',
                status: 'review',
                workflowProfile: 'default',
                blockedReason: 'Retry requested',
                blockedSource: 'merge'
            })

            const realtimeEvents: unknown[] = []
            const ticks: Array<{ namespace: string; projectId: string }> = []
            const engine = {
                handleRealtimeEvent(event: unknown) {
                    realtimeEvents.push(event)
                },
                requestAutoRunTick(requestedNamespace: string, requestedProjectId: string) {
                    ticks.push({ namespace: requestedNamespace, projectId: requestedProjectId })
                }
            } as unknown as Pick<SyncEngine, 'handleRealtimeEvent' | 'requestAutoRunTick'>

            const project = store.projects.getProjectByNamespace(projectId, namespace)
            const goal = store.goals.getGoalByNamespace(goalId, namespace)
            expect(project).toBeTruthy()
            expect(goal).toBeTruthy()

            const result = requestGoalTaskLane({
                store,
                engine,
                namespace,
                project: project!,
                goal: goal!,
                taskId,
                lane: 'planned',
                message: 'Retry after reviewing the blocker.'
            })

            expect(result).not.toBeNull()
            expect(result?.task.title).toBe('Canonical lane request title')
            expect(result?.task.description).toBe('Canonical lane request description.')
            expect(result?.task.status).toBe('planning')

            const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
            expect(todo).toContain(`ref: ${taskId}`)
            expect(todo).toContain('title: Canonical lane request title')
            expect(todo).not.toContain('Stale overlay lane request title')

            expect(ticks).toEqual([{ namespace, projectId }])
            expect(realtimeEvents.some((event) => {
                if (!event || typeof event !== 'object') return false
                const payload = event as { type?: unknown; taskId?: unknown }
                return payload.type === 'task-updated' && payload.taskId === taskId
            })).toBe(true)
        } finally {
            cleanupTempDirs()
        }
    })

    it('keeps the docs-backed task view when a lane request loses the canonical board item mid-flight', () => {
        try {
            const store = new Store(':memory:')
            const namespace = 'default'
            const projectId = 'project-goal-control-lane-request-docs-missing'
            const goalId = 'goal-goal-control-lane-request-docs-missing'
            const goalKey = 'goal-control-lane-request-docs-missing'
            const taskId = 'goal-control-lane-request-docs-missing-task'
            const workspacePath = createTempWorkspace()
            const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
            mkdirSync(goalDir, { recursive: true })
            writeFileSync(join(goalDir, 'todo.yml'), [
                'version: 1',
                'goal:',
                `  goalKey: ${goalKey}`,
                `  goalId: ${goalId}`,
                '  title: Goal control lane request docs missing',
                'items:',
                `  - ref: ${taskId}`,
                '    kind: engineering',
                '    status: in_review',
                '    title: Canonical lane request title',
                '    description: Canonical lane request description.'
            ].join('\n'), 'utf8')

            store.projects.createProject({
                id: projectId,
                namespace,
                machineId: 'machine-1',
                name: 'Project',
                defaultWorkspaceId: 'workspace-1'
            })
            store.workspaces.createWorkspace({
                id: 'workspace-1',
                projectId,
                path: workspacePath
            })
            store.goals.createGoal({
                id: goalId,
                projectId,
                namespace,
                goalKey,
                title: 'Goal control lane request docs missing'
            })
            store.tasks.createTask({
                id: taskId,
                projectId,
                goalId,
                goalTodoRef: taskId,
                title: 'Stale overlay lane request title',
                description: 'Stale overlay lane request description.',
                status: 'review',
                workflowProfile: 'default',
                blockedReason: 'Retry requested',
                blockedSource: 'merge'
            })

            const originalUpdateTaskByNamespace = store.tasks.updateTaskByNamespace.bind(store.tasks)
            store.tasks.updateTaskByNamespace = ((id, requestedNamespace, patch) => {
                const updated = originalUpdateTaskByNamespace(id, requestedNamespace, patch)
                if (updated?.id === taskId) {
                    writeFileSync(join(goalDir, 'todo.yml'), [
                        'version: 1',
                        'goal:',
                        `  goalKey: ${goalKey}`,
                        `  goalId: ${goalId}`,
                        '  title: Goal control lane request docs missing',
                        'items: []'
                    ].join('\n'), 'utf8')
                }
                return updated
            }) as typeof store.tasks.updateTaskByNamespace

            const realtimeEvents: unknown[] = []
            const ticks: Array<{ namespace: string; projectId: string }> = []
            const engine = {
                handleRealtimeEvent(event: unknown) {
                    realtimeEvents.push(event)
                },
                requestAutoRunTick(requestedNamespace: string, requestedProjectId: string) {
                    ticks.push({ namespace: requestedNamespace, projectId: requestedProjectId })
                }
            } as unknown as Pick<SyncEngine, 'handleRealtimeEvent' | 'requestAutoRunTick'>

            const project = store.projects.getProjectByNamespace(projectId, namespace)
            const goal = store.goals.getGoalByNamespace(goalId, namespace)
            expect(project).toBeTruthy()
            expect(goal).toBeTruthy()

            const result = requestGoalTaskLane({
                store,
                engine,
                namespace,
                project: project!,
                goal: goal!,
                taskId,
                lane: 'planned',
                message: 'Retry after reviewing the blocker.'
            })

            expect(result).not.toBeNull()
            expect(result?.task.title).toBe('Canonical lane request title')
            expect(result?.task.description).toBe('Canonical lane request description.')
            expect(result?.task.status).toBe('planning')

            const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
            expect(todo).toContain('items: []')
            expect(todo).not.toContain(`ref: ${taskId}`)
            expect(todo).not.toContain('Stale overlay lane request title')

            expect(ticks).toEqual([{ namespace, projectId }])
            expect(realtimeEvents.some((event) => {
                if (!event || typeof event !== 'object') return false
                const payload = event as { type?: unknown; taskId?: unknown }
                return payload.type === 'task-updated' && payload.taskId === taskId
            })).toBe(true)
        } finally {
            cleanupTempDirs()
        }
    })

    it('rejects lane requests for stale DB-only goal rows that are missing from canonical todo docs', () => {
        try {
            const store = new Store(':memory:')
            const namespace = 'default'
            const projectId = 'project-goal-control-db-only-lane-request'
            const goalId = 'goal-goal-control-db-only-lane-request'
            const goalKey = 'goal-control-db-only-lane-request'
            const taskId = 'db-only-goal-row'
            const workspacePath = createTempWorkspace()
            const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
            mkdirSync(goalDir, { recursive: true })
            writeFileSync(join(goalDir, 'todo.yml'), [
                'version: 1',
                'goal:',
                `  goalKey: ${goalKey}`,
                `  goalId: ${goalId}`,
                '  title: Goal control DB-only lane request',
                'items: []'
            ].join('\n'), 'utf8')

            store.projects.createProject({
                id: projectId,
                namespace,
                machineId: 'machine-1',
                name: 'Project',
                defaultWorkspaceId: 'workspace-1'
            })
            store.workspaces.createWorkspace({
                id: 'workspace-1',
                projectId,
                path: workspacePath
            })
            store.goals.createGoal({
                id: goalId,
                projectId,
                namespace,
                goalKey,
                title: 'Goal control DB-only lane request'
            })
            store.tasks.createTask({
                id: taskId,
                projectId,
                goalId,
                title: 'DB-only stale goal row',
                description: 'Should not become durable board truth.',
                status: 'planning',
                workflowProfile: 'default'
            })

            const project = store.projects.getProjectByNamespace(projectId, namespace)
            const goal = store.goals.getGoalByNamespace(goalId, namespace)
            expect(project).toBeTruthy()
            expect(goal).toBeTruthy()

            const result = requestGoalTaskLane({
                store,
                engine: null,
                namespace,
                project: project!,
                goal: goal!,
                taskId,
                lane: 'planned',
                message: 'Retry the stale DB-only task.'
            })

            expect(result).toBeNull()

            const storedTask = store.tasks.getTaskByNamespace(taskId, namespace)
            expect(storedTask?.goalTodoRef ?? null).toBeNull()
            const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
            expect(todo).toContain('items: []')
            expect(todo).not.toContain(`ref: ${taskId}`)
        } finally {
            cleanupTempDirs()
        }
    })
})

describe('createGoalDecisionTopic', () => {
    it('rejects task-scoped decision topics for stale DB-only goal rows that are missing from canonical todo docs', () => {
        try {
            const store = new Store(':memory:')
            const namespace = 'default'
            const projectId = 'project-goal-control-db-only-decision-topic'
            const goalId = 'goal-goal-control-db-only-decision-topic'
            const goalKey = 'goal-control-db-only-decision-topic'
            const taskId = 'db-only-decision-task'
            const workspacePath = createTempWorkspace()
            const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
            mkdirSync(goalDir, { recursive: true })
            writeFileSync(join(goalDir, 'todo.yml'), [
                'version: 1',
                'goal:',
                `  goalKey: ${goalKey}`,
                `  goalId: ${goalId}`,
                '  title: Goal control DB-only decision topic',
                'items: []'
            ].join('\n'), 'utf8')

            store.projects.createProject({
                id: projectId,
                namespace,
                machineId: 'machine-1',
                name: 'Project',
                defaultWorkspaceId: 'workspace-1'
            })
            store.workspaces.createWorkspace({
                id: 'workspace-1',
                projectId,
                path: workspacePath
            })
            store.goals.createGoal({
                id: goalId,
                projectId,
                namespace,
                goalKey,
                title: 'Goal control DB-only decision topic'
            })
            store.tasks.createTask({
                id: taskId,
                projectId,
                goalId,
                title: 'DB-only stale decision task',
                description: 'Should not become a durable decision-linked todo item.',
                status: 'planning',
                workflowProfile: 'default'
            })

            const project = store.projects.getProjectByNamespace(projectId, namespace)
            const goal = store.goals.getGoalByNamespace(goalId, namespace)
            expect(project).toBeTruthy()
            expect(goal).toBeTruthy()

            const result = createGoalDecisionTopic({
                store,
                engine: null,
                namespace,
                project: project!,
                goal: goal!,
                taskId,
                title: 'Clarify stale DB-only task',
                body: 'Should not create a durable decision topic from DB-only residue.',
                blocking: true
            })

            expect(result.topic.taskId).toBeNull()
            expect(result.blockedTask).toBeNull()
            const storedTask = store.tasks.getTaskByNamespace(taskId, namespace)
            expect(storedTask?.goalTodoRef ?? null).toBeNull()
            const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
            expect(todo).toContain('items: []')
            expect(todo).not.toContain(`ref: ${taskId}`)
            const decisions = readFileSync(join(goalDir, 'decisions.yml'), 'utf8')
            expect(decisions).not.toContain(`taskId: ${taskId}`)
        } finally {
            cleanupTempDirs()
        }
    })

    it('persists the canonical goal todo ref when a caller passes a raw goal task id', () => {
        try {
            const store = new Store(':memory:')
            const namespace = 'default'
            const projectId = 'project-goal-control-decision-topic'
            const goalId = 'goal-goal-control-decision-topic'
            const goalKey = 'goal-control-decision-topic'
            const taskId = 'goal-control-raw-task-id'
            const goalTodoRef = 'goal-control-canonical-ref'
            const workspacePath = createTempWorkspace()
            const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
            mkdirSync(goalDir, { recursive: true })
            writeFileSync(join(goalDir, 'todo.yml'), [
                'version: 1',
                'goal:',
                `  goalKey: ${goalKey}`,
                `  goalId: ${goalId}`,
                '  title: Goal control decision topic',
                'items:',
                `  - ref: ${goalTodoRef}`,
                '    kind: engineering',
                '    status: planned',
                '    title: Canonical decision target',
                '    description: Canonical decision target description.'
            ].join('\n'), 'utf8')

            store.projects.createProject({
                id: projectId,
                namespace,
                machineId: 'machine-1',
                name: 'Project',
                defaultWorkspaceId: 'workspace-1'
            })
            store.workspaces.createWorkspace({
                id: 'workspace-1',
                projectId,
                path: workspacePath
            })
            store.goals.createGoal({
                id: goalId,
                projectId,
                namespace,
                goalKey,
                title: 'Goal control decision topic'
            })
            store.tasks.createTask({
                id: taskId,
                projectId,
                goalId,
                goalTodoRef,
                title: 'Stale overlay decision target',
                description: 'Stale overlay decision target description.',
                status: 'planning'
            })

            const project = store.projects.getProjectByNamespace(projectId, namespace)
            const goal = store.goals.getGoalByNamespace(goalId, namespace)
            expect(project).toBeTruthy()
            expect(goal).toBeTruthy()

            const result = createGoalDecisionTopic({
                store,
                engine: null,
                namespace,
                project: project!,
                goal: goal!,
                taskId,
                title: 'Clarify canonical link',
                body: 'Should the durable decision link use the todo ref?',
                blocking: true
            })

            expect(result.topic.taskId).toBe(goalTodoRef)
            const topics = listGoalDecisionTopicsFromDocs({
                project: project!,
                goal: goal!,
                defaultWorkspace: store.workspaces.getWorkspace('workspace-1')
            })
            expect(topics).toHaveLength(1)
            expect(topics[0]?.taskId).toBe(goalTodoRef)
            const decisions = readFileSync(join(goalDir, 'decisions.yml'), 'utf8')
            expect(decisions).toContain(`taskId: ${goalTodoRef}`)
            expect(decisions).not.toContain(`taskId: ${taskId}`)
        } finally {
            cleanupTempDirs()
        }
    })
})

describe('resolveGoalDecisionTopic', () => {
    it('does not requeue stale DB-only goal rows from legacy decision links', () => {
        try {
            const store = new Store(':memory:')
            const namespace = 'default'
            const projectId = 'project-goal-control-resolve-db-only-decision-topic'
            const goalId = 'goal-goal-control-resolve-db-only-decision-topic'
            const goalKey = 'goal-control-resolve-db-only-decision-topic'
            const taskId = 'db-only-resolve-decision-task'
            const topicId = 'legacy-stale-topic'
            const workspacePath = createTempWorkspace()
            const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
            mkdirSync(goalDir, { recursive: true })
            writeFileSync(join(goalDir, 'todo.yml'), [
                'version: 1',
                'goal:',
                `  goalKey: ${goalKey}`,
                `  goalId: ${goalId}`,
                '  title: Goal control resolve DB-only decision topic',
                'items: []'
            ].join('\n'), 'utf8')
            writeFileSync(join(goalDir, 'decisions.yml'), [
                'version: 1',
                'decisions:',
                `  - id: ${topicId}`,
                `    taskId: ${taskId}`,
                '    title: Legacy stale task decision',
                '    body: Should not requeue a DB-only stale task.',
                '    status: waiting',
                '    blocking: true'
            ].join('\n'), 'utf8')

            store.projects.createProject({
                id: projectId,
                namespace,
                machineId: 'machine-1',
                name: 'Project',
                defaultWorkspaceId: 'workspace-1'
            })
            store.workspaces.createWorkspace({
                id: 'workspace-1',
                projectId,
                path: workspacePath
            })
            store.goals.createGoal({
                id: goalId,
                projectId,
                namespace,
                goalKey,
                title: 'Goal control resolve DB-only decision topic'
            })
            store.tasks.createTask({
                id: taskId,
                projectId,
                goalId,
                title: 'DB-only stale resolve decision task',
                description: 'Should not be requeued from a legacy decision link.',
                status: 'blocked',
                blockedReason: 'Should stay untouched.',
                blockedSource: 'decision',
                workflowProfile: 'default'
            })

            const effect = resolveGoalDecisionTopic({
                store,
                engine: null,
                namespace,
                topicId,
                resolution: 'Decision resolved without a durable todo target.',
                expectedProjectId: projectId,
                expectedGoalId: goalId
            })

            expect(effect).not.toBeNull()
            expect(effect?.requeuedTaskId).toBeNull()
            const storedTask = store.tasks.getTaskByNamespace(taskId, namespace)
            expect(storedTask?.goalTodoRef ?? null).toBeNull()
            expect(storedTask?.status).toBe('blocked')
            expect(storedTask?.blockedSource).toBe('decision')

            const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
            expect(todo).toContain('items: []')
            expect(todo).not.toContain(`ref: ${taskId}`)

            const decisions = readFileSync(join(goalDir, 'decisions.yml'), 'utf8')
            expect(decisions).toContain(`id: ${topicId}`)
            expect(decisions).toContain('status: resolved')
        } finally {
            cleanupTempDirs()
        }
    })
})
