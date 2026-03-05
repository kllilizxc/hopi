import { isObject } from '@hopi/protocol'
import { TodosSchema } from '@hopi/protocol/schemas'
import type { TodoItem } from '@hopi/protocol/types'
import type { AgentToolExtractor, TaskToolResult } from '../types'

/**
 * Claude Code tool extractor
 * Handles TodoWrite, TaskCreate, TaskUpdate, TaskList, TaskGet
 */
export class ClaudeToolExtractor implements AgentToolExtractor {
    extractTaskTools(content: Record<string, unknown>): TaskToolResult | null {
        if (content.type !== 'output') return null

        const data = isObject(content.data) ? content.data : null
        if (!data || data.type !== 'assistant') return null

        const message = isObject(data.message) ? data.message : null
        if (!message) return null

        const modelContent = message.content
        if (!Array.isArray(modelContent)) return null

        for (const block of modelContent) {
            if (!isObject(block) || block.type !== 'tool_use') continue

            const name = typeof block.name === 'string' ? block.name : null
            if (!name) continue

            const input = 'input' in block ? (block as Record<string, unknown>).input : null
            if (!isObject(input)) continue

            // Handle TodoWrite
            if (name === 'TodoWrite') {
                const result = this.extractFromTodoWrite(input)
                if (result) return result
            }

            // Handle TaskCreate
            if (name === 'TaskCreate') {
                const result = this.extractFromTaskCreate(input)
                if (result) return result
            }

            // Handle TaskUpdate
            if (name === 'TaskUpdate') {
                const result = this.extractFromTaskUpdate(input)
                if (result) return result
            }
        }

        return null
    }

    private extractFromTodoWrite(input: Record<string, unknown>): TaskToolResult | null {
        const todosCandidate = input.todos
        if (!Array.isArray(todosCandidate)) return null

        // Claude Code's TodoWrite may not include id and priority fields
        // We need to add them before validation
        const todosWithDefaults = todosCandidate.map((todo, index) => {
            if (!todo || typeof todo !== 'object') return null

            const todoObj = todo as Record<string, unknown>
            return {
                id: typeof todoObj.id === 'string' ? todoObj.id : `todo-${Date.now()}-${index}`,
                content: typeof todoObj.content === 'string' ? todoObj.content : '',
                status: todoObj.status,
                priority: typeof todoObj.priority === 'string' ? todoObj.priority : 'medium'
            }
        }).filter(Boolean)

        const parsed = TodosSchema.safeParse(todosWithDefaults)
        if (!parsed.success) return null

        return {
            todos: parsed.data,
            source: 'TodoWrite'
        }
    }

    private extractFromTaskCreate(input: Record<string, unknown>): TaskToolResult | null {
        const subject = typeof input.subject === 'string' ? input.subject : null
        const description = typeof input.description === 'string' ? input.description : null
        const activeForm = typeof input.activeForm === 'string' ? input.activeForm : null

        if (!subject || !description) return null

        const id = `task-${Date.now()}-${Math.random().toString(16).slice(2)}`

        const todo: TodoItem = {
            id,
            content: `${subject}${description ? `: ${description}` : ''}`,
            status: 'pending',
            priority: 'medium'
        }

        if (activeForm) {
            todo.content = `${subject} (${activeForm})`
        }

        return {
            todos: [todo],
            source: 'TaskCreate'
        }
    }

    private extractFromTaskUpdate(input: Record<string, unknown>): TaskToolResult | null {
        const taskId = typeof input.taskId === 'string' ? input.taskId : null
        const status = typeof input.status === 'string' ? input.status : null
        const subject = typeof input.subject === 'string' ? input.subject : null
        const description = typeof input.description === 'string' ? input.description : null

        if (!taskId) return null

        // For TaskUpdate, we need to merge with existing todos
        // This will be handled at a higher level, so we return partial info
        const todo: TodoItem = {
            id: taskId,
            content: subject || description || 'Task updated',
            status: this.mapTaskStatus(status),
            priority: 'medium'
        }

        return {
            todos: [todo],
            source: 'TaskUpdate'
        }
    }

    private mapTaskStatus(status: string | null): 'pending' | 'in_progress' | 'completed' {
        if (status === 'in_progress') return 'in_progress'
        if (status === 'completed') return 'completed'
        return 'pending'
    }
}
