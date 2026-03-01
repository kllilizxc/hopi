import type { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { runImprovementsScan, selectLatestActiveProjectSession } from '../../sync/improvementsScan'
import { KeyedMutex } from '../../utils/keyedMutex'

const improvementsScanMutex = new KeyedMutex()

export async function handleTaskMovedToFinished(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
    preferredLocale?: string
}): Promise<void> {
    const task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!task || task.status !== 'finished' || task.archivedAt) {
        return
    }

    const project = options.store.projects.getProjectByNamespace(task.projectId, options.namespace)
    if (!project) {
        return
    }

    if (project.improvementsEnabled) {
        const scanKey = `${options.namespace}:${project.id}`
        await improvementsScanMutex.runExclusive(scanKey, async () => {
            const currentGenerated = options.store.tasks.countGeneratedNewTasks(project.id, options.namespace)
            const maxGenerated = project.improvementsMaxGeneratedNew ?? 5
            const remaining = Math.max(0, maxGenerated - currentGenerated)

            if (remaining <= 0) {
                options.engine.handleRealtimeEvent({
                    type: 'toast',
                    namespace: options.namespace,
                    data: {
                        title: 'Improvements scan',
                        body: `Skipped (limit ${maxGenerated} reached)`,
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
                            improvementsMaxGeneratedNew: maxGenerated
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

    const latestTask = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!latestTask || latestTask.archivedAt || latestTask.status !== 'finished') {
        return
    }

    if (project.improvementsEnabled) {
        const archived = options.store.tasks.archiveTaskByNamespace(latestTask.id, options.namespace)
        if (archived) {
            options.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: latestTask.id,
                projectId: latestTask.projectId,
                namespace: options.namespace,
                data: { taskId: latestTask.id, archived: true }
            })
        }
    }

    if (latestTask.activeSessionId) {
        try {
            await options.engine.archiveSession(latestTask.activeSessionId)
        } catch {
        }
    }
}
