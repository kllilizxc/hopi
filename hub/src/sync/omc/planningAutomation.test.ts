import { describe, expect, it } from 'bun:test'
import { extractOmcGuidedPlanningSummary } from './planningAutomation'

describe('extractOmcGuidedPlanningSummary', () => {
    it('keeps role-wrapped assistant content as the preferred summary', () => {
        expect(extractOmcGuidedPlanningSummary({
            role: 'assistant',
            content: {
                type: 'text',
                text: 'Drafting the first executable phase breakdown.'
            }
        })).toBe('Drafting the first executable phase breakdown.')
    })

    it('falls back to Codex message events when no role wrapper exists', () => {
        expect(extractOmcGuidedPlanningSummary({
            type: 'message',
            message: 'Mapped the repo and started shaping the roadmap.'
        })).toBe('Mapped the repo and started shaping the roadmap.')
    })

    it('summarizes Codex plan updates when only plan metadata is present', () => {
        expect(extractOmcGuidedPlanningSummary({
            type: 'plan',
            entries: [
                { content: 'Capture product intent', status: 'completed' },
                { content: 'Draft first phase plans', status: 'in_progress' }
            ],
            explanation: 'Drafted the first planning steps.'
        })).toBe('Plan updated: Drafted the first planning steps.')
    })
})
