import { createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { goalPresentation } from './presenter'
import { getPrototypeSnapshot } from './scenario'
import { PrototypeStoreProvider, usePrototypeStore } from './store'
import { buildOperatorThreadSeeds, selectDefaultActiveThreadId, syncOperatorThreadBundle } from './threads'
import type { PrototypeScenarioSnapshot } from './types'

function cloneSnapshot(snapshot: PrototypeScenarioSnapshot): PrototypeScenarioSnapshot {
    return JSON.parse(JSON.stringify(snapshot)) as PrototypeScenarioSnapshot
}

function relabelApprovalSnapshot(snapshot: PrototypeScenarioSnapshot): PrototypeScenarioSnapshot {
    const next = cloneSnapshot(snapshot)

    const goalMap = new Map([
        ['goal-portfolio-foundation', 'goal-alpha'],
        ['goal-weekly-brief', 'goal-beta'],
    ])
    const goalTitleMap = new Map([
        ['goal-portfolio-foundation', 'Alpha Prime'],
        ['goal-weekly-brief', 'Beta Brief'],
    ])
    const streamMap = new Map([
        ['stream-ingest-contracts', 'stream-alpha-ingest'],
        ['stream-holdings-normalization', 'stream-alpha-normalization'],
        ['stream-weekly-brief-outline', 'stream-beta-brief'],
    ])
    const phaseMap = new Map([
        ['phase-ingest-1', 'phase-alpha-1'],
        ['phase-ingest-2', 'phase-alpha-2'],
        ['phase-ingest-3', 'phase-alpha-3'],
        ['phase-brief-1', 'phase-beta-1'],
        ['phase-brief-2', 'phase-beta-2'],
        ['phase-brief-3', 'phase-beta-3'],
    ])
    const planMap = new Map([
        ['plan-approval-1', 'plan-alpha-approval'],
        ['plan-approval-2', 'plan-alpha-proof'],
        ['plan-approval-3', 'plan-beta-scope'],
        ['plan-approval-4', 'plan-beta-run'],
    ])

    for (const goal of next.goals) {
        const originalGoalId = goal.id
        goal.id = goalMap.get(goal.id) ?? goal.id
        goal.title = goalTitleMap.get(originalGoalId) ?? goal.title
    }

    for (const strategy of next.strategies) {
        strategy.goalId = goalMap.get(strategy.goalId) ?? strategy.goalId
    }

    for (const stream of next.streams) {
        stream.id = streamMap.get(stream.id) ?? stream.id
        stream.goalId = goalMap.get(stream.goalId) ?? stream.goalId
    }

    for (const phase of next.phases) {
        phase.id = phaseMap.get(phase.id) ?? phase.id
        phase.goalId = goalMap.get(phase.goalId) ?? phase.goalId
        phase.streamId = streamMap.get(phase.streamId) ?? phase.streamId
    }

    for (const card of next.planCards) {
        card.id = planMap.get(card.id) ?? card.id
        card.goalId = goalMap.get(card.goalId) ?? card.goalId
        card.streamId = streamMap.get(card.streamId) ?? card.streamId
        card.phaseId = phaseMap.get(card.phaseId) ?? card.phaseId
    }

    for (const risk of next.risks) {
        risk.goalId = goalMap.get(risk.goalId) ?? risk.goalId
    }

    for (const batch of Object.values(next.approvalBatches)) {
        for (const item of batch.items) {
            item.goalId = goalMap.get(item.goalId) ?? item.goalId
        }
    }

    for (const stream of next.streams) {
        stream.phaseIds = stream.phaseIds.map((phaseId) => phaseMap.get(phaseId) ?? phaseId)
    }

    return next
}

it('requeues a waiting work order after the operator replies with a directive', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
        createElement(PrototypeStoreProvider, null, children)
    )

    const { result } = renderHook(() => usePrototypeStore(), { wrapper })

    act(() => {
        result.current.actions.attachDemoProgram()
    })

    act(() => {
        result.current.actions.setClockCheckpoint('approval')
    })

    const approvalThread = result.current.threads.find((thread) => thread.id === 'approval:approval-branch-ingest')
    expect(approvalThread).toBeDefined()

    act(() => {
        result.current.actions.sendThreadReply(approvalThread!.id, '先不要放行，再加固一轮')
    })

    const snapshot = result.current.dataSource.getPortfolio('today')
    expect(snapshot.goals[0]?.headline).toContain('加固')
})

describe('operator threads', () => {
    it('builds structured approval, risk, direction, and status topics', () => {
        const snapshot = getPrototypeSnapshot('execution')
        const threads = buildOperatorThreadSeeds(snapshot)

        expect(threads.some((thread) => thread.kind === 'approval')).toBe(true)
        expect(threads.some((thread) => thread.kind === 'risk')).toBe(true)
        expect(threads.some((thread) => thread.kind === 'direction')).toBe(true)
        expect(threads.some((thread) => thread.kind === 'status')).toBe(true)
    })

    it('builds readable briefing cards for approval, risk, direction, and status threads', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const threads = buildOperatorThreadSeeds(snapshot)

        const statusThread = threads.find((thread) => thread.id === 'status:goal-portfolio-foundation')
        const directionThread = threads.find((thread) => thread.id === 'direction:goal-weekly-brief')
        const approvalThread = threads.find((thread) => thread.id === 'approval:approval-branch-ingest')
        const riskThread = threads.find((thread) => thread.id === 'risk:risk-post-promo-creep')
        const portfolioGoal = snapshot.goals.find((goal) => goal.id === 'goal-portfolio-foundation')

        expect(statusThread?.briefing?.title).toBe(statusThread?.title)
        expect(statusThread?.briefing?.identity.projectLabel).toBe(snapshot.program.name)
        expect(statusThread?.briefing?.summaryRows.whatHappened).toContain('把持仓导入跑稳')
        expect(statusThread?.briefing?.summaryRows.currentImpact).toBe(goalPresentation(portfolioGoal!, snapshot.checkpoint.id).progressLabel)

        expect(directionThread?.briefing?.title).toBe(directionThread?.title)
        expect(directionThread?.briefing?.summaryRows.whyEscalated).toBe(directionThread?.firstMessage.whyNow)
        expect(directionThread?.briefing?.primaryAction?.label).toBe(directionThread?.quickActions[0]?.label)
        expect(directionThread?.briefing?.secondaryAction?.label).toBe(directionThread?.quickActions[1]?.label)

        expect(approvalThread?.briefing?.title).toBe('放行导入分支')
        expect(approvalThread?.briefing?.summaryRows.whatHappened).toContain('要不要按系统建议放行导入分支')
        expect(approvalThread?.briefing?.primaryAction?.label).toBe('按建议放行')
        expect(approvalThread?.briefing?.secondaryAction?.label).toBe('先不放行')

        expect(riskThread?.briefing?.title).toBe(riskThread?.title)
        expect(riskThread?.briefing?.summaryRows.whatHappened).toContain('风险')
        expect(riskThread?.briefing?.primaryAction?.label).toBe(riskThread?.quickActions[0]?.label)
        expect(riskThread?.briefing?.secondaryAction?.label).toBe(riskThread?.quickActions[1]?.label)
    })

    it('keeps the first agent message contract complete for approval threads', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const approvalThread = buildOperatorThreadSeeds(snapshot).find((thread) => thread.id === 'approval:approval-branch-ingest')
        const scopeApprovalThread = buildOperatorThreadSeeds(snapshot).find((thread) => thread.id === 'approval:approval-scope-brief')

        expect(approvalThread).toBeDefined()
        expect(scopeApprovalThread).toBeDefined()
        expect(approvalThread?.title).toBe('放行导入分支')
        expect(approvalThread?.introMessage.body).toContain(approvalThread!.firstMessage.currentStatus)
        expect(approvalThread?.introMessage.body).toContain(approvalThread!.firstMessage.suggestedAction)
        expect(approvalThread?.introMessage.body).toContain(`按建议执行后：${approvalThread!.firstMessage.confirmEffect}`)
        expect(approvalThread?.introMessage.body).toContain(`如果先不处理：${approvalThread!.firstMessage.deferEffect}`)
        expect(approvalThread?.introMessage.body).toContain(approvalThread!.firstMessage.freeformInvite)
        expect(approvalThread?.introMessage.body).toContain('你要决定的是：要不要按系统建议放行导入分支。')
        expect(approvalThread?.quickActions.map((action) => action.label)).toEqual([
            '按建议放行',
            '先不放行',
            '继续加固一轮',
        ])
        expect(scopeApprovalThread?.introMessage.body).toContain('你要决定的是：要不要按系统建议收紧周报范围。')
        expect(scopeApprovalThread?.quickActions.map((action) => action.label)).toEqual([
            '按建议收紧范围',
            '先保持现状',
            '不收紧，保持原路线',
        ])
        expect(approvalThread?.introMessage.body).not.toContain('###')
        expect(approvalThread?.introMessage.body).not.toContain('背景')
        expect(approvalThread?.introMessage.body).not.toContain('为什么')
        expect(approvalThread?.introMessage.body).not.toContain('结果对比')
        expect(approvalThread?.detailSections.map((section) => section.title)).toEqual([
            '查看依据',
            '查看影响',
            '看关联计划',
        ])
        expect(approvalThread?.detailSections.find((section) => section.title === '查看依据')?.refs.some((ref) => ref.kind === 'goal')).toBe(true)
        expect(approvalThread?.detailSections.find((section) => section.title === '查看影响')?.refs.some((ref) => ref.kind === 'impact')).toBe(true)
        expect(approvalThread?.detailSections.find((section) => section.title === '看关联计划')?.refs.some((ref) => ref.kind === 'plan')).toBe(true)
        expect(approvalThread?.refs.some((ref) => ref.kind === 'goal')).toBe(true)
        expect(approvalThread?.refs.some((ref) => ref.kind === 'stream')).toBe(true)
        expect(approvalThread?.refs.some((ref) => ref.kind === 'impact')).toBe(true)
    })

    it('prefers live OMC interruption briefings over demo approval copy', () => {
        const snapshot = cloneSnapshot(getPrototypeSnapshot('approval'))
        snapshot.program.id = 'omc-cardgame'
        snapshot.program.name = 'CardGame'

        const approvalItem = Object.values(snapshot.approvalBatches)
            .flatMap((batch) => batch.items)
            .find((item) => item.id === 'approval-scope-brief')

        expect(approvalItem).toBeDefined()
        approvalItem!.title = 'Establish expedition domain'
        approvalItem!.summary = 'The linked session became inactive before the attempt reported a structured outcome.'
        approvalItem!.liveContext = {
            source: 'omc',
            category: 'runtime-interruption',
            projectLabel: 'CardGame',
            goalLabel: '01 First Playable Expedition',
            planLabel: 'Establish expedition domain',
            planKey: '01-01',
            sessionId: 'session-cardgame-1',
            attemptNumber: 3,
            latestSummary: 'The linked session became inactive before the attempt reported a structured outcome.',
            terminationReason: 'session-inactive',
            nextSuggestedStep: 'Inspect the session history, then resume the loop when the machine is stable.',
            failureFingerprint: 'session-inactive',
        }

        const liveThread = buildOperatorThreadSeeds(snapshot).find((thread) => thread.id === 'approval:approval-scope-brief')

        expect(liveThread?.title).toBe('执行中断，等待恢复确认')
        expect(liveThread?.preview).toContain('CardGame')
        expect(liveThread?.briefing?.summaryRows.whatHappened).toContain('Establish expedition domain')
        expect(liveThread?.briefing?.rawEvidence.summary).toBe('The linked session became inactive before the attempt reported a structured outcome.')
        expect(liveThread?.quickActions.map((action) => action.label)).toEqual([
            '重试这一轮',
            '先停在这里',
        ])
        expect(liveThread?.introMessage.body).not.toContain('The linked session became inactive before the attempt reported a structured outcome.')
    })

    it('deduplicates approval ids across batch windows', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const approvalIds = buildOperatorThreadSeeds(snapshot)
            .filter((thread) => thread.kind === 'approval')
            .map((thread) => thread.id)

        expect(approvalIds.length).toBe(new Set(approvalIds).size)
        expect(approvalIds).toContain('approval:approval-branch-ingest')
        expect(approvalIds).toContain('approval:approval-scope-brief')
    })

    it('reopens unread when thread content changes without lifecycle change', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const seeds = buildOperatorThreadSeeds(snapshot)
        const approvalThread = seeds.find((thread) => thread.id === 'approval:approval-branch-ingest')

        expect(approvalThread).toBeDefined()

        const nextSnapshot = cloneSnapshot(snapshot)
        const approvalItem = Object.values(nextSnapshot.approvalBatches)
            .flatMap((batch) => batch.items)
            .find((item) => item.id === 'approval-branch-ingest')

        expect(approvalItem).toBeDefined()
        approvalItem!.summary = 'Promote the ingest proof branch after a fresh validation pass and keep the lane under tighter review.'

        const reopened = syncOperatorThreadBundle({
            snapshot: nextSnapshot,
            previousState: {
                threadsById: {
                    [approvalThread!.id]: {
                        ...approvalThread!,
                        unread: false,
                    },
                },
                messagesByThread: {
                    [approvalThread!.id]: [approvalThread!.introMessage],
                },
                activeThreadId: null,
            },
        })

        expect(reopened.bundle.threadsById[approvalThread!.id]?.lifecycle).toBe(approvalThread!.lifecycle)
        expect(reopened.bundle.threadsById[approvalThread!.id]?.unread).toBe(true)
    })

    it('derives refs from snapshot data instead of hardcoded scenario ids', () => {
        const snapshot = relabelApprovalSnapshot(getPrototypeSnapshot('approval'))
        const relabeledGoal = snapshot.goals.find((goal) => goal.id === 'goal-alpha')
        expect(relabeledGoal).toBeDefined()

        relabeledGoal!.summary = 'Alpha goal summary from the relabeled snapshot.'
        relabeledGoal!.headline = 'Alpha goal headline from the relabeled snapshot.'
        relabeledGoal!.successSignal = 'Alpha goal success signal from the relabeled snapshot.'
        relabeledGoal!.progressLabel = 'Alpha goal progress label from the relabeled snapshot.'
        snapshot.strategies = snapshot.strategies.filter((strategy) => strategy.goalId !== 'goal-alpha')

        const threads = buildOperatorThreadSeeds(snapshot)
        const branchApproval = threads.find((thread) => thread.id === 'approval:approval-branch-ingest')
        const riskThread = threads.find((thread) => thread.id === 'risk:risk-post-promo-creep')
        const statusThread = threads.find((thread) => thread.id === 'status:goal-alpha')
        const directionThread = threads.find((thread) => thread.id === 'direction:goal-alpha')
        const branchApprovalGoalRef = branchApproval?.refs.find((ref) => ref.kind === 'goal' && ref.id === 'goal-alpha')
        const statusImpactRef = statusThread?.refs.find((ref) => ref.kind === 'impact' && ref.id === 'impact:goal-alpha:status')
        const directionImpactRef = directionThread?.refs.find((ref) => ref.kind === 'impact' && ref.id === 'impact:goal-alpha:status')

        expect(branchApproval?.refs.some((ref) => ref.kind === 'goal' && ref.id === 'goal-alpha')).toBe(true)
        expect(branchApprovalGoalRef).toBeDefined()
        expect(branchApprovalGoalRef?.label).not.toBe('goal-alpha')
        expect(branchApprovalGoalRef?.label).toBe(relabeledGoal?.title)
        expect(statusThread?.title).toBe(`${relabeledGoal?.title} · 当前主线`)
        expect(statusThread?.firstMessage.currentStatus).toContain(relabeledGoal?.title ?? '')
        expect(statusThread?.firstMessage.currentStatus).not.toContain('goal-alpha')
        expect(statusThread?.preview).toBe(relabeledGoal?.headline)
        expect(statusThread?.firstMessage.background).toBe(relabeledGoal?.summary)
        expect(statusImpactRef?.label).toBe(relabeledGoal?.progressLabel)
        expect(directionThread?.title).toBe(`${relabeledGoal?.title} · 路线调整`)
        expect(directionThread?.firstMessage.currentStatus).toContain(relabeledGoal?.title ?? '')
        expect(directionThread?.firstMessage.currentStatus).not.toContain('goal-alpha')
        expect(directionThread?.preview).toBe(relabeledGoal?.headline)
        expect(directionImpactRef?.label).toBe(relabeledGoal?.progressLabel)
        expect(branchApproval?.refs.some((ref) => ref.kind === 'stream' && ref.id === 'stream-alpha-ingest')).toBe(true)
        expect(branchApproval?.refs.some((ref) => ref.kind === 'phase' && ref.id === 'phase-alpha-3')).toBe(true)
        expect(branchApproval?.refs.some((ref) => ref.kind === 'plan' && ref.id === 'plan-alpha-approval')).toBe(true)
        expect(riskThread?.refs.some((ref) => ref.kind === 'goal' && ref.id === 'goal-alpha')).toBe(true)
        expect(riskThread?.refs.some((ref) => ref.kind === 'stream' && ref.id === 'stream-alpha-ingest')).toBe(true)
        expect(riskThread?.refs.some((ref) => ref.kind === 'phase' && ref.id === 'phase-alpha-3')).toBe(true)
        expect(riskThread?.refs.some((ref) => ref.kind === 'plan' && ref.id === 'plan-alpha-approval')).toBe(true)

        const portfolioCanonical = getPrototypeSnapshot('approval').goals.find((goal) => goal.id === 'goal-portfolio-foundation')
        const weeklyCanonical = getPrototypeSnapshot('approval').goals.find((goal) => goal.id === 'goal-weekly-brief')

        expect(portfolioCanonical).toBeDefined()
        expect(weeklyCanonical).toBeDefined()

        expect(goalPresentation(portfolioCanonical!, 'execution')).toEqual({
            title: '把持仓导入跑稳',
            summary: '先把导入、归一化、验证三段链路跑顺，再扩分析面。',
            headline: '证明链在收口，主目标已经接近可审批状态。',
            successSignal: '券商 CSV 可以稳定导入，持仓快照能持续自洽。',
            progressLabel: '分支接近放行',
        })
        expect(goalPresentation(weeklyCanonical!, 'execution')).toEqual({
            title: '做出每周投资简报',
            summary: '先做可信的周报底座，暂不把异常叙事做重。',
            headline: '系统主动收 scope，避免在噪声上硬推版本。',
            successSignal: '每周简报能稳定给出漂移、数据新鲜度和可行动提示。',
            progressLabel: '已降 scope，等待方向确认',
        })
    })

    it('prefers unresolved intervention threads over passive status threads', () => {
        const snapshot = getPrototypeSnapshot('execution')
        const seeds = buildOperatorThreadSeeds(snapshot)
        const next = syncOperatorThreadBundle({
            snapshot,
            previousState: {
                threadsById: {},
                messagesByThread: {},
                activeThreadId: null,
            },
        })

        const active = next.activeThreadId ? next.bundle.threadsById[next.activeThreadId] : null

        expect(active).toBeDefined()
        expect(active?.passive).toBe(false)
        expect(active?.kind).not.toBe('status')
        expect(selectDefaultActiveThreadId(seeds.map((thread) => ({ ...thread, unread: true })), null)).toBe(next.activeThreadId)
    })

    it('reopens a previously resolved thread when the topic becomes active again', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const seeds = buildOperatorThreadSeeds(snapshot)
        const approvalThread = seeds.find((thread) => thread.kind === 'approval')

        expect(approvalThread).toBeDefined()

        const reopened = syncOperatorThreadBundle({
            snapshot,
            previousState: {
                threadsById: {
                    [approvalThread!.id]: {
                        ...approvalThread!,
                        unread: false,
                        lifecycle: 'resolved',
                    },
                },
                messagesByThread: {
                    [approvalThread!.id]: [approvalThread!.introMessage],
                },
                activeThreadId: null,
            },
        })

        expect(reopened.bundle.threadsById[approvalThread!.id]?.lifecycle).toBe('pending')
        expect(reopened.bundle.threadsById[approvalThread!.id]?.unread).toBe(true)
    })

    it('requeues a waiting work order after the operator replies with a directive', () => {
        const wrapper = ({ children }: { children: ReactNode }) => (
            createElement(PrototypeStoreProvider, null, children)
        )

        const { result } = renderHook(() => usePrototypeStore(), { wrapper })

        act(() => {
            result.current.actions.attachDemoProgram()
            result.current.actions.setClockCheckpoint('approval')
        })

        const approvalThread = result.current.threads.find((thread) => thread.id === 'approval:approval-branch-ingest')
        expect(approvalThread).toBeDefined()

        act(() => {
            result.current.actions.sendThreadReply(approvalThread!.id, '先不要放行，再加固一轮')
        })

        const relatedOrder = Object.values(result.current.state.worldModel.workOrders).find(
            (order) => order.id === 'work-order:approval-branch-ingest',
        )
        const goal = result.current.dataSource
            .getPortfolio('today')
            .goals.find((entry) => entry.id === 'goal-portfolio-foundation')

        expect(relatedOrder?.state).toBe('queued')
        expect(relatedOrder?.loop.lastDecisionSummary).toBe('先不要放行，再加固一轮')
        expect(goal?.headline).toContain('加固')
    })

    it.each([
        'approval-approve',
        'approval-defer',
        'approval-guide',
    ] as const)('keeps the approval world model coherent for the %s quick action', (operationType) => {
        const wrapper = ({ children }: { children: ReactNode }) => (
            createElement(PrototypeStoreProvider, null, children)
        )

        const { result } = renderHook(() => usePrototypeStore(), { wrapper })

        act(() => {
            result.current.actions.attachDemoProgram()
            result.current.actions.setClockCheckpoint('approval')
        })

        const approvalThread = result.current.threads.find((thread) => thread.id === 'approval:approval-branch-ingest')
        const quickAction = approvalThread?.quickActions.find((action) => action.operation.type === operationType)

        expect(approvalThread).toBeDefined()
        expect(quickAction).toBeDefined()

        act(() => {
            result.current.actions.performQuickAction(approvalThread!.id, quickAction!.id)
        })

        const relatedOrder = result.current.state.worldModel.workOrders['work-order:approval-branch-ingest']
        const relatedTopic = result.current.state.decisionTopics[approvalThread!.id]
        const goal = result.current.dataSource
            .getPortfolio('today')
            .goals.find((entry) => entry.id === 'goal-portfolio-foundation')

        expect(relatedOrder?.state).toBe('queued')
        expect(relatedOrder?.waitingOnTopicId).toBeNull()
        expect(relatedOrder?.loop.lastDecisionSummary).toBeTruthy()
        expect(relatedTopic?.lifecycle).toBe('resolved')
        expect(relatedTopic?.unread).toBe(false)
        expect(goal?.needsApproval).toBe(false)
        expect(goal?.headline).toContain('回到队列')
    })
})
