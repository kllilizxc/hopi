import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import ThreadHeader from './ThreadHeader'
import type { OperatorThread } from '@/prototype/types'

function buildThread(overrides: Partial<OperatorThread> = {}): OperatorThread {
    return {
        id: 'thread-1',
        kind: 'direction',
        goalId: 'goal-1',
        title: 'Alpha thread',
        preview: 'Review the plan',
        updatedAt: '10:00',
        lifecycle: 'pending',
        priority: 'high',
        tone: 'default',
        unread: true,
        passive: false,
        refs: [
            { kind: 'plan', id: 'plan-1', label: '排期计划' },
            { kind: 'goal', id: 'goal-1', label: '目标总览' },
            { kind: 'impact', id: 'impact-1', label: '影响面' },
            { kind: 'phase', id: 'phase-1', label: '发现阶段' },
            { kind: 'stream', id: 'stream-1', label: '主线执行流' },
        ],
        detailSections: [],
        firstMessage: {
            currentStatus: 'Status',
            background: 'Background',
            whyNow: '现在需要立刻处理，因为阻塞已经进入当前迭代。',
            suggestedAction: '先确认范围，再开始拆解并推进最小闭环。',
            freeformInvite: 'Reply here',
        },
        quickActions: [],
        statusLabel: '待处理',
        ...overrides,
    }
}

describe('ThreadHeader', () => {
    it('renders status plus one light context line from the most relevant refs', () => {
        render(<ThreadHeader thread={buildThread()} />)

        expect(screen.getByText('待处理')).toBeInTheDocument()
        expect(screen.getByText('计划：排期计划 · 目标：目标总览 · 阶段：发现阶段')).toBeInTheDocument()
        expect(screen.queryByText('目标')).not.toBeInTheDocument()
        expect(screen.queryByText('阶段')).not.toBeInTheDocument()
        expect(screen.queryByText('影响面')).not.toBeInTheDocument()
        expect(screen.queryByText('执行流')).not.toBeInTheDocument()
        expect(screen.queryByText('为什么现在需要你')).not.toBeInTheDocument()
        expect(screen.queryByText('执行动作')).not.toBeInTheDocument()
    })

    it('keeps the status line even when there is no context to show', () => {
        render(<ThreadHeader thread={buildThread({ refs: [] })} />)

        expect(screen.getByText('待处理')).toBeInTheDocument()
        expect(screen.queryByText(/目标：/)).not.toBeInTheDocument()
    })

    it('hides the lightweight context line when a briefing card will render below', () => {
        render(
            <ThreadHeader
                thread={buildThread({
                    briefing: {
                        title: '执行中断，等待恢复确认',
                        identity: {
                            projectLabel: 'CardGame',
                            goalLabel: '01 First Playable Expedition',
                            planLabel: 'Establish expedition domain',
                            attemptNumber: 3,
                            sessionId: 'session-cardgame-1',
                        },
                        summaryRows: {
                            whatHappened: '发生了什么',
                            whyEscalated: '为什么会找你',
                            recommendedAction: '系统建议',
                            currentImpact: '当前影响',
                        },
                        primaryAction: null,
                        secondaryAction: null,
                        rawEvidence: {
                            summary: 'raw',
                            terminationReason: 'session-inactive',
                            nextSuggestedStep: null,
                            failureFingerprint: null,
                            defaultExpanded: false,
                        },
                    },
                })}
            />,
        )

        expect(screen.getByText('待处理')).toBeInTheDocument()
        expect(screen.queryByText('计划：排期计划 · 目标：目标总览 · 阶段：发现阶段')).not.toBeInTheDocument()
    })
})
