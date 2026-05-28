import { describe, expect, it } from 'vitest'
import { extractHopiActionPacketView } from './hopi-action-packet'

describe('extractHopiActionPacketView', () => {
    it('extracts an update_current_task action from a fenced HOPI_ACTIONS packet', () => {
        const text = [
            'HOPI_ACTIONS:',
            '```json',
            JSON.stringify({
                actions: [{
                    type: 'update_current_task',
                    status: 'blocked',
                    handoff: 'Docs do not match the world-map implementation.',
                    evidence: 'Tests pass, but main uses presentation.mapWidth/mapHeight.'
                }]
            }, null, 2),
            '```'
        ].join('\n')

        const result = extractHopiActionPacketView(text)

        expect(result).toMatchObject({
            introText: '',
            actions: [{
                type: 'update_current_task',
                status: 'blocked',
                titleKey: 'hopiActions.status.blocked',
                handoff: 'Docs do not match the world-map implementation.',
                evidence: 'Tests pass, but main uses presentation.mapWidth/mapHeight.'
            }]
        })
    })

    it('keeps prose before the packet and extracts a bare marker payload', () => {
        const text = [
            'I finished the validation pass.',
            '',
            'HOPI_ACTIONS:',
            JSON.stringify({
                actions: [{
                    type: 'update_current_task',
                    status: 'in_review',
                    handoff: 'Ready for evaluator.',
                    evidence: 'bun test passed.'
                }]
            })
        ].join('\n')

        const result = extractHopiActionPacketView(text)

        expect(result?.introText).toBe('I finished the validation pass.')
        expect(result?.actions[0]).toMatchObject({
            status: 'in_review',
            titleKey: 'hopiActions.status.in_review',
            handoff: 'Ready for evaluator.',
            evidence: 'bun test passed.'
        })
    })

    it('ignores instructional HOPI_ACTIONS examples inside kickoff prompts', () => {
        const text = [
            'Final HOPI_ACTIONS packet:',
            '- HOPI applies this JSON after your turn.',
            'HOPI_ACTIONS:',
            '```json',
            JSON.stringify({
                actions: [{
                    type: 'update_current_task',
                    status: 'finished',
                    handoff: '...',
                    evidence: '...'
                }]
            }, null, 2),
            '```',
            '',
            'Task Contract:',
            '## Objective',
            'Use the brainstorming protocol to clarify this Goal before implementation: 调整为成熟的游戏架构'
        ].join('\n')

        expect(extractHopiActionPacketView(text)).toBeNull()
    })

    it('returns null for invalid or unrelated JSON', () => {
        expect(extractHopiActionPacketView('```json\n{"actions":[]}\n```')).toBeNull()
        expect(extractHopiActionPacketView('HOPI_ACTIONS:\n{not json}')).toBeNull()
    })

    it('renders marked packets with future action types generically', () => {
        const result = extractHopiActionPacketView([
            'HOPI_ACTIONS:',
            JSON.stringify({ actions: [{ type: 'future_action', description: 'Handle new protocol output.' }] })
        ].join('\n'))

        expect(result?.actions[0]).toMatchObject({
            type: 'future_action',
            titleKey: 'hopiActions.type.future_action',
            titleFallback: 'future action',
            description: 'Handle new protocol output.'
        })
    })
})
