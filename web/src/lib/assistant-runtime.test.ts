import { describe, expect, it } from 'vitest'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import { groupConsecutiveToolBlocks } from '@/lib/assistant-runtime'

function toolBlock(id: string, state: ToolCallBlock['tool']['state'] = 'completed'): ToolCallBlock {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: Number(id.replace(/\D/g, '')) || 1,
        tool: {
            id,
            name: 'Bash',
            state,
            input: { command: `cmd-${id}` },
            createdAt: Number(id.replace(/\D/g, '')) || 1,
            startedAt: null,
            completedAt: state === 'running' ? null : (Number(id.replace(/\D/g, '')) || 1) + 1,
            description: null,
            result: state === 'running' ? undefined : { stdout: `result-${id}` },
        },
        children: [],
    }
}

describe('assistant runtime tool grouping', () => {
    it('groups adjacent top-level tools but preserves non-tool boundaries', () => {
        const first = toolBlock('tool-1')
        const second = toolBlock('tool-2', 'error')
        const text: ChatBlock = {
            kind: 'agent-text',
            id: 'text-1',
            localId: null,
            createdAt: 3,
            text: 'done',
        }
        const third = toolBlock('tool-3')

        const grouped = groupConsecutiveToolBlocks([first, second, text, third])

        expect(grouped).toHaveLength(3)
        expect(grouped[0]).toMatchObject({
            kind: 'tool-call',
            id: 'tool-group:tool-1',
            tool: {
                id: 'tool-group:tool-1',
                name: 'ToolGroup',
                state: 'error',
            },
            children: [first, second],
        })
        expect(grouped[1]).toBe(text)
        expect(grouped[2]).toBe(third)
    })

    it('keeps a tool group id stable when more adjacent tools stream in', () => {
        const first = toolBlock('tool-1')
        const second = toolBlock('tool-2')
        const third = toolBlock('tool-3')

        const initialGroup = groupConsecutiveToolBlocks([first, second])[0] as ToolCallBlock
        const expandedGroup = groupConsecutiveToolBlocks([first, second, third])[0] as ToolCallBlock

        expect(initialGroup.id).toBe('tool-group:tool-1')
        expect(expandedGroup.id).toBe(initialGroup.id)
        expect(expandedGroup.children).toEqual([first, second, third])
    })
})
