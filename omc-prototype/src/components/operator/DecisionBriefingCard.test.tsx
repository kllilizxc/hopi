import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import DecisionBriefingCard from './DecisionBriefingCard'

describe('DecisionBriefingCard', () => {
    it('shows identity, translated rows, collapsed raw evidence, and log/trace actions', () => {
        const onOpenSessionLog = vi.fn()
        const onOpenTrace = vi.fn()

        render(
            <DecisionBriefingCard
                briefing={{
                    title: '执行中断，等待恢复确认',
                    identity: {
                        projectLabel: 'CardGame',
                        goalLabel: '01 First Playable Expedition',
                        planLabel: 'Establish expedition domain',
                        attemptNumber: 3,
                        sessionId: 'session-cardgame-1',
                    },
                    summaryRows: {
                        whatHappened: 'CardGame 的「Establish expedition domain」在执行中失去了关联 session，这一轮还没来得及上报结果。',
                        whyEscalated: '系统现在无法判断这轮应该继续、重试，还是改方向，所以需要你确认下一步。',
                        recommendedAction: '建议先查看日志，再决定是否恢复执行。',
                        currentImpact: '这张计划卡暂时不会继续自动推进。',
                    },
                    primaryAction: { label: '重试这一轮', helper: '建议先打开执行日志确认原因；重试后系统会重新拉起这一轮 attempt。' },
                    secondaryAction: { label: '先保持现状', helper: '保留当前状态，不恢复自动推进。' },
                    rawEvidence: {
                        summary: 'The linked session became inactive before the attempt reported a structured outcome.',
                        terminationReason: 'session-inactive',
                        nextSuggestedStep: 'Inspect the session history, then resume the loop when the machine is stable.',
                        failureFingerprint: 'session-inactive',
                        defaultExpanded: false,
                    },
                }}
                onOpenSessionLog={onOpenSessionLog}
                onOpenTrace={onOpenTrace}
            />,
        )

        expect(screen.getByText('项目：CardGame')).toBeInTheDocument()
        expect(screen.getByText('计划：Establish expedition domain')).toBeInTheDocument()
        expect(screen.getByText('发生了什么')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '查看原始依据' })).toBeInTheDocument()
        expect(screen.queryByText('The linked session became inactive before the attempt reported a structured outcome.')).not.toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: '查看原始依据' }))
        expect(screen.getByText('The linked session became inactive before the attempt reported a structured outcome.')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: '打开执行日志' }))
        expect(onOpenSessionLog).toHaveBeenCalledTimes(1)

        fireEvent.click(screen.getByRole('button', { name: '打开原始轨迹' }))
        expect(onOpenTrace).toHaveBeenCalledTimes(1)
    })
})
