import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type UIEvent } from 'react'
import {
    normalizeSessionMessage,
    renderEventLabel,
    type NormalizedAgentContent,
    type NormalizedMessage,
} from '@hopi/protocol'
import type { Session, SyncEvent } from '@hopi/protocol/types'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { OperatorMessageCard, getOperatorMessageRootClass } from '@/components/operator/OperatorMessageCard'
import { PrototypeToolCard } from '@/components/operator/PrototypeToolCard'
import { MetaBadge } from '@/components/StatusBadge'
import { useSessionMessages } from '@/hooks/useSessionMessages'
import {
    appendOptimisticMessage,
    seedMessageWindowFromSession,
    updateMessageStatus,
    type PrototypeSessionMessage,
} from '@/lib/sessionMessageStore'
import { usePrototypeRemoteApi } from '@/prototype/remoteApi'
import type { SessionLogSelection } from '@/prototype/types'

type MessageSessionLogEntry = {
    kind: 'message'
    id: string
    role: 'assistant' | 'user' | 'system'
    body: string
    createdAtLabel: string
    status: string | null
}

type ToolSessionLogEntry = {
    kind: 'tool'
    id: string
    role: 'assistant'
    toolCallId: string | null
    toolName: string
    description: string | null
    input: unknown
    result?: unknown
    state: 'pending' | 'running' | 'completed' | 'error'
    createdAtLabel: string
    status: string | null
}

type SessionLogEntry = MessageSessionLogEntry | ToolSessionLogEntry

type SessionLogTailState = {
    tone: 'running' | 'live' | 'stopped'
    title: string
    detail: string | null
    pulse: boolean
}

function labelSource(source: SessionLogSelection['source']): string {
    return source === 'planning-run' ? '规划运行' : '执行会话'
}

function formatTimestamp(createdAt: number): string {
    return new Date(createdAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    })
}

function toBlockquote(title: string, body: string): string {
    const lines = body.trim().split('\n')
    return [`> ${title}`, '>', ...lines.map((line) => `> ${line}`)].join('\n')
}

function renderAgentBlock(block: NormalizedAgentContent): string {
    if (block.type === 'text') {
        return block.text
    }

    if (block.type === 'reasoning') {
        return toBlockquote('Reasoning', block.text)
    }

    if (block.type === 'summary') {
        return toBlockquote('Summary', block.summary)
    }

    if (block.type === 'sidechain') {
        return `**Sidechain Prompt**\n\n${block.prompt}`
    }

    return ''
}

function renderNormalizedBody(message: NormalizedMessage): string {
    if (message.role === 'user') {
        return message.content.text
    }

    if (message.role === 'event') {
        return renderEventLabel(message.content)
    }

    const text = message.content
        .map((block) => renderAgentBlock(block).trim())
        .filter(Boolean)
        .join('\n\n')

    return text
}

function shouldHideEvent(message: NormalizedMessage): boolean {
    return message.role === 'event' && message.content.type === 'ready'
}

function shouldRenderAgentBlock(block: NormalizedAgentContent): boolean {
    if (block.type === 'sidechain') {
        return false
    }
    return true
}

function renderVisibleAgentBlock(block: NormalizedAgentContent): string {
    if (block.type === 'summary') {
        return block.summary
    }
    return renderAgentBlock(block)
}

function normalizeSessionLogEntries(messages: PrototypeSessionMessage[]): SessionLogEntry[] {
    const entries: SessionLogEntry[] = []
    const toolEntryIndexById = new Map<string, number>()

    for (const message of messages) {
        const normalized = normalizeSessionMessage(message)
        if (!normalized || shouldHideEvent(normalized)) {
            continue
        }

        if (normalized.role === 'user' || normalized.role === 'event') {
            const body = renderNormalizedBody(normalized).trim()
            if (!body) {
                continue
            }

            entries.push({
                kind: 'message',
                id: message.id,
                role: normalized.role === 'user' ? 'user' : 'system',
                body,
                createdAtLabel: formatTimestamp(message.createdAt),
                status: message.status ?? null,
            })
            continue
        }

        for (const block of normalized.content) {
            if (!shouldRenderAgentBlock(block)) {
                continue
            }

            if (block.type === 'tool-call') {
                toolEntryIndexById.set(block.id, entries.length)
                entries.push({
                    kind: 'tool',
                    id: `${message.id}:${block.id}`,
                    role: 'assistant',
                    toolCallId: block.id,
                    toolName: block.name,
                    description: block.description,
                    input: block.input,
                    state: 'running',
                    createdAtLabel: formatTimestamp(message.createdAt),
                    status: message.status ?? null,
                })
                continue
            }

            if (block.type === 'tool-result') {
                const existingIndex = toolEntryIndexById.get(block.tool_use_id)
                if (existingIndex !== undefined) {
                    const existingEntry = entries[existingIndex]
                    if (existingEntry?.kind === 'tool') {
                        entries[existingIndex] = {
                            ...existingEntry,
                            result: block.content,
                            state: block.is_error ? 'error' : 'completed',
                        }
                        continue
                    }
                }

                entries.push({
                    kind: 'tool',
                    id: `${message.id}:${block.tool_use_id}:result`,
                    role: 'assistant',
                    toolCallId: block.tool_use_id,
                    toolName: 'Tool',
                    description: null,
                    input: undefined,
                    result: block.content,
                    state: block.is_error ? 'error' : 'completed',
                    createdAtLabel: formatTimestamp(message.createdAt),
                    status: message.status ?? null,
                })
                continue
            }

            const body = renderVisibleAgentBlock(block).trim()
            if (!body) {
                continue
            }

            entries.push({
                kind: 'message',
                id: `${message.id}:${entries.length}`,
                role: 'assistant',
                body,
                createdAtLabel: formatTimestamp(message.createdAt),
                status: message.status ?? null,
            })
        }
    }

    return entries
}

function createOptimisticMessage(text: string, localId: string): PrototypeSessionMessage {
    return {
        id: localId,
        seq: null,
        localId,
        createdAt: Date.now(),
        content: {
            role: 'user',
            content: {
                type: 'text',
                text,
            },
        },
        status: 'sending',
        originalText: text,
    }
}

function createLocalMessageId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
        return `omc-session-${crypto.randomUUID()}`
    }
    return `omc-session-${Date.now()}-${Math.random()}`
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim()
    }
    const message = String(error).trim()
    return message || '底层 Session 操作失败'
}

function isSessionNotFoundError(error: unknown): boolean {
    const message = getErrorMessage(error)
    return /session not found/i.test(message)
}

function getSessionLoadErrorMessage(error: unknown): string {
    if (isSessionNotFoundError(error)) {
        return '这条底层 transcript 对应的旧 session 已被回收。'
    }
    return getErrorMessage(error)
}

function extractSessionStatePatch(data: unknown): Partial<Pick<Session, 'active' | 'thinking' | 'activeAt' | 'modelMode' | 'permissionMode'>> | null {
    if (!data || typeof data !== 'object') {
        return null
    }

    const record = data as Record<string, unknown>
    const patch: Partial<Pick<Session, 'active' | 'thinking' | 'activeAt' | 'modelMode' | 'permissionMode'>> = {}

    if (typeof record.active === 'boolean') {
        patch.active = record.active
    }
    if (typeof record.thinking === 'boolean') {
        patch.thinking = record.thinking
    }
    if (typeof record.activeAt === 'number') {
        patch.activeAt = record.activeAt
    }
    if (typeof record.modelMode === 'string') {
        patch.modelMode = record.modelMode as Session['modelMode']
    }
    if (typeof record.permissionMode === 'string') {
        patch.permissionMode = record.permissionMode as Session['permissionMode']
    }

    return Object.keys(patch).length ? patch : null
}

function buildSessionLogTailState(params: {
    session: Session | null
    pendingCount: number
    sending: boolean
}): SessionLogTailState | null {
    const { session, pendingCount, sending } = params
    if (!session) {
        return null
    }

    if (!session.active) {
        return {
            tone: 'stopped',
            title: '本轮已结束',
            detail: null,
            pulse: false,
        }
    }

    if (session.thinking || pendingCount > 0 || sending) {
        return {
            tone: 'running',
            title: '正在输出…',
            detail: null,
            pulse: true,
        }
    }

    return {
        tone: 'live',
        title: '在线，等待下一条输出',
        detail: null,
        pulse: false,
    }
}

export default function SessionLogWorkspace(props: {
    selection: SessionLogSelection
    onBack: () => void
    mode?: 'standalone' | 'embedded'
}) {
    const api = usePrototypeRemoteApi()
    const mode = props.mode ?? 'standalone'
    const isEmbedded = mode === 'embedded'
    const [resolvedSessionId, setResolvedSessionId] = useState(props.selection.sessionId)
    const [session, setSession] = useState<Session | null>(null)
    const [loadingSession, setLoadingSession] = useState(true)
    const [sessionError, setSessionError] = useState<string | null>(null)
    const [composerValue, setComposerValue] = useState('')
    const [sending, setSending] = useState(false)
    const [sendError, setSendError] = useState<string | null>(null)
    const viewportRef = useRef<HTMLDivElement | null>(null)
    const stickToBottomRef = useRef(true)
    const previousLastEntryIdRef = useRef<string | null>(null)
    const previousSessionIdRef = useRef<string | null>(null)
    const previousTailToneRef = useRef<SessionLogTailState['tone'] | null>(null)

    const {
        messages,
        warning,
        isLoading,
        isLoadingMore,
        hasMore,
        pendingCount,
        loadMore,
        flushPending,
        setAtBottom,
    } = useSessionMessages(api, resolvedSessionId)

    useEffect(() => {
        setResolvedSessionId(props.selection.sessionId)
        setComposerValue('')
        setSendError(null)
        setSessionError(null)
    }, [props.selection.sessionId])

    const loadSession = useCallback(async (sessionId: string) => {
        setLoadingSession(true)
        setSessionError(null)
        try {
            const response = await api.getSession(sessionId)
            setSession(response.session)
        } catch (error) {
            setSession(null)
            setSessionError(getSessionLoadErrorMessage(error))
        } finally {
            setLoadingSession(false)
        }
    }, [api])

    useEffect(() => {
        void loadSession(resolvedSessionId)
    }, [loadSession, resolvedSessionId])

    useEffect(() => {
        const eventSource = new EventSource(api.createEventsUrl())

        eventSource.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data) as SyncEvent
                if (!('sessionId' in payload) || payload.sessionId !== resolvedSessionId) {
                    return
                }

                if (payload.type === 'session-removed') {
                    setSession((previous) => previous ? {
                        ...previous,
                        active: false,
                        thinking: false,
                    } : previous)
                    return
                }

                if (payload.type !== 'session-updated' && payload.type !== 'session-added') {
                    return
                }

                const patch = extractSessionStatePatch(payload.data)
                if (patch) {
                    setSession((previous) => previous ? {
                        ...previous,
                        ...patch,
                    } : previous)
                    return
                }

                void loadSession(resolvedSessionId)
            } catch {
            }
        }

        return () => {
            eventSource.close()
        }
    }, [api, loadSession, resolvedSessionId])

    const entries = useMemo(
        () => normalizeSessionLogEntries(messages),
        [messages],
    )
    const terminalUrl = api.createSessionTerminalUrl(resolvedSessionId)
    const lastEntryId = entries.at(-1)?.id ?? null
    const tailState = buildSessionLogTailState({
        session,
        pendingCount,
        sending,
    })

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
        const viewport = viewportRef.current
        if (!viewport) {
            return
        }
        if (typeof viewport.scrollTo === 'function') {
            viewport.scrollTo({
                top: viewport.scrollHeight,
                behavior,
            })
            return
        }
        viewport.scrollTop = viewport.scrollHeight
    }, [])

    useEffect(() => {
        const sessionChanged = previousSessionIdRef.current !== resolvedSessionId
        const lastEntryChanged = previousLastEntryIdRef.current !== lastEntryId
        const tailToneChanged = previousTailToneRef.current !== (tailState?.tone ?? null)

        if (sessionChanged) {
            stickToBottomRef.current = true
            setAtBottom(true)
            requestAnimationFrame(() => {
                scrollToBottom()
            })
        } else if (lastEntryChanged || tailToneChanged) {
            requestAnimationFrame(() => {
                scrollToBottom()
            })
        }

        previousSessionIdRef.current = resolvedSessionId
        previousLastEntryIdRef.current = lastEntryId
        previousTailToneRef.current = tailState?.tone ?? null
    }, [lastEntryId, resolvedSessionId, scrollToBottom, setAtBottom, tailState?.tone])

    useEffect(() => {
        if (!pendingCount || !stickToBottomRef.current) {
            return
        }
        void flushPending()
    }, [flushPending, pendingCount])

    const handleViewportScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
        const viewport = event.currentTarget
        const threshold = 24
        const atBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= threshold
        stickToBottomRef.current = atBottom
        setAtBottom(atBottom)

        if (atBottom) {
            void flushPending()
        }
    }, [flushPending, setAtBottom])

    async function handleSend(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        const text = composerValue.trim()
        if (!text || sending) {
            return
        }

        const localId = createLocalMessageId()
        appendOptimisticMessage(resolvedSessionId, createOptimisticMessage(text, localId))
        setSending(true)
        setSendError(null)

        let activeSessionId = resolvedSessionId

        try {
            const currentSession = session ?? (await api.getSession(resolvedSessionId)).session
            if (!currentSession.active) {
                const resumedSessionId = await api.resumeSession(resolvedSessionId)
                if (resumedSessionId !== resolvedSessionId) {
                    seedMessageWindowFromSession(resolvedSessionId, resumedSessionId)
                    activeSessionId = resumedSessionId
                    setResolvedSessionId(resumedSessionId)
                } else {
                    activeSessionId = resolvedSessionId
                }
            }

            await api.sendMessage(activeSessionId, text, localId)
            updateMessageStatus(activeSessionId, localId, 'sent')
            setComposerValue('')
            await loadSession(activeSessionId)
            requestAnimationFrame(() => {
                scrollToBottom('smooth')
            })
        } catch (error) {
            updateMessageStatus(activeSessionId, localId, 'failed')
            setSendError(getErrorMessage(error))
        } finally {
            setSending(false)
        }
    }

    if (loadingSession && !session) {
        if (isEmbedded) {
            return (
                <section className="flex flex-col h-full bg-white relative">
                    <section className="flex flex-col items-center justify-center p-12 text-center text-zinc-500 h-full">
                        <h3 className="text-base font-semibold text-zinc-900 mb-2">正在连接底层 Session</h3>
                        <p className="text-sm max-w-sm">系统正在拉取这条运行的原始 transcript。</p>
                    </section>
                </section>
            )
        }

        return (
            <section className="flex flex-col h-full bg-white relative">
                <header className="flex-shrink-0 px-6 py-4 bg-zinc-50 border-b border-zinc-200">
                    <div className="flex items-center justify-between mb-4">
                        <button
                            type="button"
                            className="flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors focus:outline-none focus-visible:underline"
                            onClick={props.onBack}
                            aria-label="返回消息面板"
                        >
                            <span>← 返回消息面板</span>
                        </button>
                    </div>
                </header>
                <section className="flex flex-col items-center justify-center p-12 text-center text-zinc-500 h-full">
                    <h3 className="text-base font-semibold text-zinc-900 mb-2">正在连接底层 Session</h3>
                    <p className="text-sm max-w-sm">系统正在拉取这条运行的原始 transcript。</p>
                </section>
            </section>
        )
    }

    return (
        <section className="flex flex-col h-full bg-white relative">
            <div className="flex-shrink-0 border-b border-zinc-200 z-10 bg-white">
                <header className={`${isEmbedded ? 'px-4 py-4 bg-white' : 'px-6 py-5 bg-zinc-50'}`}>
                    <div className={`prototype-session-log__topbar flex items-center justify-between gap-3 ${isEmbedded ? '' : 'mb-4'}`}>
                        {isEmbedded ? (
                            <div className="flex flex-col min-w-0">
                                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">底层 transcript</p>
                                <p className="text-sm text-zinc-500 truncate" title={props.selection.subtitle ?? resolvedSessionId}>
                                    {props.selection.subtitle ?? resolvedSessionId}
                                </p>
                            </div>
                        ) : (
                            <button
                                type="button"
                                className="flex items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 transition-colors focus:outline-none focus-visible:underline"
                                onClick={props.onBack}
                                aria-label="返回消息面板"
                            >
                                <span>← 返回消息面板</span>
                            </button>
                        )}

                        <div className="flex items-center gap-3">
                            {hasMore ? (
                                <button
                                    type="button"
                                    className="px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded hover:bg-zinc-50 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 disabled:opacity-50"
                                    onClick={() => {
                                        void loadMore()
                                    }}
                                    disabled={isLoadingMore}
                                >
                                    {isLoadingMore ? '加载中…' : '加载更早消息'}
                                </button>
                            ) : null}
                            <a
                                className="px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded hover:bg-zinc-50 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500"
                                href={terminalUrl}
                                target="_blank"
                                rel="noreferrer"
                            >
                                打开终端
                            </a>
                        </div>
                    </div>

                    {!isEmbedded ? (
                        <div className="flex flex-col">
                            <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-1">底层 transcript</p>
                            <h2 className="prototype-session-log__title text-xl font-bold text-zinc-900 mb-1">{props.selection.title}</h2>
                            <p className="text-sm text-zinc-500 truncate" title={props.selection.subtitle ?? resolvedSessionId}>
                                {props.selection.subtitle ?? resolvedSessionId}
                            </p>
                        </div>
                    ) : null}
                </header>

                <div className={`prototype-session-log__meta prototype-session-log__meta--wrapped flex flex-wrap gap-2 ${isEmbedded ? 'px-4 py-3' : 'px-6 py-3'} bg-white border-t border-zinc-100`}>
                    <MetaBadge tone="neutral">{labelSource(props.selection.source)}</MetaBadge>
                    {session?.metadata?.flavor ? (
                        <MetaBadge tone="neutral">{session.metadata.flavor}</MetaBadge>
                    ) : null}
                    {session?.modelMode ? (
                        <MetaBadge tone="neutral">{session.modelMode}</MetaBadge>
                    ) : null}
                    {session?.metadata?.worktree?.branch ? (
                        <MetaBadge tone="neutral">{session.metadata.worktree.branch}</MetaBadge>
                    ) : null}
                </div>

                {session && !session.active ? (
                    <div className="px-6 py-2 bg-amber-50 border-t border-b border-amber-100 text-sm text-amber-800 font-medium">
                        Session 已停止。发送新消息会先自动恢复，再继续写入。
                    </div>
                ) : null}

                {sessionError ? (
                    <p className="px-6 py-3 bg-red-50 text-sm text-red-700 border-t border-b border-red-100" role="alert">
                        {sessionError}
                    </p>
                ) : null}

                {warning ? (
                    <p className="px-6 py-3 bg-amber-50 text-sm text-amber-700 border-t border-b border-amber-100">{warning}</p>
                ) : null}
            </div>

            <div className="flex-1 flex flex-col min-h-0 bg-zinc-50/30 relative" data-testid="session-log-scroll-shell">
                <div
                    ref={viewportRef}
                    className={`absolute inset-0 overflow-y-auto overflow-x-hidden ${isEmbedded ? 'px-4 py-4' : 'px-6 py-6'}`}
                    onScroll={handleViewportScroll}
                >
                    <div className="prototype-chat-thread__messages--chronological flex flex-col max-w-3xl mx-auto w-full min-w-0 gap-6 pb-4">
                        {entries.length ? entries.map((entry) => {
                                return (
                                    <article
                                        key={entry.id}
                                        className={`${getOperatorMessageRootClass(entry.role)} ${entry.role === 'assistant' ? 'prototype-thread-message--agent' : entry.role === 'user' ? 'prototype-thread-message--user' : 'prototype-thread-message--system'}`}
                                    >
                                        <OperatorMessageCard
                                            role={entry.role}
                                            timestampLabel={entry.createdAtLabel}
                                            statusLabel={entry.status}
                                        >
                                            {entry.kind === 'tool' ? (
                                                <PrototypeToolCard
                                                    toolName={entry.toolName}
                                                    description={entry.description}
                                                    input={entry.input}
                                                    result={entry.result}
                                                    state={entry.state}
                                                />
                                            ) : (
                                                <MarkdownRenderer content={entry.body} />
                                            )}
                                        </OperatorMessageCard>
                                    </article>
                                )
                            }) : (
                                <section className="flex flex-col items-center justify-center p-12 text-center text-zinc-500">
                                    <h3 className="text-base font-semibold text-zinc-900 mb-2">{isLoading ? '正在拉取消息' : '还没有 transcript'}</h3>
                                    <p className="text-sm max-w-sm">{isLoading ? '稍等一下，系统正在同步底层会话。' : '这条 Session 还没有产出可读消息。'}</p>
                                </section>
                            )}
                            {entries.length && tailState ? (
                                <div
                                    className={`prototype-session-log__tail prototype-session-log__tail--${tailState.tone} flex items-center gap-2 px-3 py-2 rounded-lg border mt-2 w-fit max-w-full ${tailState.tone === 'running' ? 'bg-blue-50/70 border-blue-200 text-blue-800' : tailState.tone === 'live' ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800' : 'bg-zinc-100 border-zinc-200 text-zinc-700 opacity-90'}`}
                                    data-testid="session-log-tail"
                                    role="status"
                                    aria-live="polite"
                                >
                                    <span
                                        aria-hidden="true"
                                        className={`prototype-session-log__tail-dot ${tailState.pulse ? 'prototype-session-log__tail-dot--pulse' : ''} w-2 h-2 rounded-full flex-shrink-0 ${tailState.tone === 'running' ? 'bg-blue-500' : tailState.tone === 'live' ? 'bg-emerald-500' : 'bg-zinc-400'} ${tailState.pulse ? 'animate-pulse' : ''}`}
                                    />
                                    <p className="text-xs font-medium whitespace-pre-wrap break-words">{tailState.title}</p>
                                    {tailState.detail ? (
                                        <p className="text-xs opacity-80 whitespace-pre-wrap break-words">{tailState.detail}</p>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                </div>
            </div>

            <form className={`flex-shrink-0 border-t border-zinc-200 bg-white ${isEmbedded ? 'p-3' : 'p-4'} z-10`} onSubmit={handleSend}>
                {sendError ? (
                    <p className="mb-3 p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-md" role="alert">
                        {sendError}
                    </p>
                ) : null}

                <div className="max-w-3xl mx-auto w-full">
                    <div className="flex flex-col border border-zinc-300 rounded-xl bg-white shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 overflow-hidden transition-all duration-200">
                        <textarea
                            className="w-full max-h-32 min-h-[44px] px-4 py-3 text-sm text-zinc-900 placeholder:text-zinc-400 bg-transparent resize-none outline-none leading-relaxed"
                            aria-label="发送到底层 Session"
                            placeholder="继续追问，或直接给底层 Agent 一条明确指令"
                            value={composerValue}
                            rows={3}
                            onChange={(event) => {
                                setComposerValue(event.currentTarget.value)
                            }}
                            disabled={sending}
                        />
                        <div className="flex justify-end p-2 bg-zinc-50 border-t border-zinc-100">
                            <button
                                type="submit"
                                className="px-4 py-1.5 text-sm font-medium bg-zinc-900 text-white rounded-lg hover:bg-zinc-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                disabled={sending || composerValue.trim().length === 0}
                            >
                                {sending ? '发送中…' : '发送'}
                            </button>
                        </div>
                    </div>
                </div>
            </form>
        </section>
    )
}
