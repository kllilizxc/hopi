import { describe, it, expect, beforeEach } from 'vitest'
import { DefaultExtractorRegistry, setExtractorRegistry } from './registry'
import type { AgentToolExtractor, TaskToolResult } from './types'

describe('DefaultExtractorRegistry', () => {
    let registry: DefaultExtractorRegistry

    beforeEach(() => {
        registry = new DefaultExtractorRegistry()
        setExtractorRegistry(registry)
    })

    it('extracts from Claude TodoWrite', () => {
        const messageContent = {
            role: 'assistant',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        content: [
                            {
                                type: 'tool_use',
                                name: 'TodoWrite',
                                input: {
                                    todos: [
                                        {
                                            id: 'todo-1',
                                            content: 'Test task',
                                            status: 'pending',
                                            priority: 'medium'
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                }
            }
        }

        const result = registry.extract(messageContent)
        expect(result).not.toBeNull()
        expect(result?.source).toBe('TodoWrite')
        expect(result?.todos).toHaveLength(1)
    })

    it('extracts from Claude TaskCreate', () => {
        const messageContent = {
            role: 'assistant',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        content: [
                            {
                                type: 'tool_use',
                                name: 'TaskCreate',
                                input: {
                                    subject: 'New task',
                                    description: 'Task description'
                                }
                            }
                        ]
                    }
                }
            }
        }

        const result = registry.extract(messageContent)
        expect(result).not.toBeNull()
        expect(result?.source).toBe('TaskCreate')
    })

    it('extracts from Codex TodoWrite', () => {
        const messageContent = {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'tool-call',
                    name: 'TodoWrite',
                    input: {
                        todos: [
                            {
                                id: 'todo-1',
                                content: 'Codex task',
                                status: 'pending',
                                priority: 'high'
                            }
                        ]
                    }
                }
            }
        }

        const result = registry.extract(messageContent)
        expect(result).not.toBeNull()
        expect(result?.source).toBe('TodoWrite')
    })

    it('extracts from ACP plan', () => {
        const messageContent = {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'plan',
                    entries: [
                        {
                            id: 'plan-1',
                            content: 'Plan step 1',
                            status: 'pending',
                            priority: 'high'
                        }
                    ]
                }
            }
        }

        const result = registry.extract(messageContent)
        expect(result).not.toBeNull()
        expect(result?.todos).toHaveLength(1)
    })

    it('returns null for non-agent/assistant roles', () => {
        const messageContent = {
            role: 'user',
            content: { type: 'text' }
        }

        const result = registry.extract(messageContent)
        expect(result).toBeNull()
    })

    it('returns null when no extractors match', () => {
        const messageContent = {
            role: 'assistant',
            content: {
                type: 'unknown',
                data: {}
            }
        }

        const result = registry.extract(messageContent)
        expect(result).toBeNull()
    })

    it('allows registering custom extractors', () => {
        const customExtractor: AgentToolExtractor = {
            extractTaskTools: (content): TaskToolResult | null => {
                if (content.type === 'custom') {
                    return {
                        todos: [
                            {
                                id: 'custom-1',
                                content: 'Custom task',
                                status: 'pending',
                                priority: 'medium'
                            }
                        ],
                        source: 'unknown'
                    }
                }
                return null
            }
        }

        registry.register('custom', customExtractor)

        const messageContent = {
            role: 'agent',
            content: {
                type: 'custom'
            }
        }

        const result = registry.extract(messageContent)
        expect(result).not.toBeNull()
        expect(result?.todos[0].content).toBe('Custom task')
    })
})
