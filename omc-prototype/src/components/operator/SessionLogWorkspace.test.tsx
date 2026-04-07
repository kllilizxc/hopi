import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@hopi/protocol/types'
import SessionLogWorkspace from './SessionLogWorkspace'

if (typeof globalThis.ResizeObserver === 'undefined') {
    class ResizeObserverMock {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
    globalThis.ResizeObserver = ResizeObserverMock as typeof ResizeObserver
}

class FakeEventSource {
    static instances: FakeEventSource[] = []

    onmessage: ((event: MessageEvent<string>) => void) | null = null

    constructor(_url: string) {
        FakeEventSource.instances.push(this)
    }

    close() {
        FakeEventSource.instances = FakeEventSource.instances.filter((instance) => instance !== this)
    }

    static emit(payload: unknown) {
        const event = { data: JSON.stringify(payload) } as MessageEvent<string>
        for (const instance of FakeEventSource.instances) {
            instance.onmessage?.(event)
        }
    }

    static reset() {
        FakeEventSource.instances = []
    }
}

vi.stubGlobal('EventSource', FakeEventSource)

const mockUsePrototypeRemoteApi = vi.fn()
const mockUseSessionMessages = vi.fn()
const appendOptimisticMessage = vi.fn()
const seedMessageWindowFromSession = vi.fn()
const updateMessageStatus = vi.fn()

vi.mock('@/prototype/remoteApi', () => ({
    usePrototypeRemoteApi: () => mockUsePrototypeRemoteApi(),
}))

vi.mock('@/hooks/useSessionMessages', () => ({
    useSessionMessages: (...args: unknown[]) => mockUseSessionMessages(...args),
}))

vi.mock('@/lib/sessionMessageStore', () => ({
    appendOptimisticMessage: (...args: unknown[]) => appendOptimisticMessage(...args),
    seedMessageWindowFromSession: (...args: unknown[]) => seedMessageWindowFromSession(...args),
    updateMessageStatus: (...args: unknown[]) => updateMessageStatus(...args),
}))

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        activeAt: 1,
        metadata: {
            path: '/tmp/card-game',
            host: 'local',
            flavor: 'codex',
            worktree: {
                basePath: '/tmp/card-game',
                branch: 'omc/01-01',
                name: 'omc-01-01',
            },
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        active: true,
        thinking: false,
        thinkingAt: 1,
        permissionMode: 'default',
        modelMode: 'default',
        ...overrides,
    }
}

describe('SessionLogWorkspace', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        FakeEventSource.reset()
        mockUseSessionMessages.mockReturnValue({
            messages: [
                {
                    id: 'message-1',
                    seq: 1,
                    localId: null,
                    createdAt: Date.UTC(2026, 3, 6, 10, 0, 0),
                    content: {
                        role: 'assistant',
                        content: {
                            type: 'text',
                            text: 'first planning update',
                        },
                    },
                },
            ],
            warning: null,
            isLoading: false,
            isLoadingMore: false,
            hasMore: true,
            pendingCount: 0,
            messagesVersion: 1,
            loadMore: vi.fn(),
            refetch: vi.fn(),
            flushPending: vi.fn(),
            setAtBottom: vi.fn(),
        })
        mockUsePrototypeRemoteApi.mockReturnValue({
            getSession: vi.fn().mockResolvedValue({ session: createSession() }),
            resumeSession: vi.fn().mockResolvedValue('session-1'),
            sendMessage: vi.fn().mockResolvedValue(undefined),
            createEventsUrl: vi.fn().mockReturnValue('http://localhost:3006/api/events'),
            createSessionTerminalUrl: vi.fn().mockReturnValue('http://localhost:3006/sessions/session-1/terminal'),
        })
    })

    it('fetches and renders the raw transcript with metadata and controls', async () => {
        render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'planning-run',
                    title: 'CardGame',
                    subtitle: 'guided planning',
                }}
                onBack={() => {}}
            />,
        )

        expect(await screen.findByText('first planning update')).toBeInTheDocument()
        expect(screen.getByText('规划运行')).toBeInTheDocument()
        expect(screen.getByRole('link', { name: '打开终端' })).toHaveAttribute(
            'href',
            'http://localhost:3006/sessions/session-1/terminal',
        )
        expect(screen.getByRole('button', { name: '加载更早消息' })).toBeInTheDocument()
    })

    it('shows the inactive banner when the session is no longer active', async () => {
        mockUsePrototypeRemoteApi.mockReturnValue({
            getSession: vi.fn().mockResolvedValue({ session: createSession({ active: false }) }),
            resumeSession: vi.fn().mockResolvedValue('session-1'),
            sendMessage: vi.fn().mockResolvedValue(undefined),
            createEventsUrl: vi.fn().mockReturnValue('http://localhost:3006/api/events'),
            createSessionTerminalUrl: vi.fn().mockReturnValue('http://localhost:3006/sessions/session-1/terminal'),
        })

        render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'plan-runtime',
                    title: 'Lock runtime foundation',
                    subtitle: '01-01',
                }}
                onBack={() => {}}
            />,
        )

        expect(await screen.findByText('Session 已停止。发送新消息会先自动恢复，再继续写入。')).toBeInTheDocument()
    })

    it('appends a breathing live tail when the session is still producing output', async () => {
        mockUsePrototypeRemoteApi.mockReturnValue({
            getSession: vi.fn().mockResolvedValue({ session: createSession({ active: true, thinking: true }) }),
            resumeSession: vi.fn().mockResolvedValue('session-1'),
            sendMessage: vi.fn().mockResolvedValue(undefined),
            createEventsUrl: vi.fn().mockReturnValue('http://localhost:3006/api/events'),
            createSessionTerminalUrl: vi.fn().mockReturnValue('http://localhost:3006/sessions/session-1/terminal'),
        })

        const { container } = render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'plan-runtime',
                    title: 'Lock runtime foundation',
                    subtitle: '01-01',
                }}
                onBack={() => {}}
            />,
        )

        expect(await screen.findByText('first planning update')).toBeInTheDocument()
        expect(screen.getByText('底层 Agent 正在继续输出')).toBeInTheDocument()
        expect(screen.getByText('新消息会继续追加在这里。')).toBeInTheDocument()
        expect(container.querySelector('.prototype-session-log__tail--running')).not.toBeNull()
        expect(container.querySelector('.prototype-session-log__tail-dot--pulse')).not.toBeNull()
    })

    it('stops the breathing tail when a session-updated event clears thinking', async () => {
        mockUsePrototypeRemoteApi.mockReturnValue({
            getSession: vi.fn().mockResolvedValue({ session: createSession({ active: true, thinking: true }) }),
            resumeSession: vi.fn().mockResolvedValue('session-1'),
            sendMessage: vi.fn().mockResolvedValue(undefined),
            createEventsUrl: vi.fn().mockReturnValue('http://localhost:3006/api/events'),
            createSessionTerminalUrl: vi.fn().mockReturnValue('http://localhost:3006/sessions/session-1/terminal'),
        })

        const { container } = render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'plan-runtime',
                    title: 'Lock runtime foundation',
                    subtitle: '01-01',
                }}
                onBack={() => {}}
            />,
        )

        expect(await screen.findByText('first planning update')).toBeInTheDocument()
        expect(screen.getByText('底层 Agent 正在继续输出')).toBeInTheDocument()

        FakeEventSource.emit({
            type: 'session-updated',
            sessionId: 'session-1',
            data: {
                active: true,
                thinking: false,
            },
        })

        await waitFor(() => {
            expect(screen.getByText('会话仍在线，等待下一步')).toBeInTheDocument()
        })
        expect(screen.queryByText('底层 Agent 正在继续输出')).toBeNull()
        expect(container.querySelector('.prototype-session-log__tail--live')).not.toBeNull()
        expect(container.querySelector('.prototype-session-log__tail-dot--pulse')).toBeNull()
    })

    it('refetches the session state when a session-updated event only carries a sid', async () => {
        const getSession = vi.fn()
            .mockResolvedValueOnce({ session: createSession({ active: true, thinking: true }) })
            .mockResolvedValueOnce({ session: createSession({ active: true, thinking: false }) })
        mockUsePrototypeRemoteApi.mockReturnValue({
            getSession,
            resumeSession: vi.fn().mockResolvedValue('session-1'),
            sendMessage: vi.fn().mockResolvedValue(undefined),
            createEventsUrl: vi.fn().mockReturnValue('http://localhost:3006/api/events'),
            createSessionTerminalUrl: vi.fn().mockReturnValue('http://localhost:3006/sessions/session-1/terminal'),
        })

        render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'plan-runtime',
                    title: 'Lock runtime foundation',
                    subtitle: '01-01',
                }}
                onBack={() => {}}
            />,
        )

        expect(await screen.findByText('底层 Agent 正在继续输出')).toBeInTheDocument()

        FakeEventSource.emit({
            type: 'session-updated',
            sessionId: 'session-1',
            data: {
                sid: 'session-1',
            },
        })

        await waitFor(() => {
            expect(getSession).toHaveBeenCalledTimes(2)
        })
        await waitFor(() => {
            expect(screen.getByText('会话仍在线，等待下一步')).toBeInTheDocument()
        })
    })

    it('marks the transcript tail as ended once the session has stopped', async () => {
        mockUsePrototypeRemoteApi.mockReturnValue({
            getSession: vi.fn().mockResolvedValue({ session: createSession({ active: false, thinking: false }) }),
            resumeSession: vi.fn().mockResolvedValue('session-1'),
            sendMessage: vi.fn().mockResolvedValue(undefined),
            createEventsUrl: vi.fn().mockReturnValue('http://localhost:3006/api/events'),
            createSessionTerminalUrl: vi.fn().mockReturnValue('http://localhost:3006/sessions/session-1/terminal'),
        })

        const { container } = render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'plan-runtime',
                    title: 'Lock runtime foundation',
                    subtitle: '01-01',
                }}
                onBack={() => {}}
            />,
        )

        expect(await screen.findByText('first planning update')).toBeInTheDocument()
        expect(screen.getByText('本轮输出已结束')).toBeInTheDocument()
        expect(screen.getByText('这条 Session 已停止；如果你继续发送，系统会先自动恢复。')).toBeInTheDocument()
        expect(container.querySelector('.prototype-session-log__tail--stopped')).not.toBeNull()
        expect(container.querySelector('.prototype-session-log__tail-dot--pulse')).toBeNull()
    })

    it('resumes an inactive session before sending and switches to the resumed session id', async () => {
        const api = {
            getSession: vi.fn().mockResolvedValue({ session: createSession({ active: false }) }),
            resumeSession: vi.fn().mockResolvedValue('session-2'),
            sendMessage: vi.fn().mockResolvedValue(undefined),
            createEventsUrl: vi.fn().mockReturnValue('http://localhost:3006/api/events'),
            createSessionTerminalUrl: vi.fn().mockImplementation((sessionId: string) => `http://localhost:3006/sessions/${sessionId}/terminal`),
        }
        mockUsePrototypeRemoteApi.mockReturnValue(api)

        render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'plan-runtime',
                    title: 'Lock runtime foundation',
                    subtitle: '01-01',
                }}
                onBack={() => {}}
            />,
        )

        await screen.findByText('first planning update')

        fireEvent.change(screen.getByRole('textbox', { name: '发送到底层 Session' }), {
            target: { value: 'continue with the current slice' },
        })
        fireEvent.click(screen.getByRole('button', { name: '发送' }))

        await waitFor(() => {
            expect(api.resumeSession).toHaveBeenCalledWith('session-1')
        })
        await waitFor(() => {
            expect(seedMessageWindowFromSession).toHaveBeenCalledWith('session-1', 'session-2')
        })
        await waitFor(() => {
            expect(api.sendMessage).toHaveBeenCalledWith('session-2', 'continue with the current slice', expect.any(String))
        })
    })

    it('delegates the back affordance to the panel shell', async () => {
        const onBack = vi.fn()

        render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'planning-run',
                    title: 'CardGame',
                    subtitle: 'guided planning',
                }}
                onBack={onBack}
            />,
        )

        await screen.findByText('first planning update')

        fireEvent.click(screen.getByRole('button', { name: '返回消息面板' }))
        expect(onBack).toHaveBeenCalledTimes(1)
    })

    it('keeps transcript messages inside a dedicated session scroll shell', async () => {
        render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'planning-run',
                    title: 'CardGame',
                    subtitle: 'guided planning',
                }}
                onBack={() => {}}
            />,
        )

        await screen.findByText('first planning update')
        expect(screen.getByTestId('session-log-scroll-shell')).toBeInTheDocument()
    })

    it('renders a separate topbar so actions do not squeeze the title column', async () => {
        const { container } = render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'plan-runtime',
                    title: 'Establish the expedition domain, persistence, and prototype content backbone for Phase 01.',
                    subtitle: '01-01',
                }}
                onBack={() => {}}
            />,
        )

        await screen.findByText('first planning update')

        expect(container.querySelector('.prototype-session-log__topbar')).not.toBeNull()
        expect(container.querySelector('.prototype-session-log__topbar .prototype-session-log__title')).toBeNull()
        expect(container.querySelector('.prototype-session-log__meta--wrapped')).not.toBeNull()
    })

    it('uses a scroll-safe top-aligned transcript stack instead of bottom-justified chat layout', async () => {
        const { container } = render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'planning-run',
                    title: 'CardGame',
                    subtitle: 'guided planning',
                }}
                onBack={() => {}}
            />,
        )

        await screen.findByText('first planning update')
        expect(container.querySelector('.prototype-chat-thread__messages--chronological')).not.toBeNull()
    })

    it('renders codex markdown messages as rich text instead of raw payload JSON', async () => {
        mockUseSessionMessages.mockReturnValue({
            messages: [
                {
                    id: 'message-codex-markdown',
                    seq: 2,
                    localId: null,
                    createdAt: Date.UTC(2026, 3, 6, 10, 1, 0),
                    content: {
                        role: 'agent',
                        content: {
                            type: 'codex',
                            data: {
                                type: 'message',
                                message: 'hello **world**',
                                id: 'codex-message-1',
                            },
                        },
                    },
                },
            ],
            warning: null,
            isLoading: false,
            isLoadingMore: false,
            hasMore: false,
            pendingCount: 0,
            messagesVersion: 1,
            loadMore: vi.fn(),
            refetch: vi.fn(),
            flushPending: vi.fn(),
            setAtBottom: vi.fn(),
        })

        const { container } = render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'planning-run',
                    title: 'CardGame',
                    subtitle: 'guided planning',
                }}
                onBack={() => {}}
            />,
        )

        await screen.findByText('hello')
        expect(container.querySelector('strong')).not.toBeNull()
        expect(screen.queryByText(/\"type\": \"codex\"/)).toBeNull()
    })

    it('renders codex plan messages as readable plan steps instead of raw JSON', async () => {
        mockUseSessionMessages.mockReturnValue({
            messages: [
                {
                    id: 'message-codex-plan',
                    seq: 3,
                    localId: null,
                    createdAt: Date.UTC(2026, 3, 6, 10, 2, 0),
                    content: {
                        role: 'agent',
                        content: {
                            type: 'codex',
                            data: {
                                type: 'plan',
                                entries: [
                                    {
                                        id: 'plan-1',
                                        content: 'Inspect seeded planning docs',
                                        status: 'completed',
                                    },
                                    {
                                        id: 'plan-2',
                                        content: 'Write the first executable planning card',
                                        status: 'in_progress',
                                    },
                                ],
                                explanation: 'Planning status',
                                id: 'codex-plan-1',
                            },
                        },
                    },
                },
            ],
            warning: null,
            isLoading: false,
            isLoadingMore: false,
            hasMore: false,
            pendingCount: 0,
            messagesVersion: 1,
            loadMore: vi.fn(),
            refetch: vi.fn(),
            flushPending: vi.fn(),
            setAtBottom: vi.fn(),
        })

        render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'planning-run',
                    title: 'CardGame',
                    subtitle: 'guided planning',
                }}
                onBack={() => {}}
            />,
        )

        await screen.findByText('Planning status')
        expect(screen.getByText('Inspect seeded planning docs')).toBeInTheDocument()
        expect(screen.getByText('Write the first executable planning card')).toBeInTheDocument()
        expect(screen.queryByText(/\"entries\"/)).toBeNull()
    })

    it('renders tool traces as structured tool cards while still hiding low-signal ready events', async () => {
        mockUseSessionMessages.mockReturnValue({
            messages: [
                {
                    id: 'message-tool-call',
                    seq: 1,
                    localId: null,
                    createdAt: Date.UTC(2026, 3, 6, 10, 0, 0),
                    content: {
                        role: 'agent',
                        content: {
                            type: 'codex',
                            data: {
                                type: 'tool-call',
                                name: 'CodexBash',
                                callId: 'call-1',
                                input: { command: 'pwd' },
                                id: 'tool-call-1',
                            },
                        },
                    },
                },
                {
                    id: 'message-tool-result',
                    seq: 2,
                    localId: null,
                    createdAt: Date.UTC(2026, 3, 6, 10, 0, 1),
                    content: {
                        role: 'agent',
                        content: {
                            type: 'codex',
                            data: {
                                type: 'tool-call-result',
                                callId: 'call-1',
                                output: {
                                    cwd: '/tmp/card-game',
                                    command: 'pwd',
                                    exit_code: 0,
                                },
                                id: 'tool-result-1',
                            },
                        },
                    },
                },
                {
                    id: 'message-ready',
                    seq: 3,
                    localId: null,
                    createdAt: Date.UTC(2026, 3, 6, 10, 0, 2),
                    content: {
                        role: 'agent',
                        content: {
                            type: 'event',
                            data: {
                                type: 'ready',
                                hasAssistantReply: true,
                            },
                        },
                    },
                },
                {
                    id: 'message-summary',
                    seq: 4,
                    localId: null,
                    createdAt: Date.UTC(2026, 3, 6, 10, 0, 3),
                    content: {
                        role: 'agent',
                        content: {
                            type: 'codex',
                            data: {
                                type: 'message',
                                message: 'Created the first executable planning cards.',
                                id: 'codex-message-summary',
                            },
                        },
                    },
                },
            ],
            warning: null,
            isLoading: false,
            isLoadingMore: false,
            hasMore: false,
            pendingCount: 0,
            messagesVersion: 1,
            loadMore: vi.fn(),
            refetch: vi.fn(),
            flushPending: vi.fn(),
            setAtBottom: vi.fn(),
        })

        render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'planning-run',
                    title: 'CardGame',
                    subtitle: 'guided planning',
                }}
                onBack={() => {}}
            />,
        )

        await screen.findByText('Created the first executable planning cards.')
        expect(screen.getByText('Terminal')).toBeInTheDocument()
        expect(screen.getAllByText('pwd').length).toBeGreaterThan(0)
        expect(screen.queryByText(/Tool Call:/)).toBeNull()
        expect(screen.queryByText(/Tool Result:/)).toBeNull()
        expect(screen.queryByText(/hasAssistantReply/)).toBeNull()
    })

    it('collapses a tool call and its result into a single structured tool card', async () => {
        mockUseSessionMessages.mockReturnValue({
            messages: [
                {
                    id: 'message-tool-call',
                    seq: 1,
                    localId: null,
                    createdAt: Date.UTC(2026, 3, 6, 10, 0, 0),
                    content: {
                        role: 'agent',
                        content: {
                            type: 'codex',
                            data: {
                                type: 'tool-call',
                                name: 'CodexBash',
                                callId: 'call-1',
                                input: { command: 'pwd' },
                                id: 'tool-call-1',
                            },
                        },
                    },
                },
                {
                    id: 'message-tool-result',
                    seq: 2,
                    localId: null,
                    createdAt: Date.UTC(2026, 3, 6, 10, 0, 1),
                    content: {
                        role: 'agent',
                        content: {
                            type: 'codex',
                            data: {
                                type: 'tool-call-result',
                                callId: 'call-1',
                                output: {
                                    cwd: '/tmp/card-game',
                                    command: 'pwd',
                                    exit_code: 0,
                                },
                                id: 'tool-result-1',
                            },
                        },
                    },
                },
            ],
            warning: null,
            isLoading: false,
            isLoadingMore: false,
            hasMore: false,
            pendingCount: 0,
            messagesVersion: 1,
            loadMore: vi.fn(),
            refetch: vi.fn(),
            flushPending: vi.fn(),
            setAtBottom: vi.fn(),
        })

        const { container } = render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'planning-run',
                    title: 'CardGame',
                    subtitle: 'guided planning',
                }}
                onBack={() => {}}
            />,
        )

        await screen.findByText('Terminal')
        expect(container.querySelectorAll('.prototype-session-log__tool-card')).toHaveLength(1)
    })

    it('keeps codex reasoning visible in the transcript', async () => {
        mockUseSessionMessages.mockReturnValue({
            messages: [
                {
                    id: 'message-reasoning',
                    seq: 1,
                    localId: null,
                    createdAt: Date.UTC(2026, 3, 6, 10, 0, 0),
                    content: {
                        role: 'agent',
                        content: {
                            type: 'codex',
                            data: {
                                type: 'reasoning',
                                message: 'I should inspect the seeded plans before writing phase output.',
                                id: 'codex-reasoning-1',
                            },
                        },
                    },
                },
            ],
            warning: null,
            isLoading: false,
            isLoadingMore: false,
            hasMore: false,
            pendingCount: 0,
            messagesVersion: 1,
            loadMore: vi.fn(),
            refetch: vi.fn(),
            flushPending: vi.fn(),
            setAtBottom: vi.fn(),
        })

        render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'planning-run',
                    title: 'CardGame',
                    subtitle: 'guided planning',
                }}
                onBack={() => {}}
            />,
        )

        await screen.findByText('Reasoning')
        expect(screen.getByText('I should inspect the seeded plans before writing phase output.')).toBeInTheDocument()
    })

    it('renders separate transcript cards for separate visible agent outputs', async () => {
        mockUseSessionMessages.mockReturnValue({
            messages: [
                {
                    id: 'message-1',
                    seq: 1,
                    localId: null,
                    createdAt: Date.UTC(2026, 3, 6, 10, 0, 0),
                    content: {
                        role: 'agent',
                        content: {
                            type: 'codex',
                            data: {
                                type: 'message',
                                message: 'First visible update',
                                id: 'codex-message-1',
                            },
                        },
                    },
                },
                {
                    id: 'message-2',
                    seq: 2,
                    localId: null,
                    createdAt: Date.UTC(2026, 3, 6, 10, 0, 5),
                    content: {
                        role: 'agent',
                        content: {
                            type: 'codex',
                            data: {
                                type: 'message',
                                message: 'Second visible update',
                                id: 'codex-message-2',
                            },
                        },
                    },
                },
            ],
            warning: null,
            isLoading: false,
            isLoadingMore: false,
            hasMore: false,
            pendingCount: 0,
            messagesVersion: 1,
            loadMore: vi.fn(),
            refetch: vi.fn(),
            flushPending: vi.fn(),
            setAtBottom: vi.fn(),
        })

        const { container } = render(
            <SessionLogWorkspace
                selection={{
                    sessionId: 'session-1',
                    source: 'planning-run',
                    title: 'CardGame',
                    subtitle: 'guided planning',
                }}
                onBack={() => {}}
            />,
        )

        await screen.findByText('First visible update')
        await screen.findByText('Second visible update')
        expect(container.querySelectorAll('.prototype-thread-message--agent')).toHaveLength(2)
    })
})
