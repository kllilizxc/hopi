import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../store'
import { recordGoalWriteTraceFromSessionMessage } from './goalWriteTrace'

const createdPaths: string[] = []

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-goal-write-trace-'))
    createdPaths.push(path)
    return path
}

function createGoalTaskFixture(flavor: 'claude' | 'codex' | 'gemini' | 'opencode') {
    const store = new Store(':memory:')
    const namespace = 'default'
    const projectId = `project-${flavor}-write-trace`
    const goalId = `goal-${flavor}-write-trace`
    const taskId = `task-${flavor}-write-trace`
    const workspacePath = createTempWorkspace()

    store.projects.createProject({
        id: projectId,
        namespace,
        machineId: 'machine-1',
        name: 'Project',
        defaultWorkspaceId: 'workspace-1',
        defaultAgentFlavor: flavor
    })
    store.workspaces.createWorkspace({
        id: 'workspace-1',
        projectId,
        path: workspacePath
    })
    store.goals.createGoal({
        id: goalId,
        projectId,
        namespace,
        title: 'Trace goal',
        goalKey: 'trace-goal',
        status: 'active'
    })
    const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'trace-goal')
    mkdirSync(goalDir, { recursive: true })
    writeFileSync(join(goalDir, 'todo.yml'), [
        'version: 1',
        'goal:',
        '  goalKey: trace-goal',
        `  goalId: ${goalId}`,
        '  title: Trace goal',
        'items:',
        '  - ref: trace-ref',
        '    kind: engineering',
        '    status: in_progress',
        '    title: Trace task',
        `    taskId: ${taskId}`,
        '    acceptanceCriteria: []',
        '    dependencyTaskList: []'
    ].join('\n'))
    store.tasks.createTask({
        id: taskId,
        projectId,
        goalId,
        goalTodoRef: 'trace-ref',
        title: 'Trace task',
        status: 'running',
        source: 'manual',
        activeSessionId: 'session-1',
        workspaceId: 'workspace-1',
        agentFlavor: flavor
    })
    const session = store.sessions.getOrCreateSession(
        'session-1',
        {
            path: workspacePath,
            host: 'test',
            projectId,
            taskId: 'trace-ref',
            flavor
        },
        null,
        namespace
    )

    return {
        store,
        namespace,
        workspacePath,
        session,
        writeTracePath: join(workspacePath, '.hopi', 'docs', 'goals', 'trace-goal', 'write-trace.jsonl')
    }
}

afterEach(() => {
    while (createdPaths.length > 0) {
        const path = createdPaths.pop()
        if (path) {
            rmSync(path, { recursive: true, force: true })
        }
    }
})

describe('goalWriteTrace', () => {
    it('ignores stale DB-only goal rows in docs-backed workspaces', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-stale-write-trace'
        const goalId = 'goal-stale-write-trace'
        const taskId = 'task-stale-write-trace'
        const workspacePath = createTempWorkspace()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            defaultWorkspaceId: 'workspace-1',
            defaultAgentFlavor: 'codex'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Trace goal',
            goalKey: 'trace-goal',
            status: 'active'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: null,
            title: 'Stale trace task',
            status: 'running',
            source: 'manual',
            activeSessionId: 'session-stale-trace',
            workspaceId: 'workspace-1',
            agentFlavor: 'codex'
        })
        const session = store.sessions.getOrCreateSession(
            'session-stale-trace',
            {
                path: workspacePath,
                host: 'test',
                projectId,
                taskId,
                flavor: 'codex'
            },
            null,
            namespace
        )

        const message = store.messages.addMessage(session.id, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'tool-call',
                    name: 'Write',
                    callId: 'stale-write-1',
                    input: {
                        filePath: 'src/stale.ts',
                        content: 'stale'
                    }
                }
            }
        })

        expect(recordGoalWriteTraceFromSessionMessage({
            store,
            session,
            message
        })).toBe(0)
        expect(existsSync(join(workspacePath, '.hopi', 'docs', 'goals', 'trace-goal', 'write-trace.jsonl'))).toBe(false)
    })

    it('records Claude write tool calls and results without storing full file content', () => {
        const fixture = createGoalTaskFixture('claude')
        const callMessage = fixture.store.messages.addMessage(fixture.session.id, {
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [
                    {
                        type: 'tool_use',
                        id: 'tool-write-1',
                        name: 'Write',
                        input: {
                            file_path: 'src/app.ts',
                            content: 'console.log("hello from a full file body")\n'.repeat(20)
                        }
                    }
                ]
            },
            uuid: 'tool-call-1',
            timestamp: new Date().toISOString(),
            parentUuid: null,
            sessionId: fixture.session.id,
            cwd: fixture.workspacePath,
            version: 'test'
        } as unknown)
        const appendedCallEntries = recordGoalWriteTraceFromSessionMessage({
            store: fixture.store,
            session: fixture.session,
            message: callMessage
        })
        expect(appendedCallEntries).toBe(1)

        const resultMessage = fixture.store.messages.addMessage(fixture.session.id, {
            type: 'user',
            message: {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'tool-write-1',
                        content: 'Wrote src/app.ts successfully.',
                        is_error: false
                    }
                ]
            },
            uuid: 'tool-result-1',
            timestamp: new Date().toISOString(),
            parentUuid: null,
            userType: 'external',
            cwd: fixture.workspacePath,
            sessionId: fixture.session.id,
            version: 'test'
        } as unknown)
        const appendedResultEntries = recordGoalWriteTraceFromSessionMessage({
            store: fixture.store,
            session: fixture.session,
            message: resultMessage
        })
        expect(appendedResultEntries).toBe(1)

        const lines = readFileSync(fixture.writeTracePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
        expect(lines).toHaveLength(2)
        expect(lines[0]).toMatchObject({
            agent: 'claude',
            toolName: 'Write',
            phase: 'tool_call',
            targetPaths: ['src/app.ts'],
            success: null
        })
        expect(lines[0].argumentSummary).toContain('write src/app.ts')
        expect(lines[0].argumentSummary).not.toContain('hello from a full file body')
        expect(lines[1]).toMatchObject({
            agent: 'claude',
            toolName: 'Write',
            phase: 'tool_result',
            targetPaths: ['src/app.ts'],
            success: true
        })
        expect(lines[1].resultSummary).toContain('Wrote src/app.ts successfully.')
    })

    it('ignores TodoWrite but records CodexPatch file changes', () => {
        const fixture = createGoalTaskFixture('codex')
        const todoWriteMessage = fixture.store.messages.addMessage(fixture.session.id, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'tool-call',
                    name: 'TodoWrite',
                    callId: 'todo-1',
                    input: {
                        todos: [{ content: 'not a repo file write', status: 'pending', priority: 'high', id: 'todo-1' }]
                    }
                }
            }
        })
        expect(recordGoalWriteTraceFromSessionMessage({
            store: fixture.store,
            session: fixture.session,
            message: todoWriteMessage
        })).toBe(0)
        expect(existsSync(fixture.writeTracePath)).toBe(false)

        const patchCallMessage = fixture.store.messages.addMessage(fixture.session.id, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'tool-call',
                    name: 'CodexPatch',
                    callId: 'patch-1',
                    input: {
                        changes: {
                            'src/a.ts': { kind: 'update' },
                            'src/b.ts': { kind: 'add' }
                        }
                    }
                }
            }
        })
        expect(recordGoalWriteTraceFromSessionMessage({
            store: fixture.store,
            session: fixture.session,
            message: patchCallMessage
        })).toBe(1)

        const patchResultMessage = fixture.store.messages.addMessage(fixture.session.id, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'tool-call-result',
                    callId: 'patch-1',
                    output: {
                        success: true,
                        stdout: 'Files modified successfully'
                    }
                }
            }
        })
        expect(recordGoalWriteTraceFromSessionMessage({
            store: fixture.store,
            session: fixture.session,
            message: patchResultMessage
        })).toBe(1)

        const lines = readFileSync(fixture.writeTracePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
        expect(lines).toHaveLength(2)
        expect(lines[0]).toMatchObject({
            agent: 'codex',
            toolName: 'CodexPatch',
            phase: 'tool_call',
            targetPaths: ['src/a.ts', 'src/b.ts']
        })
        expect(lines[0].argumentSummary).toBe('patch 2 path(s)')
        expect(lines[1]).toMatchObject({
            agent: 'codex',
            toolName: 'CodexPatch',
            phase: 'tool_result',
            targetPaths: ['src/a.ts', 'src/b.ts'],
            success: true
        })
    })

    for (const flavor of ['gemini', 'opencode'] as const) {
        it(`records ${flavor} codex-normalized tool events`, () => {
            const fixture = createGoalTaskFixture(flavor)
            const callMessage = fixture.store.messages.addMessage(fixture.session.id, {
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'tool-call',
                        name: 'Write',
                        callId: `${flavor}-write-1`,
                        input: {
                            filePath: 'src/feature.ts',
                            content: 'export const feature = true;\n'.repeat(10)
                        }
                    }
                }
            })
            expect(recordGoalWriteTraceFromSessionMessage({
                store: fixture.store,
                session: fixture.session,
                message: callMessage
            })).toBe(1)

            const resultMessage = fixture.store.messages.addMessage(fixture.session.id, {
                role: 'agent',
                content: {
                    type: 'codex',
                    data: {
                        type: 'tool-call-result',
                        callId: `${flavor}-write-1`,
                        output: {
                            success: true,
                            stdout: 'updated src/feature.ts'
                        }
                    }
                }
            })
            expect(recordGoalWriteTraceFromSessionMessage({
                store: fixture.store,
                session: fixture.session,
                message: resultMessage
            })).toBe(1)

            const lines = readFileSync(fixture.writeTracePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
            expect(lines).toHaveLength(2)
            expect(lines[0]).toMatchObject({
                agent: flavor,
                toolName: 'Write',
                phase: 'tool_call',
                targetPaths: ['src/feature.ts'],
                success: null
            })
            expect(lines[0].argumentSummary).toContain('write src/feature.ts')
            expect(lines[1]).toMatchObject({
                agent: flavor,
                toolName: 'Write',
                phase: 'tool_result',
                targetPaths: ['src/feature.ts'],
                success: true
            })
            expect(lines[1].resultSummary).toContain('updated src/feature.ts')
        })
    }
})
