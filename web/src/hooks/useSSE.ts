import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { isObject } from '@hapi/protocol'
import type {
    ModelMode,
    PermissionMode,
    SessionResponse,
    SessionsResponse,
    SyncEvent
} from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { clearMessageWindow, ingestIncomingMessages } from '@/lib/message-window-store'

type SSESubscription = {
    all?: boolean
    sessionId?: string
    machineId?: string
}

type VisibilityState = 'visible' | 'hidden'

type ToastEvent = Extract<SyncEvent, { type: 'toast' }>
type SessionUpdatedEvent = Extract<SyncEvent, { type: 'session-updated' }>

type SessionRealtimePatch = {
    active?: boolean
    thinking?: boolean
    activeAt?: number
    permissionMode?: PermissionMode
    modelMode?: ModelMode
}

const SESSION_REALTIME_KEYS = new Set(['active', 'thinking', 'activeAt', 'permissionMode', 'modelMode'])

function sortSessionSummaries(sessions: SessionsResponse['sessions']): SessionsResponse['sessions'] {
    return [...sessions].sort((a, b) => {
        if (a.active !== b.active) {
            return a.active ? -1 : 1
        }
        if (a.active && a.pendingRequestsCount !== b.pendingRequestsCount) {
            return b.pendingRequestsCount - a.pendingRequestsCount
        }
        return b.updatedAt - a.updatedAt
    })
}

function parseSessionRealtimePatch(event: SessionUpdatedEvent): SessionRealtimePatch | null {
    if (!isObject(event.data)) {
        return null
    }

    const keys = Object.keys(event.data)
    if (keys.length === 0 || keys.some((key) => !SESSION_REALTIME_KEYS.has(key))) {
        return null
    }

    const patch: SessionRealtimePatch = {}
    if ('active' in event.data) {
        if (typeof event.data.active !== 'boolean') {
            return null
        }
        patch.active = event.data.active
    }
    if ('thinking' in event.data) {
        if (typeof event.data.thinking !== 'boolean') {
            return null
        }
        patch.thinking = event.data.thinking
    }
    if ('activeAt' in event.data) {
        if (typeof event.data.activeAt !== 'number') {
            return null
        }
        patch.activeAt = event.data.activeAt
    }
    if ('permissionMode' in event.data) {
        if (typeof event.data.permissionMode !== 'string') {
            return null
        }
        patch.permissionMode = event.data.permissionMode as PermissionMode
    }
    if ('modelMode' in event.data) {
        if (typeof event.data.modelMode !== 'string') {
            return null
        }
        patch.modelMode = event.data.modelMode as ModelMode
    }

    return Object.keys(patch).length > 0 ? patch : null
}

function applySessionRealtimePatch(queryClient: QueryClient, event: SessionUpdatedEvent): boolean {
    const patch = parseSessionRealtimePatch(event)
    if (!patch) {
        return false
    }

    queryClient.setQueryData<SessionResponse>(queryKeys.session(event.sessionId), (current) => {
        if (!current?.session) {
            return current
        }

        const nextSession = { ...current.session }
        let changed = false

        if (patch.active !== undefined && nextSession.active !== patch.active) {
            nextSession.active = patch.active
            changed = true
        }
        if (patch.thinking !== undefined && nextSession.thinking !== patch.thinking) {
            nextSession.thinking = patch.thinking
            changed = true
        }
        if (patch.activeAt !== undefined && nextSession.activeAt !== patch.activeAt) {
            nextSession.activeAt = patch.activeAt
            changed = true
        }
        if (patch.permissionMode !== undefined && nextSession.permissionMode !== patch.permissionMode) {
            nextSession.permissionMode = patch.permissionMode
            changed = true
        }
        if (patch.modelMode !== undefined && nextSession.modelMode !== patch.modelMode) {
            nextSession.modelMode = patch.modelMode
            changed = true
        }

        if (!changed) {
            return current
        }
        return { ...current, session: nextSession }
    })

    queryClient.setQueryData<SessionsResponse>(queryKeys.sessions, (current) => {
        if (!current) {
            return current
        }

        const index = current.sessions.findIndex((session) => session.id === event.sessionId)
        if (index < 0) {
            return current
        }

        const currentSummary = current.sessions[index]
        const nextSummary = { ...currentSummary }
        let changed = false

        if (patch.active !== undefined && nextSummary.active !== patch.active) {
            nextSummary.active = patch.active
            changed = true
        }
        if (patch.thinking !== undefined && nextSummary.thinking !== patch.thinking) {
            nextSummary.thinking = patch.thinking
            changed = true
        }
        if (patch.activeAt !== undefined && nextSummary.activeAt !== patch.activeAt) {
            nextSummary.activeAt = patch.activeAt
            changed = true
        }
        if (patch.modelMode !== undefined && nextSummary.modelMode !== patch.modelMode) {
            nextSummary.modelMode = patch.modelMode
            changed = true
        }

        if (!changed) {
            return current
        }

        const nextSessions = [...current.sessions]
        nextSessions[index] = nextSummary
        return {
            ...current,
            sessions: sortSessionSummaries(nextSessions)
        }
    })

    return true
}

function getVisibilityState(): VisibilityState {
    if (typeof document === 'undefined') {
        return 'hidden'
    }
    return document.visibilityState === 'visible' ? 'visible' : 'hidden'
}

function buildEventsUrl(
    baseUrl: string,
    token: string,
    subscription: SSESubscription,
    visibility: VisibilityState
): string {
    const params = new URLSearchParams()
    params.set('token', token)
    params.set('visibility', visibility)
    if (subscription.all) {
        params.set('all', 'true')
    }
    if (subscription.sessionId) {
        params.set('sessionId', subscription.sessionId)
    }
    if (subscription.machineId) {
        params.set('machineId', subscription.machineId)
    }

    const path = `/api/events?${params.toString()}`
    try {
        return new URL(path, baseUrl).toString()
    } catch {
        return path
    }
}

export function useSSE(options: {
    enabled: boolean
    token: string
    baseUrl: string
    subscription?: SSESubscription
    onEvent: (event: SyncEvent) => void
    onConnect?: () => void
    onDisconnect?: (reason: string) => void
    onError?: (error: unknown) => void
    onToast?: (event: ToastEvent) => void
}): { subscriptionId: string | null } {
    const queryClient = useQueryClient()
    const onEventRef = useRef(options.onEvent)
    const onConnectRef = useRef(options.onConnect)
    const onDisconnectRef = useRef(options.onDisconnect)
    const onErrorRef = useRef(options.onError)
    const onToastRef = useRef(options.onToast)
    const eventSourceRef = useRef<EventSource | null>(null)
    const [subscriptionId, setSubscriptionId] = useState<string | null>(null)

    useEffect(() => {
        onEventRef.current = options.onEvent
    }, [options.onEvent])

    useEffect(() => {
        onErrorRef.current = options.onError
    }, [options.onError])

    useEffect(() => {
        onConnectRef.current = options.onConnect
    }, [options.onConnect])

    useEffect(() => {
        onDisconnectRef.current = options.onDisconnect
    }, [options.onDisconnect])

    useEffect(() => {
        onToastRef.current = options.onToast
    }, [options.onToast])

    const subscription = options.subscription ?? {}

    const subscriptionKey = useMemo(() => {
        return `${subscription.all ? '1' : '0'}|${subscription.sessionId ?? ''}|${subscription.machineId ?? ''}`
    }, [subscription.all, subscription.sessionId, subscription.machineId])

    useEffect(() => {
        if (!options.enabled) {
            eventSourceRef.current?.close()
            eventSourceRef.current = null
            setSubscriptionId(null)
            return
        }

        setSubscriptionId(null)
        const url = buildEventsUrl(options.baseUrl, options.token, {
            ...subscription,
            sessionId: subscription.sessionId ?? undefined
        }, getVisibilityState())
        const eventSource = new EventSource(url)
        eventSourceRef.current = eventSource

        const handleSyncEvent = (event: SyncEvent) => {
            if (event.type === 'connection-changed') {
                const data = event.data
                if (data && typeof data === 'object' && 'subscriptionId' in data) {
                    const nextId = (data as { subscriptionId?: unknown }).subscriptionId
                    if (typeof nextId === 'string' && nextId.length > 0) {
                        setSubscriptionId(nextId)
                    }
                }
            }

            if (event.type === 'toast') {
                onToastRef.current?.(event)
                return
            }

            if (event.type === 'message-received') {
                ingestIncomingMessages(event.sessionId, [event.message])
            }

            if (event.type === 'session-added' || event.type === 'session-removed') {
                void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
                if ('sessionId' in event) {
                    if (event.type === 'session-removed') {
                        void queryClient.removeQueries({ queryKey: queryKeys.session(event.sessionId) })
                        clearMessageWindow(event.sessionId)
                    } else {
                        void queryClient.invalidateQueries({ queryKey: queryKeys.session(event.sessionId) })
                    }
                }
            }

            if (event.type === 'session-updated') {
                const patched = applySessionRealtimePatch(queryClient, event)
                if (!patched) {
                    void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
                    void queryClient.invalidateQueries({ queryKey: queryKeys.session(event.sessionId) })
                }
            }

            if (event.type === 'machine-updated') {
                void queryClient.invalidateQueries({ queryKey: queryKeys.machines })
            }

            if (event.type === 'project-added' || event.type === 'project-updated' || event.type === 'project-removed') {
                void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
                if ('projectId' in event) {
                    void queryClient.invalidateQueries({ queryKey: queryKeys.project(event.projectId) })
                }
            }

            if (event.type === 'workspace-added' || event.type === 'workspace-updated' || event.type === 'workspace-removed') {
                void queryClient.invalidateQueries({ queryKey: queryKeys.projects })
                void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces(event.projectId) })
            }

            if (event.type === 'task-added' || event.type === 'task-updated' || event.type === 'task-removed') {
                void queryClient.invalidateQueries({ queryKey: queryKeys.tasks(event.projectId) })
                if ('taskId' in event) {
                    void queryClient.invalidateQueries({ queryKey: queryKeys.task(event.taskId) })
                }
            }

            onEventRef.current(event)
        }

        const handleMessage = (message: MessageEvent<string>) => {
            if (typeof message.data !== 'string') {
                return
            }

            let parsed: unknown
            try {
                parsed = JSON.parse(message.data)
            } catch {
                return
            }

            if (!isObject(parsed)) {
                return
            }
            if (typeof parsed.type !== 'string') {
                return
            }

            handleSyncEvent(parsed as SyncEvent)
        }

        eventSource.onmessage = handleMessage
        eventSource.onopen = () => {
            onConnectRef.current?.()
        }
        eventSource.onerror = (error) => {
            onErrorRef.current?.(error)
            const reason = eventSource.readyState === EventSource.CLOSED ? 'closed' : 'error'
            onDisconnectRef.current?.(reason)
        }

        return () => {
            eventSource.close()
            if (eventSourceRef.current === eventSource) {
                eventSourceRef.current = null
            }
            setSubscriptionId(null)
        }
    }, [options.baseUrl, options.enabled, options.token, subscriptionKey, queryClient])

    return { subscriptionId }
}
