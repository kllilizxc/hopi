import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Session } from '@hopi/protocol/types'
import { Store, type StoredSession } from '../store'
import type { SyncEngine } from './syncEngine'
import {
    activateProjectAssistantSession,
    applyProjectAssistantActionPacketFromReady,
    buildProjectAssistantBriefingPrompt,
    createProjectAssistantIntervention,
    ensureProjectAssistantSession,
    listProjectAssistantSessions,
    resolveProjectAssistantIntervention,
    sendProjectAssistantPlannerMail,
    tryCreateProjectAssistantIntervention
} from './projectAssistant'

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

function engineFor(store: Store): { engine: SyncEngine; sent: Array<{ sessionId: string; text: string }> } {
    const sessions = new Map<string, Session>()
    const sent: Array<{ sessionId: string; text: string }> = []
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
            sessionTag?: string
        ) {
            const stored = store.sessions.getOrCreateSession(
                sessionTag ?? `assistant-${sessions.size + 1}`,
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
        async waitForSessionActive() {
            return true
        },
        getSessionByNamespace(sessionId: string) {
            return sessions.get(sessionId) ?? null
        },
        async sendMessage(sessionId: string, payload: { text: string; localId?: string | null }) {
            sent.push({ sessionId, text: payload.text })
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
    return { engine, sent }
}

describe('project assistant', () => {
    it('creates an idempotent normal assistant session with project metadata', async () => {
        const store = new Store(':memory:')
        const seeded = seedProject(store, workspace())
        const { project, workspace: projectWorkspace, goal } = seeded
        const { engine, sent } = engineFor(store)

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

        expect(second.session.id).toBe(first.session.id)
        expect(first.session.metadata).toMatchObject({
            path: projectWorkspace.path,
            host: 'localhost',
            projectId: project.id,
            goalId: goal.id,
            hopiAssistant: true,
            assistantKind: 'normal'
        })
        expect(sent).toHaveLength(1)
        expect(sent[0]?.text).toContain('Current kanban tasks')
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
    })

    it('applies visible assistant action packets to resolve decisions', async () => {
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
        const ready = store.messages.addMessage(assistant.session.id, {
            role: 'assistant',
            content: {
                type: 'event',
                data: { type: 'ready' }
            }
        })

        const applied = applyProjectAssistantActionPacketFromReady({
            store,
            engine,
            namespace: 'default',
            sessionId: assistant.session.id,
            readyMessage: {
                id: ready.id,
                seq: ready.seq,
                localId: ready.localId,
                content: ready.content,
                createdAt: ready.createdAt
            }
        })

        expect(applied).toBe(true)
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
