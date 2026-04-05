import { useEffect, useMemo, useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import ThreadConversation from '@/components/operator/ThreadConversation'
import ThreadInbox from '@/components/operator/ThreadInbox'
import { Glyph } from '@/components/Visuals'
import { usePrototypeStore } from '@/prototype/store'
import type { OperatorThread } from '@/prototype/types'

type RouteContext = {
    goalId: string | null
    streamId: string | null
}

function parseRouteContext(pathname: string): RouteContext {
    const segments = pathname.split('/').filter(Boolean)
    return {
        goalId: segments[0] === 'goals' ? segments[1] ?? null : null,
        streamId: segments[2] === 'execution' ? segments[3] ?? null : null,
    }
}

function rankThread(thread: OperatorThread, context: RouteContext) {
    let score = 0

    if (thread.goalId && context.goalId && thread.goalId === context.goalId) {
        score += 50
    }
    if (context.streamId && thread.refs.some((ref) => ref.kind === 'stream' && ref.id === context.streamId)) {
        score += 30
    }
    if (!thread.passive) {
        score += 10
    }
    if (thread.unread) {
        score += 4
    }

    return score
}

function sortThreads(threads: OperatorThread[], context: RouteContext) {
    return [...threads].sort((left, right) => {
        const rankDiff = rankThread(right, context) - rankThread(left, context)
        if (rankDiff !== 0) {
            return rankDiff
        }
        return left.title.localeCompare(right.title, 'zh-Hans')
    })
}

function headingForContext(context: RouteContext) {
    if (context.streamId) {
        return {
            title: '执行线程',
            summary: '当前执行流相关的话题会优先浮到前面，其余线程仍留在收件箱。',
        }
    }
    if (context.goalId) {
        return {
            title: '目标线程',
            summary: '围绕当前目标的审批、风险和路线线程会优先显示。',
        }
    }
    return {
        title: '消息流',
        summary: '真正需要你判断的事进收件箱；点开线程后再继续和 Agent 聊。',
    }
}

export default function MessagePanel(props: {
    className?: string
    onClose?: () => void
}) {
    const location = useLocation()
    const { state, threads, activeThread, actions } = usePrototypeStore()
    const [showHandled, setShowHandled] = useState(false)
    const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
    const context = parseRouteContext(location.pathname)
    const copy = headingForContext(context)

    const orderedThreads = useMemo(
        () => sortThreads(threads, context),
        [context, threads],
    )

    const selectedThread = selectedThreadId
        ? state.threadsById[selectedThreadId] ?? null
        : null

    useEffect(() => {
        setSelectedThreadId(null)
    }, [location.pathname])

    useEffect(() => {
        if (selectedThreadId && !state.threadsById[selectedThreadId]) {
            setSelectedThreadId(null)
        }
    }, [selectedThreadId, state.threadsById])

    const activeMessages = selectedThread
        ? state.messagesByThread[selectedThread.id] ?? []
        : []

    return (
        <aside className={props.className ? `prototype-message-panel ${props.className}` : 'prototype-message-panel'}>
            <div className="prototype-message-panel__head">
                <div className="prototype-icon-pill prototype-icon-pill--small">
                    <Glyph name="digest" />
                </div>
                <div>
                    <h2>{copy.title}</h2>
                    <p>{copy.summary}</p>
                </div>
                {props.onClose ? (
                    <button type="button" className="prototype-message-panel__close" onClick={props.onClose} aria-label="关闭消息面板">
                        <Glyph name="close" />
                    </button>
                ) : null}
            </div>

            {selectedThread ? (
                <div className="prototype-message-panel__body">
                    <section className="prototype-thread-detail">
                        <button
                            type="button"
                            className="prototype-thread-detail__back"
                            onClick={() => setSelectedThreadId(null)}
                        >
                            <Glyph name="back" />
                            <span>返回消息列表</span>
                        </button>
                        <ThreadConversation thread={selectedThread} messages={activeMessages} />
                    </section>
                </div>
            ) : (
                <div className="prototype-message-panel__body prototype-message-panel__body--inbox">
                    <ThreadInbox
                        threads={orderedThreads}
                        activeThreadId={activeThread?.id ?? null}
                        showHandled={showHandled}
                        onToggleHandled={() => setShowHandled((current) => !current)}
                        onSelect={(threadId) => {
                            actions.setActiveThread(threadId)
                            setSelectedThreadId(threadId)
                        }}
                    />
                    {!orderedThreads.length ? (
                        <section className="prototype-thread-empty">
                            <div className="prototype-icon-pill prototype-icon-pill--small">
                                <Glyph name="digest" />
                            </div>
                            <div>
                                <h3>暂无线程</h3>
                                <p>当前没有需要你介入的话题。系统会继续静默推进。</p>
                            </div>
                        </section>
                    ) : null}
                </div>
            )}
        </aside>
    )
}
