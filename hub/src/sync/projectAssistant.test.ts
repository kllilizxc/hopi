import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../store'
import {
    createProjectAssistantIntervention,
    ensureProjectAssistantSession,
    listProjectAssistantSessions,
    resolveProjectAssistantIntervention,
    sendProjectAssistantPlannerMail,
    setProjectAssistantGoalPreference,
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

describe('project assistant', () => {
    it('creates an idempotent normal assistant session with project metadata', () => {
        const store = new Store(':memory:')
        const seeded = seedProject(store, workspace())
        const { project, workspace: projectWorkspace, goal } = seeded

        const first = ensureProjectAssistantSession({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })
        const second = ensureProjectAssistantSession({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            kind: 'normal'
        })

        expect(second.session.id).toBe(first.session.id)
        expect(first.session.metadata).toMatchObject({
            path: projectWorkspace.path,
            host: 'hopi',
            projectId: project.id,
            goalId: goal.id,
            hopiAssistant: true,
            assistantKind: 'normal'
        })
        const messages = store.messages.getMessages(first.session.id)
        expect(messages).toHaveLength(1)
        expect(JSON.stringify(messages[0]?.content)).toContain('Project Assistant')
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

    it('writes planner mail and preferences through goal-scoped operator docs', () => {
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
        const preference = setProjectAssistantGoalPreference({
            store,
            namespace: 'default',
            projectId: project.id,
            goalId: goal.id,
            category: 'test_scope',
            autonomy: 'auto_decide_and_report',
            instruction: 'Let the model choose focused regression tests.',
            source: { sessionId: 'assistant-session-1', messageId: 'message-2' },
            now: 1778570001000
        })

        expect(mail.id).toStartWith('mail-1778570000000-')
        expect(preference.id).toStartWith('pref-1778570001000-')
        expect(readFileSync(join(root, '.hopi/docs/goals/ship-ui/operator/planner-mail.yml'), 'utf8')).toContain('Please schedule')
        expect(readFileSync(join(root, '.hopi/docs/goals/ship-ui/operator/preferences.yml'), 'utf8')).toContain('focused regression')
    })
})
