export type SessionMessageLike = {
    id: string
    seq: number | null
    localId?: string | null
    createdAt: number
    status?: string
}

export type SessionMessagesPage<TMessage extends SessionMessageLike = SessionMessageLike> = {
    messages: TMessage[]
    page: {
        limit: number
        beforeSeq: number | null
        nextBeforeSeq: number | null
        hasMore: boolean
    }
}

export type SessionMessagesClient<TMessage extends SessionMessageLike = SessionMessageLike> = {
    getMessages(
        sessionId: string,
        options: { limit: number; beforeSeq: number | null },
    ): Promise<SessionMessagesPage<TMessage>>
}

export type SessionMessageWindowState<TMessage extends SessionMessageLike = SessionMessageLike> = {
    sessionId: string
    messages: TMessage[]
    pending: TMessage[]
    pendingCount: number
    hasMore: boolean
    oldestSeq: number | null
    newestSeq: number | null
    isLoading: boolean
    isLoadingMore: boolean
    warning: string | null
    atBottom: boolean
    messagesVersion: number
}

type InternalState<TMessage extends SessionMessageLike> = SessionMessageWindowState<TMessage> & {
    pendingOverflowCount: number
    pendingVisibleCount: number
    pendingOverflowVisibleCount: number
}

type PendingVisibilityCacheEntry<TMessage extends SessionMessageLike> = {
    source: TMessage
    visible: boolean
}

type CreateSessionMessageWindowStoreOptions<TMessage extends SessionMessageLike> = {
    isVisibleMessage: (message: TMessage) => boolean
    isUserMessage?: (message: TMessage) => boolean
    visibleWindowSize?: number
    pendingWindowSize?: number
    pageSize?: number
    pendingOverflowWarning?: string
}

export const DEFAULT_VISIBLE_WINDOW_SIZE = 400
export const DEFAULT_PENDING_WINDOW_SIZE = 200
export const DEFAULT_PAGE_SIZE = 50
export const DEFAULT_PENDING_OVERFLOW_WARNING = 'New messages arrived while you were away. Scroll to bottom to refresh.'

const INGEST_FLUSH_DELAY_MS = 32
const MAX_BUFFERED_INGEST_MESSAGES = 200

export function createSessionMessageWindowStore<TMessage extends SessionMessageLike>(
    options: CreateSessionMessageWindowStoreOptions<TMessage>,
) {
    const visibleWindowSize = options.visibleWindowSize ?? DEFAULT_VISIBLE_WINDOW_SIZE
    const pendingWindowSize = options.pendingWindowSize ?? DEFAULT_PENDING_WINDOW_SIZE
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE
    const pendingOverflowWarning = options.pendingOverflowWarning ?? DEFAULT_PENDING_OVERFLOW_WARNING
    const isUserMessage = options.isUserMessage ?? (() => false)

    const states = new Map<string, InternalState<TMessage>>()
    const listeners = new Map<string, Set<() => void>>()
    const pendingVisibilityCacheBySession = new Map<string, Map<string, PendingVisibilityCacheEntry<TMessage>>>()
    const incomingBufferBySession = new Map<string, TMessage[]>()
    const ingestFlushTimerBySession = new Map<string, ReturnType<typeof setTimeout>>()

    function compareMessages(left: TMessage, right: TMessage): number {
        const leftSeq = typeof left.seq === 'number' ? left.seq : null
        const rightSeq = typeof right.seq === 'number' ? right.seq : null

        if (leftSeq !== null && rightSeq !== null && leftSeq !== rightSeq) {
            return leftSeq - rightSeq
        }
        if (left.createdAt !== right.createdAt) {
            return left.createdAt - right.createdAt
        }
        return left.id.localeCompare(right.id)
    }

    function isOptimisticMessage(message: TMessage): boolean {
        return Boolean(message.localId && message.id === message.localId)
    }

    function mergeMessages(existing: TMessage[], incoming: TMessage[]): TMessage[] {
        if (existing.length === 0) {
            return [...incoming].sort(compareMessages)
        }
        if (incoming.length === 0) {
            return [...existing].sort(compareMessages)
        }

        const byId = new Map<string, TMessage>()
        for (const message of existing) {
            byId.set(message.id, message)
        }
        for (const message of incoming) {
            byId.set(message.id, message)
        }

        let merged = Array.from(byId.values())

        const incomingStoredLocalIds = new Set<string>()
        for (const message of incoming) {
            if (message.localId && !isOptimisticMessage(message)) {
                incomingStoredLocalIds.add(message.localId)
            }
        }

        if (incomingStoredLocalIds.size > 0) {
            merged = merged.filter((message) => {
                if (!message.localId || !incomingStoredLocalIds.has(message.localId)) {
                    return true
                }
                return !isOptimisticMessage(message)
            })
        }

        const optimisticMessages = merged.filter((message) => isOptimisticMessage(message))
        const nonOptimisticMessages = merged.filter((message) => !isOptimisticMessage(message))
        const result: TMessage[] = [...nonOptimisticMessages]

        for (const optimistic of optimisticMessages) {
            if (optimistic.status === 'sent') {
                const hasServerUserMessage = nonOptimisticMessages.some((message) => (
                    isUserMessage(message) && Math.abs(message.createdAt - optimistic.createdAt) < 10_000
                ))
                if (hasServerUserMessage) {
                    continue
                }
            }
            result.push(optimistic)
        }

        result.sort(compareMessages)
        return result
    }

    function getPendingVisibilityCache(sessionId: string): Map<string, PendingVisibilityCacheEntry<TMessage>> {
        const existing = pendingVisibilityCacheBySession.get(sessionId)
        if (existing) {
            return existing
        }

        const created = new Map<string, PendingVisibilityCacheEntry<TMessage>>()
        pendingVisibilityCacheBySession.set(sessionId, created)
        return created
    }

    function clearPendingVisibilityCache(sessionId: string): void {
        pendingVisibilityCacheBySession.delete(sessionId)
    }

    function clearIngestFlushTimer(sessionId: string): void {
        const handle = ingestFlushTimerBySession.get(sessionId)
        if (handle === undefined) {
            return
        }
        clearTimeout(handle)
        ingestFlushTimerBySession.delete(sessionId)
    }

    function clearIncomingBuffer(sessionId: string): void {
        clearIngestFlushTimer(sessionId)
        incomingBufferBySession.delete(sessionId)
    }

    function isVisiblePendingMessage(sessionId: string, message: TMessage): boolean {
        const cache = getPendingVisibilityCache(sessionId)
        const cached = cache.get(message.id)
        if (cached && cached.source === message) {
            return cached.visible
        }
        const visible = options.isVisibleMessage(message)
        cache.set(message.id, { source: message, visible })
        return visible
    }

    function countVisiblePendingMessages(sessionId: string, messages: TMessage[]): number {
        let count = 0
        for (const message of messages) {
            if (isVisiblePendingMessage(sessionId, message)) {
                count += 1
            }
        }
        return count
    }

    function syncPendingVisibilityCache(sessionId: string, pending: TMessage[]): void {
        const cache = pendingVisibilityCacheBySession.get(sessionId)
        if (!cache) {
            return
        }

        const keep = new Set(pending.map((message) => message.id))
        for (const id of cache.keys()) {
            if (!keep.has(id)) {
                cache.delete(id)
            }
        }
    }

    function createState(sessionId: string): InternalState<TMessage> {
        return {
            sessionId,
            messages: [],
            pending: [],
            pendingCount: 0,
            pendingVisibleCount: 0,
            pendingOverflowVisibleCount: 0,
            hasMore: false,
            oldestSeq: null,
            newestSeq: null,
            isLoading: false,
            isLoadingMore: false,
            warning: null,
            atBottom: true,
            messagesVersion: 0,
            pendingOverflowCount: 0,
        }
    }

    function getState(sessionId: string): InternalState<TMessage> {
        const existing = states.get(sessionId)
        if (existing) {
            return existing
        }

        const created = createState(sessionId)
        states.set(sessionId, created)
        return created
    }

    function notify(sessionId: string): void {
        const subscribers = listeners.get(sessionId)
        if (!subscribers) {
            return
        }
        for (const listener of subscribers) {
            listener()
        }
    }

    function setState(sessionId: string, next: InternalState<TMessage>): void {
        states.set(sessionId, next)
        notify(sessionId)
    }

    function updateState(sessionId: string, updater: (previous: InternalState<TMessage>) => InternalState<TMessage>): void {
        const previous = getState(sessionId)
        const next = updater(previous)
        if (next !== previous) {
            setState(sessionId, next)
        }
    }

    function deriveSeqBounds(messages: TMessage[]): { oldestSeq: number | null; newestSeq: number | null } {
        let oldest: number | null = null
        let newest: number | null = null

        for (const message of messages) {
            if (typeof message.seq !== 'number') {
                continue
            }
            if (oldest === null || message.seq < oldest) {
                oldest = message.seq
            }
            if (newest === null || message.seq > newest) {
                newest = message.seq
            }
        }

        return { oldestSeq: oldest, newestSeq: newest }
    }

    function buildState(
        previous: InternalState<TMessage>,
        updates: {
            messages?: TMessage[]
            pending?: TMessage[]
            pendingOverflowCount?: number
            pendingVisibleCount?: number
            pendingOverflowVisibleCount?: number
            hasMore?: boolean
            isLoading?: boolean
            isLoadingMore?: boolean
            warning?: string | null
            atBottom?: boolean
        },
    ): InternalState<TMessage> {
        const messages = updates.messages ?? previous.messages
        const pending = updates.pending ?? previous.pending
        const pendingOverflowCount = updates.pendingOverflowCount ?? previous.pendingOverflowCount
        const pendingOverflowVisibleCount = updates.pendingOverflowVisibleCount ?? previous.pendingOverflowVisibleCount
        let pendingVisibleCount = updates.pendingVisibleCount ?? previous.pendingVisibleCount
        const pendingChanged = pending !== previous.pending

        if (pendingChanged && updates.pendingVisibleCount === undefined) {
            pendingVisibleCount = countVisiblePendingMessages(previous.sessionId, pending)
        }
        if (pendingChanged) {
            syncPendingVisibilityCache(previous.sessionId, pending)
        }

        const pendingCount = pendingVisibleCount + pendingOverflowVisibleCount
        const { oldestSeq, newestSeq } = deriveSeqBounds(messages)
        const messagesVersion = messages === previous.messages ? previous.messagesVersion : previous.messagesVersion + 1

        return {
            ...previous,
            messages,
            pending,
            pendingOverflowCount,
            pendingVisibleCount,
            pendingOverflowVisibleCount,
            pendingCount,
            oldestSeq,
            newestSeq,
            hasMore: updates.hasMore !== undefined ? updates.hasMore : previous.hasMore,
            isLoading: updates.isLoading !== undefined ? updates.isLoading : previous.isLoading,
            isLoadingMore: updates.isLoadingMore !== undefined ? updates.isLoadingMore : previous.isLoadingMore,
            warning: updates.warning !== undefined ? updates.warning : previous.warning,
            atBottom: updates.atBottom !== undefined ? updates.atBottom : previous.atBottom,
            messagesVersion,
        }
    }

    function trimVisible(messages: TMessage[], mode: 'append' | 'prepend'): TMessage[] {
        if (messages.length <= visibleWindowSize) {
            return messages
        }
        if (mode === 'prepend') {
            return messages.slice(0, visibleWindowSize)
        }
        return messages.slice(messages.length - visibleWindowSize)
    }

    function trimPending(
        sessionId: string,
        messages: TMessage[],
    ): { pending: TMessage[]; dropped: number; droppedVisible: number } {
        if (messages.length <= pendingWindowSize) {
            return { pending: messages, dropped: 0, droppedVisible: 0 }
        }

        const cutoff = messages.length - pendingWindowSize
        const droppedMessages = messages.slice(0, cutoff)
        const pending = messages.slice(cutoff)
        const droppedVisible = countVisiblePendingMessages(sessionId, droppedMessages)
        return { pending, dropped: droppedMessages.length, droppedVisible }
    }

    function filterPendingAgainstVisible(pending: TMessage[], visible: TMessage[]): TMessage[] {
        if (pending.length === 0 || visible.length === 0) {
            return pending
        }
        const visibleIds = new Set(visible.map((message) => message.id))
        return pending.filter((message) => !visibleIds.has(message.id))
    }

    function mergeIntoPending(
        previous: InternalState<TMessage>,
        incoming: TMessage[],
    ): {
        pending: TMessage[]
        pendingVisibleCount: number
        pendingOverflowCount: number
        pendingOverflowVisibleCount: number
        warning: string | null
    } {
        if (incoming.length === 0) {
            return {
                pending: previous.pending,
                pendingVisibleCount: previous.pendingVisibleCount,
                pendingOverflowCount: previous.pendingOverflowCount,
                pendingOverflowVisibleCount: previous.pendingOverflowVisibleCount,
                warning: previous.warning,
            }
        }

        const mergedPending = mergeMessages(previous.pending, incoming)
        const filtered = filterPendingAgainstVisible(mergedPending, previous.messages)
        const { pending, dropped, droppedVisible } = trimPending(previous.sessionId, filtered)
        const pendingVisibleCount = countVisiblePendingMessages(previous.sessionId, pending)
        const pendingOverflowCount = previous.pendingOverflowCount + dropped
        const pendingOverflowVisibleCount = previous.pendingOverflowVisibleCount + droppedVisible
        const warning = droppedVisible > 0 && !previous.warning ? pendingOverflowWarning : previous.warning
        return {
            pending,
            pendingVisibleCount,
            pendingOverflowCount,
            pendingOverflowVisibleCount,
            warning,
        }
    }

    function flushIncomingBuffer(sessionId: string): void {
        clearIngestFlushTimer(sessionId)

        const subscribers = listeners.get(sessionId)
        if (!subscribers || subscribers.size === 0) {
            incomingBufferBySession.delete(sessionId)
            return
        }

        const queued = incomingBufferBySession.get(sessionId)
        if (!queued || queued.length === 0) {
            incomingBufferBySession.delete(sessionId)
            return
        }
        incomingBufferBySession.delete(sessionId)

        updateState(sessionId, (previous) => {
            if (previous.atBottom) {
                const merged = mergeMessages(previous.messages, queued)
                const trimmed = trimVisible(merged, 'append')
                const pending = filterPendingAgainstVisible(previous.pending, trimmed)
                return buildState(previous, { messages: trimmed, pending })
            }

            const pendingResult = mergeIntoPending(previous, queued)
            return buildState(previous, {
                pending: pendingResult.pending,
                pendingVisibleCount: pendingResult.pendingVisibleCount,
                pendingOverflowCount: pendingResult.pendingOverflowCount,
                pendingOverflowVisibleCount: pendingResult.pendingOverflowVisibleCount,
                warning: pendingResult.warning,
            })
        })
    }

    function scheduleIncomingBufferFlush(sessionId: string): void {
        if (ingestFlushTimerBySession.has(sessionId)) {
            return
        }
        const handle = setTimeout(() => {
            flushIncomingBuffer(sessionId)
        }, INGEST_FLUSH_DELAY_MS)
        ingestFlushTimerBySession.set(sessionId, handle)
    }

    return {
        getActiveMessageWindowSessionIds(): string[] {
            return Array.from(listeners.keys())
        },

        getMessageWindowState(sessionId: string): SessionMessageWindowState<TMessage> {
            return getState(sessionId)
        },

        subscribeMessageWindow(sessionId: string, listener: () => void): () => void {
            const subscribers = listeners.get(sessionId) ?? new Set()
            subscribers.add(listener)
            listeners.set(sessionId, subscribers)

            return () => {
                const current = listeners.get(sessionId)
                if (!current) {
                    return
                }

                current.delete(listener)
                if (current.size === 0) {
                    listeners.delete(sessionId)
                    states.delete(sessionId)
                    clearPendingVisibilityCache(sessionId)
                    clearIncomingBuffer(sessionId)
                }
            }
        },

        clearMessageWindow(sessionId: string): void {
            clearPendingVisibilityCache(sessionId)
            clearIncomingBuffer(sessionId)
            if (!states.has(sessionId)) {
                return
            }
            setState(sessionId, createState(sessionId))
        },

        seedMessageWindowFromSession(fromSessionId: string, toSessionId: string): void {
            if (!fromSessionId || !toSessionId || fromSessionId === toSessionId) {
                return
            }

            const source = getState(fromSessionId)
            const base = createState(toSessionId)
            const next = buildState(base, {
                messages: [...source.messages],
                pending: [...source.pending],
                pendingOverflowCount: source.pendingOverflowCount,
                pendingOverflowVisibleCount: source.pendingOverflowVisibleCount,
                hasMore: source.hasMore,
                warning: source.warning,
                atBottom: source.atBottom,
                isLoading: false,
                isLoadingMore: false,
            })
            setState(toSessionId, next)
        },

        async fetchLatestMessages(api: SessionMessagesClient<TMessage>, sessionId: string): Promise<void> {
            const initial = getState(sessionId)
            if (initial.isLoading) {
                return
            }

            updateState(sessionId, (previous) => buildState(previous, {
                isLoading: true,
                warning: null,
            }))

            try {
                const response = await api.getMessages(sessionId, { limit: pageSize, beforeSeq: null })
                updateState(sessionId, (previous) => {
                    if (previous.atBottom) {
                        const merged = mergeMessages(previous.messages, [...previous.pending, ...response.messages])
                        const trimmed = trimVisible(merged, 'append')
                        return buildState(previous, {
                            messages: trimmed,
                            pending: [],
                            pendingOverflowCount: 0,
                            pendingVisibleCount: 0,
                            pendingOverflowVisibleCount: 0,
                            hasMore: response.page.hasMore,
                            isLoading: false,
                            warning: null,
                        })
                    }

                    const pendingResult = mergeIntoPending(previous, response.messages)
                    return buildState(previous, {
                        pending: pendingResult.pending,
                        pendingVisibleCount: pendingResult.pendingVisibleCount,
                        pendingOverflowCount: pendingResult.pendingOverflowCount,
                        pendingOverflowVisibleCount: pendingResult.pendingOverflowVisibleCount,
                        isLoading: false,
                        warning: pendingResult.warning,
                    })
                })
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to load messages'
                updateState(sessionId, (previous) => buildState(previous, {
                    isLoading: false,
                    warning: message,
                }))
            }
        },

        async fetchOlderMessages(api: SessionMessagesClient<TMessage>, sessionId: string): Promise<void> {
            const initial = getState(sessionId)
            if (initial.isLoadingMore || !initial.hasMore || initial.oldestSeq === null) {
                return
            }

            updateState(sessionId, (previous) => buildState(previous, { isLoadingMore: true }))

            try {
                const response = await api.getMessages(sessionId, {
                    limit: pageSize,
                    beforeSeq: initial.oldestSeq,
                })
                updateState(sessionId, (previous) => {
                    const merged = mergeMessages(response.messages, previous.messages)
                    const trimmed = trimVisible(merged, 'prepend')
                    return buildState(previous, {
                        messages: trimmed,
                        hasMore: response.page.hasMore,
                        isLoadingMore: false,
                    })
                })
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to load messages'
                updateState(sessionId, (previous) => buildState(previous, {
                    isLoadingMore: false,
                    warning: message,
                }))
            }
        },

        ingestIncomingMessages(sessionId: string, incoming: TMessage[]): void {
            if (incoming.length === 0) {
                return
            }

            const subscribers = listeners.get(sessionId)
            if (!subscribers || subscribers.size === 0) {
                return
            }

            const buffered = incomingBufferBySession.get(sessionId)
            if (buffered) {
                buffered.push(...incoming)
            } else {
                incomingBufferBySession.set(sessionId, [...incoming])
            }

            const size = incomingBufferBySession.get(sessionId)?.length ?? 0
            if (size >= MAX_BUFFERED_INGEST_MESSAGES) {
                flushIncomingBuffer(sessionId)
                return
            }

            scheduleIncomingBufferFlush(sessionId)
        },

        flushIncomingMessages(sessionId: string): void {
            flushIncomingBuffer(sessionId)
        },

        flushPendingMessages(sessionId: string): boolean {
            const current = getState(sessionId)
            if (current.pending.length === 0 && current.pendingOverflowVisibleCount === 0) {
                return false
            }

            const needsRefresh = current.pendingOverflowVisibleCount > 0
            updateState(sessionId, (previous) => {
                const merged = mergeMessages(previous.messages, previous.pending)
                const trimmed = trimVisible(merged, 'append')
                return buildState(previous, {
                    messages: trimmed,
                    pending: [],
                    pendingOverflowCount: 0,
                    pendingVisibleCount: 0,
                    pendingOverflowVisibleCount: 0,
                    warning: needsRefresh ? (previous.warning ?? pendingOverflowWarning) : previous.warning,
                })
            })
            return needsRefresh
        },

        setAtBottom(sessionId: string, atBottom: boolean): void {
            updateState(sessionId, (previous) => {
                if (previous.atBottom === atBottom) {
                    return previous
                }
                return buildState(previous, { atBottom })
            })
        },

        appendOptimisticMessage(sessionId: string, message: TMessage): void {
            updateState(sessionId, (previous) => {
                const merged = mergeMessages(previous.messages, [message])
                const trimmed = trimVisible(merged, 'append')
                const pending = filterPendingAgainstVisible(previous.pending, trimmed)
                return buildState(previous, {
                    messages: trimmed,
                    pending,
                    atBottom: true,
                })
            })
        },

        updateMessageStatus(sessionId: string, localId: string, status: Extract<TMessage['status'], string>): void {
            if (!localId) {
                return
            }

            updateState(sessionId, (previous) => {
                let changed = false
                const updateList = (list: TMessage[]) => list.map((message) => {
                    if (message.localId !== localId || !isOptimisticMessage(message)) {
                        return message
                    }
                    if (message.status === status) {
                        return message
                    }
                    changed = true
                    return { ...message, status } as TMessage
                })

                const messages = updateList(previous.messages)
                const pending = updateList(previous.pending)
                if (!changed) {
                    return previous
                }
                return buildState(previous, { messages, pending })
            })
        },
    }
}
