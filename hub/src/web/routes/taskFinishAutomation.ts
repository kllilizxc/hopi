import { existsSync } from 'node:fs'
import type { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { getDocsRoot, getGoalDocPath, getGoalTodoPath } from '../../sync/goals/goalDocPaths'
import { upsertGoalTodoTaskState } from '../../sync/goals/goalTodo'
import {
    getTaskByNamespaceOrGoalTodoProjection,
    materializeGoalTodoTaskOverlayForWrite
} from '../../sync/goals/goalTodoProjection'
import { runImprovementsScan, selectLatestActiveProjectSession } from '../../sync/improvementsScan'
import { KeyedMutex } from '../../utils/keyedMutex'

const improvementsScanMutex = new KeyedMutex()

function hasDocsBackedGoalState(options: {
    docsRoot: string | null
    goalKey: string
}): boolean {
    if (!options.docsRoot) {
        return true
    }
    return existsSync(getGoalDocPath(options.docsRoot, options.goalKey))
        || existsSync(getGoalTodoPath(options.docsRoot, options.goalKey))
}

function resolveWritableFinishedTask(options: {
    store: Store
    namespace: string
    taskId: string
}) {
    const materialized = materializeGoalTodoTaskOverlayForWrite({
        store: options.store,
        namespace: options.namespace,
        taskId: options.taskId
    })
    if (materialized) {
        return materialized
    }

    const stored = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!stored || !stored.goalId) {
        return stored
    }

    const project = options.store.projects.getProjectByNamespace(stored.projectId, options.namespace)
    if (!project) {
        return null
    }
    const defaultWorkspace = project.defaultWorkspaceId
        ? options.store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : options.store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
    if (getDocsRoot(defaultWorkspace)) {
        return null
    }

    return stored
}

function getProjectedFinishedTaskRuntimeView(options: {
    store: Store
    namespace: string
    task: ReturnType<typeof resolveWritableFinishedTask>
}) {
    if (!options.task || !options.task.goalId) {
        return options.task
    }

    return getTaskByNamespaceOrGoalTodoProjection({
        store: options.store,
        namespace: options.namespace,
        taskId: options.task.goalTodoRef?.trim() || options.task.id
    })
}

export async function handleTaskMovedToFinished(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
    preferredLocale?: string
}): Promise<void> {
    const storedTask = resolveWritableFinishedTask(options)
    if (!storedTask || (storedTask.status !== 'done' && storedTask.status !== 'finished') || storedTask.archivedAt) {
        return
    }
    let task = getProjectedFinishedTaskRuntimeView({
        store: options.store,
        namespace: options.namespace,
        task: storedTask
    }) ?? storedTask

    const project = options.store.projects.getProjectByNamespace(task.projectId, options.namespace)
    if (!project) {
        return
    }

    if (task.goalId && task.goalTodoRef) {
        const goal = options.store.goals.getGoalByNamespace(task.goalId, options.namespace)
        const defaultWorkspace = project.defaultWorkspaceId
            ? options.store.workspaces.getWorkspace(project.defaultWorkspaceId)
            : options.store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
        const docsRoot = getDocsRoot(defaultWorkspace)
        const goalIsDocsBacked = goal
            && goal.projectId === project.id
            && hasDocsBackedGoalState({
                docsRoot,
                goalKey: goal.goalKey
            })
        if (goalIsDocsBacked) {
            const projectedTask = getProjectedFinishedTaskRuntimeView({
                store: options.store,
                namespace: options.namespace,
                task: storedTask
            })
            if (!projectedTask) {
                return
            }
            task = projectedTask
            const projectedTodoRef = projectedTask.goalTodoRef?.trim() || projectedTask.id
            upsertGoalTodoTaskState({
                project,
                goal,
                defaultWorkspace,
                taskId: projectedTodoRef,
                status: 'done',
                tag: 'accepted',
                taskKind: task.source === 'planner' || task.source === 'radar' ? 'planning' : 'engineering',
                title: task.title,
                body: task.description,
                blocked: null,
                event: {
                    writer: 'task-finish-automation',
                    action: 'finish_task_completed',
                    reason: 'Finished task moved the todo item into done during post-finish automation.',
                    metadata: {
                        source: 'handleTaskMovedToFinished',
                        taskId: task.id
                    }
                }
            })
        }
    }

    const goal = task.goalId
        ? options.store.goals.getGoalByNamespace(task.goalId, options.namespace)
        : null
    const defaultWorkspace = project.defaultWorkspaceId
        ? options.store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : options.store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
    const docsRoot = getDocsRoot(defaultWorkspace)
    const allowGoalFollowUps = !task.goalId || !goal || (
        goal.projectId === project.id
        && hasDocsBackedGoalState({
            docsRoot,
            goalKey: goal.goalKey
        })
    )

    if (project.improvementsEnabled && allowGoalFollowUps) {
        const scanKey = `${options.namespace}:${project.id}`
        await improvementsScanMutex.runExclusive(scanKey, async () => {
            const currentPending = options.store.tasks.countPendingImprovementsTasks(project.id, options.namespace)
            const maxPending = project.improvementsMaxPendingTasks ?? 5
            const remaining = Math.max(0, maxPending - currentPending)

            if (remaining <= 0) {
                options.engine.handleRealtimeEvent({
                    type: 'toast',
                    namespace: options.namespace,
                    data: {
                        title: 'Improvements scan',
                        body: `Skipped (limit ${maxPending} reached)`,
                        sessionId: '',
                        url: ''
                    }
                })
            } else {
                const preferredSession = task.activeSessionId
                    ? options.engine.getSessionByNamespace(task.activeSessionId, options.namespace)
                    : null
                const fallbackSession = selectLatestActiveProjectSession({
                    engine: options.engine,
                    namespace: options.namespace,
                    projectId: project.id
                })
                const targetSessionId = (preferredSession?.active ? preferredSession.id : null)
                    ?? (fallbackSession?.active ? fallbackSession.id : null)

                if (!targetSessionId) {
                    options.engine.handleRealtimeEvent({
                        type: 'toast',
                        namespace: options.namespace,
                        data: {
                            title: 'Improvements scan',
                            body: 'Skipped (no active session available)',
                            sessionId: '',
                            url: ''
                        }
                    })
                } else {
                    const result = await runImprovementsScan({
                        store: options.store,
                        engine: options.engine,
                        namespace: options.namespace,
                        project: {
                            id: project.id,
                            name: project.name,
                            improvementsMaxPendingTasks: maxPending,
                            agentOutputLanguage: project.agentOutputLanguage
                        },
                        finishedTask: task,
                        targetSessionId,
                        maxToCreate: remaining,
                        preferredLocale: options.preferredLocale
                    })

                    options.store.projects.updateProject(project.id, options.namespace, {
                        lastImprovementsAt: Date.now()
                    })

                    if (result.ok) {
                        options.engine.handleRealtimeEvent({
                            type: 'toast',
                            namespace: options.namespace,
                            data: {
                                title: 'Improvements scan',
                                body: result.createdTaskIds.length > 0
                                    ? `Created ${result.createdTaskIds.length} task(s)`
                                    : 'No suggestions',
                                sessionId: '',
                                url: ''
                            }
                        })
                    } else {
                        const raw = result.rawAssistantText ? ` Raw: ${result.rawAssistantText.slice(0, 500)}` : ''
                        options.engine.handleRealtimeEvent({
                            type: 'toast',
                            namespace: options.namespace,
                            data: {
                                title: 'Improvements scan failed',
                                body: `${result.error}${raw}`,
                                sessionId: '',
                                url: ''
                            }
                        })
                    }
                }
            }
        })
    }

    const latestStoredTask = resolveWritableFinishedTask(options)
    if (!latestStoredTask || latestStoredTask.archivedAt || (latestStoredTask.status !== 'done' && latestStoredTask.status !== 'finished')) {
        return
    }
    const latestTask = latestStoredTask.goalId
        ? getProjectedFinishedTaskRuntimeView({
            store: options.store,
            namespace: options.namespace,
            task: latestStoredTask
        })
        : latestStoredTask
    if (!latestTask) {
        return
    }

    // Keep finished tasks visible in the board; only stop the linked session to free resources.
    if (latestTask.activeSessionId) {
        try {
            await options.engine.archiveSession(latestTask.activeSessionId)
        } catch {
        }
    }
}
