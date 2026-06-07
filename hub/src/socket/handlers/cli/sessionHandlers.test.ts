import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../../store'
import { registerSessionHandlers } from './sessionHandlers'

const createdPaths: string[] = []

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-session-handlers-'))
    createdPaths.push(path)
    return path
}

afterEach(() => {
    while (createdPaths.length > 0) {
        const path = createdPaths.pop()
        if (path) {
            rmSync(path, { recursive: true, force: true })
        }
    }
})

describe('sessionHandlers write trace', () => {
    it('records goal-scoped write traces from incoming write tool messages', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-session-handler-write-trace'
        const goalId = 'goal-session-handler-write-trace'
        const taskId = 'task-session-handler-write-trace'
        const workspacePath = createTempWorkspace()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project',
            defaultWorkspaceId: 'workspace-1',
            defaultAgentFlavor: 'claude'
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
            title: 'Goal',
            goalKey: 'handler-goal',
            status: 'active'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: 'handler-ref',
            title: 'Task',
            status: 'running',
            source: 'manual',
            workspaceId: 'workspace-1',
            agentFlavor: 'claude'
        })
        const storedSession = store.sessions.getOrCreateSession(
            'session-handler-1',
            {
                path: workspacePath,
                host: 'test',
                projectId,
                taskId,
                flavor: 'claude'
            },
            null,
            namespace
        )

        const handlers = new Map<string, (payload: unknown) => void>()
        const socket = {
            on(event: string, handler: (payload: unknown) => void) {
                handlers.set(event, handler)
            },
            to() {
                return {
                    emit() {
                    }
                }
            }
        } as any

        registerSessionHandlers(socket, {
            store,
            resolveSessionAccess(sessionId: string) {
                if (sessionId !== storedSession.id) {
                    return { ok: false, reason: 'not-found' as const }
                }
                return { ok: true, value: storedSession }
            },
            emitAccessError() {
            }
        })

        const messageHandler = handlers.get('message')
        expect(messageHandler).toBeDefined()

        messageHandler?.({
            sid: storedSession.id,
            message: {
                role: 'assistant',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        message: {
                            content: [
                                {
                                    type: 'tool_use',
                                    id: 'tool-write-1',
                                    name: 'Write',
                                    input: {
                                        file_path: 'src/handler.ts',
                                        content: 'console.log("handler")'
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        })

        const writeTracePath = join(workspacePath, '.hopi', 'docs', 'goals', 'handler-goal', 'write-trace.jsonl')
        const lines = readFileSync(writeTracePath, 'utf8').trim().split('\n').map((line) => JSON.parse(line))
        expect(lines).toHaveLength(1)
        expect(lines[0]).toMatchObject({
            agent: 'claude',
            toolName: 'Write',
            phase: 'tool_call',
            targetPaths: ['src/handler.ts']
        })
    })
})
