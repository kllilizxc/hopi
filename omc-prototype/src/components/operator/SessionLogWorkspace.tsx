import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type UIEvent } from 'react'
import {
    normalizeSessionMessage,
    renderEventLabel,
    type NormalizedAgentContent,
    type NormalizedMessage,
} from '@hopi/protocol'
import type { Session } from '@hopi/protocol/types'
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

export default function SessionLogWorkspace(props: {
    selection: SessionLogSelection
    onBack: () => void
}) {
    const api = usePrototypeRemoteApi()
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
            setSessionError(getErrorMessage(error))
        } finally {
            setLoadingSession(false)
        }
    }, [api])

    useEffect(() => {
        void loadSession(resolvedSessionId)
    }, [loadSession, resolvedSessionId])

    const entries = useMemo(
        () => normalizeSessionLogEntries(messages),
        [messages],
    )
    const terminalUrl = api.createSessionTerminalUrl(resolvedSessionId)
    const lastEntryId = entries.at(-1)?.id ?? null

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

        if (sessionChanged) {
            stickToBottomRef.current = true
            setAtBottom(true)
            requestAnimationFrame(() => {
                scrollToBottom()
            })
        } else if (lastEntryChanged && stickToBottomRef.current) {
            requestAnimationFrame(() => {
                scrollToBottom()
            })
        }

        previousSessionIdRef.current = resolvedSessionId
        previousLastEntryIdRef.current = lastEntryId
    }, [lastEntryId, resolvedSessionId, scrollToBottom, setAtBottom])

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
        return (
            <section className="prototype-session-log">
                <header className="prototype-session-log__header">
                    <button
                        type="button"
                        className="prototype-thread-detail__back"
                        onClick={props.onBack}
                        aria-label="返回消息面板"
                    >
                        返回消息面板
                    </button>
                </header>
                <section className="prototype-trace-empty">
                    <h3>正在连接底层 Session</h3>
                    <p>系统正在拉取这条运行的原始 transcript。</p>
                </section>
            </section>
        )
    }

    return (
        <section className="prototype-session-log">
            <div className="prototype-session-log__summary">
                <header className="prototype-session-log__header">
                    <button
                        type="button"
                        className="prototype-thread-detail__back"
                        onClick={props.onBack}
                        aria-label="返回消息面板"
                    >
                        返回消息面板
                    </button>

                    <div className="prototype-session-log__title">
                        <p className="prototype-message-panel__eyebrow">底层 transcript</p>
                        <h2>{props.selection.title}</h2>
                        <p className="prototype-session-log__subtitle">
                            {props.selection.subtitle ?? resolvedSessionId}
                        </p>
                    </div>

                    <div className="prototype-session-log__toolbar">
                        {hasMore ? (
                            <button
                                type="button"
                                className="prototype-button--ghost"
                                onClick={() => {
                                    void loadMore()
                                }}
                                disabled={isLoadingMore}
                            >
                                {isLoadingMore ? '加载中…' : '加载更早消息'}
                            </button>
                        ) : null}
                        <a
                            className="prototype-button--ghost"
                            href={terminalUrl}
                            target="_blank"
                            rel="noreferrer"
                        >
                            打开终端
                        </a>
                    </div>
                </header>

                <div className="prototype-session-log__meta">
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

                {!session?.active ? (
                    <div className="prototype-session-log__banner">
                        Session 已停止。发送新消息会先自动恢复，再继续写入。
                    </div>
                ) : null}

                {sessionError ? (
                    <p className="prototype-seed-panel__error" role="alert">
                        {sessionError}
                    </p>
                ) : null}

                {warning ? (
                    <p className="prototype-session-log__hint">{warning}</p>
                ) : null}
            </div>

            <div className="prototype-session-log__body-shell" data-testid="session-log-scroll-shell">
                <section className="prototype-chat-thread__root">
                    <div
                        ref={viewportRef}
                        className="prototype-chat-thread__viewport"
                        onScroll={handleViewportScroll}
                    >
                        <div className="prototype-chat-thread__messages prototype-chat-thread__messages--chronological">
                            {entries.length ? entries.map((entry) => {
                                return (
                                    <article key={entry.id} className={getOperatorMessageRootClass(entry.role)}>
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
                                <section className="prototype-trace-empty">
                                    <h3>{isLoading ? '正在拉取消息' : '还没有 transcript'}</h3>
                                    <p>{isLoading ? '稍等一下，系统正在同步底层会话。' : '这条 Session 还没有产出可读消息。'}</p>
                                </section>
                            )}
                        </div>
                    </div>
                </section>
            </div>

            <form className="prototype-chat-thread__controls" onSubmit={handleSend}>
                {sendError ? (
                    <p className="prototype-seed-panel__error" role="alert">
                        {sendError}
                    </p>
                ) : null}

                <div className="prototype-chat-compose">
                    <div className="prototype-chat-compose__row">
                        <textarea
                            className="prototype-chat-compose__input"
                            aria-label="发送到底层 Session"
                            placeholder="继续追问，或直接给底层 Agent 一条明确指令"
                            value={composerValue}
                            rows={3}
                            onChange={(event) => {
                                setComposerValue(event.currentTarget.value)
                            }}
                            disabled={sending}
                        />
                        <button
                            type="submit"
                            className="prototype-primary-button prototype-chat-compose__send"
                            disabled={sending || composerValue.trim().length === 0}
                        >
                            {sending ? '发送中…' : '发送'}
                        </button>
                    </div>
                </div>
            </form>
        </section>
    )
}
