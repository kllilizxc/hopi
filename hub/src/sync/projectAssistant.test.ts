import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from '@hopi/protocol/types'
import { Store, type StoredSession } from '../store'
import type { SyncEngine } from './syncEngine'
import { EventPublisher } from './eventPublisher'
import {
    activateProjectAssistantSession,
    buildProjectAssistantBriefingPrompt,
    createProjectAssistantIntervention,
    ensureProjectAssistantSession,
    executeProjectAssistantOperatorTool,
    listProjectAssistantSessions,
    resolveProjectAssistantIntervention,
    sendProjectAssistantPlannerMail,
    tryCreateProjectAssistantIntervention
} from './projectAssistant'
import { SessionCache } from './sessionCache'

const MERGE_BASE = '1111111111111111111111111111111111111111'
const SNAPSHOT_REF = '2222222222222222222222222222222222222222'
const TARGET_HEAD = '3333333333333333333333333333333333333333'
const VALID_ACTIONS_MANIFEST = [
    'version: 1',
    'setup:',
    '  steps:',
    '    - id: deps',
    '      type: run',
    '      run: ["bun", "install"]',
    'preview:',
    '  services:',
    '    - id: web',
    '      type: run',
    '      run: ["bun", "run", "dev"]',
    '      ready:',
    '        type: process_alive',
    'merge:',
    '  targetBranch: main',
    '  strategy: squash'
].join('\n')

function workspace() {
    return mkdtempSync(join(tmpdir(), 'hopi-project-assistant-'))
}

function seedProject(store: Store, root: string) {
    const project = store.projects.createProject({
        id: 'project-1',
        namespace: 'default',
        machineId: 'machine-1',
        name: 'Assistant Project',
        defaultWorkspaceId: null
    })
    const workspace = store.workspaces.createWorkspace({
        id: 'workspace-1',
        projectId: project.id,
        path: root
    })
    store.projects.updateProject(project.id, 'default', {
        defaultWorkspaceId: workspace.id
    })
    const goal = store.goals.createGoal({
        id: 'goal-1',
        projectId: project.id,
        namespace: 'default',
        goalKey: 'ship-ui',
        title: 'Ship UI'
    })
    return { project, workspace, goal }
}

function runtimeSession(stored: StoredSession): Session {
    return {
        id: stored.id,
        namespace: stored.namespace,
        seq: stored.seq,
        createdAt: stored.createdAt,
        updatedAt: stored.updatedAt,
        active: true,
        activeAt: stored.activeAt ?? stored.createdAt,
        metadata: stored.metadata as Session['metadata'],
        metadataVersion: stored.metadataVersion,
        agentState: null,
        agentStateVersion: stored.agentStateVersion,
        thinking: false,
        thinkingAt: 0
    }
}

function engineFor(store: Store, options?: { spawnCreatesNewSession?: boolean }): {
    engine: SyncEngine
    sent: Array<{
        sessionId: string
        text: string
        localId?: string | null
        appendSystemPrompt?: string | null
        allowedTools?: string[] | null
        disallowedTools?: string[] | null
    }>
    appliedConfigs: Array<{ sessionId: string; permissionMode?: string; modelMode?: string }>
    spawnCalls: Array<{ operatorConsole?: unknown }>
} {
    const sessions = new Map<string, Session>()
    const sent: Array<{
        sessionId: string
        text: string
        localId?: string | null
        appendSystemPrompt?: string | null
        allowedTools?: string[] | null
        disallowedTools?: string[] | null
    }> = []
    const appliedConfigs: Array<{ sessionId: string; permissionMode?: string; modelMode?: string }> = []
    const spawnCalls: Array<{ operatorConsole?: unknown }> = []
    const publisher = new EventPublisher({ broadcast() {} } as never, (event) => event.namespace)
    const sessionCache = new SessionCache(store, publisher)
    publisher.subscribe((event) => {
        if (!('sessionId' in event) || !event.sessionId) return
        if (event.type === 'session-removed') {
            sessions.delete(event.sessionId)
            return
        }
        const stored = store.sessions.getSessionByNamespace(event.sessionId, event.namespace ?? 'default')
        if (stored) {
            sessions.set(stored.id, runtimeSession(stored))
        }
    })
    const engine = {
        async spawnSession(
            machineId: string,
            directory: string,
            agent?: string,
            model?: string,
            _yolo?: boolean,
            _sessionType?: string,
            _worktreeName?: string,
            _resumeSessionId?: string,
            _worktreeWorkspacePaths?: string[],
            _worktreeTargetBranch?: string,
            sessionTag?: string,
            operatorConsole?: unknown
        ) {
            spawnCalls.push({ operatorConsole })
            const tag = options?.spawnCreatesNewSession
                ? `assistant-spawned-${sessions.size + 1}`
                : sessionTag ?? `assistant-${sessions.size + 1}`
            const stored = store.sessions.getOrCreateSession(
                tag,
                {
                    path: directory,
                    host: 'localhost',
                    machineId,
                    flavor: agent,
                    model,
                    startedFromRunner: true
                },
                null,
                'default'
            )
            sessions.set(stored.id, runtimeSession(stored))
            return { type: 'success' as const, sessionId: stored.id }
        },
        async mergeSessions(oldSessionId: string, newSessionId: string, namespace: string) {
            await sessionCache.mergeSessions(oldSessionId, newSessionId, namespace)
        },
        async waitForSessionActive() {
            return true
        },
        getSessionByNamespace(sessionId: string) {
            return sessions.get(sessionId) ?? null
        },
        async applySessionConfig(sessionId: string, patch: { permissionMode?: string; modelMode?: string }) {
            appliedConfigs.push({ sessionId, ...patch })
            const existing = sessions.get(sessionId)
            if (existing) {
                const next = {
                    ...existing,
                    permissionMode: patch.permissionMode ?? existing.permissionMode,
                    modelMode: patch.modelMode ?? existing.modelMode
                } as Session
                sessions.set(sessionId, next)
            }
        },
        async sendMessage(sessionId: string, payload: {
            text: string
            localId?: string | null
            appendSystemPrompt?: string | null
            allowedTools?: string[] | null
            disallowedTools?: string[] | null
        }) {
            sent.push({
                sessionId,
                text: payload.text,
                localId: payload.localId,
                appendSystemPrompt: payload.appendSystemPrompt,
                allowedTools: payload.allowedTools,
                disallowedTools: payload.disallowedTools
            })
            store.messages.addMessage(sessionId, {
                role: 'user',
                content: {
                    type: 'text',
                    text: payload.text
                }
            }, payload.localId ?? undefined)
        },
        handleRealtimeEvent(event: { sessionId?: string; namespace?: string }) {
            if (!event.sessionId) return
            const stored = store.sessions.getSessionByNamespace(event.sessionId, event.namespace ?? 'default')
            if (stored) {
                sessions.set(stored.id, runtimeSession(stored))
            }
        }
    } as unknown as SyncEngine
    return { engine, sent, appliedConfigs, spawnCalls }
}

async function waitForTask(options: {
    store: Store
    namespace: string
    taskId: string
    predicate: (task: ReturnType<Store['tasks']['getTaskByNamespace']>) => boolean
    timeoutMs?: number
}): Promise<void> {
    const deadline = Date.now() + (options.timeoutMs ?? 1_000)
    while (Date.now() < deadline) {
        const task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
        if (options.predicate(task)) {
            return
        }
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`Timed out waiting for task ${options.taskId}`)
}

describe('project assistant', () => {
    it('creates a fresh normal assistant session with project metadata each time', async () => {
        const store = new Store(':memory:')
        const seeded = seedProject(store, workspace())
        const { project, workspace: projectWorkspace, goal } = seeded
        const { engine, sent, appliedConfigs, spawnCalls } = engineFor(store)

        const first = await ensureProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })
        const second = await ensureProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })

        expect(second.session.id).not.toBe(first.session.id)
        expect(first.session.metadata).toMatchObject({
            path: projectWorkspace.path,
            host: 'localhost',
            projectId: project.id,
            goalId: goal.id,
            hopiAssistant: true,
            assistantKind: 'normal',
            capabilityProfile: 'operator_console'
        })
        expect(second.session.metadata).toMatchObject({
            path: projectWorkspace.path,
            host: 'localhost',
            projectId: project.id,
            goalId: goal.id,
            hopiAssistant: true,
            assistantKind: 'normal',
            capabilityProfile: 'operator_console'
        })
        expect(sent).toHaveLength(2)
        expect(sent[0]?.text).toContain('Current kanban tasks')
        expect(sent[0]?.appendSystemPrompt).toContain('Project Assistant')
        expect(sent[0]?.disallowedTools).toContain('Write')
        expect(sent[0]?.disallowedTools).toContain('Edit')
        expect(sent[0]?.disallowedTools).toContain('MultiEdit')
        expect(sent[0]?.disallowedTools).toContain('Task')
        expect(sent[0]?.disallowedTools).not.toContain('Bash')
        expect(sent[0]?.disallowedTools).not.toContain('CodexBash')
        expect(sent[0]?.disallowedTools).toContain('CodexPatch')
        expect(spawnCalls).toContainEqual({
            operatorConsole: {
                projectId: project.id,
                goalId: goal.id,
                taskId: null
            }
        })
        expect(appliedConfigs).toContainEqual({
            sessionId: first.session.id,
            permissionMode: 'read-only'
        })
        expect(appliedConfigs).toContainEqual({
            sessionId: second.session.id,
            permissionMode: 'read-only'
        })
    })

    it('uses the project default Opencode agent for normal assistant sessions', async () => {
        const store = new Store(':memory:')
        const { project, goal } = seedProject(store, workspace())
        store.projects.updateProject(project.id, 'default', {
            defaultAgentFlavor: 'opencode'
        })
        const { engine, appliedConfigs } = engineFor(store)

        const result = await ensureProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })

        expect(result.session.metadata).toMatchObject({
            flavor: 'opencode',
            projectId: project.id,
            goalId: goal.id,
            hopiAssistant: true,
            assistantKind: 'normal',
            capabilityProfile: 'operator_console'
        })
        expect(appliedConfigs).toContainEqual({
            sessionId: result.session.id,
            permissionMode: 'read-only'
        })
    })

    it('does not reuse an existing normal assistant session when creating a new conversation', async () => {
        const store = new Store(':memory:')
        const { project, workspace: projectWorkspace, goal } = seedProject(store, workspace())
        const legacy = store.sessions.getOrCreateSession(
            'legacy-assistant',
            {
                path: projectWorkspace.path,
                host: 'localhost',
                machineId: project.machineId,
                projectId: project.id,
                goalId: goal.id,
                name: 'Project Assistant: Ship UI',
                flavor: 'codex',
                hopiAssistant: true,
                assistantKind: 'normal',
                startedFromRunner: true
            },
            null,
            'default'
        )
        const { engine, sent, appliedConfigs } = engineFor(store)

        const result = await ensureProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })

        expect(result.session.id).not.toBe(legacy.id)
        expect(result.session.metadata).toMatchObject({
            projectId: project.id,
            goalId: goal.id,
            assistantKind: 'normal',
            capabilityProfile: 'operator_console'
        })
        expect(sent).toHaveLength(1)
        expect(appliedConfigs).toContainEqual({
            sessionId: result.session.id,
            permissionMode: 'read-only'
        })
        expect(store.sessions.getSessionByNamespace(legacy.id, 'default')).not.toBeNull()
    })

    it('creates pending intervention sessions and resolves them without mutating tasks', () => {
        const store = new Store(':memory:')
        const { project, goal } = seedProject(store, workspace())

        const task = store.tasks.createTask({
            id: 'task-1',
            projectId: project.id,
            goalId: goal.id,
            title: 'Blocked task',
            description: null,
            status: 'blocked',
            sortKey: 1,
            blockedReason: 'Need product choice.'
        })

        const created = createProjectAssistantIntervention({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            taskId: task.id,
            interventionKey: `task:${task.id}:blocked`,
            interventionKind: 'task_blocked',
            title: 'Blocked task needs direction',
            body: 'Need product choice.',
            suggestedActions: [
                { id: 'agent_decides', label: 'Let agent decide', recommended: true },
                { id: 'pause_goal', label: 'Pause goal' }
            ]
        })

        expect(created.session.metadata).toMatchObject({
            hopiAssistant: true,
            assistantKind: 'intervention',
            interventionKind: 'task_blocked',
            interventionStatus: 'pending'
        })
        const pending = listProjectAssistantSessions({
            store,
            namespace: 'default',
            projectId: project.id
        })
        expect(pending.pendingCount).toBe(1)
        expect(pending.sessions[0]?.suggestedActions).toHaveLength(2)

        const resolved = resolveProjectAssistantIntervention({
            store,
            namespace: 'default',
            sessionId: created.session.id,
            status: 'resolved',
            actionId: 'agent_decides',
            note: 'Use preference going forward.'
        })

        expect(resolved?.metadata).toMatchObject({
            interventionStatus: 'resolved',
            interventionResolution: {
                actionId: 'agent_decides',
                note: 'Use preference going forward.'
            }
        })
        expect(store.tasks.getTaskByNamespace(task.id, 'default')?.status).toBe('blocked')
    })

    it('activates a synthetic intervention in the same session', async () => {
        const store = new Store(':memory:')
        const { project, goal } = seedProject(store, workspace())
        const created = createProjectAssistantIntervention({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            interventionKey: 'decision-topic:topic-1',
            interventionKind: 'decision_needed',
            title: 'Choose scope',
            body: 'Pick the smaller release scope.',
            suggestedActions: [{ id: 'answer_decision', label: 'Answer decision' }]
        })
        const { engine, sent } = engineFor(store)

        const activated = await activateProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            sessionId: created.session.id
        })

        expect(activated.session.id).toBe(created.session.id)
        expect(sent).toHaveLength(1)
        expect(sent[0]?.sessionId).toBe(created.session.id)
        expect(sent[0]?.text).toContain('Activate this existing Project Assistant conversation')
        expect(sent[0]?.text).toContain('Pick the smaller release scope.')
        expect(sent[0]?.disallowedTools).not.toContain('Bash')
        expect(sent[0]?.disallowedTools).toContain('CodexPatch')
    })

    it('activates a synthetic intervention with the first user message as one agent turn', async () => {
        const store = new Store(':memory:')
        const { project, goal } = seedProject(store, workspace())
        const created = createProjectAssistantIntervention({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            interventionKey: 'merge-blocked:task-1',
            interventionKind: 'merge_blocked',
            title: 'Auto-merge blocked',
            body: 'Merge conflicts persisted after 2 agent repair attempt(s).',
            suggestedActions: [{ id: 'retry', label: 'Retry merge' }]
        })
        const { engine, sent } = engineFor(store)

        const activated = await activateProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            sessionId: created.session.id,
            initialMessage: {
                text: '啥意思',
                localId: 'local-first'
            }
        })

        expect(activated.session.id).toBe(created.session.id)
        expect(sent).toHaveLength(1)
        expect(sent[0]).toMatchObject({
            sessionId: created.session.id,
            localId: 'local-first',
            text: '啥意思'
        })
        expect(sent[0]?.appendSystemPrompt).toContain('Merge conflicts persisted after 2 agent repair attempt(s).')
        expect(sent[0]?.appendSystemPrompt).toContain('Existing visible conversation')
        expect(sent[0]?.appendSystemPrompt).toContain('Answer the user message directly')

        const messages = store.messages.getMessages(created.session.id, 10)
        expect(messages.some((message) => message.localId?.startsWith('auto:assistant:activation:'))).toBe(false)
        expect(messages.some((message) => message.localId === 'local-first')).toBe(true)
    })

    it('activates a synthetic intervention by merging it into the runner-created session', async () => {
        const store = new Store(':memory:')
        const { project, goal } = seedProject(store, workspace())
        const created = createProjectAssistantIntervention({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            interventionKey: 'decision-topic:topic-new-session',
            interventionKind: 'decision_needed',
            title: 'Choose rollout',
            body: 'Pick the staged rollout.',
            suggestedActions: [{ id: 'answer_decision', label: 'Answer decision' }]
        })
        const { engine, sent, appliedConfigs } = engineFor(store, { spawnCreatesNewSession: true })

        const activated = await activateProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            sessionId: created.session.id
        })

        expect(activated.session.id).not.toBe(created.session.id)
        expect(store.sessions.getSessionByNamespace(created.session.id, 'default')).toBeNull()
        expect(activated.session.metadata).toMatchObject({
            host: 'localhost',
            startedFromRunner: true,
            hopiAssistant: true,
            assistantKind: 'intervention',
            interventionKind: 'decision_needed',
            interventionStatus: 'pending',
            interventionKey: 'decision-topic:topic-new-session',
            suggestedActions: [{ id: 'answer_decision', label: 'Answer decision' }],
            capabilityProfile: 'operator_console',
            projectId: project.id,
            goalId: goal.id
        })
        expect(appliedConfigs).toContainEqual({
            sessionId: activated.session.id,
            permissionMode: 'read-only'
        })
        expect(sent).toHaveLength(1)
        expect(sent[0]?.sessionId).toBe(activated.session.id)
        expect(sent[0]?.text).toContain('Activate this existing Project Assistant conversation')
        expect(sent[0]?.text).toContain('Pick the staged rollout.')
        const messages = store.messages.getMessages(activated.session.id, 10)
        expect(messages.some((message) => message.localId === 'auto:assistant:intervention:decision-topic:topic-new-session')).toBe(true)
        expect(messages.some((message) => message.localId?.startsWith('auto:assistant:activation:'))).toBe(true)
    })

    it('ignores visible assistant action packets and resolves decisions only through typed operator tools', async () => {
        const store = new Store(':memory:')
        const { project, goal } = seedProject(store, workspace())
        store.goals.updateGoalByNamespace(goal.id, 'default', { status: 'blocked' })
        const topic = store.goalDecisionTopics.create({
            id: 'topic-1',
            projectId: project.id,
            goalId: goal.id,
            namespace: 'default',
            title: 'Choose scope',
            body: 'Which scope should ship first?',
            blocking: true
        })
        const intervention = createProjectAssistantIntervention({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            interventionKey: `decision-topic:${topic.id}`,
            interventionKind: 'decision_needed',
            title: topic.title,
            body: topic.body,
            suggestedActions: [{ id: 'answer_decision', label: 'Answer decision' }]
        })
        const { engine } = engineFor(store)
        const assistant = await ensureProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })
        store.messages.addMessage(assistant.session.id, {
            role: 'assistant',
            content: {
                type: 'text',
                text: [
                    'Use the smaller first-release scope.',
                    '',
                    'HOPI_ASSISTANT_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'resolve_decision',
                                topicId: topic.id,
                                resolution: 'Use the smaller first-release scope.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })

        expect(store.goalDecisionTopics.getByNamespace(topic.id, 'default')?.status).toBe('waiting')
        expect(store.goals.getGoalByNamespace(goal.id, 'default')?.status).toBe('blocked')
        expect(store.sessions.getSessionByNamespace(intervention.session.id, 'default')?.metadata).toMatchObject({
            interventionStatus: 'pending'
        })

        const applied = await executeProjectAssistantOperatorTool({
            store,
            engine,
            namespace: 'default',
            sessionId: assistant.session.id,
            toolName: 'hopi_resolve_decision',
            input: {
                topicId: topic.id,
                resolution: 'Use the smaller first-release scope.'
            }
        })

        expect(applied.ok).toBe(true)
        expect(store.goalDecisionTopics.getByNamespace(topic.id, 'default')?.status).toBe('resolved')
        expect(store.goalDecisionTopics.getByNamespace(topic.id, 'default')?.resolution).toBe('Use the smaller first-release scope.')
        expect(store.goals.getGoalByNamespace(goal.id, 'default')?.status).toBe('active')
        expect(store.sessions.getSessionByNamespace(intervention.session.id, 'default')?.metadata).toMatchObject({
            interventionStatus: 'resolved',
            interventionResolution: {
                actionId: 'assistant_resolve_decision',
                note: 'Use the smaller first-release scope.'
            }
        })
    })

    it('skips optional intervention creation when a project has no workspace', () => {
        const store = new Store(':memory:')
        const project = store.projects.createProject({
            id: 'project-no-workspace',
            namespace: 'default',
            machineId: 'machine-1',
            name: 'No Workspace Project',
            defaultWorkspaceId: null
        })

        const created = tryCreateProjectAssistantIntervention({
            store,
            namespace: 'default',
            projectId: project.id,
            interventionKey: 'task:missing-workspace:blocked',
            interventionKind: 'task_blocked',
            title: 'Blocked task needs direction',
            body: 'Missing workspace should not break workflow owners.',
            suggestedActions: [{ id: 'dismiss', label: 'Dismiss' }]
        })

        expect(created).toBeNull()
        expect(listProjectAssistantSessions({
            store,
            namespace: 'default',
            projectId: project.id
        }).sessions).toHaveLength(0)
    })

    it('writes planner mail through goal-scoped operator docs', () => {
        const store = new Store(':memory:')
        const root = workspace()
        const { project, goal } = seedProject(store, root)

        const mail = sendProjectAssistantPlannerMail({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'request',
            body: 'Please schedule an accessibility pass.',
            source: { sessionId: 'assistant-session-1', messageId: 'message-1' },
            now: 1778570000000
        })

        expect(mail.id).toStartWith('mail-1778570000000-')
        expect(readFileSync(join(root, '.hopi/docs/goals/ship-ui/operator/planner-mail.yml'), 'utf8')).toContain('Please schedule')
    })

    it('does not treat global preference edits as assistant operator actions', async () => {
        const store = new Store(':memory:')
        const root = workspace()
        const { project, goal } = seedProject(store, root)
        const { engine } = engineFor(store)
        const assistant = await ensureProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })
        store.messages.addMessage(assistant.session.id, {
            role: 'assistant',
            content: {
                type: 'text',
                text: [
                    'I will remember that globally.',
                    '',
                    'HOPI_ASSISTANT_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_global_preference',
                                markdown: '# HOPI Preferences\n\n- Do not auto-commit.\n'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })
        expect(existsSync(join(root, '.hopi/preference.md'))).toBe(false)
    })

    it('unblocks a user-confirmed non-merge blocked task through a typed operator tool', async () => {
        const store = new Store(':memory:')
        const root = workspace()
        const { project, goal } = seedProject(store, root)
        const task = store.tasks.createTask({
            id: 'task-agent-blocked',
            projectId: project.id,
            goalId: goal.id,
            title: 'Continue after external fix',
            status: 'blocked',
            source: 'manual',
            blockedReason: 'Missing prerequisite file; user says it now exists.',
            blockedSource: 'agent'
        })
        const { engine } = engineFor(store)
        const tickRequests: Array<{ namespace: string; projectId: string }> = []
        Object.assign(engine as unknown as Record<string, unknown>, {
            requestAutoRunTick(namespace: string, projectId: string) {
                tickRequests.push({ namespace, projectId })
            }
        })
        const assistant = await ensureProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })

        const applied = await executeProjectAssistantOperatorTool({
            store,
            engine,
            namespace: 'default',
            sessionId: assistant.session.id,
            toolName: 'hopi_unblock_task',
            input: {
                taskId: task.id,
                reason: 'User confirmed the prerequisite now exists.',
                userConfirmationQuote: '前置 block 解除了'
            }
        })

        expect(applied).toEqual({
            ok: true,
            result: {
                taskId: task.id,
                status: 'planned'
            }
        })
        expect(store.tasks.getTaskByNamespace(task.id, 'default')).toMatchObject({
            status: 'planned',
            blockedReason: null,
            blockedSource: null
        })
        expect(store.tasks.getTaskByNamespace(task.id, 'default')?.handoff)
            .toContain('User confirmed the prerequisite now exists.')
        expect(tickRequests).toEqual([{ namespace: 'default', projectId: project.id }])
    })

    it('rejects manual unblock for merge-blocked tasks', async () => {
        const store = new Store(':memory:')
        const root = workspace()
        const { project, goal } = seedProject(store, root)
        const task = store.tasks.createTask({
            id: 'task-merge-still-blocked',
            projectId: project.id,
            goalId: goal.id,
            title: 'Merge blocked',
            status: 'blocked',
            source: 'evaluator',
            blockedReason: 'Merge conflicts persisted.',
            blockedSource: 'merge',
            mergeRuntime: {
                status: 'blocked',
                updatedAt: Date.now(),
                blockedReason: 'Merge conflicts persisted.'
            }
        })
        const { engine } = engineFor(store)
        const assistant = await ensureProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })

        const applied = await executeProjectAssistantOperatorTool({
            store,
            engine,
            namespace: 'default',
            sessionId: assistant.session.id,
            toolName: 'hopi_unblock_task',
            input: {
                taskId: task.id,
                reason: 'User asked to unblock.',
                userConfirmationQuote: '解决了'
            }
        })

        expect(applied).toEqual({
            ok: false,
            error: 'Merge-blocked tasks must use hopi_retry_blocked_merge'
        })
        expect(store.tasks.getTaskByNamespace(task.id, 'default')?.status).toBe('blocked')
    })

    it('rejects manual unblock for decision-blocked tasks', async () => {
        const store = new Store(':memory:')
        const root = workspace()
        const { project, goal } = seedProject(store, root)
        const task = store.tasks.createTask({
            id: 'task-decision-blocked',
            projectId: project.id,
            goalId: goal.id,
            title: 'Decision blocked',
            status: 'blocked',
            source: 'manual',
            blockedReason: 'Waiting for scope decision.',
            blockedSource: 'decision'
        })
        store.goalDecisionTopics.create({
            id: 'topic-decision-blocked',
            projectId: project.id,
            goalId: goal.id,
            taskId: task.id,
            namespace: 'default',
            title: 'Choose scope',
            body: 'Which scope should ship?',
            blocking: true
        })
        const { engine } = engineFor(store)
        const assistant = await ensureProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })

        const applied = await executeProjectAssistantOperatorTool({
            store,
            engine,
            namespace: 'default',
            sessionId: assistant.session.id,
            toolName: 'hopi_unblock_task',
            input: {
                taskId: task.id,
                reason: 'User asked to unblock.',
                userConfirmationQuote: '解决了'
            }
        })

        expect(applied).toEqual({
            ok: false,
            error: 'Decision-blocked tasks must resolve the waiting decision topic'
        })
        expect(store.tasks.getTaskByNamespace(task.id, 'default')?.status).toBe('blocked')
    })

    it('retries a blocked auto-merge only through a typed assistant operator tool', async () => {
        const store = new Store(':memory:')
        const root = workspace()
        const { project, goal } = seedProject(store, root)
        store.projects.updateProject(project.id, 'default', {
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        const taskId = 'task-merge-blocked'
        const taskSession = store.sessions.getOrCreateSession(
            'task-merge-session',
            {
                path: '/tmp/worktree',
                host: 'test',
                projectId: project.id,
                taskId,
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch',
                    worktreePath: '/tmp/worktree',
                    baseCommit: MERGE_BASE
                }
            },
            null,
            'default'
        )
        store.tasks.createTask({
            id: taskId,
            projectId: project.id,
            goalId: goal.id,
            title: 'Merge accepted change',
            status: 'blocked',
            activeSessionId: taskSession.id,
            source: 'evaluator',
            blockedReason: 'Base repository has uncommitted changes; commit/stash first',
            blockedSource: 'merge',
            blockedSessionId: taskSession.id,
            mergeRuntime: {
                status: 'blocked',
                sessionId: taskSession.id,
                requestedAt: 10,
                startedAt: 10,
                updatedAt: 20,
                completedAt: 20,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Auto-merge blocked: Base repository has uncommitted changes; commit/stash first',
                blockedReason: 'Base repository has uncommitted changes; commit/stash first',
                failure: null
            }
        })
        const intervention = createProjectAssistantIntervention({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            taskId,
            interventionKey: `merge-blocked:${taskId}`,
            interventionKind: 'merge_blocked',
            title: 'Auto-merge blocked',
            body: 'The base repository blocker was resolved by the user.',
            suggestedActions: [{ id: 'retry_merge', label: 'Retry merge', recommended: true }]
        })
        const { engine } = engineFor(store)
        engine.handleRealtimeEvent({ type: 'session-updated', sessionId: taskSession.id, namespace: 'default' } as never)
        Object.assign(engine as unknown as Record<string, unknown>, {
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 1,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return {
                    success: true,
                    targetBranch: 'main',
                    sourceBranch: 'task-branch',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1
                }
            },
            async gitMergeWorktree() {
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return {
                    success: true,
                    verified: true,
                    targetBranch: 'main',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1,
                    targetHead: TARGET_HEAD
                }
            },
            async getGitDiffNumstat() {
                return { success: true, stdout: '1\t0\tsrc/app.ts\n' }
            },
            async archiveSession() {
            }
        })

        const applied = await executeProjectAssistantOperatorTool({
            store,
            engine,
            namespace: 'default',
            sessionId: intervention.session.id,
            toolName: 'hopi_retry_blocked_merge',
            input: {
                taskId
            }
        })

        expect(applied.ok).toBe(true)
        await waitForTask({
            store,
            namespace: 'default',
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded'
        })
        const accepted = store.tasks.getTaskByNamespace(taskId, 'default')
        expect(accepted?.status).toBe('finished')
        expect(accepted?.worktreeMergeCommit).toBe(TARGET_HEAD)
        expect(store.sessions.getSessionByNamespace(intervention.session.id, 'default')?.metadata).toMatchObject({
            interventionStatus: 'resolved',
            interventionResolution: {
                actionId: 'assistant_retry_blocked_merge',
                note: 'Retrying blocked merge.'
            }
        })
    })

    it('resumes an inactive linked worktree session before retrying a blocked auto-merge', async () => {
        const store = new Store(':memory:')
        const root = workspace()
        const { project, goal } = seedProject(store, root)
        store.projects.updateProject(project.id, 'default', {
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        const taskId = 'task-merge-inactive-session'
        const taskSession = store.sessions.getOrCreateSession(
            'task-merge-inactive-session',
            {
                path: '/tmp/worktree',
                host: 'test',
                projectId: project.id,
                taskId,
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch',
                    worktreePath: '/tmp/worktree',
                    baseCommit: MERGE_BASE
                }
            },
            null,
            'default'
        )
        store.tasks.createTask({
            id: taskId,
            projectId: project.id,
            goalId: goal.id,
            title: 'Merge accepted change',
            status: 'blocked',
            activeSessionId: taskSession.id,
            source: 'evaluator',
            blockedReason: 'Base repository has uncommitted changes; commit/stash first',
            blockedSource: 'merge',
            blockedSessionId: taskSession.id,
            mergeRuntime: {
                status: 'blocked',
                sessionId: taskSession.id,
                requestedAt: 10,
                startedAt: 10,
                updatedAt: 20,
                completedAt: 20,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Auto-merge blocked: Base repository has uncommitted changes; commit/stash first',
                blockedReason: 'Base repository has uncommitted changes; commit/stash first',
                failure: null
            }
        })
        const intervention = createProjectAssistantIntervention({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            taskId,
            interventionKey: `merge-blocked:${taskId}`,
            interventionKind: 'merge_blocked',
            title: 'Auto-merge blocked',
            body: 'The base repository blocker was resolved by the user.',
            suggestedActions: [{ id: 'retry_merge', label: 'Retry merge', recommended: true }]
        })
        const { engine } = engineFor(store)
        let active = false
        let resumeCalls = 0
        Object.assign(engine as unknown as Record<string, unknown>, {
            getSessionByNamespace(sessionId: string, namespace: string) {
                const stored = store.sessions.getSessionByNamespace(sessionId, namespace)
                if (!stored) return null
                return {
                    ...runtimeSession(stored),
                    active
                }
            },
            async resumeSession(sessionId: string) {
                resumeCalls += 1
                active = true
                return { type: 'success', sessionId }
            },
            async readSessionFile() {
                return {
                    success: true,
                    content: Buffer.from(VALID_ACTIONS_MANIFEST, 'utf8').toString('base64')
                }
            },
            async gitMergeWorktreeState() {
                return {
                    success: true,
                    sourceBranch: 'task-branch',
                    hasWorkingTreeChanges: false,
                    committedChangedCount: 1,
                    mergeable: true
                }
            },
            async gitCaptureWorktreeMergeSnapshot() {
                return {
                    success: true,
                    targetBranch: 'main',
                    sourceBranch: 'task-branch',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1
                }
            },
            async gitMergeWorktree() {
                return {
                    success: true,
                    commitHash: TARGET_HEAD
                }
            },
            async gitVerifyWorktreeMerge() {
                return {
                    success: true,
                    verified: true,
                    targetBranch: 'main',
                    mergeBase: MERGE_BASE,
                    snapshotRef: SNAPSHOT_REF,
                    expectedChangeCount: 1,
                    targetHead: TARGET_HEAD
                }
            },
            async getGitDiffNumstat() {
                return { success: true, stdout: '1\t0\tsrc/app.ts\n' }
            },
            async archiveSession() {
            }
        })

        const applied = await executeProjectAssistantOperatorTool({
            store,
            engine,
            namespace: 'default',
            sessionId: intervention.session.id,
            toolName: 'hopi_retry_blocked_merge',
            input: {
                taskId
            }
        })

        expect(applied.ok).toBe(true)
        expect(resumeCalls).toBe(1)
        await waitForTask({
            store,
            namespace: 'default',
            taskId,
            predicate: (task) => task?.mergeRuntime?.status === 'succeeded'
        })
        expect(store.tasks.getTaskByNamespace(taskId, 'default')).toMatchObject({
            status: 'finished',
            worktreeMergeCommit: TARGET_HEAD
        })
    })

    it('keeps a blocked merge unchanged when typed assistant retry cannot queue auto-merge', async () => {
        const store = new Store(':memory:')
        const root = workspace()
        const { project, goal } = seedProject(store, root)
        store.projects.updateProject(project.id, 'default', {
            defaultSessionType: 'worktree',
            worktreeTargetBranch: 'main'
        })
        const taskId = 'task-merge-missing-active-session'
        store.tasks.createTask({
            id: taskId,
            projectId: project.id,
            goalId: goal.id,
            title: 'Merge accepted change',
            status: 'blocked',
            source: 'evaluator',
            blockedReason: 'No active linked task session',
            blockedSource: 'merge',
            blockedSessionId: 'missing-session',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'missing-session',
                requestedAt: 10,
                startedAt: 10,
                updatedAt: 20,
                completedAt: 20,
                retryCount: 0,
                failureFingerprint: null,
                latestNote: 'Auto-merge blocked: No active linked task session',
                blockedReason: 'No active linked task session',
                failure: null
            }
        })
        const intervention = createProjectAssistantIntervention({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            taskId,
            interventionKey: `merge-blocked:${taskId}`,
            interventionKind: 'merge_blocked',
            title: 'Auto-merge blocked',
            body: 'The blocker was reported as resolved.',
            suggestedActions: [{ id: 'retry_merge', label: 'Retry merge', recommended: true }]
        })
        const { engine } = engineFor(store)

        const applied = await executeProjectAssistantOperatorTool({
            store,
            engine,
            namespace: 'default',
            sessionId: intervention.session.id,
            toolName: 'hopi_retry_blocked_merge',
            input: {
                taskId
            }
        })

        expect(applied.ok).toBe(false)
        expect(store.tasks.getTaskByNamespace(taskId, 'default')).toMatchObject({
            status: 'blocked',
            blockedReason: 'No active linked task session',
            mergeRuntime: {
                status: 'blocked',
                sessionId: 'missing-session',
                retryCount: 0,
                blockedReason: 'No active linked task session'
            }
        })
        expect(store.sessions.getSessionByNamespace(intervention.session.id, 'default')?.metadata).toMatchObject({
            interventionStatus: 'pending'
        })
    })

    it('rejects operator tools outside the assistant session namespace and project scope', async () => {
        const store = new Store(':memory:')
        const { project, goal } = seedProject(store, workspace())
        const { engine } = engineFor(store)
        const assistant = await ensureProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })

        const wrongNamespace = await executeProjectAssistantOperatorTool({
            store,
            engine,
            namespace: 'other',
            sessionId: assistant.session.id,
            toolName: 'hopi_project_snapshot',
            input: {}
        })
        const wrongProject = await executeProjectAssistantOperatorTool({
            store,
            engine,
            namespace: 'default',
            sessionId: assistant.session.id,
            toolName: 'hopi_project_snapshot',
            input: { projectId: 'project-other' }
        })

        expect(wrongNamespace).toEqual({ ok: false, error: 'Assistant session not found' })
        expect(wrongProject).toEqual({ ok: false, error: 'Operator tool project scope mismatch' })
    })

    it('writes preference markdown only through the constrained global preference path', async () => {
        const store = new Store(':memory:')
        const root = workspace()
        const { project, goal } = seedProject(store, root)
        const { engine } = engineFor(store)
        const assistant = await ensureProjectAssistantSession({
            store,
            engine,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })

        const rejected = await executeProjectAssistantOperatorTool({
            store,
            engine,
            namespace: 'default',
            sessionId: assistant.session.id,
            toolName: 'hopi_write_preference',
            input: {
                path: 'README.md',
                markdown: '# Wrong path\n'
            }
        })
        const written = await executeProjectAssistantOperatorTool({
            store,
            engine,
            namespace: 'default',
            sessionId: assistant.session.id,
            toolName: 'hopi_write_preference',
            input: {
                path: '.hopi/preference.md',
                markdown: '# HOPI Preferences\n\n- Keep replies concise.\n'
            }
        })

        expect(rejected).toEqual({ ok: false, error: 'Preference writes are limited to .hopi/preference.md' })
        expect(written.ok).toBe(true)
        expect(readFileSync(join(root, '.hopi/preference.md'), 'utf8')).toContain('Keep replies concise.')
    })

    it('briefs assistant to maintain global preference markdown instead of goal preferences', () => {
        const store = new Store(':memory:')
        const root = workspace()
        const { project, goal } = seedProject(store, root)
        mkdirSync(join(root, '.hopi'), { recursive: true })
        writeFileSync(join(root, '.hopi/preference.md'), '# HOPI Preferences\n\n- Do not auto-commit.\n', 'utf8')

        const prompt = buildProjectAssistantBriefingPrompt({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id
        })

        expect(prompt).toContain('.hopi/preference.md')
        expect(prompt).toContain('Do not auto-commit.')
        expect(prompt).not.toContain('Active preferences')
    })
})
