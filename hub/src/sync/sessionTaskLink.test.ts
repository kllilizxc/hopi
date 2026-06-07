import { describe, expect, it } from 'bun:test'
import type { Session } from '@hopi/protocol/types'
import { afterEach } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../store'
import { relinkTaskToSession, resolveBestUsableTaskSession, setSessionTaskLink } from './sessionTaskLink'
import type { SyncEngine } from './syncEngine'

const tempDirs: string[] = []

afterEach(() => {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
})

function createTempWorkspace(): string {
    const path = mkdtempSync(join(tmpdir(), 'hopi-session-task-link-'))
    tempDirs.push(path)
    return path
}

function createSession(store: Store, options: {
    id: string
    namespace: string
    metadata: Session['metadata']
    active?: boolean
    updatedAt?: number
}): Session {
    const stored = store.sessions.getOrCreateSession(options.id, options.metadata, null, options.namespace)
    const updatedAt = options.updatedAt ?? Date.now()
    return {
        id: stored.id,
        namespace: options.namespace,
        seq: 0,
        createdAt: updatedAt,
        updatedAt,
        active: options.active ?? true,
        activeAt: options.active === false ? 0 : updatedAt,
        metadata: options.metadata,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: updatedAt
    }
}

describe('relinkTaskToSession', () => {
    it('keeps task, session metadata, and runtime sessions in sync', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const oldSession = createSession(store, {
            id: 'session-old',
            namespace,
            metadata: { path: '/tmp/old', host: 'test', projectId, taskId: 'task-1' }
        })
        const newSession = createSession(store, {
            id: 'session-new',
            namespace,
            metadata: { path: '/tmp/new', host: 'test' }
        })

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })
        const task = store.tasks.createTask({
            id: 'task-1',
            projectId,
            title: 'Task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: oldSession.id,
            mergeRuntime: {
                status: 'running',
                sessionId: oldSession.id,
                updatedAt: Date.now(),
                latestNote: 'merge running'
            },
            previewRuntime: {
                status: 'running',
                sessionId: oldSession.id,
                updatedAt: Date.now(),
                latestNote: 'preview running'
            },
            initRuntime: {
                status: 'running',
                sessionId: oldSession.id,
                updatedAt: Date.now(),
                latestNote: 'init running'
            }
        })

        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as Pick<SyncEngine, 'handleRealtimeEvent'>

        const updated = relinkTaskToSession({
            store,
            engine,
            task,
            namespace,
            sessionId: newSession.id
        })

        expect(updated?.activeSessionId).toBe(newSession.id)
        expect(updated?.mergeRuntime?.sessionId).toBe(newSession.id)
        expect(updated?.previewRuntime?.sessionId).toBe(newSession.id)
        expect(updated?.initRuntime?.sessionId).toBe(newSession.id)
        const linkedSession = store.sessions.getSessionByNamespace(newSession.id, namespace)
        expect(linkedSession?.metadata).toMatchObject({ projectId, taskId: 'task-1' })
        expect(events.some((event) => {
            if (!event || typeof event !== 'object') return false
            const payload = event as { type?: unknown; taskId?: unknown; sessionId?: unknown }
            return payload.type === 'task-updated' || payload.type === 'session-updated'
        })).toBe(true)
    })

    it('returns the docs-projected goal task view and syncs the canonical title into session metadata when relinking directly', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-direct-relink'
        const goalId = 'goal-direct-relink'
        const goalKey = 'goal-direct-relink'
        const taskId = 'task-goal-direct-relink'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Goal direct relink',
            'items:',
            `  - ref: ${taskId}`,
            '    kind: engineering',
            '    status: in_progress',
            '    title: Canonical direct relink title',
            '    description: Canonical direct relink description.'
        ].join('\n'), 'utf8')

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
            title: 'Goal direct relink'
        })

        createSession(store, {
            id: 'session-old-goal-direct',
            namespace,
            metadata: { path: workspacePath, host: 'test', projectId, taskId }
        })
        const newSession = createSession(store, {
            id: 'session-new-goal-direct',
            namespace,
            metadata: { path: workspacePath, host: 'test' }
        })

        const task = store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Stale direct relink overlay title',
            description: 'Stale direct relink overlay description.',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-old-goal-direct'
        })

        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as Pick<SyncEngine, 'handleRealtimeEvent'>

        const updated = relinkTaskToSession({
            store,
            engine,
            task,
            namespace,
            sessionId: newSession.id
        })

        expect(updated?.activeSessionId).toBe(newSession.id)
        expect(updated?.title).toBe('Canonical direct relink title')
        expect(updated?.description).toBe('Canonical direct relink description.')
        const linkedSession = store.sessions.getSessionByNamespace(newSession.id, namespace)
        expect(linkedSession?.metadata).toMatchObject({
            projectId,
            taskId,
            name: 'Canonical direct relink title'
        })
        expect(events.some((event) => {
            if (!event || typeof event !== 'object') return false
            const payload = event as { type?: unknown; taskId?: unknown }
            return payload.type === 'task-updated' && payload.taskId === taskId
        })).toBe(true)
    })

    it('rejects relinking a docs-missing goal overlay even when goalTodoRef is already set', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-direct-missing-projection-relink'
        const goalId = 'goal-direct-missing-projection-relink'
        const goalKey = 'goal-direct-missing-projection-relink'
        const taskId = 'task-goal-direct-missing-projection-relink-db'
        const todoRef = 'task-goal-direct-missing-projection-relink-ref'
        const workspacePath = createTempWorkspace()

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
            title: 'Goal direct missing projection relink'
        })

        createSession(store, {
            id: 'session-old-goal-direct-missing-projection',
            namespace,
            metadata: { path: workspacePath, host: 'test', projectId, taskId: todoRef }
        })
        const newSession = createSession(store, {
            id: 'session-new-goal-direct-missing-projection',
            namespace,
            metadata: { path: workspacePath, host: 'test' }
        })

        const task = store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Docs-missing relink title',
            description: 'Docs-missing relink description.',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-old-goal-direct-missing-projection'
        })

        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as Pick<SyncEngine, 'handleRealtimeEvent'>

        const updated = relinkTaskToSession({
            store,
            engine,
            task,
            namespace,
            sessionId: newSession.id
        })

        expect(updated).toBeNull()
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.activeSessionId).toBe('session-old-goal-direct-missing-projection')
        expect(store.sessions.getSessionByNamespace(newSession.id, namespace)?.metadata).not.toMatchObject({
            projectId,
            taskId: todoRef
        })
        expect(events).toHaveLength(0)
    })

    it('rejects relinking a stale DB-only manual goal row when a docs-backed workspace exists', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-direct-stale-relink'
        const goalId = 'goal-direct-stale-relink'
        const goalKey = 'goal-direct-stale-relink'
        const taskId = 'task-goal-direct-stale-relink'
        const workspacePath = createTempWorkspace()

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
            title: 'Goal direct stale relink'
        })

        createSession(store, {
            id: 'session-old-goal-direct-stale',
            namespace,
            metadata: { path: workspacePath, host: 'test', projectId, taskId }
        })
        const newSession = createSession(store, {
            id: 'session-new-goal-direct-stale',
            namespace,
            metadata: { path: workspacePath, host: 'test' }
        })

        const task = store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Stale direct relink task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-old-goal-direct-stale',
            source: 'manual'
        })

        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as Pick<SyncEngine, 'handleRealtimeEvent'>

        const updated = relinkTaskToSession({
            store,
            engine,
            task,
            namespace,
            sessionId: newSession.id
        })

        expect(updated).toBeNull()
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.activeSessionId).toBe('session-old-goal-direct-stale')
        expect(store.sessions.getSessionByNamespace(newSession.id, namespace)?.metadata).not.toMatchObject({
            projectId,
            taskId
        })
        expect(events).toHaveLength(0)
    })

    it('rejects direct session-link writes for a stale DB-only manual goal row when a docs-backed workspace exists', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-direct-stale-link-write'
        const goalId = 'goal-direct-stale-link-write'
        const goalKey = 'goal-direct-stale-link-write'
        const taskId = 'task-goal-direct-stale-link-write'
        const workspacePath = createTempWorkspace()

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
            title: 'Goal direct stale link write'
        })
        const session = createSession(store, {
            id: 'session-stale-link-write',
            namespace,
            metadata: { path: workspacePath, host: 'test' }
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Stale direct link write task',
            status: 'in_progress',
            workflowProfile: 'default',
            source: 'manual'
        })

        const ok = setSessionTaskLink({
            store,
            engine: { handleRealtimeEvent() {} } as unknown as SyncEngine,
            sessionId: session.id,
            namespace,
            projectId,
            taskId
        })

        expect(ok).toBe(false)
        expect(store.sessions.getSessionByNamespace(session.id, namespace)?.metadata).not.toMatchObject({
            projectId,
            taskId
        })
    })

    it('rejects direct session-link writes for a docs-missing goal overlay even when goalTodoRef is already set', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-direct-missing-projection-link-write'
        const goalId = 'goal-direct-missing-projection-link-write'
        const goalKey = 'goal-direct-missing-projection-link-write'
        const taskId = 'task-goal-direct-missing-projection-link-write-db'
        const todoRef = 'task-goal-direct-missing-projection-link-write-ref'
        const workspacePath = createTempWorkspace()

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
            title: 'Goal direct missing projection link write'
        })
        const session = createSession(store, {
            id: 'session-direct-missing-projection-link-write',
            namespace,
            metadata: { path: workspacePath, host: 'test' }
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Docs-missing direct link write task',
            status: 'in_progress',
            workflowProfile: 'default'
        })

        const ok = setSessionTaskLink({
            store,
            engine: { handleRealtimeEvent() {} } as unknown as SyncEngine,
            sessionId: session.id,
            namespace,
            projectId,
            taskId
        })

        expect(ok).toBe(false)
        expect(store.sessions.getSessionByNamespace(session.id, namespace)?.metadata).not.toMatchObject({
            projectId,
            taskId: todoRef
        })
    })

    it('rejects relinking a stale DB-only bootstrap goal row when a docs-backed workspace exists', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-direct-stale-bootstrap-relink'
        const goalId = 'goal-direct-stale-bootstrap-relink'
        const goalKey = 'goal-direct-stale-bootstrap-relink'
        const taskId = 'task-goal-direct-stale-bootstrap-relink'
        const workspacePath = createTempWorkspace()

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
            title: 'Goal direct stale bootstrap relink'
        })

        createSession(store, {
            id: 'session-old-goal-direct-stale-bootstrap',
            namespace,
            metadata: { path: workspacePath, host: 'test', projectId, taskId }
        })
        const newSession = createSession(store, {
            id: 'session-new-goal-direct-stale-bootstrap',
            namespace,
            metadata: { path: workspacePath, host: 'test' }
        })

        const task = store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Stale direct bootstrap relink task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-old-goal-direct-stale-bootstrap',
            source: 'project_init'
        })

        const events: unknown[] = []
        const engine = {
            handleRealtimeEvent(event: unknown) {
                events.push(event)
            }
        } as Pick<SyncEngine, 'handleRealtimeEvent'>

        const updated = relinkTaskToSession({
            store,
            engine,
            task,
            namespace,
            sessionId: newSession.id
        })

        expect(updated).toBeNull()
        expect(store.tasks.getTaskByNamespace(taskId, namespace)?.activeSessionId).toBe('session-old-goal-direct-stale-bootstrap')
        expect(store.sessions.getSessionByNamespace(newSession.id, namespace)?.metadata).not.toMatchObject({
            projectId,
            taskId
        })
        expect(events).toHaveLength(0)
    })

    it('rejects direct session-link writes for a stale DB-only bootstrap goal row when a docs-backed workspace exists', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-direct-stale-bootstrap-link-write'
        const goalId = 'goal-direct-stale-bootstrap-link-write'
        const goalKey = 'goal-direct-stale-bootstrap-link-write'
        const taskId = 'task-goal-direct-stale-bootstrap-link-write'
        const workspacePath = createTempWorkspace()

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
            title: 'Goal direct stale bootstrap link write'
        })
        const session = createSession(store, {
            id: 'session-stale-bootstrap-link-write',
            namespace,
            metadata: { path: workspacePath, host: 'test' }
        })

        store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Stale direct bootstrap link write task',
            status: 'in_progress',
            workflowProfile: 'default',
            source: 'project_init'
        })

        const ok = setSessionTaskLink({
            store,
            engine: { handleRealtimeEvent() {} } as unknown as SyncEngine,
            sessionId: session.id,
            namespace,
            projectId,
            taskId
        })

        expect(ok).toBe(false)
        expect(store.sessions.getSessionByNamespace(session.id, namespace)?.metadata).not.toMatchObject({
            projectId,
            taskId
        })
    })

    it('stores the canonical goal todo ref in session metadata when relinking a legacy goal overlay id', () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-canonical-link-id'
        const goalId = 'goal-canonical-link-id'
        const goalKey = 'goal-canonical-link-id'
        const rawTaskId = 'legacy-goal-overlay-id'
        const todoRef = 'canonical-goal-ref'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Goal canonical link id',
            'items:',
            `  - ref: ${todoRef}`,
            '    kind: engineering',
            '    status: in_progress',
            '    title: Canonical linked title',
            '    description: Canonical linked description.'
        ].join('\n'), 'utf8')

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
            title: 'Goal canonical link id'
        })

        createSession(store, {
            id: 'session-old-goal-canonical-link',
            namespace,
            metadata: { path: workspacePath, host: 'test', projectId, taskId: rawTaskId }
        })
        const newSession = createSession(store, {
            id: 'session-new-goal-canonical-link',
            namespace,
            metadata: { path: workspacePath, host: 'test' }
        })

        const task = store.tasks.createTask({
            id: rawTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stale overlay linked title',
            description: 'Stale overlay linked description.',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-old-goal-canonical-link'
        })

        const engine = {
            handleRealtimeEvent() {
            }
        } as Pick<SyncEngine, 'handleRealtimeEvent'>

        const updated = relinkTaskToSession({
            store,
            engine,
            task,
            namespace,
            sessionId: newSession.id
        })

        expect(updated?.id).toBe(rawTaskId)
        expect(updated?.goalTodoRef).toBe(todoRef)
        const linkedSession = store.sessions.getSessionByNamespace(newSession.id, namespace)
        expect(linkedSession?.metadata).toMatchObject({
            projectId,
            taskId: todoRef,
            name: 'Canonical linked title'
        })
    })
})

describe('resolveBestUsableTaskSession', () => {
    it('returns the docs-projected goal task view after relinking to a metadata-matched session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-docs-relink'
        const goalId = 'goal-docs-relink'
        const goalKey = 'goal-docs-relink'
        const taskId = 'task-goal-docs-relink'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Goal docs relink',
            'items:',
            `  - ref: ${taskId}`,
            '    kind: engineering',
            '    status: in_progress',
            '    title: Canonical relink title',
            '    description: Canonical relink description.'
        ].join('\n'), 'utf8')

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
            title: 'Goal docs relink'
        })

        const bestSession = createSession(store, {
            id: 'session-best-goal',
            namespace,
            metadata: {
                path: workspacePath,
                host: 'test',
                projectId,
                taskId,
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            active: true,
            updatedAt: Date.now()
        })

        const task = store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: taskId,
            title: 'Stale overlay relink title',
            description: 'Stale overlay relink description.',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-stale-goal',
            previewRuntime: {
                status: 'waiting',
                sessionId: 'session-stale-goal',
                updatedAt: Date.now() - 500,
                latestNote: 'waiting for preview'
            }
        })

        const runtimeSessions = new Map<string, Session>([[bestSession.id, bestSession]])
        const engine = {
            resolveSessionAccess(sessionId: string, ns: string) {
                const session = runtimeSessions.get(sessionId)
                if (!session || ns !== namespace) {
                    return { ok: false as const, reason: 'not-found' as const }
                }
                return { ok: true as const, sessionId, session }
            },
            getSessionByNamespace(sessionId: string, ns: string) {
                return ns === namespace ? runtimeSessions.get(sessionId) : undefined
            },
            getSessionsByNamespace(ns: string) {
                return ns === namespace ? Array.from(runtimeSessions.values()) : []
            },
            async resumeSession() {
                return { type: 'error' as const, message: 'not needed', code: 'resume_unavailable' as const }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const resolved = await resolveBestUsableTaskSession({
            store,
            engine,
            namespace,
            task,
            requireWorktree: true,
            allowResume: true
        })

        expect(resolved.ok).toBe(true)
        if (!resolved.ok) {
            return
        }
        expect(resolved.task.activeSessionId).toBe(bestSession.id)
        expect(resolved.task.title).toBe('Canonical relink title')
        expect(resolved.task.description).toBe('Canonical relink description.')
        expect(resolved.relinked).toBe(true)
    })

    it('rejects docs-missing goal overlays when resolving the best usable task session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-missing-projection-session-resolution'
        const goalId = 'goal-missing-projection-session-resolution'
        const goalKey = 'goal-missing-projection-session-resolution'
        const taskId = 'task-goal-missing-projection-session-resolution-db'
        const todoRef = 'task-goal-missing-projection-session-resolution-ref'
        const workspacePath = createTempWorkspace()

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
            title: 'Goal missing projection session resolution'
        })

        const bestSession = createSession(store, {
            id: 'session-best-goal-missing-projection',
            namespace,
            metadata: {
                path: workspacePath,
                host: 'test',
                projectId,
                taskId: todoRef,
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            active: true,
            updatedAt: Date.now()
        })

        const task = store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Missing projection session resolution task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-stale-goal-missing-projection'
        })

        const runtimeSessions = new Map<string, Session>([[bestSession.id, bestSession]])
        const engine = {
            resolveSessionAccess(sessionId: string, ns: string) {
                const session = runtimeSessions.get(sessionId)
                if (!session || ns !== namespace) {
                    return { ok: false as const, reason: 'not-found' as const }
                }
                return { ok: true as const, sessionId, session }
            },
            getSessionByNamespace(sessionId: string, ns: string) {
                return ns === namespace ? runtimeSessions.get(sessionId) : undefined
            },
            getSessionsByNamespace(ns: string) {
                return ns === namespace ? Array.from(runtimeSessions.values()) : []
            },
            async resumeSession() {
                return { type: 'error' as const, message: 'not needed', code: 'resume_unavailable' as const }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const resolved = await resolveBestUsableTaskSession({
            store,
            engine,
            namespace,
            task,
            requireWorktree: true,
            allowResume: true
        })

        expect(resolved).toEqual({
            ok: false,
            reason: 'session_not_found'
        })
    })

    it('matches session metadata that stores a canonical goal todo ref against a legacy goal overlay id', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-canonical-metadata-match'
        const goalId = 'goal-canonical-metadata-match'
        const goalKey = 'goal-canonical-metadata-match'
        const rawTaskId = 'legacy-goal-metadata-overlay-id'
        const todoRef = 'canonical-metadata-ref'
        const workspacePath = createTempWorkspace()
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Goal canonical metadata match',
            'items:',
            `  - ref: ${todoRef}`,
            '    kind: engineering',
            '    status: in_progress',
            '    title: Canonical metadata match title',
            '    description: Canonical metadata match description.'
        ].join('\n'), 'utf8')

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
            title: 'Goal canonical metadata match'
        })

        const bestSession = createSession(store, {
            id: 'session-best-goal-canonical-metadata',
            namespace,
            metadata: {
                path: workspacePath,
                host: 'test',
                projectId,
                taskId: todoRef,
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            active: true,
            updatedAt: Date.now()
        })

        const task = store.tasks.createTask({
            id: rawTaskId,
            projectId,
            goalId,
            goalTodoRef: todoRef,
            title: 'Stale overlay canonical metadata title',
            description: 'Stale overlay canonical metadata description.',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-stale-goal-canonical-metadata',
            previewRuntime: {
                status: 'waiting',
                sessionId: 'session-stale-goal-canonical-metadata',
                updatedAt: Date.now() - 500,
                latestNote: 'waiting for preview'
            }
        })

        const runtimeSessions = new Map<string, Session>([[bestSession.id, bestSession]])
        const engine = {
            resolveSessionAccess(sessionId: string, ns: string) {
                const session = runtimeSessions.get(sessionId)
                if (!session || ns !== namespace) {
                    return { ok: false as const, reason: 'not-found' as const }
                }
                return { ok: true as const, sessionId, session }
            },
            getSessionByNamespace(sessionId: string, ns: string) {
                return ns === namespace ? runtimeSessions.get(sessionId) : undefined
            },
            getSessionsByNamespace(ns: string) {
                return ns === namespace ? Array.from(runtimeSessions.values()) : []
            },
            async resumeSession() {
                return { type: 'error' as const, message: 'not needed', code: 'resume_unavailable' as const }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const resolved = await resolveBestUsableTaskSession({
            store,
            engine,
            namespace,
            task,
            requireWorktree: true,
            allowResume: true
        })

        expect(resolved.ok).toBe(true)
        if (!resolved.ok) {
            return
        }
        expect(resolved.task.id).toBe(rawTaskId)
        expect(resolved.task.goalTodoRef).toBe(todoRef)
        expect(resolved.task.activeSessionId).toBe(bestSession.id)
        expect(resolved.relinked).toBe(true)
    })

    it('rejects stale DB-only manual goal rows when resolving the best usable task session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-stale-session-resolution'
        const goalId = 'goal-stale-session-resolution'
        const goalKey = 'goal-stale-session-resolution'
        const taskId = 'task-goal-stale-session-resolution'
        const workspacePath = createTempWorkspace()

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
            title: 'Goal stale session resolution'
        })

        const bestSession = createSession(store, {
            id: 'session-best-goal-stale',
            namespace,
            metadata: {
                path: workspacePath,
                host: 'test',
                projectId,
                taskId,
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            active: true,
            updatedAt: Date.now()
        })

        const task = store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Stale session resolution task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-stale-goal-stale',
            source: 'manual'
        })

        const runtimeSessions = new Map<string, Session>([[bestSession.id, bestSession]])
        const engine = {
            resolveSessionAccess(sessionId: string, ns: string) {
                const session = runtimeSessions.get(sessionId)
                if (!session || ns !== namespace) {
                    return { ok: false as const, reason: 'not-found' as const }
                }
                return { ok: true as const, sessionId, session }
            },
            getSessionByNamespace(sessionId: string, ns: string) {
                return ns === namespace ? runtimeSessions.get(sessionId) : undefined
            },
            getSessionsByNamespace(ns: string) {
                return ns === namespace ? Array.from(runtimeSessions.values()) : []
            },
            async resumeSession() {
                return { type: 'error' as const, message: 'not needed', code: 'resume_unavailable' as const }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const resolved = await resolveBestUsableTaskSession({
            store,
            engine,
            namespace,
            task,
            requireWorktree: true,
            allowResume: true
        })

        expect(resolved).toEqual({
            ok: false,
            reason: 'session_not_found'
        })
    })

    it('rejects stale DB-only bootstrap goal rows when resolving the best usable task session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-goal-stale-bootstrap-session-resolution'
        const goalId = 'goal-stale-bootstrap-session-resolution'
        const goalKey = 'goal-stale-bootstrap-session-resolution'
        const taskId = 'task-goal-stale-bootstrap-session-resolution'
        const workspacePath = createTempWorkspace()

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
            title: 'Goal stale bootstrap session resolution'
        })

        const bestSession = createSession(store, {
            id: 'session-best-goal-stale-bootstrap',
            namespace,
            metadata: {
                path: workspacePath,
                host: 'test',
                projectId,
                taskId,
                worktree: {
                    basePath: workspacePath,
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            active: true,
            updatedAt: Date.now()
        })

        const task = store.tasks.createTask({
            id: taskId,
            projectId,
            goalId,
            title: 'Stale bootstrap session resolution task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-stale-goal-stale-bootstrap',
            source: 'project_init'
        })

        const runtimeSessions = new Map<string, Session>([[bestSession.id, bestSession]])
        const engine = {
            resolveSessionAccess(sessionId: string, ns: string) {
                const session = runtimeSessions.get(sessionId)
                if (!session || ns !== namespace) {
                    return { ok: false as const, reason: 'not-found' as const }
                }
                return { ok: true as const, sessionId, session }
            },
            getSessionByNamespace(sessionId: string, ns: string) {
                return ns === namespace ? runtimeSessions.get(sessionId) : undefined
            },
            getSessionsByNamespace(ns: string) {
                return ns === namespace ? Array.from(runtimeSessions.values()) : []
            },
            async resumeSession() {
                return { type: 'error' as const, message: 'not needed', code: 'resume_unavailable' as const }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const resolved = await resolveBestUsableTaskSession({
            store,
            engine,
            namespace,
            task,
            requireWorktree: true,
            allowResume: true
        })

        expect(resolved).toEqual({
            ok: false,
            reason: 'session_not_found'
        })
    })

    it('relinks to a metadata-matched session when task activeSessionId is stale', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })

        const bestSession = createSession(store, {
            id: 'session-best',
            namespace,
            metadata: {
                path: '/tmp/best',
                host: 'test',
                projectId,
                taskId: 'task-1',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            active: true,
            updatedAt: Date.now()
        })

        const task = store.tasks.createTask({
            id: 'task-1',
            projectId,
            title: 'Task',
            status: 'in_progress',
            workflowProfile: 'default',
            activeSessionId: 'session-stale',
            mergeRuntime: {
                status: 'queued',
                updatedAt: Date.now() - 1_000,
                latestNote: 'queued'
            },
            previewRuntime: {
                status: 'waiting',
                sessionId: 'session-stale',
                updatedAt: Date.now() - 500,
                latestNote: 'waiting for preview'
            },
            initRuntime: {
                status: 'waiting',
                sessionId: 'session-stale',
                updatedAt: Date.now() - 250,
                latestNote: 'waiting for init repair'
            }
        })

        const runtimeSessions = new Map<string, Session>([[bestSession.id, bestSession]])
        const engine = {
            resolveSessionAccess(sessionId: string, ns: string) {
                const session = runtimeSessions.get(sessionId)
                if (!session || ns !== namespace) {
                    return { ok: false as const, reason: 'not-found' as const }
                }
                return { ok: true as const, sessionId, session }
            },
            getSessionByNamespace(sessionId: string, ns: string) {
                return ns === namespace ? runtimeSessions.get(sessionId) : undefined
            },
            getSessionsByNamespace(ns: string) {
                return ns === namespace ? Array.from(runtimeSessions.values()) : []
            },
            async resumeSession() {
                return { type: 'error' as const, message: 'not needed', code: 'resume_unavailable' as const }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const resolved = await resolveBestUsableTaskSession({
            store,
            engine,
            namespace,
            task,
            requireWorktree: true,
            allowResume: true
        })

        expect(resolved.ok).toBe(true)
        if (!resolved.ok) {
            return
        }
        expect(resolved.sessionId).toBe(bestSession.id)
        expect(resolved.task.activeSessionId).toBe(bestSession.id)
        expect(resolved.task.mergeRuntime?.sessionId).toBe(bestSession.id)
        expect(resolved.task.previewRuntime?.sessionId).toBe(bestSession.id)
        expect(resolved.task.initRuntime?.sessionId).toBe(bestSession.id)
        expect(resolved.relinked).toBe(true)
    })

    it('prefers an active metadata-matched session over an inactive explicit task session', async () => {
        const store = new Store(':memory:')
        const namespace = 'default'
        const projectId = 'project-1'
        const taskId = 'task-1'

        store.projects.createProject({
            id: projectId,
            namespace,
            machineId: 'machine-1',
            name: 'Project'
        })

        const inactiveSession = createSession(store, {
            id: 'session-inactive',
            namespace,
            metadata: {
                path: '/tmp/worktree',
                host: 'test',
                projectId,
                taskId,
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            active: false,
            updatedAt: Date.now() - 2_000
        })
        const activeSession = createSession(store, {
            id: 'session-active',
            namespace,
            metadata: {
                path: '/tmp/worktree',
                host: 'test',
                projectId,
                taskId,
                hopiTaskRole: 'evaluator',
                worktree: {
                    basePath: '/tmp/base',
                    branch: 'task-branch',
                    name: 'task-branch'
                }
            },
            active: true,
            updatedAt: Date.now()
        })

        const task = store.tasks.createTask({
            id: taskId,
            projectId,
            title: 'Task',
            status: 'in_review',
            workflowProfile: 'default',
            activeSessionId: inactiveSession.id
        })

        const runtimeSessions = new Map<string, Session>([
            [inactiveSession.id, inactiveSession],
            [activeSession.id, activeSession]
        ])
        const engine = {
            resolveSessionAccess(sessionId: string, ns: string) {
                const session = runtimeSessions.get(sessionId)
                if (!session || ns !== namespace) {
                    return { ok: false as const, reason: 'not-found' as const }
                }
                return { ok: true as const, sessionId, session }
            },
            getSessionByNamespace(sessionId: string, ns: string) {
                return ns === namespace ? runtimeSessions.get(sessionId) : undefined
            },
            getSessionsByNamespace(ns: string) {
                return ns === namespace ? Array.from(runtimeSessions.values()) : []
            },
            async resumeSession() {
                return { type: 'error' as const, message: 'not needed', code: 'resume_unavailable' as const }
            },
            handleRealtimeEvent() {}
        } as unknown as SyncEngine

        const resolved = await resolveBestUsableTaskSession({
            store,
            engine,
            namespace,
            task,
            requireWorktree: true,
            allowResume: true
        })

        expect(resolved.ok).toBe(true)
        if (!resolved.ok) {
            return
        }
        expect(resolved.sessionId).toBe(activeSession.id)
        expect(resolved.task.activeSessionId).toBe(activeSession.id)
        expect(resolved.relinked).toBe(true)
    })
})
