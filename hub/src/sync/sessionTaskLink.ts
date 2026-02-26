import type { Store } from '../store'
import type { SyncEngine } from './syncEngine'

type TaskLinkPatch = {
    projectId: string
    taskId: string
    name?: string
}

function mergeSessionMetadata(current: unknown, patch: TaskLinkPatch): unknown {
    const base = current && typeof current === 'object' && !Array.isArray(current)
        ? current as Record<string, unknown>
        : {}

    return {
        ...base,
        projectId: patch.projectId,
        taskId: patch.taskId,
        name: patch.name ?? base.name
    }
}

export function setSessionTaskLink(options: {
    store: Store
    engine: SyncEngine
    sessionId: string
    namespace: string
    projectId: string
    taskId: string
    name?: string
}): boolean {
    const patch: TaskLinkPatch = {
        projectId: options.projectId,
        taskId: options.taskId,
        name: options.name
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const stored = options.store.sessions.getSessionByNamespace(options.sessionId, options.namespace)
        if (!stored) {
            return false
        }

        const nextMetadata = mergeSessionMetadata(stored.metadata, patch)
        const result = options.store.sessions.updateSessionMetadata(
            options.sessionId,
            nextMetadata,
            stored.metadataVersion,
            options.namespace,
            { touchUpdatedAt: false }
        )

        if (result.result === 'success') {
            options.engine.handleRealtimeEvent({
                type: 'session-updated',
                sessionId: options.sessionId,
                namespace: options.namespace,
                data: { sessionId: options.sessionId }
            })
            return true
        }

        if (result.result === 'error') {
            return false
        }
    }

    return false
}

