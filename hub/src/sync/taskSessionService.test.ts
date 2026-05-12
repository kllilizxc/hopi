import { describe, expect, it } from 'bun:test'
import type { SyncEvent } from '@hopi/protocol/types'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../store'
import { appendPlannerMail, setGoalPreference } from './operator/operatorDocs'
import { startSessionFromTask } from './taskSessionService'
import type { SyncEngine } from './syncEngine'

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
            status: 'planned',
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
            status: 'planned',
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
        expect(kickoffText).not.toContain('Mark this Goal active, paused, blocked')
    })

    it('includes goal operator docs in goal task kickoff', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-operator-docs-kickoff'
        const taskId = 'task-operator-docs-kickoff'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-operator-docs'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-operator-kickoff-'))

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId,
            name: 'Project',
            defaultWorkspaceId: workspaceId
        })
        store.workspaces.createWorkspace({
            id: workspaceId,
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: 'goal-operator-docs',
            projectId,
            namespace,
            goalKey: 'ship-ui',
            title: 'Ship UI'
        })
        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId: 'goal-operator-docs',
            title: 'Plan next UI tasks',
            status: 'planned',
            workspaceId,
            source: 'planner'
        })
        setGoalPreference({
            workspacePath,
            goalKey: 'ship-ui',
            category: 'test_scope',
            autonomy: 'auto_decide_and_report',
            instruction: 'Let the model choose focused regression tests.',
            source: { sessionId: 'assistant-session', messageId: 'message-pref' },
            now: 1778570000000
        })
        appendPlannerMail({
            workspacePath,
            goalKey: 'ship-ui',
            kind: 'request',
            body: 'Please schedule an accessibility pass.',
            source: { sessionId: 'assistant-session', messageId: 'message-mail' },
            now: 1778570001000
        })

        const spawned = store.sessions.getOrCreateSession(
            'spawned-session-operator-docs-kickoff',
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
        expect(kickoffText).toContain('Goal Operator Docs')
        expect(kickoffText).toContain('Goal Preferences')
        expect(kickoffText).toContain('Let the model choose focused regression tests.')
        expect(kickoffText).toContain('Planner Mail')
        expect(kickoffText).toContain('Please schedule an accessibility pass.')
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'in_review',
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
            status: 'planned',
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
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_progress')
        expect(kickoffText).toContain('Role: Planner')
        expect(kickoffText).toContain('docs maintenance')
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
        expect(updated?.status).toBe('in_progress')
        expect(updated?.initRuntime?.status).toBe('succeeded')
        expect(updated?.initRuntime?.latestNote).toContain('Goal role skipped setup workflow')
        expect(kickoffText).toContain('Role: Generator')
        expect(kickoffText).toContain('Task Contract')
        expect(kickoffText).toContain('{ "type": "update_current_task", "status": "in_review"')
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
            status: 'in_review',
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
        expect(updatedReviewTask?.status).toBe('in_review')
        expect(updatedReviewTask?.activeSessionId).toBe(previousSession.id)
        expect((spawnedReviewSession?.metadata as { hopiTaskRole?: string } | null)?.hopiTaskRole).toBe('evaluator')
        expect(kickoffText).toContain('Role: Evaluator')
        expect(kickoffText).toContain('Generator Handoff')
        expect(kickoffText).toContain('Evidence Packet')
        expect(kickoffText).toContain('HOPI will request the existing worktree merge flow before closing accepted work')
        expect(kickoffText).not.toContain('Previous session messages')
        expect(kickoffText).not.toContain('raw previous generator transcript')
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
            status: 'in_review',
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
        const taskId = 'task-goal-generator-rework'
        const machineId = 'machine-1'
        const workspaceId = 'workspace-1'
        const workspacePath = '/tmp/workspace'
        const generatorWorktreePath = '/tmp/workspace-worktrees/task-rework'

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
            status: 'planned',
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
            status: 'planned',
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
            status: 'in_progress',
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
        expect(kickoffText).toContain('Previous session messages:')
        expect(kickoffText).toContain('User:\nPlease keep this context.')
        expect(kickoffText).toContain('Assistant:\nAcknowledged and implemented.')
        expect(kickoffText).not.toContain('skip kickoff payload')
    })

    it('includes message history across all pages when previous session is long', async () => {
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
                content: { type: 'text', text: `history message ${index}` }
            })
        }

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'in_progress',
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
        expect(kickoffText).toContain('history message 1')
        expect(kickoffText).toContain('history message 205')
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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
            status: 'planned',
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

})
