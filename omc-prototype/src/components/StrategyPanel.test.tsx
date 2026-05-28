import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import StrategyPanel from './StrategyPanel'

describe('StrategyPanel', () => {
    it('prefers the live strategy payload instead of demo presenter copy for unknown goals', () => {
        render(
            <StrategyPanel
                goal={{
                    id: '01-foundation',
                    programId: 'program-1',
                    title: '01 Foundation',
                    summary: 'summary',
                    successSignal: 'signal',
                    status: 'on-track',
                    confidence: 82,
                    priority: 'highest',
                    direction: 'maintain',
                    headline: 'headline',
                    progressLabel: 'progress',
                    needsApproval: false,
                    lastWorkedAt: '2026-04-08T10:00:00.000Z',
                }}
                strategy={{
                    goalId: '01-foundation',
                    thesis: '先把第一轮可玩的 expedition loop 跑通。',
                    reason: '当前重点是做出真实可玩的最小闭环，而不是继续沿用旧 demo 的导入文案。',
                    changedAt: '2026-04-08T10:00:00.000Z',
                    confidenceDelta: '+0.12',
                    focusAreas: ['地图遍历', '节点状态', '战斗回路'],
                    todayMoves: ['补山门节点内容', '接通 stash 结算', '验证 keep-or-lose 循环'],
                    nextQuestions: [],
                }}
                checkpointId="execution"
            />,
        )

        expect(screen.getByText('先把第一轮可玩的 expedition loop 跑通。')).toBeInTheDocument()
        expect(screen.getByText('当前重点是做出真实可玩的最小闭环，而不是继续沿用旧 demo 的导入文案。')).toBeInTheDocument()
        expect(screen.queryByText('先选一个券商入口，做出最窄但可信的导入主链。')).not.toBeInTheDocument()
        expect(screen.getByText('地图遍历')).toBeInTheDocument()
        expect(screen.getByText('补山门节点内容')).toBeInTheDocument()
    })
})
