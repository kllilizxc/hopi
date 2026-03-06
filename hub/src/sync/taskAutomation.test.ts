import { describe, expect, it } from 'bun:test'
import type { Session, SyncEvent } from '@hopi/protocol/types'

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
    it('flips task to in_review on ready', () => {
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

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
    })

    it('flips to in_review even when only codex tool-call messages exist before ready', () => {
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

        const toolCallMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'tool-call',
                    name: 'CodexBash',
                    callId: 'call-1',
                    input: { command: 'ls' }
                }
            }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, toolCallMsg))

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', forLocalKey: promptLocalId } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
    })

    it('flips to in_review even if ready arrives before thinking=false session update', () => {
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

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
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

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
    })

    it('treats permission pending as in_review (session-updated)', () => {
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

        session.agentState = {
            requests: {
                'req-1': {
                    tool: 'filesystem',
                    arguments: { title: 'allow read' },
                    createdAt: Date.now()
                }
            }
        }
        automation.handleEvent({ type: 'session-updated', sessionId })

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
    })

    it('moves in_review back to in_progress when session starts thinking again', () => {
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
            status: 'in_review',
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

        session.thinking = true
        automation.handleEvent({ type: 'session-updated', sessionId })

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_progress')
    })

    it('does not miss in_review -> in_progress when thinking=true arrives before agentState clears pending requests', () => {
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
            status: 'in_review',
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

        // Simulate a transient state where the agent has resumed (thinking=true)
        // but the pending request envelope hasn't been cleared yet.
        session.agentState = {
            requests: {
                'req-1': {
                    tool: 'filesystem',
                    arguments: { title: 'allow read' },
                    createdAt: Date.now()
                }
            }
        }
        session.thinking = true
        automation.handleEvent({ type: 'session-updated', sessionId })

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_progress')
    })

    it('ignores merge-conflict auto-resolution prompts for task progress state', () => {
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

        const mergedAt = Date.now() - 1_000
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'finished',
            activeSessionId: sessionId,
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'abc123'
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, {
            finishedAt: mergedAt,
            mergedDiffSnapshot: {
                files: [{ fullPath: 'src/app.ts', linesAdded: 5, linesRemoved: 1 }],
                capturedAt: mergedAt,
                baseCommit: 'deadbeef'
            }
        })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const promptLocalId = `auto:merge_conflict_resolve:${taskId}:1`
        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'resolve merge conflicts' },
            localKey: promptLocalId,
            meta: { sentFrom: 'webapp' }
        }, promptLocalId)
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('finished')
        expect(afterPrompt?.worktreeMergedAt).toBe(mergedAt)
        expect(afterPrompt?.worktreeMergeCommit).toBe('abc123')

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', forLocalKey: promptLocalId } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const afterReady = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterReady?.status).toBe('finished')
        expect(afterReady?.worktreeMergedAt).toBe(mergedAt)
        expect(afterReady?.worktreeMergeCommit).toBe('abc123')
    })

    it('ignores preview setup automation prompts for task progress state', () => {
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

        const mergedAt = Date.now() - 1_000
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'finished',
            activeSessionId: sessionId,
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'abc123'
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, { finishedAt: mergedAt })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const promptLocalId = `auto:preview_setup:${taskId}:1`
        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'setup preview script' },
            localKey: promptLocalId,
            meta: { sentFrom: 'webapp' }
        }, promptLocalId)
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('finished')
        expect(afterPrompt?.worktreeMergedAt).toBe(mergedAt)
        expect(afterPrompt?.worktreeMergeCommit).toBe('abc123')

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready', forLocalKey: promptLocalId } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const afterReady = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterReady?.status).toBe('finished')
        expect(afterReady?.worktreeMergedAt).toBe(mergedAt)
        expect(afterReady?.worktreeMergeCommit).toBe('abc123')
    })

    it('moves finished task back to in_progress on follow-up prompt and clears merge markers', () => {
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

        const mergedAt = Date.now() - 1_000
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'finished',
            activeSessionId: sessionId,
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'abc123'
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, { finishedAt: mergedAt })

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
            content: { type: 'text', text: 'continue this task' },
            meta: { sentFrom: 'cli' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('in_progress')
        expect(afterPrompt?.worktreeMergedAt).toBeNull()
        expect(afterPrompt?.worktreeMergeCommit).toBeNull()
        expect(afterPrompt?.mergedDiffSnapshot).toBeNull()
        expect(afterPrompt?.finishedAt).toBeNull()

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.status).toBe('in_review')
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
    })

    it('clears stale merged diff snapshot on follow-up prompt while already in_progress', () => {
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
        store.tasks.updateTaskByNamespace(taskId, namespace, {
            mergedDiffSnapshot: {
                files: [{ fullPath: 'src/app.ts', linesAdded: 2, linesRemoved: 0 }],
                capturedAt: Date.now(),
                baseCommit: 'abc1234'
            }
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
            content: { type: 'text', text: 'continue this task' },
            meta: { sentFrom: 'cli' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const updated = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(updated?.status).toBe('in_progress')
        expect(updated?.mergedDiffSnapshot).toBeNull()
        expect(realtimeEvents.some((event) => event.type === 'task-updated')).toBe(true)
    })

    it('applies gsd workflow phase transitions on prompt and ready', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-gsd'
        const taskId = 'task-gsd'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'GSD project'
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
            title: 'GSD task',
            status: 'planned',
            workflowProfile: 'gsd',
            workflowPhase: 'execute_ready',
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
            content: { type: 'text', text: 'run implementation now' },
            meta: { sentFrom: 'webapp' }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('in_progress')
        expect(afterPrompt?.workflowPhase).toBe('execute')

        const readyMsg = store.messages.addMessage(sessionId, {
            role: 'agent',
            content: { type: 'event', data: { type: 'ready' } }
        })
        automation.handleEvent(toMessageReceivedEvent(sessionId, readyMsg))

        const afterReady = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterReady?.status).toBe('in_review')
        expect(afterReady?.workflowPhase).toBe('verify')
    })

    it('ignores workflow automation prompts for task progress state', () => {
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

        const mergedAt = Date.now() - 1_000
        store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Test task',
            status: 'finished',
            activeSessionId: sessionId,
            worktreeMergedAt: mergedAt,
            worktreeMergeCommit: 'abc123'
        })
        store.tasks.updateTaskByNamespace(taskId, namespace, { finishedAt: mergedAt })

        const engine = {
            getSession(id: string) {
                return id === sessionId ? session : undefined
            },
            handleRealtimeEvent(_event: SyncEvent) {}
        } as unknown as SyncEngine

        const automation = new TaskAutomation(store, engine)
        automation.handleEvent({ type: 'session-added', sessionId })

        const promptLocalId = `auto:workflow:${taskId}:1`
        const userMsg = store.messages.addMessage(sessionId, {
            role: 'user',
            content: { type: 'text', text: 'workflow-driven helper prompt' },
            localKey: promptLocalId,
            meta: { sentFrom: 'webapp' }
        }, promptLocalId)
        automation.handleEvent(toMessageReceivedEvent(sessionId, userMsg))

        const afterPrompt = store.tasks.getTaskByNamespace(taskId, namespace)
        expect(afterPrompt?.status).toBe('finished')
        expect(afterPrompt?.worktreeMergedAt).toBe(mergedAt)
        expect(afterPrompt?.worktreeMergeCommit).toBe('abc123')
    })
})
