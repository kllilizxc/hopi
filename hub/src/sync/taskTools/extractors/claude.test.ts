import { describe, it, expect } from 'vitest'
import { ClaudeToolExtractor } from './claude'

describe('ClaudeToolExtractor', () => {
    const extractor = new ClaudeToolExtractor()

    describe('TodoWrite', () => {
        it('extracts todos from TodoWrite tool call', () => {
            const content = {
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
                                            content: 'Implement feature',
                                            status: 'pending',
                                            priority: 'high'
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                }
            }

            const result = extractor.extractTaskTools(content)
            expect(result).toEqual({
                todos: [
                    {
                        id: 'todo-1',
                        content: 'Implement feature',
                        status: 'pending',
                        priority: 'high'
                    }
                ],
                source: 'TodoWrite'
            })
        })
    })

    describe('TaskCreate', () => {
        it('extracts task from TaskCreate tool call', () => {
            const content = {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        content: [
                            {
                                type: 'tool_use',
                                name: 'TaskCreate',
                                input: {
                                    subject: 'Fix bug',
                                    description: 'Fix the login bug',
                                    activeForm: 'Fixing bug'
                                }
                            }
                        ]
                    }
                }
            }

            const result = extractor.extractTaskTools(content)
            expect(result).not.toBeNull()
            expect(result?.source).toBe('TaskCreate')
            expect(result?.todos).toHaveLength(1)
            expect(result?.todos[0].content).toContain('Fix bug')
            expect(result?.todos[0].status).toBe('pending')
            expect(result?.todos[0].priority).toBe('medium')
        })

        it('handles TaskCreate without activeForm', () => {
            const content = {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        content: [
                            {
                                type: 'tool_use',
                                name: 'TaskCreate',
                                input: {
                                    subject: 'Add feature',
                                    description: 'Add new feature'
                                }
                            }
                        ]
                    }
                }
            }

            const result = extractor.extractTaskTools(content)
            expect(result).not.toBeNull()
            expect(result?.todos[0].content).toBe('Add feature: Add new feature')
        })
    })

    describe('TaskUpdate', () => {
        it('extracts task from TaskUpdate tool call', () => {
            const content = {
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
                                    subject: 'Updated task'
                                }
                            }
                        ]
                    }
                }
            }

            const result = extractor.extractTaskTools(content)
            expect(result).toEqual({
                todos: [
                    {
                        id: 'task-123',
                        content: 'Updated task',
                        status: 'in_progress',
                        priority: 'medium'
                    }
                ],
                source: 'TaskUpdate'
            })
        })

        it('maps task status correctly', () => {
            const testCases = [
                { input: 'pending', expected: 'pending' },
                { input: 'in_progress', expected: 'in_progress' },
                { input: 'completed', expected: 'completed' },
                { input: 'unknown', expected: 'pending' }
            ]

            for (const { input, expected } of testCases) {
                const content = {
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
                                        status: input
                                    }
                                }
                            ]
                        }
                    }
                }

                const result = extractor.extractTaskTools(content)
                expect(result?.todos[0].status).toBe(expected)
            }
        })
    })

    it('returns null for non-output content', () => {
        const content = { type: 'other' }
        const result = extractor.extractTaskTools(content)
        expect(result).toBeNull()
    })

    it('returns null for non-assistant data', () => {
        const content = {
            type: 'output',
            data: { type: 'user' }
        }
        const result = extractor.extractTaskTools(content)
        expect(result).toBeNull()
    })

    it('returns null when no task tools found', () => {
        const content = {
            type: 'output',
            data: {
                type: 'assistant',
                message: {
                    content: [
                        {
                            type: 'tool_use',
                            name: 'OtherTool',
                            input: {}
                        }
                    ]
                }
            }
        }
        const result = extractor.extractTaskTools(content)
        expect(result).toBeNull()
    })
})
