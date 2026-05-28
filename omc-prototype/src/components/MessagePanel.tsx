import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from '@tanstack/react-router'
import MessageWorkspace from '@/components/operator/MessageWorkspace'
import { useOperatorSurface } from '@/components/operator/OperatorSurfaceContext'
import { usePrototypeStore } from '@/prototype/store'
import type { OperatorThread } from '@/prototype/types'

type RouteContext = {
    goalId: string | null
    planId: string | null
}

function parseRouteContext(pathname: string, searchStr: string): RouteContext {
    const segments = pathname.split('/').filter(Boolean)
    const searchParams = new URLSearchParams(searchStr.startsWith('?') ? searchStr.slice(1) : searchStr)
    const queryGoalId = searchParams.get('goal')

    return {
        goalId: (segments[0] === 'goals' ? segments[1] : queryGoalId) ?? null,
        planId: segments[2] === 'plans' ? segments[3] ?? null : null,
    }
}

function rankThread(thread: OperatorThread, context: RouteContext) {
    let score = 0

    switch (thread.lifecycle) {
        case 'pending':
            score += 48
            break
        case 'waiting':
            score += 36
            break
        case 'in-progress':
            score += 22
            break
        case 'silent':
            score += 10
            break
        case 'resolved':
            score += 0
            break
    }

    if (thread.goalId && context.goalId && thread.goalId === context.goalId) {
        score += 50
    }
    if (context.planId && thread.refs.some((ref) => ref.kind === 'plan' && ref.id === context.planId)) {
        score += 30
    }
    if (!thread.passive) {
        score += 10
    } else {
        score -= 8
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
    return {
        title: '收件箱',
        summary: context.planId
            ? '先处理这张计划卡相关的话题，静默更新放在后面。'
            : context.goalId
                ? '围绕当前目标的话题会优先排前，默认先看列表。'
                : '先从待处理线程开始，静默更新会留在列表下方。',
    }
}

export default function MessagePanel(props: {
    className?: string
    onClose?: () => void
}) {
    const location = useLocation()
    const operatorSurface = useOperatorSurface()
    const { state, threads, activeThread, activeThreadSelectionId, actions } = usePrototypeStore()
    const [showHandled, setShowHandled] = useState(false)
    const [dismissedThreadSelectionId, setDismissedThreadSelectionId] = useState<number | null>(null)
    const searchStr = (location as { searchStr?: string }).searchStr ?? ''
    const context = useMemo(() => parseRouteContext(location.pathname, searchStr), [location.pathname, searchStr])
    const copy = useMemo(() => headingForContext(context), [context])
    const didMount = useRef(false)
    const traceSelection = state.traceSelection
    const sessionLogSelection = operatorSurface.activeSessionLog

    const orderedThreads = useMemo(
        () => sortThreads(threads, context),
        [context, threads],
    )

    const selectedThread = !traceSelection && activeThread && activeThreadSelectionId !== dismissedThreadSelectionId
        ? activeThread
        : null
    const mode: 'inbox' | 'thread' | 'trace' | 'session-log' = sessionLogSelection
        ? 'session-log'
        : traceSelection
            ? 'trace'
            : selectedThread
                ? 'thread'
                : 'inbox'

    function backToList() {
        if (mode === 'session-log') {
            operatorSurface.clearSessionLog()
            return
        }

        if (mode === 'trace') {
            actions.clearPlanTrace()
            return
        }

        setDismissedThreadSelectionId(activeThreadSelectionId)
    }

    useEffect(() => {
        setDismissedThreadSelectionId(activeThreadSelectionId)
    }, [location.pathname])

    useEffect(() => {
        if (didMount.current) {
            return
        }

        didMount.current = true
    }, [activeThread, activeThreadSelectionId])

    return (
        <MessageWorkspace
            className={props.className}
            heading={copy}
            threads={orderedThreads}
            messagesByThread={state.messagesByThread}
            selectedThread={selectedThread}
            mode={mode}
            traceSelection={traceSelection}
            sessionLogSelection={sessionLogSelection}
            showHandled={showHandled}
            onToggleHandled={() => setShowHandled((current) => !current)}
            onSelectThread={(threadId) => {
                operatorSurface.clearSessionLog()
                actions.clearPlanTrace()
                actions.setActiveThread(threadId)
                setDismissedThreadSelectionId(null)
            }}
            onBackToList={backToList}
            onClose={props.onClose}
        />
    )
}
