import { describe, expect, it } from 'vitest'
import type { DecryptedMessage } from '@/types/api'
import { normalizeDecryptedMessage } from '@/chat/normalize'
import { reduceChatBlocks } from '@/chat/reducer'

function message(id: string, seq: number, content: unknown): DecryptedMessage {
    return {
        id,
        seq,
        localId: null,
        createdAt: seq,
        content,
    }
}

function planMessage(id: string, seq: number, completed: number): DecryptedMessage {
    return message(id, seq, {
        role: 'agent',
        content: {
            type: 'codex',
            data: {
                type: 'plan',
                explanation: `Progress ${completed}`,
                entries: [
                    { content: 'Read task context', status: completed >= 1 ? 'completed' : 'pending' },
                    { content: 'Run verification', status: 'pending' },
                ],
            },
        },
    })
}

function normalize(messages: DecryptedMessage[]) {
    return messages
        .map(normalizeDecryptedMessage)
        .filter((value) => value !== null)
}

describe('reduceChatBlocks plan updates', () => {
    it('keeps only the latest plan update in a user turn while preserving tools', () => {
        const normalized = normalize([
            message('user-1', 1, {
                role: 'user',
                content: { type: 'text', text: 'continue' },
            }),
            planMessage('plan-1', 2, 0),
            message('tool-start', 3, {
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'tool-call',
                        callId: 'cmd-1',
                        name: 'CodexBash',
                        input: { command: 'bun test' },
                    },
                },
            }),
            message('tool-end', 4, {
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'tool-call-result',
                        callId: 'cmd-1',
                        output: { stdout: 'ok' },
                    },
                },
            }),
            planMessage('plan-2', 5, 1),
        ])

        const { blocks } = reduceChatBlocks(normalized, null)
        const textBlocks = blocks.filter((block) => block.kind === 'agent-text')

        expect(blocks.some((block) => block.kind === 'tool-call' && block.id === 'cmd-1')).toBe(true)
        expect(textBlocks).toHaveLength(1)
        expect(textBlocks[0]?.text).toContain('Progress 1')
        expect(textBlocks[0]?.text).toContain('- [x] Read task context')
    })

    it('keeps the final plan snapshot from previous user turns', () => {
        const normalized = normalize([
            message('user-1', 1, {
                role: 'user',
                content: { type: 'text', text: 'first turn' },
            }),
            planMessage('plan-1', 2, 0),
            planMessage('plan-2', 3, 1),
            message('user-2', 4, {
                role: 'user',
                content: { type: 'text', text: 'second turn' },
            }),
            planMessage('plan-3', 5, 0),
        ])

        const { blocks } = reduceChatBlocks(normalized, null)
        const textBlocks = blocks.filter((block) => block.kind === 'agent-text')

        expect(textBlocks).toHaveLength(2)
        expect(textBlocks[0]?.text).toContain('Progress 1')
        expect(textBlocks[1]?.text).toContain('Progress 0')
    })
})
