import { describe, expect, it } from 'bun:test'

import { Store } from '../store'
import { SSEManager } from '../sse/sseManager'
import { VisibilityTracker } from '../visibility/visibilityTracker'
import { EventPublisher } from './eventPublisher'
import { SessionCache } from './sessionCache'

describe('SessionCache.deleteSession', () => {
    it('clears activeSessionId on tasks linked to a deleted session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })

        const storedSession = store.sessions.getOrCreateSession(
            'test-session',
            { path: '/tmp', host: 'test' },
            null,
            namespace
        )

        const taskId = 'task-1'
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'in_progress',
            workflowProfile: 'default',
            sortKey: Date.now(),
            activeSessionId: storedSession.id
        })

        const visibilityTracker = new VisibilityTracker()
        const sseManager = new SSEManager(0, visibilityTracker)
        const publisher = new EventPublisher(sseManager, (event) => event.namespace)
        const events: unknown[] = []
        publisher.subscribe((event) => events.push(event))

        const cache = new SessionCache(store, publisher)
        cache.refreshSession(storedSession.id)

        const before = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(before?.activeSessionId).toBe(storedSession.id)

        await cache.deleteSession(storedSession.id)

        const after = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(after?.activeSessionId).toBeNull()

        const hasSessionRemoved = events.some((event) => {
            if (!event || typeof event !== 'object') return false
            const e = event as { type?: unknown; sessionId?: unknown }
            return e.type === 'session-removed' && e.sessionId === storedSession.id
        })
        expect(hasSessionRemoved).toBe(true)

        const hasTaskUpdated = events.some((event) => {
            if (!event || typeof event !== 'object') return false
            const e = event as { type?: unknown; taskId?: unknown; data?: unknown }
            if (e.type !== 'task-updated' || e.taskId !== taskId) return false
            const data = e.data as { activeSessionId?: unknown } | undefined
            return data?.activeSessionId === null
        })
        expect(hasTaskUpdated).toBe(true)
    })
})

describe('SessionCache.mergeSessions', () => {
    it('re-links task activeSessionId to the merged session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })

        const oldSession = store.sessions.getOrCreateSession(
            'session-old',
            { path: '/tmp/old', host: 'test' },
            null,
            namespace
        )
        const newSession = store.sessions.getOrCreateSession(
            'session-new',
            { path: '/tmp/new', host: 'test' },
            null,
            namespace
        )

        const taskId = 'task-merge'
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task merge',
            status: 'in_progress',
            workflowProfile: 'default',
            sortKey: Date.now(),
            activeSessionId: oldSession.id
        })

        const visibilityTracker = new VisibilityTracker()
        const sseManager = new SSEManager(0, visibilityTracker)
        const publisher = new EventPublisher(sseManager, (event) => event.namespace)
        const events: unknown[] = []
        publisher.subscribe((event) => events.push(event))

        const cache = new SessionCache(store, publisher)
        cache.refreshSession(oldSession.id)
        cache.refreshSession(newSession.id)

        await cache.mergeSessions(oldSession.id, newSession.id, namespace)

        const updatedTask = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updatedTask?.activeSessionId).toBe(newSession.id)

        const hasTaskUpdated = events.some((event) => {
            if (!event || typeof event !== 'object') return false
            const e = event as { type?: unknown; taskId?: unknown; data?: unknown }
            if (e.type !== 'task-updated' || e.taskId !== taskId) return false
            const data = e.data as { activeSessionId?: unknown } | undefined
            return data?.activeSessionId === newSession.id
        })
        expect(hasTaskUpdated).toBe(true)
    })
})
