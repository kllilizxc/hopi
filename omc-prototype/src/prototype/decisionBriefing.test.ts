import { describe, expect, it } from 'vitest'
import { buildDecisionBriefing } from './decisionBriefing'

describe('decision briefing projection', () => {
    it('translates session-inactive runtime failures into operator-facing Chinese copy', () => {
        const briefing = buildDecisionBriefing({
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
        })

        expect(briefing?.title).toBe('执行中断，等待恢复确认')
        expect(briefing?.decisionQuestion).toContain('这一轮是否要在环境恢复后重试')
        expect(briefing?.summaryRows.whatHappened).toContain('CardGame')
        expect(briefing?.summaryRows.whatHappened).toContain('Establish expedition domain')
        expect(briefing?.primaryAction?.label).toBe('重试这一轮')
        expect(briefing?.secondaryAction?.label).toBe('先停在这里')
        expect(briefing?.rawEvidence.summary).toBe('The linked session became inactive before the attempt reported a structured outcome.')
        expect(briefing?.rawEvidence.defaultExpanded).toBe(false)
    })

    it('keeps product approval copy separate from runtime interruption copy', () => {
        const briefing = buildDecisionBriefing({
            source: 'omc',
            category: 'review-approval',
            projectLabel: 'CardGame',
            goalLabel: '01 First Playable Expedition',
            planLabel: 'Promote expedition proof',
            planKey: '01-02',
            planSummary: 'Turn the new stash and run state into a playable exploration surface before combat handoff is connected.',
            sessionId: 'session-review-1',
            attemptNumber: 2,
            latestSummary: 'Booted the game into ExpeditionScene, added fog-of-war traversal, and wired event/shop/extract node panels into the active run state.',
            terminationReason: null,
            nextSuggestedStep: null,
            failureFingerprint: null,
            changedFiles: [
                'src/game/scenes/expedition/ExpeditionScene.ts',
                'src/game/ui/expedition/NodePanel.ts',
            ],
        })

        expect(briefing?.title).toBe('Promote expedition proof')
        expect(briefing?.decisionQuestion).toContain('结果是否已经够好')
        expect(briefing?.summaryRows.targetOutcome).toContain('playable exploration surface')
        expect(briefing?.summaryRows.changeSummary).toContain('Booted the game into ExpeditionScene')
        expect(briefing?.summaryRows.changeSummary).toContain('ExpeditionScene.ts')
        expect(briefing?.summaryRows.whatHappened).toContain('人工确认')
        expect(briefing?.summaryRows.whyEscalated).toContain('当前结果是否已经够好')
        expect(briefing?.summaryRows.currentImpact).toContain('继续下一步')
        expect(briefing?.summaryRows.currentImpact).toContain('先停在这里')
        expect(briefing?.primaryAction?.label).toBe('认可当前结果，继续下一步')
        expect(briefing?.primaryAction?.helper).toContain('当前产物视为通过')
        expect(briefing?.secondaryAction?.label).toBe('先停在这里')
        expect(briefing?.secondaryAction?.helper).toContain('不继续自动推进')
    })

    it('explains merge approval as a branch-level decision instead of a generic continue prompt', () => {
        const briefing = buildDecisionBriefing({
            source: 'omc',
            category: 'merge-approval',
            projectLabel: 'CardGame',
            goalLabel: '01 First Playable Expedition',
            planLabel: 'Merge expedition backbone',
            planKey: '01-03',
            planSummary: 'Bank the expedition backbone into the target branch once the review result is accepted.',
            sessionId: 'session-merge-1',
            attemptNumber: 2,
            latestSummary: 'Review approved. Waiting for a human merge decision.',
            terminationReason: null,
            nextSuggestedStep: null,
            failureFingerprint: null,
            changedFiles: ['src/game/services/RunResolution.ts'],
        })

        expect(briefing?.decisionQuestion).toContain('是否允许把当前结果合并到目标分支')
        expect(briefing?.summaryRows.whatHappened).toContain('合并前最后一个人工确认点')
        expect(briefing?.primaryAction?.label).toBe('批准合并到目标分支')
        expect(briefing?.primaryAction?.helper).toContain('继续执行 merge')
        expect(briefing?.secondaryAction?.label).toBe('先不要合并')
        expect(briefing?.secondaryAction?.helper).toContain('不会进入目标分支')
    })

    it('explains merge blocked as a recovery decision instead of a generic approval', () => {
        const briefing = buildDecisionBriefing({
            source: 'omc',
            category: 'merge-blocked',
            projectLabel: 'CardGame',
            goalLabel: '01 First Playable Expedition',
            planLabel: 'Merge expedition backbone',
            planKey: '01-03',
            planSummary: 'Bank the expedition backbone into the target branch once the review result is accepted.',
            sessionId: 'session-merge-2',
            attemptNumber: 3,
            latestSummary: 'Merge is blocked by conflicts in the target branch.',
            terminationReason: null,
            nextSuggestedStep: 'Inspect merge conflicts, then decide whether to continue the merge lane.',
            failureFingerprint: 'merge-conflict',
            changedFiles: ['src/game/services/RunResolution.ts'],
        })

        expect(briefing?.decisionQuestion).toContain('没法直接合并')
        expect(briefing?.summaryRows.whatHappened).toContain('被阻塞')
        expect(briefing?.summaryRows.whyEscalated).toContain('继续让 agent 处理这个阻塞')
        expect(briefing?.primaryAction?.label).toBe('继续尝试推进')
        expect(briefing?.primaryAction?.helper).toContain('重新尝试合并')
        expect(briefing?.secondaryAction?.label).toBe('先停在这里')
    })
})
