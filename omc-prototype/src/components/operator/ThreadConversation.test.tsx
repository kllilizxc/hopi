import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ThreadConversation from './ThreadConversation'
import type { OperatorMessage, OperatorThread } from '@/prototype/types'

const performQuickAction = vi.fn()
const sendThreadReply = vi.fn()
const openSessionLog = vi.fn()
const openTrace = vi.fn()
let composerValue = ''
let currentRuntime: { onSend?: (text: string) => void } = {}

vi.mock('@/prototype/store', () => ({
    usePrototypeStore: () => ({
        actions: {
            performQuickAction,
            sendThreadReply,
        },
        live: {
            sessionIdByPlanKey: {
                'plan-1': 'session-runtime-1',
            },
        },
    }),
}))

vi.mock('@/components/operator/OperatorSurfaceContext', () => ({
    useOperatorSurface: () => ({
        openInbox: vi.fn(),
        openThread: vi.fn(),
        openTrace,
        openSessionLog,
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
        openSessionLog.mockClear()
        openTrace.mockClear()
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

    it('renders a translated briefing card above the transcript and exposes evidence actions', () => {
        const thread = buildThread({
            id: 'approval:runtime',
            kind: 'approval',
            title: '执行中断，等待恢复确认',
            refs: [
                { kind: 'plan', id: 'plan-1', label: 'Establish expedition domain' },
            ],
            briefing: {
                title: '执行中断，等待恢复确认',
                decisionQuestion: '这一轮是否要在环境恢复后重试，还是先停在这里。',
                identity: {
                    projectLabel: 'CardGame',
                    goalLabel: '01 First Playable Expedition',
                    planLabel: 'Establish expedition domain',
                    attemptNumber: 3,
                    sessionId: 'session-runtime-1',
                },
                summaryRows: {
                    whatHappened: 'CardGame 的「Establish expedition domain」在执行中失去了关联 session，这一轮还没来得及上报结果。',
                    whyEscalated: '系统现在无法判断这轮应该继续、重试，还是改方向，所以需要你确认下一步。',
                    recommendedAction: '建议先查看日志，再决定是否恢复执行。',
                    currentImpact: '这张计划卡暂时不会继续自动推进。',
                },
                primaryAction: { label: '重试这一轮', helper: '建议先打开执行日志确认原因；重试后系统会重新拉起这一轮 attempt。' },
                secondaryAction: { label: '先停在这里', helper: '保留当前状态，不恢复自动推进。' },
                rawEvidence: {
                    summary: 'The linked session became inactive before the attempt reported a structured outcome.',
                    terminationReason: 'session-inactive',
                    nextSuggestedStep: 'Inspect the session history, then resume the loop when the machine is stable.',
                    failureFingerprint: 'session-inactive',
                    defaultExpanded: false,
                },
            },
            quickActions: [
                {
                    id: 'retry',
                    label: '重试这一轮',
                    tone: 'primary',
                    operation: { type: 'approval-approve', approvalId: 'plan-1' },
                },
            ],
        })

        render(
            <ThreadConversation
                thread={thread}
                messages={[
                    {
                        id: 'message-runtime',
                        threadId: thread.id,
                        role: 'agent',
                        body: '系统现在无法判断这轮应该继续、重试，还是改方向，所以需要你确认下一步。',
                        createdAt: '2026-04-07T10:00:00.000Z',
                    } satisfies OperatorMessage,
                ]}
            />,
        )

        expect(screen.getByText('发生了什么')).toBeInTheDocument()
        expect(screen.getByText('你现在要确认的是')).toBeInTheDocument()
        expect(screen.getByText('计划：Establish expedition domain')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '查看原始依据' })).toBeInTheDocument()
        expect(screen.queryByText('The linked session became inactive before the attempt reported a structured outcome.')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: '查看原始依据' }))
        expect(screen.getByText('The linked session became inactive before the attempt reported a structured outcome.')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: '打开执行日志' }))
        expect(openSessionLog).toHaveBeenCalledWith({
            sessionId: 'session-runtime-1',
            source: 'plan-runtime',
            title: 'Establish expedition domain',
            subtitle: 'plan-1',
        })

        fireEvent.click(screen.getByRole('button', { name: '打开原始轨迹' }))
        expect(openTrace).toHaveBeenCalledWith({
            planId: 'plan-1',
            streamId: 'plan-1',
        })
    })

    it('reuses the same briefing layout for non-runtime direction threads', () => {
        const thread = buildThread({
            briefing: {
                title: '做出每周投资简报 · 路线调整',
                decisionQuestion: null,
                identity: {
                    projectLabel: 'Portfolio Copilot',
                    goalLabel: '做出每周投资简报',
                    planLabel: '收紧周报框架',
                    attemptNumber: null,
                    sessionId: null,
                },
                summaryRows: {
                    whatHappened: '系统当前路线是先把周报框架收紧，避免一开始就把异常叙事做重。',
                    whyEscalated: '当前目标信心还不够高，路线和优先级都可能要重新拍板。',
                    recommendedAction: '如果你认同，就保持当前路线；如果不认同，可以直接改方向。',
                    currentImpact: '后续执行流会优先补齐框架和栏目边界。',
                },
                primaryAction: {
                    label: '收紧范围',
                    helper: '系统会按更保守的路线重排执行流、风险语气和后续摘要。',
                },
                secondaryAction: {
                    label: '保持路线',
                    helper: '维持当前路线和优先级继续推进。',
                },
                rawEvidence: {
                    summary: null,
                    terminationReason: null,
                    nextSuggestedStep: null,
                    failureFingerprint: null,
                    defaultExpanded: false,
                },
            },
        })

        render(
            <ThreadConversation
                thread={thread}
                messages={[
                    {
                        id: 'message-direction',
                        threadId: thread.id,
                        role: 'agent',
                        body: '如果你不改方向，我会按“框架先行”推进。',
                        createdAt: '2026-04-07T10:00:00.000Z',
                    } satisfies OperatorMessage,
                ]}
            />,
        )

        expect(screen.getByText('为什么会找你')).toBeInTheDocument()
        expect(screen.getByText('项目：Portfolio Copilot')).toBeInTheDocument()
        expect(screen.getByText('目标：做出每周投资简报')).toBeInTheDocument()
        expect(screen.getByText('计划：收紧周报框架')).toBeInTheDocument()
        expect(screen.getByText('按钮含义')).toBeInTheDocument()
        expect(screen.getByText('系统会按更保守的路线重排执行流、风险语气和后续摘要。')).toBeInTheDocument()
    })
})
