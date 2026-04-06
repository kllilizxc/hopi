import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessageWorkspace from './MessageWorkspace'
import type { OperatorMessage, OperatorThread } from '@/prototype/types'

const prototypeStoreMock = {
    state: {
        checkpoint: 'approval' as const,
        worldModel: {
            currentFocus: { goalId: null, streamId: null },
            workOrders: {},
            decisionTopics: {},
            agentEvents: [],
        },
        decisionTopics: {},
    },
}

vi.mock('@/components/operator/ThreadConversation', () => ({
    default: function MockThreadConversation(props: {
        thread: OperatorThread
        messages: OperatorMessage[]
    }) {
        return (
            <div data-testid="thread-conversation">
                <strong>{props.thread.title}</strong>
                <span>{props.messages.length}</span>
            </div>
        )
    },
}))

vi.mock('@/components/operator/PlanTraceWorkspace', () => ({
    default: function MockPlanTraceWorkspace(props: { inspection: { planId: string } }) {
        return <div data-testid="plan-trace-workspace">{props.inspection.planId}</div>
    },
}))

vi.mock('@/components/operator/SessionLogWorkspace', () => ({
    default: function MockSessionLogWorkspace(props: { selection: { sessionId: string } }) {
        return <div data-testid="session-log-workspace">{props.selection.sessionId}</div>
    },
}))

vi.mock('@/prototype/store', () => ({
    usePrototypeStore: () => prototypeStoreMock,
}))

vi.mock('@/components/operator/OperatorSurfaceContext', () => ({
    useOperatorSurface: () => ({
        openInbox: vi.fn(),
        openThread: vi.fn(),
        openTrace: vi.fn(),
        openSessionLog: vi.fn(),
        clearSessionLog: vi.fn(),
        closePanel: vi.fn(),
        isOpen: true,
        activeTrace: null,
        activeSessionLog: null,
    }),
}))

function buildThread(overrides: Partial<OperatorThread> = {}): OperatorThread {
    return {
        id: 'thread-1',
        kind: 'approval',
        goalId: 'goal-1',
        title: 'Alpha thread',
        preview: 'Review the proposal',
        updatedAt: '10:00',
        lifecycle: 'pending',
        priority: 'high',
        tone: 'default',
        unread: true,
        passive: false,
        refs: [],
        detailSections: [],
        firstMessage: {
            currentStatus: 'Status',
            background: 'Background',
            whyNow: 'Why now',
            suggestedAction: 'Do the thing',
            freeformInvite: 'Reply here',
        },
        quickActions: [],
        statusLabel: '待处理',
        ...overrides,
    }
}

describe('MessageWorkspace', () => {
    const onToggleHandled = vi.fn()
    const onSelectThread = vi.fn()
    const onBackToList = vi.fn()

    beforeEach(() => {
        onToggleHandled.mockClear()
        onSelectThread.mockClear()
        onBackToList.mockClear()
    })

    it('shows the inbox by default, opens a thread, and returns to the list', () => {
        const thread = buildThread()
        const { rerender } = render(
            <MessageWorkspace
                heading={{ title: '消息流', summary: 'Inbox summary' }}
                threads={[thread]}
                messagesByThread={{ [thread.id]: [] }}
                selectedThread={null}
                showHandled={false}
                onToggleHandled={onToggleHandled}
                onSelectThread={onSelectThread}
                onBackToList={onBackToList}
            />,
        )

        expect(screen.getByRole('button', { name: /alpha thread/i })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /alpha thread/i }))
        expect(onSelectThread).toHaveBeenCalledWith(thread.id)

        rerender(
            <MessageWorkspace
                heading={{ title: '消息流', summary: 'Inbox summary' }}
                threads={[thread]}
                messagesByThread={{ [thread.id]: [] }}
                selectedThread={thread}
                showHandled={false}
                onToggleHandled={onToggleHandled}
                onSelectThread={onSelectThread}
                onBackToList={onBackToList}
            />,
        )

        expect(screen.getByRole('button', { name: /返回列表/i })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /返回列表/i }))
        expect(onBackToList).toHaveBeenCalledTimes(1)

        rerender(
            <MessageWorkspace
                heading={{ title: '消息流', summary: 'Inbox summary' }}
                threads={[thread]}
                messagesByThread={{ [thread.id]: [] }}
                selectedThread={null}
                showHandled={false}
                onToggleHandled={onToggleHandled}
                onSelectThread={onSelectThread}
                onBackToList={onBackToList}
            />,
        )

        expect(screen.getByRole('button', { name: /alpha thread/i })).toBeInTheDocument()
        expect(screen.queryByTestId('thread-conversation')).not.toBeInTheDocument()
    })

    it('shows the empty fallback when there are no threads', () => {
        render(
            <MessageWorkspace
                heading={{ title: '消息流', summary: 'Inbox summary' }}
                threads={[]}
                messagesByThread={{}}
                selectedThread={null}
                showHandled={false}
                onToggleHandled={onToggleHandled}
                onSelectThread={onSelectThread}
                onBackToList={onBackToList}
            />,
        )

        expect(screen.getByRole('heading', { name: '暂无线程' })).toBeInTheDocument()
        expect(screen.getByText('当前没有进入经营边界的话题。系统会继续静默推进。')).toBeInTheDocument()
    })

    it('shows lean detail metadata without the old status pill shell', () => {
        const thread = buildThread({
            title: '做出每周投资简报',
            updatedAt: '12 分钟前',
            statusLabel: '等你回复',
            kind: 'direction',
        })

        const { container } = render(
            <MessageWorkspace
                heading={{ title: '消息流', summary: 'Inbox summary' }}
                threads={[thread]}
                messagesByThread={{ [thread.id]: [] }}
                selectedThread={thread}
                showHandled={false}
                onToggleHandled={onToggleHandled}
                onSelectThread={onSelectThread}
                onBackToList={onBackToList}
            />,
        )

        expect(screen.getByRole('heading', { name: '做出每周投资简报' })).toBeInTheDocument()
        expect(screen.getByText('12 分钟前')).toBeInTheDocument()
        expect(screen.getByText('等你回复')).toBeInTheDocument()
        expect(screen.getByText('方向话题')).toBeInTheDocument()
        expect(container.querySelector('.prototype-thread-status-pill')).toBeNull()
    })

    it('uses a dedicated detail body shell when a thread is selected', () => {
        const thread = buildThread()
        const { container } = render(
            <MessageWorkspace
                heading={{ title: '消息流', summary: 'Inbox summary' }}
                threads={[thread]}
                messagesByThread={{ [thread.id]: [] }}
                selectedThread={thread}
                showHandled={false}
                onToggleHandled={onToggleHandled}
                onSelectThread={onSelectThread}
                onBackToList={onBackToList}
            />,
        )

        expect(container.querySelector('.prototype-message-panel__body--detail')).not.toBeNull()
        expect(container.querySelector('.prototype-thread-detail--immersive')).toBeNull()
        expect(container.querySelector('.prototype-message-panel__detail')).not.toBeNull()
    })

    it('renders the trace workspace when trace mode is active', () => {
        render(
            <MessageWorkspace
                heading={{ title: '消息流', summary: 'Inbox summary' }}
                threads={[]}
                messagesByThread={{}}
                selectedThread={null}
                mode="trace"
                traceSelection={{ planId: 'plan-approval-1', streamId: 'stream-ingest-contracts' }}
                showHandled={false}
                onToggleHandled={onToggleHandled}
                onSelectThread={onSelectThread}
                onBackToList={onBackToList}
            />,
        )

        expect(screen.getByTestId('plan-trace-workspace')).toHaveTextContent('plan-approval-1')
    })

    it('renders the raw session-log workspace when session-log mode is active', () => {
        render(
            <MessageWorkspace
                heading={{ title: '消息流', summary: 'Inbox summary' }}
                threads={[]}
                messagesByThread={{}}
                selectedThread={null}
                mode="session-log"
                sessionLogSelection={{
                    sessionId: 'session-runtime-1',
                    source: 'plan-runtime',
                    title: 'Lock runtime foundation',
                    subtitle: '01-01',
                }}
                showHandled={false}
                onToggleHandled={onToggleHandled}
                onSelectThread={onSelectThread}
                onBackToList={onBackToList}
            />,
        )

        expect(screen.getByTestId('session-log-workspace')).toHaveTextContent('session-runtime-1')
    })
})
