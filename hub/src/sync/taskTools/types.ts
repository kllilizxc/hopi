import type { TodoItem } from '@hapi/protocol/types'

/**
 * Unified task tool extraction result
 */
export interface TaskToolResult {
    todos: TodoItem[]
    source: 'TodoWrite' | 'TaskCreate' | 'TaskUpdate' | 'TaskList' | 'unknown'
}

/**
 * Agent-specific tool extractor interface
 */
export interface AgentToolExtractor {
    /**
     * Extract task-related tool calls from agent message content
     */
    extractTaskTools(content: Record<string, unknown>): TaskToolResult | null
}

/**
 * Registry for agent-specific extractors
 */
export interface ExtractorRegistry {
    register(agentType: string, extractor: AgentToolExtractor): void
    extract(messageContent: unknown): TaskToolResult | null
}
