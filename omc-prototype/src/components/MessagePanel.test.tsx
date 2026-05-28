import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OperatorMessage, OperatorThread, SessionLogSelection } from '@/prototype/types'

const storeState: {
    activeThread: OperatorThread | null
    activeThreadSelectionId: number
    threads: OperatorThread[]
    state: {
        threadsById: Record<string, OperatorThread>
        messagesByThread: Record<string, OperatorMessage[]>
        traceSelection: { planId: string; streamId: string } | null
    }
    actions: {
        setActiveThread: (id: string) => void
        clearPlanTrace: () => void
        openPlanTrace: (input: { planId: string; streamId: string }) => void
    }
} = {
    activeThread: null,
    activeThreadSelectionId: 0,
    threads: [],
    state: {
        threadsById: {},
        messagesByThread: {},
        traceSelection: null,
    },
    actions: {
        setActiveThread: vi.fn(),
        clearPlanTrace: vi.fn(),
        openPlanTrace: vi.fn(),
    },
}

const operatorSurfaceState: {
    activeSessionLog: SessionLogSelection | null
    clearSessionLog: () => void
} = {
    activeSessionLog: null,
    clearSessionLog: vi.fn(),
}

const locationState: {
    pathname: string
    searchStr?: string
} = {
    pathname: '/goals/goal-1',
    searchStr: '',
}

vi.mock('@tanstack/react-router', () => ({
    useLocation: () => locationState,
}))

vi.mock('@/prototype/store', () => ({
    usePrototypeStore: () => storeState,
}))

vi.mock('@/components/operator/OperatorSurfaceContext', () => ({
    useOperatorSurface: () => ({
        openInbox: vi.fn(),
        openThread: vi.fn(),
        openTrace: vi.fn(),
        openSessionLog: vi.fn(),
        closePanel: vi.fn(),
        clearSessionLog: operatorSurfaceState.clearSessionLog,
        isOpen: true,
        activeTrace: storeState.state.traceSelection,
        activeSessionLog: operatorSurfaceState.activeSessionLog,
    }),
}))

vi.mock('@/components/operator/MessageWorkspace', () => ({
    default: function MockMessageWorkspace(props: {
        mode?: 'inbox' | 'thread' | 'trace' | 'session-log'
        selectedThread: OperatorThread | null
        traceSelection?: { planId: string; streamId: string } | null
        sessionLogSelection?: { sessionId: string } | null
        heading?: { summary: string }
        onSelectThread: (threadId: string) => void
        onBackToList: () => void
    }) {
        return (
            <div>
                <div data-testid="workspace-heading">{props.heading?.summary ?? ''}</div>
                <div data-testid="workspace-mode">
                    {props.mode === 'session-log'
                        ? `session-log:${props.sessionLogSelection?.sessionId ?? 'unknown'}`
                        : props.mode === 'trace'
                        ? `trace:${props.traceSelection?.planId ?? 'unknown'}`
                        : props.selectedThread
                            ? `detail:${props.selectedThread.title}`
                            : 'list'}
                </div>
                <button type="button" onClick={props.onBackToList}>
                    back
                </button>
            </div>
        )
    },
}))

describe('MessagePanel', () => {
    beforeEach(() => {
        locationState.pathname = '/goals/goal-1'
        locationState.searchStr = ''
        storeState.activeThread = null
        storeState.activeThreadSelectionId = 0
        storeState.threads = [buildThread()]
        storeState.state.threadsById = {
            'thread-1': buildThread(),
        }
        storeState.state.messagesByThread = {
            'thread-1': [],
        }
        storeState.state.traceSelection = null
        operatorSurfaceState.activeSessionLog = null
        operatorSurfaceState.clearSessionLog = vi.fn(() => {
            operatorSurfaceState.activeSessionLog = null
        })
        storeState.actions.setActiveThread = vi.fn((id: string) => {
            storeState.activeThreadSelectionId += 1
            storeState.activeThread = storeState.state.threadsById[id] ?? null
        })
        storeState.actions.clearPlanTrace = vi.fn(() => {
            storeState.state.traceSelection = null
        })
        storeState.actions.openPlanTrace = vi.fn((input: { planId: string; streamId: string }) => {
            storeState.state.traceSelection = input
        })
    })

    it('uses store activeThread selection and keeps the back-to-list handoff', async () => {
        const { default: MessagePanel } = await import('./MessagePanel')
        const { rerender } = render(<MessagePanel />)

        expect(screen.getByTestId('workspace-mode')).toHaveTextContent('list')

        storeState.actions.setActiveThread('thread-1')
        rerender(<MessagePanel />)

        expect(screen.getByTestId('workspace-mode')).toHaveTextContent('detail:Alpha thread')

        fireEvent.click(screen.getByRole('button', { name: 'back' }))
        rerender(<MessagePanel />)
        expect(screen.getByTestId('workspace-mode')).toHaveTextContent('list')

        storeState.actions.setActiveThread('thread-1')
        rerender(<MessagePanel />)

        expect(screen.getByTestId('workspace-mode')).toHaveTextContent('detail:Alpha thread')
    })

    it('shows trace mode before thread detail when a plan trace is active', async () => {
        const { default: MessagePanel } = await import('./MessagePanel')

        storeState.activeThread = storeState.state.threadsById['thread-1'] ?? null
        storeState.activeThreadSelectionId = 1
        storeState.state.traceSelection = {
            planId: 'plan-ingest-proof',
            streamId: 'stream-ingest-contracts',
        }

        render(<MessagePanel />)

        expect(screen.getByTestId('workspace-mode')).toHaveTextContent('trace:plan-ingest-proof')
    })

    it('shows session-log mode before trace when a raw session viewer is active', async () => {
        const { default: MessagePanel } = await import('./MessagePanel')

        storeState.activeThread = storeState.state.threadsById['thread-1'] ?? null
        storeState.activeThreadSelectionId = 1
        storeState.state.traceSelection = {
            planId: 'plan-ingest-proof',
            streamId: 'stream-ingest-contracts',
        }
        operatorSurfaceState.activeSessionLog = {
            sessionId: 'session-planning-1',
            source: 'planning-run',
            title: 'CardGame',
            subtitle: 'guided planning',
        }

        render(<MessagePanel />)

        expect(screen.getByTestId('workspace-mode')).toHaveTextContent('session-log:session-planning-1')
    })

    it('clears trace mode on back and reveals the underlying thread selection', async () => {
        const { default: MessagePanel } = await import('./MessagePanel')

        const { rerender } = render(<MessagePanel />)

        storeState.actions.setActiveThread('thread-1')
        rerender(<MessagePanel />)

        storeState.state.traceSelection = {
            planId: 'plan-ingest-proof',
            streamId: 'stream-ingest-contracts',
        }
        rerender(<MessagePanel />)

        expect(screen.getByTestId('workspace-mode')).toHaveTextContent('trace:plan-ingest-proof')

        fireEvent.click(screen.getByRole('button', { name: 'back' }))
        rerender(<MessagePanel />)

        expect(screen.getByTestId('workspace-mode')).toHaveTextContent('detail:Alpha thread')
    })

    it('clears session-log mode on back and reveals the underlying trace selection', async () => {
        const { default: MessagePanel } = await import('./MessagePanel')
        const { rerender } = render(<MessagePanel />)

        storeState.state.traceSelection = {
            planId: 'plan-ingest-proof',
            streamId: 'stream-ingest-contracts',
        }
        operatorSurfaceState.activeSessionLog = {
            sessionId: 'session-runtime-1',
            source: 'plan-runtime',
            title: 'Lock runtime foundation',
            subtitle: '01-01',
        }

        rerender(<MessagePanel />)
        expect(screen.getByTestId('workspace-mode')).toHaveTextContent('session-log:session-runtime-1')

        fireEvent.click(screen.getByRole('button', { name: 'back' }))
        expect(operatorSurfaceState.clearSessionLog).toHaveBeenCalledTimes(1)

        rerender(<MessagePanel />)
        expect(screen.getByTestId('workspace-mode')).toHaveTextContent('trace:plan-ingest-proof')
    })

    it('treats the root workspace goal query as the current goal context', async () => {
        const { default: MessagePanel } = await import('./MessagePanel')

        locationState.pathname = '/'
        locationState.searchStr = '?goal=goal-1'

        render(<MessagePanel />)

        expect(screen.getByTestId('workspace-heading')).toHaveTextContent('围绕当前目标的话题会优先排前，默认先看列表。')
    })
})

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
