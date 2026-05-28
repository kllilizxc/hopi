/**
 * Example: How to use the task tools extraction layer
 */

import { extractTaskToolsFromMessage, getExtractorRegistry } from './index'
import type { AgentToolExtractor, TaskToolResult } from './types'

// Example 1: Extract from Claude Code TodoWrite
function exampleClaudeTodoWrite() {
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
                                        content: 'Implement feature X',
                                        status: 'pending',
                                        priority: 'high'
                                    },
                                    {
                                        id: 'todo-2',
                                        content: 'Write tests',
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

    const result = extractTaskToolsFromMessage(messageContent)
    console.log('TodoWrite result:', result)
    // Output: { todos: [...], source: 'TodoWrite' }
}

// Example 2: Extract from Claude Code TaskCreate
function exampleClaudeTaskCreate() {
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
                                subject: 'Fix login bug',
                                description: 'Users cannot login with email',
                                activeForm: 'Fixing login bug'
                            }
                        }
                    ]
                }
            }
        }
    }

    const result = extractTaskToolsFromMessage(messageContent)
    console.log('TaskCreate result:', result)
    // Output: { todos: [{ id: '...', content: 'Fix login bug (Fixing login bug)', ... }], source: 'TaskCreate' }
}

// Example 3: Extract from Claude Code TaskUpdate
function exampleClaudeTaskUpdate() {
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
                            name: 'TaskUpdate',
                            input: {
                                taskId: 'task-123',
                                status: 'in_progress',
                                subject: 'Updated task title'
                            }
                        }
                    ]
                }
            }
        }
    }

    const result = extractTaskToolsFromMessage(messageContent)
    console.log('TaskUpdate result:', result)
    // Output: { todos: [{ id: 'task-123', content: 'Updated task title', status: 'in_progress', ... }], source: 'TaskUpdate' }
}

// Example 4: Register custom extractor
function exampleCustomExtractor() {
    const customExtractor: AgentToolExtractor = {
        extractTaskTools(content): TaskToolResult | null {
            if (content.type !== 'custom-agent') return null

            // Custom extraction logic
            const data = content.data as { tasks?: unknown[] }
            if (!Array.isArray(data.tasks)) return null

            const todos = data.tasks.map((task, index) => ({
                id: `custom-${index}`,
                content: String(task),
                status: 'pending' as const,
                priority: 'medium' as const
            }))

            return {
                todos,
                source: 'unknown'
            }
        }
    }

    // Register the custom extractor
    getExtractorRegistry().register('custom-agent', customExtractor)

    // Now it can extract from custom agent messages
    const messageContent = {
        role: 'agent',
        content: {
            type: 'custom-agent',
            data: {
                tasks: ['Task 1', 'Task 2', 'Task 3']
            }
        }
    }

    const result = extractTaskToolsFromMessage(messageContent)
    console.log('Custom extractor result:', result)
    // Output: { todos: [{ id: 'custom-0', content: 'Task 1', ... }, ...], source: 'unknown' }
}

// Example 5: Handle different merge modes
function exampleMergeModes() {
    // Replace mode (for TodoWrite)
    // - Completely replaces existing subtasks
    // - Use when agent provides full task list

    // Merge mode (for TaskCreate/TaskUpdate)
    // - Merges by ID, preserving existing tasks
    // - Use when agent provides incremental updates

    console.log('Replace mode: All existing subtasks are replaced')
    console.log('Merge mode: Tasks are merged by ID, existing tasks preserved')
}

// Run examples
if (import.meta.main) {
    console.log('=== Example 1: Claude TodoWrite ===')
    exampleClaudeTodoWrite()

    console.log('\n=== Example 2: Claude TaskCreate ===')
    exampleClaudeTaskCreate()

    console.log('\n=== Example 3: Claude TaskUpdate ===')
    exampleClaudeTaskUpdate()

    console.log('\n=== Example 4: Custom Extractor ===')
    exampleCustomExtractor()

    console.log('\n=== Example 5: Merge Modes ===')
    exampleMergeModes()
}
