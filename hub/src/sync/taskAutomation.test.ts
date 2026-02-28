import { describe, expect, it } from 'bun:test'
import type { Session, SyncEvent } from '@hapi/protocol/types'

import { Store } from '../store'
import { TaskAutomation } from './taskAutomation'
import type { SyncEngine } from './syncEngine'

function createLinkedSession(store: Store, options: {
    namespace: string
    projectId: string
    taskId: string
    thinking: boolean
}): { sessionId: string; session: Session } {
    const stored = store.sessions.getOrCreateSession(
        'test-session',
        { path: '/tmp', host: 'test', projectId: options.projectId, taskId: options.taskId },
        null,
        options.namespace
    )

    const now = Date.now()
    const session: Session = {
        id: stored.id,
        namespace: options.namespace,
        seq: 0,
        createdAt: now,
        updatedAt: now,
        active: true,
        activeAt: now,
        metadata: {
            path: '/tmp',
            host: 'test',
            projectId: options.projectId,
            taskId: options.taskId
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: options.thinking,
        thinkingAt: now
    }

    return { sessionId: stored.id, session }
}

function createUnlinkedSession(store: Store, options: {
    namespace: string
    thinking: boolean
}): { sessionId: string; session: Session } {
    const stored = store.sessions.getOrCreateSession(
        'test-session',
        { path: '/tmp', host: 'test' },
        null,
        options.namespace
    )

    const now = Date.now()
    const session: Session = {
        id: stored.id,
        namespace: options.namespace,
        seq: 0,
        createdAt: now,
        updatedAt: now,
        active: true,
        activeAt: now,
        metadata: {
            path: '/tmp',
            host: 'test'
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: options.thinking,
        thinkingAt: now
    }

    return { sessionId: stored.id, session }
}

function toMessageReceivedEvent(sessionId: string, msg: {
    id: string
    seq: number
    localId: string | null
    content: unknown
    createdAt: number
}): SyncEvent {
    return {
        type: 'message-received',
        sessionId,
        message: {
            id: msg.id,
            seq: msg.seq,
            localId: msg.localId,
            content: msg.content,
            createdAt: msg.createdAt
        }
    }
}

describe('TaskAutomation', () => {
    it('flips task to in_review when assistant message arrives after thinking stops', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: true
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'in_progress',
            activeSessionId: sessionId
        })

        const realtimeEvents: SyncEvent[] = []
        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(event: SyncEvent) {
                realtimeEvents.push(event)
            }
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)

        automation.handleEvent({ type: 'session-added', sessionId })

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'do thing' },
            meta: { sentFrom: 'webapp' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        session.thinking = false
        automation.handleEvent({ type: 'session-updated', sessionId })

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_progress')

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'output', data: { type: 'text', text: 'done' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_progress')

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
    })

    it('flips task to in_review when session is linked only via activeSessionId', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createUnlinkedSession(store, {
            namespace,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'in_progress',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'do thing' },
            meta: { sentFrom: 'webapp' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'output', data: { type: 'text', text: 'done' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
    })

    it('does not flip to in_review while session is still thinking', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: true
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'in_progress',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        store.messages.addMessage(sessionId, { role: 'user', content: { type: 'text', text: 'do thing' }, meta: { sentFrom: 'webapp' } })

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'output', data: { type: 'text', text: 'partial reply' } }
        })

        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_progress')
    })

    it('flips task to in_review when a non-role message trails the assistant output', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: true
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'in_progress',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'do thing' },
            meta: { sentFrom: 'webapp' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const assistantMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'output', data: { type: 'text', text: 'done' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, assistantMsg))

        const trailing = store.messages.addMessage(sessionId, { note: 'trail' })
        automation.handleEvent(toMessageReceivedEvent(sessionId, trailing))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        session.thinking = false
        automation.handleEvent({ type: 'session-updated', sessionId })

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
    })

    it('flips task to in_review when session becomes active while already idle', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        session.active = false

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'in_progress',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'do thing' },
            meta: { sentFrom: 'webapp' }
        })
        store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'output', data: { type: 'text', text: 'done' } }
        })
        store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })

        session.active = true
        automation.handleEvent({ type: 'session-updated', sessionId })

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
    })

    it('flips task to in_review even when the last automation prompt is older than the last 200 messages', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'in_progress',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'do thing' },
            meta: { sentFrom: 'webapp' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        // Simulate long streaming / tool-heavy turn (prompt pushed out of the last 200 messages)
        for (let i = 0; i < 210; i += 1) {
            store.messages.addMessage(sessionId, {
                role: 'agent',
                content: { type: 'output', data: { type: 'text', text: `chunk-${i}` } }
            })
        }

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
    })

    it('flips task to in_review based on ready correlation fields (forLocalKey + hasAssistantReply)', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'in_progress',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const promptLocalId = 'prompt-1'

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'do thing' },
            localKey: promptLocalId,
            meta: { sentFrom: 'webapp' }
        }, promptLocalId)
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        // No assistant output messages stored; rely solely on ready correlation fields.
        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', forLocalKey: promptLocalId, hasAssistantReply: true } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
    })

    it('flips task to in_review even when ready correlation says hasAssistantReply=false', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Test project'
        })

        const { sessionId, session } = createLinkedSession(store, {
            namespace,
            projectId,
            taskId,
            thinking: false
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'in_progress',
            activeSessionId: sessionId
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const promptLocalId = 'prompt-1'

        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'do thing' },
            localKey: promptLocalId,
            meta: { sentFrom: 'webapp' }
        }, promptLocalId)
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', forLocalKey: promptLocalId, hasAssistantReply: false } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
    })
})
