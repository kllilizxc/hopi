import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH } from '@hopi/protocol/brand'
import type { SyncEvent } from '@hopi/protocol/types'
import { Store } from '../store'
import { continueTaskInLinkedSession, startSessionFromTask } from './taskSessionService'
import type { SyncEngine } from './syncEngine'

const tempDirs: string[] = []

function tick(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0))
}

function encodeBase64(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64')
}

type BootstrapWriteCall = {
    path: string
    options: {
        cwd?: string
        content: string
        createParents?: boolean
    }
}

const DEFAULT_VALID_ACTIONS_MANIFEST = [
    'version: 1',
    'setup:',
    '  steps:',
    '    - id: deps',
    '      type: run',
    '      cwd: .',
    '      run: ["bun", "install"]',
    'preview:',
    '  services:',
    '    - id: web',
    '      type: run',
    '      cwd: .',
    '      run: ["bun", "run", "dev"]',
    '      ready:',
    '        type: process_alive',
    '      expose: primary',
    'merge:',
    '  targetBranch: main',
    '  strategy: squash'
].join('\n')

function withValidContract<T extends Record<string, unknown>>(engine: T, manifest = DEFAULT_VALID_ACTIONS_MANIFEST): T {
    const runBash = typeof engine.runBash === 'function'
        ? engine.runBash as (...args: unknown[]) => Promise<unknown>
        : async () => ({ success: true, stdout: 'setup ok', stderr: '' })

    return {
        ...engine,
        async readSessionFile(...args: unknown[]) {
            if (typeof engine.readSessionFile === 'function') {
                return await (engine.readSessionFile as (...callArgs: unknown[]) => Promise<unknown>)(...args)
            }
            return {
                success: true,
                content: encodeBase64(manifest)
            }
        },
        async runBash(...args: unknown[]) {
            return await runBash(...args)
        }
    }
}

function createTempWorkspacePath(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-task-session-'))
    tempDirs.push(path)
    return path
}

function seedCanonicalGoalTodo(workspacePath: string, options: {
    goalKey: string
    goalId: string
    todoRef: string
    title: string
}): void {
    const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', options.goalKey)
    mkdirSync(goalDir, { recursive: true })
    writeFileSync(join(goalDir, 'todo.yml'), [
        'version: 1',
        'goal:',
        `  goalKey: ${options.goalKey}`,
        `  goalId: ${options.goalId}`,
        `  title: Goal ${options.goalKey}`,
        'items:',
        `  - ref: ${options.todoRef}`,
        '    kind: engineering',
        '    status: planned',
        `    title: ${options.title}`,
        '    description: Seeded from test.',
        '    acceptanceCriteria: []',
        '    blockedBy: []'
    ].join('\n'), 'utf8')
}

afterEach(() => {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
})

describe('startSessionFromTask', () => {
    it('uses setup workflow from actions manifest before kickoff when contract exists', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-setup-contract-1'
        const taskId = 'task-setup-contract-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-setup-contract-1',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        const sequence: string[] = []
        let observedCommand = ''
        let observedCwd = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: encodeBase64([
                        'version: 1',
                        'setup:',
                        '  steps:',
                        '    - id: deps',
                        '      type: run',
                        '      cwd: .',
                        '      run: ["bun", "install"]',
                        'preview:',
                        '  services:',
                        '    - id: web',
                        '      type: run',
                        '      cwd: .',
                        '      run: ["bun", "run", "dev"]',
                        '      ready:',
                        '        type: process_alive',
                        '      expose: primary',
                        'merge:',
                        '  targetBranch: main',
                        '  strategy: squash'
                    ].join('\n'))
                }
            },
            async runBash(_sessionId: string, params: { command: string; cwd?: string }) {
                sequence.push('setup')
                observedCommand = params.command
                observedCwd = params.cwd ?? ''
                return { success: true, stdout: 'deps installed', stderr: '' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
                sequence.push('kickoff')
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(sequence).toEqual(['setup', 'kickoff'])
        expect(observedCwd).toBe(workspacePath)
        expect(observedCommand).toContain("'bun' 'install'")
        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.activeSessionId).toBe(spawned.id)
        expect(updatedTask?.initRuntime?.status).toBe('succeeded')
        expect(updatedTask?.initRuntime?.sessionId).toBe(spawned.id)
        expect(updatedTask?.initRuntime?.latestNote ?? null).toBeNull()
        expect(store.messages.getMessages(spawned.id, 10)).toHaveLength(0)
    })

    it('includes task contract in the default kickoff message', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-task-contract-kickoff'
        const taskId = 'task-contract-kickoff'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: 'goal-1',
            projectId,
            namespace,
            title: 'Goal 1'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId: 'goal-1',
            title: 'Clarify goal and plan first iteration',
            description: 'Clarify the goal before implementation.',
            status: 'planning',
            workspaceId,
            source: 'planner',
            contract: [
                '## Objective',
                '',
                'Use the brainstorming protocol to clarify this Goal before implementation.',
                '',
                '## Acceptance',
                '',
                '- Update .hopi/docs/goals/goal-1/goal.md.'
            ].join('\n')
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-task-contract-kickoff',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let kickoffText = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, message: { text?: string }) {
                kickoffText = message.text ?? ''
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(kickoffText).toContain('Task: Clarify goal and plan first iteration')
        expect(kickoffText).toContain('Task Contract:')
        expect(kickoffText).toContain('Use the brainstorming protocol to clarify this Goal before implementation.')
        expect(kickoffText).toContain('.hopi/docs/goals/goal-1/goal.md')
        expect(kickoffText).toContain('Role: Planner')
        expect(kickoffText).toContain('Allowed transitions:')
        expect(kickoffText).toContain('Task creation quality bar:')
        expect(kickoffText).toContain('Involved Files / Areas')
        expect(kickoffText).toContain('bugfix, feature, refactor, test, content, infra, or performance')
        expect(kickoffText).toContain('Do not mark the Goal paused, done, or archived')
        expect(kickoffText).not.toContain('operator/planner-mail.yml')
        expect(kickoffText).not.toContain('legacy candidate/deferred notes')
        expect(kickoffText).not.toContain('old `goals[]` / `tag` shape')
        expect(kickoffText).not.toContain('Mark this Goal active, paused, blocked')
    })

    it('adds project agent output language guidance to goal task kickoff', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-task-language-kickoff'
        const taskId = 'task-language-kickoff'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            agentOutputLanguage: 'zh-CN'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: 'goal-language',
            projectId,
            namespace,
            title: 'Goal language'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId: 'goal-language',
            title: 'Build language-aware planning',
            description: 'Make generated goal artifacts follow project language.',
            status: 'planning',
            workspaceId,
            source: 'planner'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-task-language-kickoff',
            { path: workspacePath, host: 'localhost', locale: 'en-US' },
            null,
            namespace
        )

        let kickoffText = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost', locale: 'en-US' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, message: { text?: string }) {
                kickoffText = message.text ?? ''
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(kickoffText).toContain('Agent output language: zh-CN')
        expect(kickoffText).toContain('Use zh-CN for HOPI_ACTIONS generated titles, descriptions, decision topics, handoff, evidence, and goal updates unless quoting source text.')
    })

    it('keeps project agent output language guidance on internal workflow kickoff', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-workflow-language-kickoff'
        const taskId = 'task-workflow-language-kickoff'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            agentOutputLanguage: 'zh-CN'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Plan language-aware workflow',
            description: 'Keep generated artifacts localized.',
            status: 'planning',
            workspaceId,
            workflowProfile: 'gsd',
            workflowPhase: 'plan'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-workflow-language-kickoff',
            { path: workspacePath, host: 'localhost', locale: 'en-US' },
            null,
            namespace
        )

        let kickoffText = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost', locale: 'en-US' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, message: { text?: string }) {
                kickoffText = message.text ?? ''
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(kickoffText).toContain('Agent output language: zh-CN')
        expect(kickoffText).toContain('Workflow mode: GSD plan.')
    })

    it('blocks task when setup workflow from actions manifest fails', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-setup-contract-fail'
        const taskId = 'task-setup-contract-fail'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-setup-contract-fail',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let sendMessageCalled = false
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: encodeBase64([
                        'version: 1',
                        'setup:',
                        '  steps:',
                        '    - id: deps',
                        '      type: run',
                        '      cwd: .',
                        '      run: ["bun", "install"]',
                        'preview:',
                        '  services:',
                        '    - id: web',
                        '      type: run',
                        '      cwd: .',
                        '      run: ["bun", "run", "dev"]',
                        '      ready:',
                        '        type: process_alive',
                        '      expose: primary',
                        'merge:',
                        '  targetBranch: main',
                        '  strategy: squash'
                    ].join('\n'))
                }
            },
            async runBash() {
                return { success: false, error: 'bun install failed', stdout: 'installing', stderr: 'bun install failed' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
                sendMessageCalled = true
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        if (!result.ok) {
            return
        }
        expect(sendMessageCalled).toBe(false)
        expect(result.initRecoveryAttempted).toBe(false)
        expect(result.task.activeSessionId).toBe(spawned.id)
        expect(result.task.initRuntime).toMatchObject({
            status: 'blocked',
            sessionId: spawned.id,
            blockedReason: 'bun install failed'
        })
        expect(result.task.initRuntime?.latestNote).toContain('Setup workflow failed')
        expect(result.task.initRuntime?.latestNote).toContain('retry task start')
        const messages = store.messages.getMessages(spawned.id, 10)
        expect(messages).toHaveLength(1)
        const content = messages[0]?.content as { content?: { text?: string } }
        expect(content.content?.text).toContain('HOPI ran setup workflow from `.hopi/actions.yaml`, but it failed before kickoff.')
    })

    it('skips runtime root paths outside the session working directory and uses the workspace contract', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-setup-contract-worktree'
        const taskId = 'task-setup-contract-worktree'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const runtimePath = '/Users/realizer/Code/hopi'
        const workspacePath = '/Users/realizer/Code/hopi-worktrees/self-task'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultSessionType: 'worktree'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-setup-contract-worktree',
            { path: runtimePath, host: 'localhost' },
            null,
            namespace
        )

        const readAttempts: string[] = []
        let observedCwd = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: runtimePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile(_sessionId: string, _path: string, cwd?: string) {
                readAttempts.push(cwd ?? '')
                if (cwd === runtimePath) {
                    return {
                        success: false,
                        error: `Access denied: Path '${runtimePath}' is outside the working directory`
                    }
                }

                if (cwd === workspacePath) {
                    return {
                        success: true,
                        content: encodeBase64(DEFAULT_VALID_ACTIONS_MANIFEST)
                    }
                }

                return {
                    success: false,
                    error: 'Failed to read file: ENOENT'
                }
            },
            async runBash(_sessionId: string, params: { cwd?: string }) {
                observedCwd = params.cwd ?? ''
                return { success: true, stdout: 'deps installed', stderr: '' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(readAttempts).toEqual([runtimePath, workspacePath])
        expect(observedCwd).toBe(workspacePath)
        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.initRuntime?.status).toBe('succeeded')
    })

    it('blocks task when actions manifest is invalid', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-setup-contract-invalid'
        const taskId = 'task-setup-contract-invalid'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-setup-contract-invalid',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let runBashCalled = false
        let sendMessageCalled = false
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: encodeBase64([
                        'version: 1',
                        'setup:',
                        '  steps: []',
                        'preview:',
                        '  services: []',
                        'merge:',
                        '  targetBranch: ""'
                    ].join('\n'))
                }
            },
            async runBash() {
                runBashCalled = true
                return { success: true, stdout: '', stderr: '' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
                sendMessageCalled = true
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        if (!result.ok) {
            return
        }
        expect(runBashCalled).toBe(false)
        expect(sendMessageCalled).toBe(false)
        expect(result.initRecoveryAttempted).toBe(false)
        expect(result.task.activeSessionId).toBe(spawned.id)
        expect(result.task.initRuntime).toMatchObject({
            status: 'blocked',
            sessionId: spawned.id
        })
        expect(result.task.initRuntime?.blockedReason).toContain('setup.steps')
        const messages = store.messages.getMessages(spawned.id, 10)
        expect(messages).toHaveLength(1)
        const content = messages[0]?.content as { content?: { text?: string } }
        expect(content.content?.text).toContain('the setup contract is invalid')
    })

    it('prefers worktree metadata path over base workspace path for setup contract loading', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-setup-contract-worktree-metadata'
        const taskId = 'task-setup-contract-worktree-metadata'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/Users/realizer/Code/hopi'
        const worktreePath = '/Users/realizer/Code/hopi-worktrees/self-task'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultSessionType: 'worktree'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-setup-contract-worktree-metadata',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        const readAttempts: string[] = []
        let observedCwd = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: {
                        path: workspacePath,
                        host: 'localhost',
                        worktree: {
                            basePath: workspacePath,
                            worktreePath
                        }
                    }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile(_sessionId: string, _path: string, cwd?: string) {
                readAttempts.push(cwd ?? '')
                if (cwd === worktreePath) {
                    return {
                        success: true,
                        content: encodeBase64(DEFAULT_VALID_ACTIONS_MANIFEST)
                    }
                }

                return {
                    success: false,
                    error: `Access denied: Path '${workspacePath}' is outside the working directory`
                }
            },
            async runBash(_sessionId: string, params: { cwd?: string }) {
                observedCwd = params.cwd ?? ''
                return { success: true, stdout: 'deps installed', stderr: '' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(readAttempts).toEqual([worktreePath])
        expect(observedCwd).toBe(worktreePath)
        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.initRuntime?.status).toBe('succeeded')
    })

    it('blocks task when actions manifest is missing', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-setup-contract-missing'
        const taskId = 'task-setup-contract-missing'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-setup-contract-missing',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let sendMessageCalled = false
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile() {
                return {
                    success: false,
                    error: 'Failed to read file: ENOENT'
                }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
                sendMessageCalled = true
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        if (!result.ok) {
            return
        }
        expect(sendMessageCalled).toBe(false)
        expect(result.initRecoveryAttempted).toBe(false)
        expect(result.task.activeSessionId).toBe(spawned.id)
        expect(result.task.initRuntime).toMatchObject({
            status: 'blocked',
            sessionId: spawned.id
        })
        expect(result.task.initRuntime?.blockedReason).toContain('.hopi/actions.yaml')
        const messages = store.messages.getMessages(spawned.id, 10)
        expect(messages).toHaveLength(1)
        const content = messages[0]?.content as { content?: { text?: string } }
        expect(content.content?.text).toContain('could not find `.hopi/actions.yaml`')
    })

    it('starts project_init tasks without requiring an existing actions manifest', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-bootstrap-contract-missing'
        const taskId = 'task-bootstrap-contract-missing'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Initialize project scripts',
            status: 'planning',
            workspaceId,
            source: 'project_init'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-bootstrap-contract-missing',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let readSessionFileCalled = false
        let writeSessionFileCall: BootstrapWriteCall | undefined
        let runBashCalled = false
        let sendMessageCalled = false
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile() {
                readSessionFileCalled = true
                return {
                    success: false,
                    error: 'Failed to read file: ENOENT'
                }
            },
            async writeSessionFile(_sessionId: string, path: string, options: { cwd?: string; content: string; createParents?: boolean }) {
                writeSessionFileCall = { path, options }
                return { success: true, hash: 'starter-hash' }
            },
            async runBash() {
                runBashCalled = true
                return { success: true, stdout: '', stderr: '' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
                sendMessageCalled = true
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(readSessionFileCalled).toBe(true)
        expect(writeSessionFileCall).toBeDefined()
        const seededWrite = writeSessionFileCall
        if (!seededWrite) {
            throw new Error('Expected bootstrap scaffold write')
        }
        expect(seededWrite.path).toBe('.hopi/actions.yaml')
        expect(seededWrite.options.cwd).toBe(workspacePath)
        expect(seededWrite.options.createParents).toBe(true)
        expect(Buffer.from(seededWrite.options.content, 'base64').toString('utf8')).toContain('steps: []')
        expect(runBashCalled).toBe(false)
        expect(sendMessageCalled).toBe(true)
        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.activeSessionId).toBe(spawned.id)
        expect(updatedTask?.initRuntime?.status).toBe('succeeded')
        expect(updatedTask?.initRuntime?.latestNote).toContain('Starter scaffold written')
        const messages = store.messages.getMessages(spawned.id, 10)
        expect(messages).toHaveLength(2)
        const transcript = JSON.stringify(messages.map((message) => message.content))
        expect(transcript).toContain('skipped setup workflow preflight')
        expect(transcript).toContain('created a starter')
    })

    it('infers a non-placeholder starter contract from package.json and bun lockfiles', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-bootstrap-inferred'
        const taskId = 'task-bootstrap-inferred'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            worktreeTargetBranch: 'dev'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Initialize project scripts',
            status: 'planning',
            workspaceId,
            source: 'project_init'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-bootstrap-inferred',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let writeSessionFileCall: BootstrapWriteCall | undefined
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile(_sessionId: string, path: string) {
                if (path === '.hopi/actions.yaml') {
                    return {
                        success: false,
                        error: 'Failed to read file: ENOENT'
                    }
                }
                if (path === 'package.json') {
                    return {
                        success: true,
                        content: Buffer.from(JSON.stringify({
                            scripts: {
                                dev: 'concurrently "bun run dev:hub" "bun run dev:web"',
                                'dev:hub': 'cd hub && bun run dev',
                                'dev:web': 'cd web && bun run dev'
                            }
                        }), 'utf8').toString('base64')
                    }
                }
                if (path === 'bun.lock') {
                    return {
                        success: true,
                        content: Buffer.from('# bun lock', 'utf8').toString('base64')
                    }
                }
                return {
                    success: false,
                    error: 'Failed to read file: ENOENT'
                }
            },
            async writeSessionFile(_sessionId: string, path: string, options: { cwd?: string; content: string; createParents?: boolean }) {
                writeSessionFileCall = { path, options }
                return { success: true, hash: 'starter-hash' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        const seededWrite = writeSessionFileCall
        if (!seededWrite) {
            throw new Error('Expected inferred bootstrap scaffold write')
        }
        const content = Buffer.from(seededWrite.options.content, 'base64').toString('utf8')
        expect(content).toContain('run: ["bun", "install"]')
        expect(content).toContain('id: hub')
        expect(content).toContain('run: ["bun", "run", "dev:hub"]')
        expect(content).toContain('id: web')
        expect(content).toContain('run: ["bun", "run", "dev:web"]')
        expect(content).toContain('targetBranch: "dev"')
        expect(content).not.toContain('steps: []')
        expect(content).not.toContain('services: []')
    })

    it('refreshes an existing placeholder actions manifest into an inferred starter contract', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-bootstrap-refresh'
        const taskId = 'task-bootstrap-refresh'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            worktreeTargetBranch: 'dev'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Initialize project scripts',
            status: 'planning',
            workspaceId,
            source: 'project_init'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-bootstrap-refresh',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        const writeCalls: Array<BootstrapWriteCall & { options: BootstrapWriteCall['options'] & { overwrite?: boolean } }> = []
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile(_sessionId: string, path: string) {
                if (path === '.hopi/actions.yaml') {
                    return {
                        success: true,
                        content: Buffer.from([
                            '# HOPI bootstrap scaffold.',
                            '# Replace empty sections with project-specific setup, preview, and merge rules before verifying automation.',
                            'version: 1',
                            'setup:',
                            '  steps: []',
                            'preview:',
                            '  services: []',
                            'merge:',
                            '  targetBranch: "dev"',
                            '  strategy: merge_commit',
                            '  conflictResolution:',
                            '    mode: ai',
                            '    maxAttempts: 2'
                        ].join('\n'), 'utf8').toString('base64')
                    }
                }
                if (path === 'package.json') {
                    return {
                        success: true,
                        content: Buffer.from(JSON.stringify({
                            scripts: {
                                dev: 'concurrently "bun run dev:hub" "bun run dev:web"',
                                'dev:hub': 'cd hub && bun run dev',
                                'dev:web': 'cd web && bun run dev'
                            }
                        }), 'utf8').toString('base64')
                    }
                }
                if (path === 'bun.lock') {
                    return {
                        success: true,
                        content: Buffer.from('# bun lock', 'utf8').toString('base64')
                    }
                }
                return {
                    success: false,
                    error: 'Failed to read file: ENOENT'
                }
            },
            async writeSessionFile(_sessionId: string, path: string, options: BootstrapWriteCall['options'] & { overwrite?: boolean }) {
                writeCalls.push({ path, options })
                return { success: true, hash: 'starter-hash' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(writeCalls).toHaveLength(1)
        expect(writeCalls[0]?.options.overwrite).toBe(true)
        const content = Buffer.from(writeCalls[0]!.options.content, 'base64').toString('utf8')
        expect(content).toContain('run: ["bun", "install"]')
        expect(content).toContain('run: ["bun", "run", "dev:web"]')
        expect(content).not.toContain('steps: []')
        expect(content).not.toContain('services: []')
    })

    it('uses worktree metadata path when bootstrapping a missing actions manifest', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-bootstrap-worktree-metadata'
        const taskId = 'task-bootstrap-worktree-metadata'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/Users/realizer/Code/hopi'
        const worktreePath = '/Users/realizer/Code/hopi-worktrees/task-bootstrap'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultSessionType: 'worktree'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Initialize project scripts',
            status: 'planning',
            workspaceId,
            source: 'project_init'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-bootstrap-worktree-metadata',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        const readAttempts: string[] = []
        let writeSessionFileCall: {
            path: string
            options: {
                cwd?: string
                content: string
                createParents?: boolean
            }
        } | undefined
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: {
                        path: workspacePath,
                        host: 'localhost',
                        worktree: {
                            basePath: workspacePath,
                            worktreePath
                        }
                    }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile(_sessionId: string, _path: string, cwd?: string) {
                readAttempts.push(cwd ?? '')
                return {
                    success: false,
                    error: 'Failed to read file: ENOENT'
                }
            },
            async writeSessionFile(_sessionId: string, path: string, options: { cwd?: string; content: string; createParents?: boolean }) {
                writeSessionFileCall = { path, options }
                return { success: true, hash: 'starter-hash' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(readAttempts.length).toBeGreaterThan(0)
        expect(readAttempts.every((attempt) => attempt === worktreePath)).toBe(true)
        expect(writeSessionFileCall?.path).toBe('.hopi/actions.yaml')
        expect(writeSessionFileCall?.options.cwd).toBe(worktreePath)
    })

    it('emits task-updated before waiting for kickoff message delivery', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId,
            source: 'improvements_scan'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        const realtimeEvents: SyncEvent[] = []
        let resolveSendMessage: () => void = () => {}
        let sendMessageCalled = false

        const engine = withValidContract({
            getMachineByNamespace(id: string, ns: string) {
                if (id !== machineId || ns !== namespace) {
                    return undefined
                }
                return {
                    id,
                    namespace: ns,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
                sendMessageCalled = true
                await new Promise<void>((resolve) => {
                    resolveSendMessage = () => resolve()
                })
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        }) as unknown as SyncEngine

        const pending = startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        await tick()

        expect(sendMessageCalled).toBe(true)
        expect(realtimeEvents.some((event) => event.type === 'task-updated' && event.taskId === taskId)).toBe(true)

        resolveSendMessage()
        const result = await pending
        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.task.source).toBe('manual')
        }
    })

    it('uses task agent flavor when no start-session override is provided', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultAgentFlavor: 'claude'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId,
            agentFlavor: 'codex'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let spawnedAgent = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession(_machineId: string, _path: string, agent: string) {
                spawnedAgent = agent
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedAgent).toBe('codex')
    })

    it('defaults task sessions to Codex GPT-5.5 when task and project have no agent or model', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-default-codex'
        const taskId = 'task-default-codex'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-default-codex',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let spawnedAgent = ''
        let spawnedModel: string | undefined
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession(_machineId: string, _path: string, agent: string, model?: string) {
                spawnedAgent = agent
                spawnedModel = model
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedAgent).toBe('codex')
        expect(spawnedModel).toBe('gpt-5.5')
    })

    it('uses project default model for inherited review tasks', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-review-model-default'
        const goalId = 'goal-review-model-default'
        const taskId = 'task-review-model-default'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultAgentFlavor: 'codex',
            defaultModel: 'gpt-5.3-codex-spark xhigh'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Review with project defaults'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Ready for evaluator',
            status: 'review',
            workspaceId,
            source: 'manual'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-review-model-default',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let spawnedAgent = ''
        let spawnedModel: string | undefined
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession(_machineId: string, _path: string, agent: string, model?: string) {
                spawnedAgent = agent
                spawnedModel = model
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedAgent).toBe('codex')
        expect(spawnedModel).toBe('gpt-5.3-codex-spark xhigh')
        expect(store.sessions.getSessionByNamespace(spawned.id, namespace)?.metadata).toMatchObject({
            hopiTaskRole: 'evaluator'
        })
    })

    it('starts planner goal tasks in safe-yolo Codex mode without requiring an actions manifest', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-planner-no-manifest'
        const goalId = 'goal-planner-no-manifest'
        const taskId = 'task-planner-no-manifest'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Clarify autonomous loop',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Clarify goal',
            status: 'planning',
            source: 'planner',
            workspaceId,
            contract: '## Objective\nClarify first.'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-planner-no-manifest',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let appliedPermissionMode = ''
        let kickoffText = ''
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig(_sessionId: string, patch: { permissionMode?: string; collaborationMode?: string }) {
                appliedPermissionMode = patch.permissionMode ?? patch.collaborationMode ?? appliedPermissionMode
            },
            async readSessionFile() {
                return {
                    success: false,
                    error: 'Failed to read file: ENOENT'
                }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                kickoffText = payload.text
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(appliedPermissionMode).toBe('safe-yolo')
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')
        expect(kickoffText).toContain('Role: Planner')
        expect(kickoffText).toContain('docs maintenance')
        expect(kickoffText).not.toContain('operator/planner-mail.yml')
    })

    it('lets planner goal tasks inherit project-configured Claude bypassPermissions mode', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-planner-claude-bypass'
        const goalId = 'goal-planner-claude-bypass'
        const taskId = 'task-planner-claude-bypass'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultAgentFlavor: 'claude',
            defaultPermissionMode: 'bypassPermissions'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Clarify autonomous loop',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Clarify goal',
            status: 'planning',
            source: 'planner',
            workspaceId,
            contract: '## Objective\nClarify first.'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-planner-claude-bypass',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let appliedPermissionMode = ''
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig(_sessionId: string, patch: { permissionMode?: string; collaborationMode?: string }) {
                appliedPermissionMode = patch.permissionMode ?? patch.collaborationMode ?? appliedPermissionMode
            },
            async readSessionFile() {
                return {
                    success: false,
                    error: 'Failed to read file: ENOENT'
                }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(appliedPermissionMode).toBe('bypassPermissions')
    })

    it('coerces legacy Claude planner project permission modes to bypassPermissions at session start', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-planner-claude-legacy-yolo'
        const goalId = 'goal-planner-claude-legacy-yolo'
        const taskId = 'task-planner-claude-legacy-yolo'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultAgentFlavor: 'claude',
            defaultPermissionMode: 'yolo'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Clarify autonomous loop',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Clarify goal',
            status: 'planning',
            source: 'planner',
            workspaceId,
            contract: '## Objective\nClarify first.'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-planner-claude-legacy-yolo',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let appliedPermissionMode = ''
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig(_sessionId: string, patch: { permissionMode?: string; collaborationMode?: string }) {
                appliedPermissionMode = patch.permissionMode ?? patch.collaborationMode ?? appliedPermissionMode
            },
            async readSessionFile() {
                return {
                    success: false,
                    error: 'Failed to read file: ENOENT'
                }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(appliedPermissionMode).toBe('bypassPermissions')
    })

    it('starts planner goal tasks in the main workspace without creating a worktree', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-planner-main-workspace'
        const goalId = 'goal-planner-main-workspace'
        const taskId = 'task-planner-main-workspace'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Clarify autonomous loop',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Clarify goal',
            status: 'planning',
            source: 'planner',
            workspaceId,
            contract: '## Objective\nClarify first.'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-planner-main-workspace',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let spawnedPath = ''
        let spawnedSessionType: 'simple' | 'worktree' | undefined
        let spawnedWorktreeName: string | undefined
        let spawnedWorktreeWorkspacePaths: string[] | undefined
        let spawnedWorktreeTargetBranch: string | undefined
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession(
                _machineId: string,
                path: string,
                _agent: string,
                _model?: string,
                _yolo?: boolean,
                sessionType?: 'simple' | 'worktree',
                worktreeName?: string,
                _resumeSessionId?: string,
                worktreeWorkspacePaths?: string[],
                worktreeTargetBranch?: string
            ) {
                spawnedPath = path
                spawnedSessionType = sessionType
                spawnedWorktreeName = worktreeName
                spawnedWorktreeWorkspacePaths = worktreeWorkspacePaths
                spawnedWorktreeTargetBranch = worktreeTargetBranch
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedPath).toBe(workspacePath)
        expect(spawnedSessionType).toBe('simple')
        expect(spawnedWorktreeName).toBeUndefined()
        expect(spawnedWorktreeWorkspacePaths).toBeUndefined()
        expect(spawnedWorktreeTargetBranch).toBeUndefined()
    })

    it('includes resolved decision handoff in goal planner kickoff', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-planner-decision-handoff'
        const goalId = 'goal-planner-decision-handoff'
        const taskId = 'task-planner-decision-handoff'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Clarify autonomous loop',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Plan next goal iteration',
            status: 'planning',
            source: 'planner',
            workspaceId,
            handoff: [
                'Resolved DecisionTopic: Choose story entry',
                'Human answer:',
                'Use MainMenu as the player-facing entry.'
            ].join('\n')
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-planner-decision-handoff',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let kickoffText = ''
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                kickoffText = payload.text
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(kickoffText).toContain('Role: Planner')
        expect(kickoffText).toContain('Latest Handoff')
        expect(kickoffText).toContain('Resolved DecisionTopic: Choose story entry')
        expect(kickoffText).toContain('Use MainMenu as the player-facing entry.')
    })

    it('starts radar goal tasks in the main workspace without creating a worktree', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-radar-main-workspace'
        const goalId = 'goal-radar-main-workspace'
        const taskId = 'task-radar-main-workspace'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Maintain autonomous loop',
            status: 'active',
            autopilotEnabled: true
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Radar: scan goal docs and technical debt',
            status: 'planning',
            source: 'radar',
            workspaceId,
            contract: '## Objective\nScan docs.'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-radar-main-workspace',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let spawnedPath = ''
        let spawnedSessionType: 'simple' | 'worktree' | undefined
        let spawnedWorktreeName: string | undefined
        let spawnedWorktreeWorkspacePaths: string[] | undefined
        let spawnedWorktreeTargetBranch: string | undefined
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession(
                _machineId: string,
                path: string,
                _agent: string,
                _model?: string,
                _yolo?: boolean,
                sessionType?: 'simple' | 'worktree',
                worktreeName?: string,
                _resumeSessionId?: string,
                worktreeWorkspacePaths?: string[],
                worktreeTargetBranch?: string
            ) {
                spawnedPath = path
                spawnedSessionType = sessionType
                spawnedWorktreeName = worktreeName
                spawnedWorktreeWorkspacePaths = worktreeWorkspacePaths
                spawnedWorktreeTargetBranch = worktreeTargetBranch
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedPath).toBe(workspacePath)
        expect(spawnedSessionType).toBe('simple')
        expect(spawnedWorktreeName).toBeUndefined()
        expect(spawnedWorktreeWorkspacePaths).toBeUndefined()
        expect(spawnedWorktreeTargetBranch).toBeUndefined()
    })

    it('starts goal generator tasks without requiring an actions manifest', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-generator-no-manifest'
        const goalId = 'goal-generator-no-manifest'
        const taskId = 'task-generator-no-manifest'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Implement autonomous loop',
            status: 'active'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Implement first slice',
            status: 'planning',
            source: 'manual',
            workspaceId,
            contract: '## Objective\nImplement first slice.'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-generator-no-manifest',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let readSessionFileCalled = false
        let kickoffText = ''
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile() {
                readSessionFileCalled = true
                return {
                    success: false,
                    error: 'Failed to read file: ENOENT'
                }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                kickoffText = payload.text
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(readSessionFileCalled).toBe(false)
        const updated = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updated?.status).toBe('running')
        expect(updated?.initRuntime?.status).toBe('succeeded')
        expect(updated?.initRuntime?.latestNote).toContain('Goal role skipped setup workflow')
        expect(kickoffText).toContain('Role: Generator')
        expect(kickoffText).toContain('Task Contract')
        expect(kickoffText).toContain('{ "type": "update_current_task", "status": "review"')
    })

    it('starts goal review tasks as evaluator handoffs and keeps them in review', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-review'
        const goalId = 'goal-review'
        const taskId = 'task-goal-review'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Ship checked work',
            status: 'active',
            autopilotEnabled: true
        })
        const previousSession = store.sessions.getOrCreateSession(
            'previous-goal-review-session',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )
        store.messages.addMessage(previousSession.id, {
            role: 'agent',
            content: { type: 'text', text: 'raw previous generator transcript that should not be copied' }
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Review implementation',
            status: 'review',
            source: 'manual',
            activeSessionId: previousSession.id,
            workspaceId,
            contract: '## Acceptance\n- Verify behavior.',
            handoff: '## Summary\nGenerator says checks passed.'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-goal-review',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let kickoffText = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                kickoffText = payload.text
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        const updatedReviewTask = store.tasks.getTaskByNamespace(taskId, namespace)
        const spawnedReviewSession = store.sessions.getSessionByNamespace(spawned.id, namespace)
        expect(updatedReviewTask?.status).toBe('review')
        expect(updatedReviewTask?.activeSessionId).toBe(previousSession.id)
        expect((spawnedReviewSession?.metadata as { hopiTaskRole?: string } | null)?.hopiTaskRole).toBe('evaluator')
        expect(kickoffText).toContain('Role: Evaluator')
        expect(kickoffText).toContain('Generator Handoff')
        expect(kickoffText).toContain('Evidence Packet')
        expect(kickoffText).toContain('HOPI will request the existing worktree merge flow before closing accepted work')
        expect(kickoffText).not.toContain('Previous session messages')
        expect(kickoffText).not.toContain('raw previous generator transcript')
    })

    it('writes goal todo docs first when starting a goal task session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-docs-start'
        const goalId = 'goal-docs-start'
        const goalKey = 'goal-docs-start'
        const taskId = 'task-goal-docs-start'
        const todoRef = 'T-100'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspacePath()

        seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef,
            title: 'Start through todo docs'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal docs start'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Start through todo docs',
            description: 'Verify docs-first session start.',
            status: 'planning',
            source: 'manual',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-goal-docs-start',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')
        const goalTodo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(goalTodo).toContain(`ref: ${todoRef}`)
        expect(goalTodo).toContain('status: in_progress')
        const eventLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('task_session_started')
    })

    it('keeps the docs-backed goal task view when session start finishes after the canonical board item disappears', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-docs-start-missing-projection'
        const goalId = 'goal-docs-start-missing-projection'
        const goalKey = 'goal-docs-start-missing-projection'
        const taskId = 'task-goal-docs-start-missing-projection'
        const todoRef = 'T-100b'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspacePath()

        seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef,
            title: 'Start after missing projection'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal docs start missing projection'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stale start overlay title',
            description: 'Stale start overlay description.',
            status: 'planning',
            source: 'manual',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-goal-docs-start-missing-projection',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
                writeFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), [
                    'version: 1',
                    'goal:',
                    `  goalKey: ${goalKey}`,
                    `  goalId: ${goalId}`,
                    '  title: Start after missing projection',
                    'items: []'
                ].join('\n'), 'utf8')
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        if (!result.ok) {
            return
        }
        expect(result.task.title).toBe('Start after missing projection')
        expect(result.task.description).toBe('Seeded from test.')
        expect(result.task.status).toBe('running')
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')

        const goalTodo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(goalTodo).toContain('items: []')
        expect(goalTodo).not.toContain(`ref: ${todoRef}`)
    })

    it('uses docs-projected goal task fields at session start without rewriting stale overlay metadata first', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-docs-projected-start'
        const goalId = 'goal-docs-projected-start'
        const goalKey = 'goal-docs-projected-start'
        const taskId = 'task-goal-docs-projected-start'
        const todoRef = 'T-101'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspacePath()

        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            `  title: Goal ${goalKey}`,
            'items:',
            `  - ref: ${todoRef}`,
            '    kind: engineering',
            '    status: planned',
            '    title: Canonical docs title',
            '    description: Canonical docs description.',
            '    acceptanceCriteria: []',
            '    blockedBy: []'
        ].join('\n'), 'utf8')

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal docs projected start'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stale overlay title',
            description: 'Stale overlay description.',
            status: 'planning',
            source: 'manual',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-goal-docs-projected-start',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let kickoffText = ''
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                kickoffText = payload.text
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        if (result.ok) {
            expect(result.task.title).toBe('Canonical docs title')
            expect(result.task.description).toBe('Canonical docs description.')
        }
        expect(kickoffText).toContain('Task: Canonical docs title')
        expect(kickoffText).toContain('Canonical docs description.')
        expect(kickoffText).not.toContain('Stale overlay title')
        expect(kickoffText).not.toContain('Stale overlay description.')

        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.title).toBe('Stale overlay title')
        expect(updatedTask?.description).toBe('Stale overlay description.')
        expect(updatedTask?.status).toBe('running')
    })

    it('returns docs-projected goal task fields when setup contract blocks session start', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-docs-blocked-start'
        const goalId = 'goal-docs-blocked-start'
        const goalKey = 'goal-docs-blocked-start'
        const taskId = 'task-goal-docs-blocked-start'
        const todoRef = 'T-102'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspacePath()

        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            `  title: Goal ${goalKey}`,
            'items:',
            `  - ref: ${todoRef}`,
            '    kind: engineering',
            '    status: planned',
            '    title: Canonical blocked docs title',
            '    description: Canonical blocked docs description.',
            '    acceptanceCriteria: []',
            '    blockedBy: []'
        ].join('\n'), 'utf8')

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal docs blocked start'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stale blocked overlay title',
            description: 'Stale blocked overlay description.',
            status: 'planning',
            source: 'manual',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-goal-docs-blocked-start',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let runBashCalled = false
        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace() {
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: encodeBase64([
                        'version: 1',
                        'setup:',
                        '  steps: []',
                        'preview:',
                        '  services: []',
                        'merge:',
                        '  targetBranch: ""'
                    ].join('\n'))
                }
            },
            async runBash() {
                runBashCalled = true
                return { success: true, stdout: '', stderr: '' }
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        if (!result.ok) {
            return
        }
        expect(runBashCalled).toBe(false)
        expect(result.task.title).toBe('Canonical blocked docs title')
        expect(result.task.description).toBe('Canonical blocked docs description.')
        expect(result.task.status).toBe('running')

        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.title).toBe('Stale blocked overlay title')
        expect(updatedTask?.description).toBe('Stale blocked overlay description.')
        expect(updatedTask?.status).toBe('running')

        const goalTodo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(goalTodo).toContain('title: Canonical blocked docs title')
        expect(goalTodo).not.toContain('Stale blocked overlay title')
        expect(goalTodo).toContain('status: in_progress')

        const eventLog = readFileSync(join(goalDir, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('task_session_started')
    })

    it('starts a docs-only goal todo item from its canonical ref', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-docs-only-start-ref'
        const goalId = 'goal-docs-only-start-ref'
        const goalKey = 'goal-docs-only-start-ref'
        const todoRef = 'T-150'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspacePath()

        seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef,
            title: 'Docs-only goal start task'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal docs-only start ref'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-goal-docs-only-start-ref',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== spawned.id) {
                    return null
                }
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { path: workspacePath, host: 'localhost' },
                    agentState: null
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId: todoRef
        })

        expect(result.ok).toBe(true)
        if (!result.ok) {
            return
        }
        expect(result.task.id).toBe(todoRef)
        expect(result.task.goalTodoRef).toBe(todoRef)
        expect(result.task.title).toBe('Docs-only goal start task')
        expect(result.task.description).toBe('Seeded from test.')
        expect(result.task.status).toBe('running')
        expect(result.sessionId).toBe(spawned.id)

        const storedTask = store.tasks.getTaskByNamespace(todoRef, namespace)
        expect(storedTask?.goalTodoRef).toBe(todoRef)
        expect(storedTask?.activeSessionId).toBe(spawned.id)
        expect(storedTask?.status).toBe('running')

        const goalTodo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(goalTodo).toContain(`ref: ${todoRef}`)
        expect(goalTodo).toContain('status: in_progress')
        const eventLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('task_session_started')
    })

    it('rejects a stale DB-only goal row when starting a session directly by raw task id', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-db-only-start-reject'
        const goalId = 'goal-db-only-start-reject'
        const goalKey = 'goal-db-only-start-reject'
        const taskId = 'legacy-db-only-goal-start-task'
        const workspacePath = createTempWorkspacePath()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
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
            goalKey,
            title: 'Goal stale DB-only start reject'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Stale DB-only start title',
            description: 'Stale DB-only start description.',
            status: 'planning',
            source: 'manual'
        })

        const result = await startSessionFromTask({
            store,
            engine: {} as SyncEngine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(false)
        if (!result.ok) {
            expect(result.error.code).toBe('task_not_found')
        }
    })

    it('repairs a missing goal todo ref when starting a canonical-ref goal task from a stale overlay row', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-start-ref-repairs-missing-todo-ref'
        const goalId = 'goal-start-ref-repairs-missing-todo-ref'
        const goalKey = 'goal-start-ref-repairs-missing-todo-ref'
        const todoRef = 'T-151'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspacePath()

        seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef,
            title: 'Canonical ref repair start task'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal ref repair start'
        })
        store.tasks.createTask({
            id: todoRef,
            projectId,
            goalId,
            title: 'Stale overlay start title',
            description: 'Stale overlay start description.',
            status: 'planning',
            source: 'manual',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-goal-ref-repair-start',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            getSessionByNamespace(sessionId: string) {
                if (sessionId !== spawned.id) {
                    return null
                }
                return {
                    id: spawned.id,
                    namespace,
                    active: true,
                    thinking: false,
                    metadata: { path: workspacePath, host: 'localhost' },
                    agentState: null
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId: todoRef
        })

        expect(result.ok).toBe(true)
        if (!result.ok) {
            return
        }
        expect(result.task.id).toBe(todoRef)
        expect(result.task.goalTodoRef).toBe(todoRef)
        expect(result.task.title).toBe('Canonical ref repair start task')
        expect(result.task.description).toBe('Seeded from test.')
        expect(result.task.status).toBe('running')

        const storedTask = store.tasks.getTaskByNamespace(todoRef, namespace)
        expect(storedTask?.goalTodoRef).toBe(todoRef)
        expect(storedTask?.activeSessionId).toBe(spawned.id)
        expect(storedTask?.status).toBe('running')

        const goalTodo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(goalTodo).toContain(`ref: ${todoRef}`)
        expect(goalTodo).toContain('title: Canonical ref repair start task')
        expect(goalTodo).not.toContain('Stale overlay start title')
    })

    it('writes goal todo docs first when continuing an existing goal task session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-docs-continue'
        const goalId = 'goal-docs-continue'
        const goalKey = 'goal-docs-continue'
        const taskId = 'task-goal-docs-continue'
        const todoRef = 'T-200'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspacePath()

        seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef,
            title: 'Continue through todo docs'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal docs continue'
        })
        const linkedSession = store.sessions.getOrCreateSession(
            'linked-session-goal-docs-continue',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Continue through todo docs',
            description: 'Verify docs-first session continuation.',
            status: 'planning',
            source: 'manual',
            workspaceId,
            activeSessionId: linkedSession.id
        })

        const engine = {
            getSessionByNamespace() {
                return {
                    id: linkedSession.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await continueTaskInLinkedSession({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result?.ok).toBe(true)
        if (result?.ok) {
            expect(result.task.title).toBe('Continue through todo docs')
            expect(result.task.description).toBe('Seeded from test.')
        }
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')
        const goalTodo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(goalTodo).toContain(`ref: ${todoRef}`)
        expect(goalTodo).toContain('status: in_progress')
        const eventLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('task_session_continued')
    })

    it('does not recreate a removed goal todo item when linked-session continuation runs after the canonical board item disappears', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-docs-continue-missing-projection'
        const goalId = 'goal-docs-continue-missing-projection'
        const goalKey = 'goal-docs-continue-missing-projection'
        const taskId = 'task-goal-docs-continue-missing-projection'
        const todoRef = 'T-201b'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspacePath()

        seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef,
            title: 'Continue after missing projection'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal docs continue missing projection'
        })

        const linkedSession = store.sessions.getOrCreateSession(
            'linked-session-goal-docs-continue-missing-projection',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Continue through todo docs',
            description: 'Verify docs-first session continuation.',
            status: 'planning',
            source: 'manual',
            workspaceId,
            activeSessionId: linkedSession.id
        })

        const engine = {
            getSessionByNamespace() {
                return {
                    id: linkedSession.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async sendMessage() {
                writeFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), [
                    'version: 1',
                    'goal:',
                    `  goalKey: ${goalKey}`,
                    `  goalId: ${goalId}`,
                    '  title: Continue after missing projection',
                    'items: []'
                ].join('\n'), 'utf8')
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await continueTaskInLinkedSession({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result?.ok).toBe(true)
        if (result?.ok) {
            expect(result.task.title).toBe('Continue after missing projection')
            expect(result.task.description).toBe('Seeded from test.')
        }
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('running')
        const goalTodo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(goalTodo).toContain('items: []')
        expect(goalTodo).not.toContain(`ref: ${todoRef}`)
        const eventLogPath = join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl')
        if (existsSync(eventLogPath)) {
            const eventLog = readFileSync(eventLogPath, 'utf8')
            expect(eventLog).not.toContain('task_session_continued')
        }
    })

    it('continues an existing goal task session when addressed by canonical todo ref', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-docs-continue-ref'
        const goalId = 'goal-docs-continue-ref'
        const goalKey = 'goal-docs-continue-ref'
        const taskId = 'task-goal-docs-continue-ref'
        const todoRef = 'T-202'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspacePath()

        seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef,
            title: 'Continue through canonical ref'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal docs continue ref'
        })
        const linkedSession = store.sessions.getOrCreateSession(
            'linked-session-goal-docs-continue-ref',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stale continue overlay title',
            description: 'Stale continue overlay description.',
            status: 'planning',
            source: 'manual',
            workspaceId,
            activeSessionId: linkedSession.id
        })

        const engine = {
            getSessionByNamespace() {
                return {
                    id: linkedSession.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await continueTaskInLinkedSession({
            store,
            engine,
            namespace,
            taskId: todoRef
        })

        expect(result?.ok).toBe(true)
        if (!result?.ok) {
            return
        }
        expect(result.task.id).toBe(taskId)
        expect(result.task.goalTodoRef).toBe(todoRef)
        expect(result.task.title).toBe('Continue through canonical ref')
        expect(result.task.description).toBe('Seeded from test.')
        expect(result.task.status).toBe('running')

        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.status).toBe('running')
        expect(updatedTask?.goalTodoRef).toBe(todoRef)
        const goalTodo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(goalTodo).toContain(`ref: ${todoRef}`)
        expect(goalTodo).toContain('status: in_progress')
        expect(goalTodo).toContain('title: Continue through canonical ref')
        expect(goalTodo).not.toContain('Stale continue overlay title')
        const eventLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('task_session_continued')
    })

    it('rejects a stale DB-only goal row when continuing a linked session directly by raw task id', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-db-only-continue-reject'
        const goalId = 'goal-db-only-continue-reject'
        const goalKey = 'goal-db-only-continue-reject'
        const taskId = 'legacy-db-only-goal-continue-task'
        const workspacePath = createTempWorkspacePath()

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
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
            goalKey,
            title: 'Goal stale DB-only continue reject'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Stale DB-only continue title',
            description: 'Stale DB-only continue description.',
            status: 'planning',
            source: 'manual',
            activeSessionId: 'session-stale-db-only-continue'
        })

        const result = await continueTaskInLinkedSession({
            store,
            engine: {} as SyncEngine,
            namespace,
            taskId
        })

        expect(result).not.toBeNull()
        expect(result?.ok).toBe(false)
        if (result && !result.ok) {
            expect(result.error.code).toBe('task_not_found')
        }
    })

    it('clears stale goal init blockers when continuing an existing goal task session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-docs-continue-clears-init'
        const goalId = 'goal-docs-continue-clears-init'
        const goalKey = 'goal-docs-continue-clears-init'
        const taskId = 'task-goal-docs-continue-clears-init'
        const todoRef = 'T-201'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspacePath()

        seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef,
            title: 'Continue clears init blocker'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Goal docs continue clears init blocker'
        })
        const linkedSession = store.sessions.getOrCreateSession(
            'linked-session-goal-docs-continue-clears-init',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Continue clears init blocker',
            description: 'Verify stale init blockers are cleared on continue.',
            status: 'planning',
            source: 'manual',
            workspaceId,
            activeSessionId: linkedSession.id,
            blockedReason: `Missing ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`,
            blockedSource: 'init',
            blockedSessionId: linkedSession.id,
            initRuntime: {
                status: 'blocked',
                sessionId: linkedSession.id,
                updatedAt: Date.now(),
                requestedAt: Date.now() - 1_000,
                startedAt: Date.now() - 500,
                completedAt: Date.now(),
                retryCount: 1,
                failureFingerprint: 'init:stale',
                latestNote: 'Starter scaffold missing before kickoff.',
                blockedReason: `Missing ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`,
                failure: {
                    code: 'init_script_failed',
                    message: `Missing ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`,
                    blockedReason: `Missing ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`,
                    retry: {
                        count: 1,
                        action: 'manual_fix_then_retry_start',
                        available: true
                    }
                }
            }
        })

        const engine = {
            getSessionByNamespace() {
                return {
                    id: linkedSession.id,
                    namespace,
                    active: true,
                    thinking: false,
                    agentState: null,
                    metadata: { path: workspacePath, host: 'localhost' }
                }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await continueTaskInLinkedSession({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result?.ok).toBe(true)
        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.status).toBe('running')
        expect(updatedTask?.blockedReason).toBeNull()
        expect(updatedTask?.blockedSource).toBeNull()
        expect(updatedTask?.blockedSessionId).toBeNull()
        expect(updatedTask?.initRuntime?.status).toBe('succeeded')

        const goalTodo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'todo.yml'), 'utf8')
        expect(goalTodo).toContain(`ref: ${todoRef}`)
        expect(goalTodo).toContain('status: in_progress')
        expect(goalTodo).not.toContain(`summary: Missing ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`)
        const eventLog = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goalKey, 'events.jsonl'), 'utf8')
        expect(eventLog).toContain('task_session_continued')
    })

    it('starts goal review sessions in the generator worktree without creating a new worktree', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-review-worktree'
        const goalId = 'goal-review-worktree'
        const taskId = 'task-goal-review-worktree'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'
        const generatorWorktreePath = '/tmp/workspace-worktrees/task-1234'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            title: 'Ship checked work',
            status: 'active',
            autopilotEnabled: true
        })
        const previousSession = store.sessions.getOrCreateSession(
            'previous-goal-review-worktree-session',
            {
                path: generatorWorktreePath,
                host: 'localhost',
                worktree: {
                    basePath: workspacePath,
                    branch: 'hopi-task-1234',
                    name: 'task-1234',
                    worktreePath: generatorWorktreePath,
                    createdAt: 123
                }
            },
            null,
            namespace
        )
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Review implementation',
            status: 'review',
            source: 'manual',
            activeSessionId: previousSession.id,
            workspaceId,
            contract: '## Acceptance\n- Verify behavior.',
            handoff: '## Summary\nGenerator says checks passed.'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-goal-review-worktree',
            { path: generatorWorktreePath, host: 'localhost' },
            null,
            namespace
        )

        let spawnedPath = ''
        let spawnedSessionType: 'simple' | 'worktree' | undefined
        let spawnedWorktreeWorkspacePaths: string[] | undefined
        let spawnedWorktreeTargetBranch: string | undefined
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession(
                _machineId: string,
                path: string,
                _agent: string,
                _model?: string,
                _yolo?: boolean,
                sessionType?: 'simple' | 'worktree',
                _worktreeName?: string,
                _resumeSessionId?: string,
                worktreeWorkspacePaths?: string[],
                worktreeTargetBranch?: string
            ) {
                spawnedPath = path
                spawnedSessionType = sessionType
                spawnedWorktreeWorkspacePaths = worktreeWorkspacePaths
                spawnedWorktreeTargetBranch = worktreeTargetBranch
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedPath).toBe(generatorWorktreePath)
        expect(spawnedSessionType).toBe('simple')
        expect(spawnedWorktreeWorkspacePaths).toBeUndefined()
        expect(spawnedWorktreeTargetBranch).toBeUndefined()
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.activeSessionId).toBe(previousSession.id)
    })

    it('continues rejected goal generator tasks in the previous worktree', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-generator-rework'
        const goalId = 'goal-generator-rework'
        const goalKey = 'goal-generator-rework'
        const taskId = 'task-goal-generator-rework'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspacePath()
        const generatorWorktreePath = '/tmp/workspace-worktrees/task-rework'

        seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Revise implementation'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Ship checked work',
            status: 'active',
            autopilotEnabled: true
        })
        const previousSession = store.sessions.getOrCreateSession(
            'previous-goal-generator-rework-session',
            {
                path: generatorWorktreePath,
                host: 'localhost',
                worktree: {
                    basePath: workspacePath,
                    branch: 'hopi-task-rework',
                    name: 'task-rework',
                    worktreePath: generatorWorktreePath,
                    createdAt: 123
                }
            },
            null,
            namespace
        )
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Revise implementation',
            status: 'planning',
            source: 'manual',
            activeSessionId: previousSession.id,
            workspaceId,
            contract: '## Acceptance\n- Fix review feedback.',
            handoff: '## Feedback\nTraversal helper is missing.'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-goal-generator-rework',
            { path: generatorWorktreePath, host: 'localhost' },
            null,
            namespace
        )

        let spawnedPath = ''
        let spawnedSessionType: 'simple' | 'worktree' | undefined
        let spawnedWorktreeWorkspacePaths: string[] | undefined
        let kickoffText = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession(
                _machineId: string,
                path: string,
                _agent: string,
                _model?: string,
                _yolo?: boolean,
                sessionType?: 'simple' | 'worktree',
                _worktreeName?: string,
                _resumeSessionId?: string,
                worktreeWorkspacePaths?: string[]
            ) {
                spawnedPath = path
                spawnedSessionType = sessionType
                spawnedWorktreeWorkspacePaths = worktreeWorkspacePaths
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                kickoffText = payload.text
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedPath).toBe(generatorWorktreePath)
        expect(spawnedSessionType).toBe('simple')
        expect(spawnedWorktreeWorkspacePaths).toBeUndefined()
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.activeSessionId).toBe(spawned.id)
        expect(kickoffText).toContain('Role: Generator')
    })

    it('can force goal continuations through project worktree policy instead of the previous session path', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-generator-forced-project-policy'
        const goalId = 'goal-generator-forced-project-policy'
        const goalKey = 'goal-generator-forced-project-policy'
        const taskId = 'task-goal-generator-forced-project-policy'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = createTempWorkspacePath()
        const oldWorktreePath = '/tmp/workspace-worktrees/old-rework'

        seedCanonicalGoalTodo(workspacePath, {
            goalKey,
            goalId,
            todoRef: taskId,
            title: 'Revise implementation'
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey,
            title: 'Ship checked work',
            status: 'active',
            autopilotEnabled: true
        })
        const previousSession = store.sessions.getOrCreateSession(
            'previous-goal-generator-forced-project-policy',
            {
                path: oldWorktreePath,
                host: 'localhost',
                worktree: {
                    basePath: workspacePath,
                    branch: 'old-branch',
                    name: 'old-rework',
                    worktreePath: oldWorktreePath,
                    createdAt: 123
                }
            },
            null,
            namespace
        )
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Revise implementation',
            status: 'planning',
            source: 'manual',
            activeSessionId: previousSession.id,
            workspaceId,
            contract: '## Acceptance\n- Fix review feedback.'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-goal-generator-forced-project-policy',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )

        let spawnedPath = ''
        let spawnedSessionType: 'simple' | 'worktree' | undefined
        let spawnedWorktreeName: string | undefined
        let spawnedWorktreeTargetBranch: string | undefined
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession(
                _machineId: string,
                path: string,
                _agent: string,
                _model?: string,
                _yolo?: boolean,
                sessionType?: 'simple' | 'worktree',
                worktreeName?: string,
                _resumeSessionId?: string,
                _worktreeWorkspacePaths?: string[],
                worktreeTargetBranch?: string
            ) {
                spawnedPath = path
                spawnedSessionType = sessionType
                spawnedWorktreeName = worktreeName
                spawnedWorktreeTargetBranch = worktreeTargetBranch
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId,
            overrides: {
                forceProjectSessionSettings: true
            }
        })

        expect(result.ok).toBe(true)
        expect(spawnedPath).toBe(workspacePath)
        expect(spawnedSessionType).toBe('worktree')
        expect(spawnedWorktreeName).toContain('task-task-goa')
        expect(spawnedWorktreeTargetBranch).toBe('main')
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.activeSessionId).toBe(spawned.id)
    })

    it('passes all project workspace paths for multi-workspace worktree sessions', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceAId = 'workspace-a'
        const workspaceBId = 'workspace-b'
        const workspaceAPath = '/tmp/workspace-a'
        const workspaceBPath = '/tmp/workspace-b'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'dev',
            defaultWorkspaceId: workspaceAId
        })
        store.workspaces.createWorkspace({
            id: workspaceAId,
            projectId,
            path: workspaceAPath
        })
        store.workspaces.createWorkspace({
            id: workspaceBId,
            projectId,
            path: workspaceBPath
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId: workspaceBId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: workspaceBPath, host: 'localhost' },
            null,
            namespace
        )

        let spawnedPath = ''
        let spawnedSessionType: 'simple' | 'worktree' | undefined
        let spawnedWorktreeWorkspacePaths: string[] | undefined
        let spawnedWorktreeTargetBranch: string | undefined
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession(
                _machineId: string,
                path: string,
                _agent: string,
                _model?: string,
                _yolo?: boolean,
                sessionType?: 'simple' | 'worktree',
                _worktreeName?: string,
                _resumeSessionId?: string,
                worktreeWorkspacePaths?: string[],
                worktreeTargetBranch?: string
            ) {
                spawnedPath = path
                spawnedSessionType = sessionType
                spawnedWorktreeWorkspacePaths = worktreeWorkspacePaths
                spawnedWorktreeTargetBranch = worktreeTargetBranch
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedPath).toBe(workspaceBPath)
        expect(spawnedSessionType).toBe('worktree')
        expect(spawnedWorktreeTargetBranch).toBe('dev')
        expect(spawnedWorktreeWorkspacePaths?.[0]).toBe(workspaceBPath)
        expect(spawnedWorktreeWorkspacePaths).toContain(workspaceAPath)
        expect(spawnedWorktreeWorkspacePaths).toContain(workspaceBPath)
        expect(spawnedWorktreeWorkspacePaths?.length).toBe(2)
    })

    it('includes previous session messages in kickoff text when task restarts', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })

        const previousSession = store.sessions.getOrCreateSession(
            'previous-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )
        store.messages.addMessage(previousSession.id, {
            role: 'user',
            content: { type: 'text', text: 'Please keep this context.' }
        })
        store.messages.addMessage(previousSession.id, {
            role: 'agent',
            content: { type: 'codex', data: { type: 'message', message: 'Acknowledged and implemented.' } }
        })
        store.messages.addMessage(previousSession.id, {
            role: 'user',
            content: { type: 'text', text: 'skip kickoff payload' }
        }, `auto:kickoff:${taskId}:1`)

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            description: 'Make restart carry full history',
            status: 'running',
            workspaceId,
            activeSessionId: previousSession.id
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let kickoffText = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                kickoffText = payload.text
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(kickoffText).toContain('Previous session messages (recent, budgeted):')
        expect(kickoffText).toContain('User:\nPlease keep this context.')
        expect(kickoffText).toContain('Assistant:\nAcknowledged and implemented.')
        expect(kickoffText).not.toContain('skip kickoff payload')
    })

    it('keeps restart history recent and budgeted when previous session is long', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })

        const previousSession = store.sessions.getOrCreateSession(
            'previous-session-long',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )
        for (let index = 1; index <= 205; index += 1) {
            store.messages.addMessage(previousSession.id, {
                role: 'user',
                content: { type: 'text', text: index === 1 ? 'oldest history marker' : `history message ${index}` }
            })
        }
        store.messages.addMessage(previousSession.id, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'tool-call-result',
                    output: 'tool-output-should-not-carry'.repeat(4_000)
                }
            }
        })
        store.messages.addMessage(previousSession.id, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'message',
                    message: 'large assistant carryover message '.repeat(500)
                }
            }
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'running',
            workspaceId,
            activeSessionId: previousSession.id
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-long',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let kickoffText = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                kickoffText = payload.text
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(kickoffText.length).toBeLessThan(40_000)
        expect(kickoffText).not.toContain('oldest history marker')
        expect(kickoffText).toContain('history message 205')
        expect(kickoffText).toContain('[message truncated for restart context budget]')
        expect(kickoffText).not.toContain('tool-output-should-not-carry')
    })

    it('uses task permission mode before project defaults when starting session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultPermissionMode: 'default'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId,
            agentFlavor: 'claude',
            permissionMode: 'plan'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        const appliedConfigs: Array<Record<string, unknown>> = []
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig(_sessionId: string, patch: Record<string, unknown>) {
                appliedConfigs.push(patch)
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(appliedConfigs.some((patch) => patch.permissionMode === 'plan')).toBe(true)
    })

    it('maps legacy Codex plan mode to safe-yolo permission mode when starting session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultPermissionMode: 'default'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId,
            agentFlavor: 'codex',
            permissionMode: 'plan'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        const appliedConfigs: Array<Record<string, unknown>> = []
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig(_sessionId: string, patch: Record<string, unknown>) {
                appliedConfigs.push(patch)
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(appliedConfigs.some((patch) => patch.permissionMode === 'safe-yolo')).toBe(true)
        expect(appliedConfigs.some((patch) => patch.permissionMode === 'plan')).toBe(false)
        expect(appliedConfigs.some((patch) => patch.collaborationMode === 'plan')).toBe(false)
    })

    it('prefers task model mode over project default model mode', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultModelMode: 'sonnet'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId,
            agentFlavor: 'claude',
            modelMode: 'opus'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        const appliedConfigs: Array<Record<string, unknown>> = []
        let spawnedModel: string | undefined
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession(_machineId: string, _path: string, _agent: string, model?: string) {
                spawnedModel = model
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig(_sessionId: string, patch: Record<string, unknown>) {
                appliedConfigs.push(patch)
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedModel).toBe('opus')
        expect(appliedConfigs.some((patch) => patch.modelMode === 'opus')).toBe(true)
        expect(appliedConfigs.some((patch) => patch.modelMode === 'sonnet')).toBe(false)
    })

    it('uses task custom model without falling back to project model mode', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-custom-model'
        const taskId = 'task-custom-model'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultModelMode: 'sonnet'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId,
            agentFlavor: 'claude',
            model: 'claude-sonnet-4-5'
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-custom-model',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        const appliedConfigs: Array<Record<string, unknown>> = []
        let spawnedModel: string | undefined
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession(_machineId: string, _path: string, _agent: string, model?: string) {
                spawnedModel = model
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig(_sessionId: string, patch: Record<string, unknown>) {
                appliedConfigs.push(patch)
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result.ok).toBe(true)
        expect(spawnedModel).toBe('claude-sonnet-4-5')
        expect(appliedConfigs.some((patch) => patch.modelMode === 'sonnet')).toBe(false)
    })

    it('uses custom kickoff text when requested', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-custom-kickoff'
        const taskId = 'task-custom-kickoff'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            description: 'Default kickoff should be replaced',
            status: 'planning',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-custom-kickoff',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let payloadText = ''
        let payloadLocalId = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, payload: { text: string; localId?: string }) {
                payloadText = payload.text
                payloadLocalId = payload.localId ?? ''
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId,
            kickoff: {
                kind: 'custom',
                text: 'Merge this worktree now.',
                localId: 'custom-merge-kickoff'
            }
        })

        expect(result.ok).toBe(true)
        expect(payloadText).toBe('Merge this worktree now.')
        expect(payloadLocalId).toBe('custom-merge-kickoff')
    })

    it('can include the task contract before custom continuation text', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-custom-kickoff-contract'
        const taskId = 'task-custom-kickoff-contract'
        const goalId = 'goal-custom-kickoff-contract'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.goals.createGoal({
            id: goalId,
            projectId,
            namespace,
            goalKey: 'goal-custom-kickoff-contract',
            title: 'Goal'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Task',
            description: 'Default kickoff should remain present',
            status: 'planning',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-custom-kickoff-contract',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let payloadText = ''
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage(_sessionId: string, payload: { text: string }) {
                payloadText = payload.text
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId,
            kickoff: {
                kind: 'custom',
                text: 'Continue the compile-error repair.',
                includeTaskKickoffSummary: true
            }
        })

        expect(result.ok).toBe(true)
        expect(payloadText).toContain('Task: Task')
        expect(payloadText).toContain('Default kickoff should remain present')
        expect(payloadText).toContain('Final HOPI_ACTIONS packet:')
        expect(payloadText).toContain('Operator continuation request:')
        expect(payloadText).toContain('Continue the compile-error repair.')
    })

    it('can skip kickoff message entirely', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-skip-kickoff'
        const taskId = 'task-skip-kickoff'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-skip-kickoff',
            { path: '/tmp/workspace', host: 'localhost' },
            null,
            namespace
        )

        let sendMessageCalled = false
        const engine = withValidContract({
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: true,
                    runnerState: { status: 'running' }
                }
            },
            async spawnSession() {
                return { type: 'success' as const, sessionId: spawned.id }
            },
            async waitForSessionActive() {
                return true
            },
            async applySessionConfig() {
            },
            async uploadFile() {
                return { success: true, path: '/tmp/attachment' }
            },
            async sendMessage() {
                sendMessageCalled = true
            },
            handleRealtimeEvent() {
            }
        }) as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId,
            kickoff: { kind: 'skip' }
        })

        expect(result.ok).toBe(true)
        expect(sendMessageCalled).toBe(false)
    })

    it('marks runner offline starts as wait-then-retry failures', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-runner-offline-retry'
        const taskId = 'task-runner-offline-retry'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project'
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: '/tmp/workspace'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'planning',
            workspaceId
        })

        const engine = {
            getMachineByNamespace() {
                return {
                    id: machineId,
                    namespace,
                    active: false,
                    runnerState: { status: 'stopped' }
                }
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const result = await startSessionFromTask({
            store,
            engine,
            namespace,
            taskId
        })

        expect(result).toMatchObject({
            ok: false,
            error: {
                code: 'runner_offline',
                retry: {
                    action: 'wait_then_retry_start',
                    available: true
                }
            }
        })
    })

})
