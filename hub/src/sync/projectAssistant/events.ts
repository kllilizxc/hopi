import type { Store, StoredGoalDecisionTopic, StoredSession, StoredTask } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { prependTaskHandoffDecisionContext } from '../goals/decisionHandoff'

export function emitTaskUpdated(options: {
    engine: SyncEngine | null | undefined
    namespace: string
    task: StoredTask
}): void {
    options.engine?.handleRealtimeEvent?.({
        type: 'task-updated',
        taskId: options.task.id,
        projectId: options.task.projectId,
        namespace: options.namespace,
        data: { taskId: options.task.id }
    })
}

export function emitProjectUpdated(options: {
    engine: SyncEngine | null | undefined
    namespace: string
    projectId: string
}): void {
    options.engine?.handleRealtimeEvent?.({
        type: 'project-updated',
        projectId: options.projectId,
        namespace: options.namespace,
        data: { projectId: options.projectId }
    })
}

export function emitAssistantSessionUpdated(options: {
    engine: SyncEngine | null | undefined
    namespace: string
    projectId: string
    session: StoredSession
}): void {
    options.engine?.handleRealtimeEvent?.({
        type: 'session-updated',
        sessionId: options.session.id,
        projectId: options.projectId,
        namespace: options.namespace,
        data: options.session
    })
}

export function applyResolvedDecisionTopicState(options: {
    store: Store
    engine: SyncEngine | null | undefined
    namespace: string
    topic: StoredGoalDecisionTopic
}): void {
    const remainingBlockingGoalTopics = options.topic.blocking
        ? options.store.goalDecisionTopics
            .listByGoalAndNamespace(options.topic.goalId, options.namespace)
            .filter((candidate) => candidate.blocking && candidate.status === 'waiting')
        : []

    if (options.topic.blocking && options.topic.taskId) {
        const stillBlocked = remainingBlockingGoalTopics
            .some((candidate) => (
                candidate.taskId === options.topic.taskId &&
                candidate.blocking &&
                candidate.status === 'waiting'
            ))
        if (!stillBlocked) {
            const task = options.store.tasks.getTaskByNamespace(options.topic.taskId, options.namespace)
            if (task) {
                const plannedTask = options.store.tasks.updateTaskByNamespace(task.id, options.namespace, {
                    status: task.status === 'blocked' ? 'planned' : task.status,
                    handoff: prependTaskHandoffDecisionContext(task, options.topic)
                })
                if (plannedTask) {
                    emitTaskUpdated({
                        engine: options.engine,
                        namespace: options.namespace,
                        task: plannedTask
                    })
                }
            }
        }
    }

    if (options.topic.blocking && remainingBlockingGoalTopics.length === 0) {
        const goal = options.store.goals.getGoalByNamespace(options.topic.goalId, options.namespace)
        if (goal?.status === 'blocked') {
            options.store.goals.updateGoalByNamespace(goal.id, options.namespace, {
                status: 'active'
            })
        }
    }

    emitProjectUpdated({
        engine: options.engine,
        namespace: options.namespace,
        projectId: options.topic.projectId
    })
}
