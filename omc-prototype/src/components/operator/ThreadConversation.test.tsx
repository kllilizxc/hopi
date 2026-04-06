import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ThreadConversation from './ThreadConversation'
import type { OperatorMessage, OperatorThread } from '@/prototype/types'

const performQuickAction = vi.fn()
const sendThreadReply = vi.fn()
let composerValue = ''
let currentRuntime: { onSend?: (text: string) => void } = {}

vi.mock('@/prototype/store', () => ({
    usePrototypeStore: () => ({
        actions: {
            performQuickAction,
            sendThreadReply,
        },
    }),
}))

vi.mock('@/lib/omcAssistantRuntime', () => ({
    useOmcAssistantRuntime: (options: { onSend?: (text: string) => void }) => options,
}))

vi.mock('@/components/MarkdownRenderer', () => ({
    MarkdownMessagePart: () => <div>markdown</div>,
}))

vi.mock('@/components/operator/ThreadHeader', () => ({
    default: () => <div data-testid="thread-header">thread header</div>,
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
        kind: 'direction',
        goalId: 'goal-1',
        title: '做出每周投资简报',
        preview: '当前主线在周报框架',
        updatedAt: '12 分钟前',
        lifecycle: 'waiting',
        priority: 'high',
        tone: 'accent',
        unread: true,
        passive: false,
        refs: [],
        detailSections: [],
        firstMessage: {
            currentStatus: '现在在待启动，置信 24%。',
            background: '先把主线缩到周报框架。',
            whyNow: '栏目优先级还没钉死。',
            suggestedAction: '直接回复要保留的栏目。',
            freeformInvite: '也可以改路线。',
        },
        quickActions: [
            {
                id: 'keep-track',
                label: '沿用当前主线',
                tone: 'primary',
                operation: { type: 'direction-set', goalId: 'goal-1', direction: 'maintain' },
            },
            {
                id: 'tighten-scope',
                label: '收紧栏目',
                tone: 'secondary',
                operation: { type: 'direction-set', goalId: 'goal-1', direction: 'tighten-scope' },
            },
        ],
        statusLabel: '等你回复',
        ...overrides,
    }
}

describe('ThreadConversation', () => {
    beforeEach(() => {
        performQuickAction.mockClear()
        sendThreadReply.mockClear()
        composerValue = ''
        currentRuntime = {}
    })

    it('keeps quick actions ahead of the composer inside the dock and wires actions', () => {
        const thread = buildThread()
        const { container } = render(
            <ThreadConversation
                thread={thread}
                messages={[
                    {
                        id: 'message-1',
                        threadId: 'thread-1',
                        role: 'agent',
                        body: '如果你不改方向，我会按“框架先行”推进。',
                        createdAt: '12 分钟前',
                    } satisfies OperatorMessage,
                ]}
            />,
        )

        expect(screen.getByTestId('thread-messages')).toBeInTheDocument()
        expect(screen.getByText('建议动作')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '沿用当前主线' })).toBeInTheDocument()
        const composer = screen.getByRole('textbox', { name: '回复这条线程' })
        expect(composer).toHaveAttribute('placeholder', '继续追问，或直接告诉 Agent 要怎么做')
        expect(container.querySelector('.prototype-chat-thread')).not.toBeNull()
        expect(container.querySelector('.prototype-chat-thread__root')).not.toBeNull()
        expect(container.querySelector('.prototype-chat-thread__viewport')).not.toBeNull()
        expect(container.querySelector('.prototype-chat-thread__messages')).not.toBeNull()

        const dock = container.querySelector('.prototype-chat-thread__controls')
        expect(dock).not.toBeNull()

        const quickActions = dock?.querySelector('.prototype-thread-quick-actions')
        const composerShell = dock?.querySelector('.prototype-chat-compose')

        expect(quickActions).not.toBeNull()
        expect(composerShell).not.toBeNull()
        expect(dock?.firstElementChild).toBe(quickActions)
        expect(quickActions?.nextElementSibling).toBe(composerShell)

        fireEvent.click(screen.getByRole('button', { name: '沿用当前主线' }))
        expect(performQuickAction).toHaveBeenCalledWith('thread-1', 'keep-track')

        fireEvent.change(composer, {
            target: { value: '请先保留三段式栏目' },
        })
        fireEvent.click(screen.getByRole('button', { name: '发送' }))
        expect(sendThreadReply).toHaveBeenCalledWith('thread-1', '请先保留三段式栏目')
    })

    it('renders approval-boundary quick actions for decision topics', () => {
        const approvalThread = buildThread({
            id: 'approval:branch',
            kind: 'approval',
            title: '要不要现在放行导入分支',
            preview: '导入分支已经接近放行边界。',
            lifecycle: 'pending',
            tone: 'accent',
            firstMessage: {
                currentStatus: '现在要你拍板：放行导入分支。',
                background: '导入链路已经基本稳定。',
                whyNow: '继续自动推进会跨过经营边界。',
                suggestedAction: '如果你认可，我就放行。',
                freeformInvite: '也可以直接说别放。',
            },
            quickActions: [
                {
                    id: 'approve',
                    label: '确认放行',
                    tone: 'primary',
                    operation: { type: 'approval-approve', approvalId: 'approval-branch-ingest' },
                },
            ],
            statusLabel: '待处理',
        })

        render(
            <ThreadConversation
                thread={approvalThread}
                messages={[
                    {
                        id: 'message-approval',
                        threadId: approvalThread.id,
                        role: 'agent',
                        body: '现在要你拍板：放行导入分支。',
                        createdAt: '2026-04-06T10:00:00.000Z',
                    } satisfies OperatorMessage,
                ]}
            />,
        )

        expect(screen.getByRole('button', { name: '确认放行' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: '确认放行' }))
        expect(performQuickAction).toHaveBeenCalledWith('approval:branch', 'approve')
    })
})
