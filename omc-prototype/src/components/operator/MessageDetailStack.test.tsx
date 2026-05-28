import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import MessageWorkspace from './MessageWorkspace'
import type { OperatorMessage, OperatorThread } from '@/prototype/types'

const performQuickAction = vi.fn()
const sendThreadReply = vi.fn()
let composerValue = ''
let currentRuntime: { onSend?: (text: string) => void } = {}

vi.mock('@/prototype/store', () => ({
    usePrototypeStore: () => ({
        state: {
            checkpoint: 'approval',
            worldModel: {
                currentFocus: { goalId: null, streamId: null },
                workOrders: {},
                decisionTopics: {},
                agentEvents: [],
            },
            decisionTopics: {},
        },
        actions: {
            performQuickAction,
            sendThreadReply,
        },
    }),
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

vi.mock('@/lib/omcAssistantRuntime', () => ({
    useOmcAssistantRuntime: (options: { onSend?: (text: string) => void }) => options,
}))

vi.mock('@assistant-ui/react', () => ({
    AssistantRuntimeProvider: ({
        children,
        runtime,
    }: {
        children: React.ReactNode
        runtime?: { onSend?: (text: string) => void }
    }) => {
        currentRuntime = runtime ?? {}

        return <>{children}</>
    },
    ComposerPrimitive: {
        Root: ({ children, className }: { children: React.ReactNode; className?: string }) => (
            <div className={className}>{children}</div>
        ),
        Input: ({
            submitOnEnter: _submitOnEnter,
            maxRows: _maxRows,
            onChange,
            ...props
        }: React.ComponentProps<'textarea'> & {
            submitOnEnter?: boolean
            maxRows?: number
        }) => (
            <textarea
                {...props}
                onChange={(event) => {
                    composerValue = event.currentTarget.value
                    onChange?.(event)
                }}
            />
        ),
        Send: ({ children, className }: { children: React.ReactNode; className?: string }) => (
            <button className={className} onClick={() => currentRuntime.onSend?.(composerValue)}>
                {children}
            </button>
        ),
    },
    ThreadPrimitive: {
        Root: ({ children, className }: { children: React.ReactNode; className?: string }) => (
            <div className={className}>{children}</div>
        ),
        Viewport: ({
            children,
            className,
        }: {
            children: React.ReactNode
            className?: string
        }) => <div className={className}>{children}</div>,
        Messages: () => <div data-testid="thread-messages">mock messages</div>,
    },
    MessagePrimitive: {
        Root: ({ children, className }: { children: React.ReactNode; className?: string }) => (
            <div className={className}>{children}</div>
        ),
        Content: () => <div>message</div>,
    },
}))

function buildThread(overrides: Partial<OperatorThread> = {}): OperatorThread {
    return {
        id: 'thread-1',
        kind: 'approval',
        goalId: 'goal-1',
        title: '放行导入分支',
        preview: '导入链路验证通过，等待放行',
        updatedAt: '12 分钟前',
        lifecycle: 'pending',
        priority: 'high',
        tone: 'default',
        unread: true,
        passive: false,
        refs: [
            { kind: 'goal', id: 'goal-1', label: '完善持仓导入' },
            { kind: 'stream', id: 'stream-1', label: '导入链路收口' },
            { kind: 'plan', id: 'plan-1', label: '分支放行检查' },
        ],
        detailSections: [],
        firstMessage: {
            currentStatus: '导入分支已经补齐验证，等待你确认是否放行。',
            background: '今天补上了回归检查和数据对齐。',
            whyNow: '如果现在不拍板，合流窗口会错过今天的验证结果。',
            suggestedAction: '确认是否直接放行导入分支，或者告诉我还要补哪一步。',
            freeformInvite: '直接回复你希望我怎么处理这个放行节点。',
        },
        quickActions: [
            {
                id: 'approve-branch',
                label: '直接放行',
                tone: 'primary',
                operation: { type: 'approval-approve', approvalId: 'approval-1' },
            },
            {
                id: 'hold-branch',
                label: '再等等',
                tone: 'secondary',
                operation: { type: 'approval-defer', approvalId: 'approval-1' },
            },
        ],
        statusLabel: '待处理',
        ...overrides,
    }
}

function buildMessages(threadId: string): OperatorMessage[] {
    return [
        {
            id: 'message-1',
            threadId,
            role: 'agent',
            body: '验证已经完成，只差你一句话。',
            createdAt: '12 分钟前',
        },
    ]
}

describe('Message detail stack', () => {
    beforeEach(() => {
        performQuickAction.mockClear()
        sendThreadReply.mockClear()
        composerValue = ''
        currentRuntime = {}
    })

    it('renders the real selected-thread detail path with title layer, context line, actions, and dock order', () => {
        const thread = buildThread()
        const { container } = render(
            <MessageWorkspace
                heading={{ title: '消息流', summary: 'Inbox summary' }}
                threads={[thread]}
                messagesByThread={{ [thread.id]: buildMessages(thread.id) }}
                selectedThread={thread}
                showHandled={false}
                onToggleHandled={() => {}}
                onSelectThread={() => {}}
                onBackToList={() => {}}
            />,
        )

        expect(screen.getByRole('heading', { name: '放行导入分支' })).toBeInTheDocument()
        expect(screen.getByText('12 分钟前')).toBeInTheDocument()
        expect(screen.getAllByText('待处理')).toHaveLength(2)
        expect(screen.getByText('目标：完善持仓导入 · 执行流：导入链路收口 · 计划：分支放行检查')).toBeInTheDocument()
        expect(screen.getByText('建议动作')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '直接放行' })).toBeInTheDocument()

        const composer = screen.getByRole('textbox', { name: '回复这条线程' })
        expect(composer).toHaveAttribute('placeholder', '继续追问，或直接告诉 Agent 要怎么做')

        const dock = container.querySelector('.prototype-chat-thread__controls')
        const quickActions = dock?.querySelector('.prototype-thread-quick-actions')
        const composerShell = dock?.querySelector('.prototype-chat-compose')

        expect(dock).not.toBeNull()
        expect(quickActions).not.toBeNull()
        expect(composerShell).not.toBeNull()
        expect(dock?.firstElementChild).toBe(quickActions)
        expect(quickActions?.nextElementSibling).toBe(composerShell)

        fireEvent.click(screen.getByRole('button', { name: '直接放行' }))
        expect(performQuickAction).toHaveBeenCalledWith('thread-1', 'approve-branch')

        fireEvent.change(composer, {
            target: { value: '先放行，我来盯后续回归。' },
        })
        fireEvent.click(screen.getByRole('button', { name: '发送' }))
        expect(sendThreadReply).toHaveBeenCalledWith('thread-1', '先放行，我来盯后续回归。')
    })

    it('keeps the composer when the selected thread has no quick actions', () => {
        const thread = buildThread({
            quickActions: [],
        })
        const { container } = render(
            <MessageWorkspace
                heading={{ title: '消息流', summary: 'Inbox summary' }}
                threads={[thread]}
                messagesByThread={{ [thread.id]: buildMessages(thread.id) }}
                selectedThread={thread}
                showHandled={false}
                onToggleHandled={() => {}}
                onSelectThread={() => {}}
                onBackToList={() => {}}
            />,
        )

        expect(screen.queryByText('建议动作')).not.toBeInTheDocument()
        expect(container.querySelector('.prototype-thread-quick-actions')).toBeNull()
        expect(screen.getByRole('textbox', { name: '回复这条线程' })).toBeInTheDocument()
        expect(container.querySelector('.prototype-chat-compose')).not.toBeNull()
    })
})
