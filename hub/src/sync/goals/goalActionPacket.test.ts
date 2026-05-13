import { describe, expect, it } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { appendPlannerMail, readGoalOperatorDocs } from '../operator/operatorDocs'
import { listProjectAssistantSessions } from '../projectAssistant'
import { applyGoalActionPacketFromSession } from './goalActionPacket'

describe('goal action packet', () => {
    it('updates goal planner mail status from HOPI_ACTIONS', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-mail-status'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-mail-status-'))

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Mail Status Project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: 'goal-1',
            projectId,
            namespace,
            goalKey: 'ship-ui',
            title: 'Ship UI'
        })
        store.tasks.createTask({
            id: 'task-1',
            projectId,
            goalId: 'goal-1',
            title: 'Plan next tasks',
            status: 'in_progress',
            source: 'planner'
        })
        const session = store.sessions.getOrCreateSession(
            'planner-session',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )
        const mail = appendPlannerMail({
            workspacePath,
            goalKey: 'ship-ui',
            kind: 'request',
            body: 'Please schedule an accessibility pass.',
            source: { sessionId: 'assistant-session', messageId: 'message-1' },
            now: 1778570000000
        })
        store.messages.addMessage(session.id, {
            role: 'assistant',
            content: {
                type: 'text',
                text: [
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'update_planner_mail_status',
                                mailId: mail.id,
                                status: 'included'
                            },
                            {
                                type: 'update_current_task',
                                status: 'finished',
                                handoff: 'Mail included in the plan.',
                                evidence: 'Updated planner state.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })

        const events: unknown[] = []
        const applied = applyGoalActionPacketFromSession({
            store,
            engine: {
                handleRealtimeEvent(event: unknown) {
                    events.push(event)
                }
            } as SyncEngine,
            namespace,
            projectId,
            taskId: 'task-1',
            sessionId: session.id
        })

        expect(applied).toBe(true)
        const docs = readGoalOperatorDocs({ workspacePath, goalKey: 'ship-ui' })
        expect(docs.mail.mail[0]).toMatchObject({
            id: mail.id,
            status: 'included'
        })
        expect(events).toContainEqual(expect.objectContaining({
            type: 'project-updated',
            projectId
        }))
    })

    it('creates assistant interventions for decision topics and blocked task updates', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-intervention-actions'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-intervention-actions-'))

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Intervention Project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: 'goal-1',
            projectId,
            namespace,
            goalKey: 'ship-ui',
            title: 'Ship UI'
        })
        store.tasks.createTask({
            id: 'task-1',
            projectId,
            goalId: 'goal-1',
            title: 'Build table',
            status: 'in_progress',
            source: 'manual'
        })
        const session = store.sessions.getOrCreateSession(
            'generator-session',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )
        store.messages.addMessage(session.id, {
            role: 'assistant',
            content: {
                type: 'text',
                text: [
                    'HOPI_ACTIONS:',
                    '```json',
                    JSON.stringify({
                        actions: [
                            {
                                type: 'create_decision_topic',
                                title: 'Choose table density',
                                body: 'Compact or spacious table rows?',
                                blocking: true
                            },
                            {
                                type: 'update_current_task',
                                status: 'blocked',
                                handoff: 'Blocked until the table density decision is made.'
                            }
                        ]
                    }),
                    '```'
                ].join('\n')
            }
        })

        const applied = applyGoalActionPacketFromSession({
            store,
            engine: {
                handleRealtimeEvent() {
                }
            } as unknown as SyncEngine,
            namespace,
            projectId,
            taskId: 'task-1',
            sessionId: session.id
        })

        expect(applied).toBe(true)
        const assistantSessions = listProjectAssistantSessions({
            store,
            namespace,
            projectId
        })
        expect(assistantSessions.pendingCount).toBe(2)
        expect(assistantSessions.sessions.map((item) => item.interventionKind).sort()).toEqual([
            'decision_needed',
            'task_blocked'
        ])
    })

    it('repairs unescaped double quotes inside HOPI_ACTIONS string values', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-quote-repair'
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-quote-repair-'))

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Quote Repair Project',
            defaultWorkspaceId: 'workspace-1'
        })
        store.workspaces.createWorkspace({
            id: 'workspace-1',
            projectId,
            path: workspacePath
        })
        store.goals.createGoal({
            id: 'goal-1',
            projectId,
            namespace,
            goalKey: 'ship-ui',
            title: 'Ship UI'
        })
        store.tasks.createTask({
            id: 'task-1',
            projectId,
            goalId: 'goal-1',
            title: 'Plan next tasks',
            status: 'in_progress',
            source: 'planner'
        })
        const session = store.sessions.getOrCreateSession(
            'planner-session',
            { path: workspacePath, host: 'localhost' },
            null,
            namespace
        )
        store.messages.addMessage(session.id, {
            role: 'assistant',
            content: {
                type: 'text',
                text: [
                    'HOPI_ACTIONS:',
                    '```json',
                    '{',
                    '  "actions": [',
                    '    { "type": "create_goal_task", "title": "Build filters", "description": "Add filters.", "priority": "high" },',
                    '    { "type": "update_current_task", "status": "finished", "handoff": "Human confirmed "ship it".", "evidence": "Created next task." }',
                    '  ]',
                    '}',
                    '```'
                ].join('\n')
            }
        })

        const applied = applyGoalActionPacketFromSession({
            store,
            engine: {
                handleRealtimeEvent() {
                }
            } as unknown as SyncEngine,
            namespace,
            projectId,
            taskId: 'task-1',
            sessionId: session.id
        })

        expect(applied).toBe(true)
        const tasks = store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { goalId: 'goal-1' })
        expect(tasks.map((task) => task.title)).toContain('Build filters')
        expect(store.tasks.getTaskByNamespace('task-1', namespace)).toMatchObject({
            status: 'finished',
            handoff: 'Human confirmed "ship it".'
        })
    })
})
