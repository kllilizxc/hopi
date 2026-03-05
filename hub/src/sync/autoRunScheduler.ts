import type { SyncEvent } from '@hopi/protocol/types'
import type { Store } from '../store'
import type { SyncEngine } from './syncEngine'
import { startSessionFromTask } from './taskSessionService'

type ProjectKey = `${string}:${string}`

function toProjectKey(namespace: string, projectId: string): ProjectKey {
    return `${namespace}:${projectId}`
}

function isTaskAutoRunnable(task: {
    status: string
    archivedAt: number | null
    activeSessionId: string | null
    source: string | null
}): boolean {
    if (task.status !== 'planned') return false
    if (task.archivedAt) return false
    if (task.activeSessionId) return false
    if (task.source === 'improvements_scan') return false
    return true
}

export class AutoRunScheduler {
    private readonly lastThinkingBySessionId: Map<string, boolean> = new Map()
    private readonly tickTimers: Map<ProjectKey, NodeJS.Timeout> = new Map()
    private readonly runningTicks: Set<ProjectKey> = new Set()

    constructor(
        private readonly store: Store,
        private readonly engine: SyncEngine
    ) {
    }

    requestTick(namespace: string, projectId: string, options?: { delayMs?: number }): void {
        const delayMs = options?.delayMs ?? 250
        const key = toProjectKey(namespace, projectId)

        if (this.tickTimers.has(key)) {
            return
        }

        const timer = setTimeout(() => {
            this.tickTimers.delete(key)
            void this.tickProject(namespace, projectId)
        }, delayMs)

        this.tickTimers.set(key, timer)
    }

    handleEvent(event: SyncEvent): void {
        if (event.type === 'session-added' && event.sessionId) {
            const session = this.engine.getSession(event.sessionId)
            if (session) {
                this.lastThinkingBySessionId.set(event.sessionId, Boolean(session.thinking))
            }
            return
        }

        if (event.type === 'session-removed' && event.sessionId) {
            this.lastThinkingBySessionId.delete(event.sessionId)
            return
        }

        if (event.type === 'session-updated' && event.sessionId) {
            const session = this.engine.getSession(event.sessionId)
            if (!session) {
                return
            }

            const previous = this.lastThinkingBySessionId.get(event.sessionId)
            const current = Boolean(session.thinking)
            this.lastThinkingBySessionId.set(event.sessionId, current)

            if (previous === true && current === false) {
                const projectId = session.metadata?.projectId
                if (projectId && session.namespace) {
                    this.requestTick(session.namespace, projectId, { delayMs: 500 })
                }
            }
            return
        }

        if (event.type === 'project-updated' && event.projectId && event.namespace) {
            this.requestTick(event.namespace, event.projectId, { delayMs: 500 })
            return
        }

        if ((event.type === 'task-added' || event.type === 'task-updated') && event.projectId && event.taskId && event.namespace) {
            const task = this.store.tasks.getTaskByNamespace(event.taskId, event.namespace)
            if (task && isTaskAutoRunnable(task)) {
                this.requestTick(event.namespace, event.projectId, { delayMs: 250 })
            }
        }
    }

    private async tickProject(namespace: string, projectId: string): Promise<void> {
        const key = toProjectKey(namespace, projectId)
        if (this.runningTicks.has(key)) {
            return
        }
        this.runningTicks.add(key)

        try {
            const project = this.store.projects.getProjectByNamespace(projectId, namespace)
            if (!project || project.archivedAt) {
                return
            }
            if (!project.autoRunEnabled) {
                return
            }

            const maxRunning = project.maxRunningSessions ?? 5
            const runningCount = this.engine.getSessionsByNamespace(namespace)
                .filter((session) => session.metadata?.projectId === projectId && session.thinking)
                .length

            const capacity = Math.max(0, maxRunning - runningCount)
            if (capacity <= 0) {
                return
            }

            const planned = this.store.tasks.listPlannedTasksByProjectAndNamespace(projectId, namespace, { limit: Math.min(50, capacity * 5) })
            if (planned.length === 0) {
                return
            }

            let started = 0

            for (const task of planned) {
                if (started >= capacity) {
                    break
                }
                if (!isTaskAutoRunnable(task)) continue

                const result = await startSessionFromTask({
                    store: this.store,
                    engine: this.engine,
                    namespace,
                    taskId: task.id
                })

                if (result.ok) {
                    started += 1
                    continue
                }

                const blocked = this.store.tasks.updateTaskByNamespace(task.id, namespace, {
                    status: 'blocked'
                })
                if (blocked) {
                    this.engine.handleRealtimeEvent({
                        type: 'task-updated',
                        taskId: blocked.id,
                        projectId: blocked.projectId,
                        namespace,
                        data: { taskId: blocked.id }
                    })
                }

                this.engine.handleRealtimeEvent({
                    type: 'toast',
                    namespace,
                    data: {
                        title: 'Auto-run failed',
                        body: `${task.title}: ${result.error}`,
                        sessionId: '',
                        url: ''
                    }
                })
            }
        } finally {
            this.runningTicks.delete(key)
        }
    }
}
