import { isObject } from '@hapi/protocol'
import { TodosSchema } from '@hapi/protocol/schemas'
import type { TodoItem } from '@hapi/protocol/types'
import type { AgentToolExtractor, TaskToolResult } from '../types'

/**
 * Codex tool extractor
 * Handles TodoWrite tool calls
 */
export class CodexToolExtractor implements AgentToolExtractor {
    extractTaskTools(content: Record<string, unknown>): TaskToolResult | null {
        if (content.type !== 'codex') return null

        const data = isObject(content.data) ? content.data : null
        if (!data || data.type !== 'tool-call') return null

        const name = typeof data.name === 'string' ? data.name : null
        if (name !== 'TodoWrite') return null

        const input = 'input' in data ? (data as Record<string, unknown>).input : null
        if (!isObject(input)) return null

        const todosCandidate = input.todos
        const parsed = TodosSchema.safeParse(todosCandidate)
        if (!parsed.success) return null

        return {
            todos: parsed.data,
            source: 'TodoWrite'
        }
    }
}
