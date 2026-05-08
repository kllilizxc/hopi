import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import ThreadInbox from './ThreadInbox'
import type { OperatorThread } from '@/prototype/types'

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
        tone: 'accent',
        unread: true,
        passive: false,
        refs: [
            { kind: 'goal', id: 'goal-1', label: '01 First Playable Expedition' },
            { kind: 'plan', id: 'plan-1', label: 'Establish expedition domain' },
        ],
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

describe('ThreadInbox', () => {
    it('shows a distinct intervention label for blocking vs non-blocking inbox threads', () => {
        const onSelect = vi.fn()
        render(
            <ThreadInbox
                threads={[
                    buildThread({
                        id: 'approval-1',
                        kind: 'approval',
                        title: '需要审批的计划',
                    }),
                    buildThread({
                        id: 'direction-1',
                        kind: 'direction',
                        tone: 'default',
                        title: '路线调整',
                    }),
                ]}
                activeThreadId={null}
                showHandled={false}
                onToggleHandled={vi.fn()}
                onSelect={onSelect}
            />,
        )

        expect(screen.getByText('阻塞当前计划')).toBeInTheDocument()
        expect(screen.getByText('可并行处理')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: /路线调整/i }))
        expect(onSelect).toHaveBeenCalledWith('direction-1')
    })
})
