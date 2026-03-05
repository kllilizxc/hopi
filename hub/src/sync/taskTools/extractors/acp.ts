import { isObject } from '@hopi/protocol'
import { TodosSchema } from '@hopi/protocol/schemas'
import type { TodoItem } from '@hopi/protocol/types'
import type { AgentToolExtractor, TaskToolResult } from '../types'

/**
 * ACP (Anthropic Computer Protocol) tool extractor
 * Handles plan entries from ACP messages
 */
export class AcpToolExtractor implements AgentToolExtractor {
    extractTaskTools(content: Record<string, unknown>): TaskToolResult | null {
        if (content.type !== 'codex') return null

        const data = isObject(content.data) ? content.data : null
        if (!data || data.type !== 'plan') return null

        const entries = data.entries
        if (!Array.isArray(entries)) return null

        const todos: TodoItem[] = []
        entries.forEach((entry, index) => {
            if (!isObject(entry)) return

            const contentValue = typeof entry.content === 'string' ? entry.content : null
            const priorityValue = typeof entry.priority === 'string' ? entry.priority : null
            const statusValue = typeof entry.status === 'string' ? entry.status : null

            if (!contentValue || !priorityValue || !statusValue) return
            if (priorityValue !== 'high' && priorityValue !== 'medium' && priorityValue !== 'low') return
            if (statusValue !== 'pending' && statusValue !== 'in_progress' && statusValue !== 'completed') return

            const idValue = typeof entry.id === 'string' ? entry.id : `plan-${index + 1}`

            todos.push({
                content: contentValue,
                priority: priorityValue,
                status: statusValue,
                id: idValue
            })
        })

        const parsed = TodosSchema.safeParse(todos)
        if (!parsed.success) return null

        return {
            todos: parsed.data,
            source: 'TodoWrite'
        }
    }
}
