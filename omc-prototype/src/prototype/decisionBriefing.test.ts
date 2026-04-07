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
        expect(briefing?.summaryRows.whatHappened).toContain('CardGame')
        expect(briefing?.summaryRows.whatHappened).toContain('Establish expedition domain')
        expect(briefing?.primaryAction?.label).toBe('重试这一轮')
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
            sessionId: 'session-review-1',
            attemptNumber: 2,
            latestSummary: 'Reviewer accepted the work but wants a human release decision.',
            terminationReason: null,
            nextSuggestedStep: null,
            failureFingerprint: null,
        })

        expect(briefing?.title).toBe('Promote expedition proof')
        expect(briefing?.summaryRows.whyEscalated).toContain('人工确认')
        expect(briefing?.primaryAction?.label).toContain('继续')
        expect(briefing?.secondaryAction?.label).toContain('保持')
    })
})
