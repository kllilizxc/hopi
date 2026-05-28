import type { SyncEvent } from '../sync/syncEngine'
import type { VisibilityState } from '../visibility/visibilityTracker'
import type { VisibilityTracker } from '../visibility/visibilityTracker'

export const SSE_EVENT_CATEGORIES = [
    'messages',
    'sessions',
    'machines',
    'projects',
    'workspaces',
    'tasks',
    'toasts',
] as const

export type SSEEventCategory = (typeof SSE_EVENT_CATEGORIES)[number]

export type SSESubscription = {
    id: string
    namespace: string
    all: boolean
    include: SSEEventCategory[] | null
    sessionId: string | null
    machineId: string | null
    projectId: string | null
}

type SSEConnection = SSESubscription & {
    includeSet: ReadonlySet<SSEEventCategory> | null
    send: (event: SyncEvent) => void | Promise<void>
    sendHeartbeat: () => void | Promise<void>
}

export class SSEManager {
    private readonly connections: Map<string, SSEConnection> = new Map()
    private heartbeatTimer: NodeJS.Timeout | null = null
    private readonly heartbeatMs: number
    private readonly visibilityTracker: VisibilityTracker

    constructor(heartbeatMs = 30_000, visibilityTracker: VisibilityTracker) {
        this.heartbeatMs = heartbeatMs
        this.visibilityTracker = visibilityTracker
    }

    subscribe(options: {
        id: string
        namespace: string
        all?: boolean
        include?: SSEEventCategory[] | null
        sessionId?: string | null
        machineId?: string | null
        projectId?: string | null
        visibility?: VisibilityState
        send: (event: SyncEvent) => void | Promise<void>
        sendHeartbeat: () => void | Promise<void>
    }): SSESubscription {
        const include = options.include ?? null
        const includeSet = include ? new Set(include) : null

        const subscription: SSEConnection = {
            id: options.id,
            namespace: options.namespace,
            all: Boolean(options.all),
            include,
            includeSet,
            sessionId: options.sessionId ?? null,
            machineId: options.machineId ?? null,
            projectId: options.projectId ?? null,
            send: options.send,
            sendHeartbeat: options.sendHeartbeat
        }

        this.connections.set(subscription.id, subscription)
        this.visibilityTracker.registerConnection(
            subscription.id,
            subscription.namespace,
            options.visibility ?? 'hidden'
        )
        this.ensureHeartbeat()
        return {
            id: subscription.id,
            namespace: subscription.namespace,
            all: subscription.all,
            include: subscription.include,
            sessionId: subscription.sessionId,
            machineId: subscription.machineId,
            projectId: subscription.projectId
        }
    }

    unsubscribe(id: string): void {
        this.connections.delete(id)
        this.visibilityTracker.removeConnection(id)
        if (this.connections.size === 0) {
            this.stopHeartbeat()
        }
    }

    async sendToast(namespace: string, event: Extract<SyncEvent, { type: 'toast' }>): Promise<number> {
        try {
            const title = event.data.title?.trim() ?? ''
            const body = event.data.body?.trim() ?? ''
            const base = title && body ? `${title} — ${body}` : (title || body || '(empty)')
            console.info('[Toast]', base, {
                namespace,
                sessionId: event.data.sessionId,
                url: event.data.url
            })
        } catch {
        }

        const deliveries: Array<Promise<{ id: string; ok: boolean }>> = []
        for (const connection of this.connections.values()) {
            if (connection.namespace !== namespace) {
                continue
            }
            if (!this.visibilityTracker.isVisibleConnection(connection.id)) {
                continue
            }
            if (connection.includeSet && !connection.includeSet.has('toasts')) {
                continue
            }

            try {
                deliveries.push(
                    Promise.resolve(connection.send(event))
                        .then(() => ({ id: connection.id, ok: true }))
                        .catch(() => ({ id: connection.id, ok: false }))
                )
            } catch {
                deliveries.push(Promise.resolve({ id: connection.id, ok: false }))
            }
        }

        if (deliveries.length === 0) {
            return 0
        }

        const results = await Promise.all(deliveries)
        let successCount = 0
        for (const result of results) {
            if (result.ok) {
                successCount += 1
                continue
            }
            this.unsubscribe(result.id)
        }

        return successCount
    }

    broadcast(event: SyncEvent): void {
        if (event.type === 'toast') {
            try {
                const title = event.data.title?.trim() ?? ''
                const body = event.data.body?.trim() ?? ''
                const base = title && body ? `${title} — ${body}` : (title || body || '(empty)')
                console.info('[Toast]', base, {
                    namespace: event.namespace ?? '(missing-namespace)',
                    sessionId: event.data.sessionId,
                    url: event.data.url
                })
            } catch {
            }
        }

        for (const connection of this.connections.values()) {
            if (!this.shouldSend(connection, event)) {
                continue
            }

            try {
                void Promise.resolve(connection.send(event)).catch(() => {
                    this.unsubscribe(connection.id)
                })
            } catch {
                this.unsubscribe(connection.id)
            }
        }
    }

    stop(): void {
        this.stopHeartbeat()
        for (const id of this.connections.keys()) {
            this.visibilityTracker.removeConnection(id)
        }
        this.connections.clear()
    }

    private ensureHeartbeat(): void {
        if (this.heartbeatTimer || this.heartbeatMs <= 0) {
            return
        }

        this.heartbeatTimer = setInterval(() => {
            for (const connection of this.connections.values()) {
                try {
                    void Promise.resolve(connection.sendHeartbeat()).catch(() => {
                        this.unsubscribe(connection.id)
                    })
                } catch {
                    this.unsubscribe(connection.id)
                }
            }
        }, this.heartbeatMs)
    }

    private stopHeartbeat(): void {
        if (!this.heartbeatTimer) {
            return
        }

        clearInterval(this.heartbeatTimer)
        this.heartbeatTimer = null
    }

    private shouldSend(connection: SSEConnection, event: SyncEvent): boolean {
        if (event.type === 'connection-changed') {
            return true
        }

        const eventNamespace = event.namespace
        if (!eventNamespace || eventNamespace !== connection.namespace) {
            return false
        }

        const category = getEventCategory(event)
        if (connection.includeSet && category && !connection.includeSet.has(category)) {
            return false
        }

        if (connection.all) {
            return true
        }

        if (category === 'messages') {
            return Boolean(connection.sessionId && 'sessionId' in event && connection.sessionId === event.sessionId)
        }

        if (category === 'sessions') {
            if (connection.sessionId && 'sessionId' in event && connection.sessionId === event.sessionId) {
                return true
            }
            return Boolean(connection.projectId && 'projectId' in event && connection.projectId === event.projectId)
        }

        if (category === 'machines') {
            return Boolean(connection.machineId && 'machineId' in event && connection.machineId === event.machineId)
        }

        if (category === 'projects') {
            return Boolean(connection.projectId && 'projectId' in event && connection.projectId === event.projectId)
        }

        if (category === 'workspaces' || category === 'tasks') {
            return Boolean(connection.projectId && 'projectId' in event && connection.projectId === event.projectId)
        }

        if (category === 'toasts') {
            // Toasts are namespace-wide and do not carry a stable scope key.
            return true
        }

        return false
    }
}

function getEventCategory(event: SyncEvent): SSEEventCategory | null {
    switch (event.type) {
        case 'message-received':
            return 'messages'
        case 'session-added':
        case 'session-updated':
        case 'session-removed':
            return 'sessions'
        case 'machine-updated':
            return 'machines'
        case 'project-added':
        case 'project-updated':
        case 'project-removed':
            return 'projects'
        case 'workspace-added':
        case 'workspace-updated':
        case 'workspace-removed':
            return 'workspaces'
        case 'task-added':
        case 'task-updated':
        case 'task-removed':
            return 'tasks'
        case 'toast':
            return 'toasts'
        case 'connection-changed':
        case 'omc-program-updated':
        case 'omc-guided-planning-updated':
        case 'omc-plan-runtime-updated':
        case 'omc-attempt-added':
        case 'omc-attempt-updated':
        case 'omc-evidence-added':
        case 'omc-review-updated':
        case 'omc-merge-updated':
        case 'omc-topic-updated':
        case 'omc-topic-turn-added':
        case 'omc-mailbox-message-added':
        case 'omc-work-order-updated':
        case 'omc-work-attempt-added':
        case 'omc-work-attempt-updated':
        case 'omc-coordination-agent-updated':
        case 'omc-directive-ledger-updated':
            return null
        default: {
            const _exhaustive: never = event
            return _exhaustive
        }
    }
}
