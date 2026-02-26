import { unwrapRoleWrappedRecordEnvelope } from '@hapi/protocol/messages'
import type { DecryptedMessage, SyncEvent } from '@hapi/protocol/types'
import type { Store } from '../store'
import type { SyncEngine } from './syncEngine'

const IMPROVEMENTS_SCAN_LOCAL_ID_PREFIX = 'auto:improvements_scan:'

function getMessageRole(message: DecryptedMessage): 'user' | 'assistant' | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) return null
    if (record.role === 'user' || record.role === 'assistant') return record.role
    return null
}

function isImprovementsScanLocalId(localId: unknown): boolean {
    return typeof localId === 'string' && localId.startsWith(IMPROVEMENTS_SCAN_LOCAL_ID_PREFIX)
}

type LinkedTask = {
    namespace: string
    projectId: string
    taskId: string
}

function getLinkedTaskFromSession(engine: SyncEngine, sessionId: string): LinkedTask | null {
    const session = engine.getSession(sessionId)
    const namespace = session?.namespace
    const metadata = session?.metadata
    const projectId = metadata?.projectId
    const taskId = metadata?.taskId

    if (!namespace || !projectId || !taskId) return null
    return { namespace, projectId, taskId }
}

function findLastAssistantTurn(messages: DecryptedMessage[]): {
    lastAssistantIndex: number
    lastUserMessage: DecryptedMessage | null
} | null {
    let lastAssistantIndex = -1
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const role = getMessageRole(messages[i])
        if (role === 'assistant') {
            lastAssistantIndex = i
            break
        }
    }

    if (lastAssistantIndex < 0) return null

    let lastUserMessage: DecryptedMessage | null = null
    for (let i = lastAssistantIndex - 1; i >= 0; i -= 1) {
        const role = getMessageRole(messages[i])
        if (role === 'user') {
            lastUserMessage = messages[i]
            break
        }
    }

    return { lastAssistantIndex, lastUserMessage }
}

export class TaskAutomation {
    private readonly lastThinkingBySessionId: Map<string, boolean> = new Map()

    constructor(
        private readonly store: Store,
        private readonly engine: SyncEngine
    ) {
    }

    handleEvent(event: SyncEvent): void {
        if (event.type.startsWith('task-') || event.type.startsWith('project-') || event.type.startsWith('workspace-')) {
            return
        }

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
            this.handleSessionUpdated(event.sessionId)
            return
        }

        if (event.type === 'message-received' && event.sessionId) {
            this.handleMessageReceived(event.sessionId, event.message)
            return
        }
    }

    private handleSessionUpdated(sessionId: string): void {
        const session = this.engine.getSession(sessionId)
        if (!session) return

        const previous = this.lastThinkingBySessionId.get(sessionId)
        const current = Boolean(session.thinking)
        this.lastThinkingBySessionId.set(sessionId, current)

        if (previous === true && current === false) {
            this.tryFlipToInReview(sessionId)
        }
    }

    private handleMessageReceived(sessionId: string, message: DecryptedMessage): void {
        const linked = getLinkedTaskFromSession(this.engine, sessionId)
        if (!linked) return

        const role = getMessageRole(message)
        if (role !== 'user') {
            return
        }

        if (isImprovementsScanLocalId(message.localId)) {
            return
        }

        const current = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        if (!current) return
        if (current.archivedAt) return
        if (current.status === 'finished') return

        if (current.status !== 'in_progress') {
            const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
                status: 'in_progress'
            })
            if (updated) {
                this.engine.handleRealtimeEvent({
                    type: 'task-updated',
                    taskId: updated.id,
                    projectId: updated.projectId,
                    namespace: linked.namespace,
                    data: { taskId: updated.id }
                })
            }
        }
    }

    private tryFlipToInReview(sessionId: string): void {
        const linked = getLinkedTaskFromSession(this.engine, sessionId)
        if (!linked) return

        const current = this.store.tasks.getTaskByNamespace(linked.taskId, linked.namespace)
        if (!current) return
        if (current.archivedAt) return
        if (current.status !== 'in_progress') return

        const messages = this.store.messages.getMessages(sessionId, 50)
            .map((m) => ({
                id: m.id,
                seq: m.seq,
                localId: m.localId,
                content: m.content,
                createdAt: m.createdAt
            }))

        const lastMessage = messages[messages.length - 1]
        if (!lastMessage || getMessageRole(lastMessage) !== 'assistant') {
            return
        }

        const turn = findLastAssistantTurn(messages)
        if (!turn) return

        if (turn.lastUserMessage && isImprovementsScanLocalId(turn.lastUserMessage.localId)) {
            return
        }

        const updated = this.store.tasks.updateTaskByNamespace(linked.taskId, linked.namespace, {
            status: 'in_review'
        })
        if (updated) {
            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: updated.id,
                projectId: updated.projectId,
                namespace: linked.namespace,
                data: { taskId: updated.id }
            })
        }
    }
}
