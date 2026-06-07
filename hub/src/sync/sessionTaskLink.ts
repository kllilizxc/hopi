import type { HopiTaskRole, Session } from '@hopi/protocol/types'

import type { StoredSession, StoredTask, Store } from '../store'
import { syncTaskActionRuntimeSession } from '../utils/taskActionRuntime'
import { getDocsRoot } from './goals/goalDocPaths'
import { findGoalTodoTaskProjectionById, getTaskByNamespaceOrGoalTodoProjection } from './goals/goalTodoProjection'
import type { SyncEngine } from './syncEngine'

export type SessionTaskLinkMetadata = {
    projectId: string
    taskId: string
    name?: string
    hopiTaskRole?: HopiTaskRole
}

type LinkRealtimeEngine = Pick<SyncEngine, 'handleRealtimeEvent'>

export type BestTaskSessionResolution =
    | {
        ok: true
        sessionId: string
        session: Session | null
        source: 'task-active-session' | 'merge-runtime' | 'session-metadata'
        needsRelink: boolean
        needsResume: boolean
    }
    | {
        ok: false
        reason: 'not-found' | 'access-denied'
    }

type FoundBestTaskSessionResolution = Extract<BestTaskSessionResolution, { ok: true }>

export type ResolveBestUsableTaskSessionResult =
    | {
        ok: true
        task: StoredTask
        sessionId: string
        session: Session
        relinked: boolean
        resumed: boolean
        source: 'task-active-session' | 'merge-runtime' | 'session-metadata'
    }
    | {
        ok: false
        reason: 'session_not_found' | 'session_access_denied' | 'not_worktree_session'
    }

function trimString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function getCanonicalSessionLinkTaskId(task: Pick<StoredTask, 'id' | 'goalTodoRef'>): string {
    return trimString(task.goalTodoRef) ?? task.id
}

function resolveCanonicalSessionLinkTaskId(options: {
    store: Store
    namespace: string
    projectId: string
    taskId: string
}): string | null {
    const projected = getTaskByNamespaceOrGoalTodoProjection({
        store: options.store,
        namespace: options.namespace,
        taskId: options.taskId
    })
    if (projected && projected.projectId === options.projectId) {
        return getCanonicalSessionLinkTaskId(projected)
    }

    const stored = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (stored && stored.projectId === options.projectId) {
        if (!getTaskRuntimeView({
            store: options.store,
            namespace: options.namespace,
            task: stored
        })) {
            return null
        }
        return getCanonicalSessionLinkTaskId(stored)
    }

    return options.taskId
}

function isSessionActive(session: Session | null | undefined): boolean {
    return session ? session.active !== false : false
}

function getTaskRuntimeView(options: {
    store: Store
    namespace: string
    task: StoredTask
}): StoredTask | null {
    if (!options.task.goalId) {
        return options.task
    }
    const projected = getTaskByNamespaceOrGoalTodoProjection({
        store: options.store,
        namespace: options.namespace,
        taskId: options.task.id
    })
    if (!projected) {
        return null
    }
    if (projected === options.task) {
        return options.task
    }

    const hasExplicitOverlayBlock = Boolean(
        options.task.blockedReason
        || options.task.blockedSource
        || options.task.blockedSessionId
        || options.task.blockedAt
    )
    if (!hasExplicitOverlayBlock) {
        return projected
    }

    return {
        ...projected,
        blockedReason: options.task.blockedReason,
        blockedSource: options.task.blockedSource,
        blockedSessionId: options.task.blockedSessionId,
        blockedAt: options.task.blockedAt
    }
}

function isStaleDbOnlyGoalTaskForSource(options: {
    store: Store
    namespace: string
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'source' | 'projectId'>
    source: StoredTask['source']
}): boolean {
    if (!options.task.goalId) {
        return false
    }
    if (options.task.source !== options.source) {
        return false
    }
    if (trimString(options.task.goalTodoRef)) {
        return false
    }
    const project = options.store.projects.getProjectByNamespace(options.task.projectId, options.namespace)
    if (!project) {
        return false
    }
    const defaultWorkspace = project.defaultWorkspaceId
        ? options.store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : options.store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
    if (!getDocsRoot(defaultWorkspace)) {
        return false
    }
    return !findGoalTodoTaskProjectionById({
        store: options.store,
        namespace: options.namespace,
        taskId: options.task.id
    })
}

function isStaleDbOnlyManualGoalTask(options: {
    store: Store
    namespace: string
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'source' | 'projectId'>
}): boolean {
    return isStaleDbOnlyGoalTaskForSource({
        ...options,
        source: 'manual'
    })
}

function isStaleDbOnlyBootstrapGoalTask(options: {
    store: Store
    namespace: string
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'source' | 'projectId'>
}): boolean {
    return isStaleDbOnlyGoalTaskForSource({
        ...options,
        source: 'project_init'
    })
}

function isStaleDbOnlyRuntimeGoalTask(options: {
    store: Store
    namespace: string
    task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'source' | 'projectId'>
}): boolean {
    return isStaleDbOnlyManualGoalTask(options) || isStaleDbOnlyBootstrapGoalTask(options)
}

export function readSessionTaskLinkMetadata(current: unknown): SessionTaskLinkMetadata | null {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return null
    }

    const record = current as Record<string, unknown>
    const projectId = trimString(record.projectId)
    const taskId = trimString(record.taskId)
    if (!projectId || !taskId) {
        return null
    }

    const name = trimString(record.name) ?? undefined
    const rawRole = trimString(record.hopiTaskRole)
    const hopiTaskRole = rawRole === 'planner' || rawRole === 'generator' || rawRole === 'evaluator' || rawRole === 'radar'
        ? rawRole
        : undefined
    return { projectId, taskId, name, hopiTaskRole }
}

export function mergeSessionTaskLinkMetadata(current: unknown, patch: SessionTaskLinkMetadata): unknown {
    const base = current && typeof current === 'object' && !Array.isArray(current)
        ? current as Record<string, unknown>
        : {}

    return {
        ...base,
        projectId: patch.projectId,
        taskId: patch.taskId,
        name: patch.name ?? base.name,
        hopiTaskRole: patch.hopiTaskRole ?? base.hopiTaskRole
    }
}

export function sessionMetadataMatchesTaskLink(current: unknown, projectId: string, taskId: string): boolean {
    const metadata = readSessionTaskLinkMetadata(current)
    return metadata?.projectId === projectId && metadata.taskId === taskId
}

function sessionMetadataMatchesTask(options: {
    current: unknown
    task: Pick<StoredTask, 'id' | 'goalTodoRef' | 'projectId'>
}): boolean {
    const metadata = readSessionTaskLinkMetadata(options.current)
    if (!metadata || metadata.projectId !== options.task.projectId) {
        return false
    }
    return metadata.taskId === options.task.id
        || metadata.taskId === getCanonicalSessionLinkTaskId(options.task)
}

function updateStoredSessionTaskLink(options: {
    store: Store
    sessionId: string
    namespace: string
    patch: SessionTaskLinkMetadata
}): boolean {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const stored = options.store.sessions.getSessionByNamespace(options.sessionId, options.namespace)
        if (!stored) {
            return false
        }

        const nextMetadata = mergeSessionTaskLinkMetadata(stored.metadata, options.patch)
        const result = options.store.sessions.updateSessionMetadata(
            options.sessionId,
            nextMetadata,
            stored.metadataVersion,
            options.namespace,
            { touchUpdatedAt: false }
        )

        if (result.result === 'success') {
            return true
        }

        if (result.result === 'error') {
            return false
        }
    }

    return false
}

export function syncTaskSessionLink(options: {
    store: Store
    engine?: LinkRealtimeEngine
    sessionId: string
    namespace: string
    projectId: string
    taskId: string
    name?: string
    hopiTaskRole?: HopiTaskRole
}): boolean {
    const canonicalTaskId = resolveCanonicalSessionLinkTaskId({
        store: options.store,
        namespace: options.namespace,
        projectId: options.projectId,
        taskId: options.taskId
    })
    if (!canonicalTaskId) {
        return false
    }

    const ok = updateStoredSessionTaskLink({
        store: options.store,
        sessionId: options.sessionId,
        namespace: options.namespace,
        patch: {
            projectId: options.projectId,
            taskId: canonicalTaskId,
            name: options.name,
            hopiTaskRole: options.hopiTaskRole
        }
    })

    if (!ok) {
        return false
    }

    options.engine?.handleRealtimeEvent({
        type: 'session-updated',
        sessionId: options.sessionId,
        namespace: options.namespace,
        data: { sessionId: options.sessionId }
    })
    return true
}

export function setSessionTaskLink(options: {
    store: Store
    engine: SyncEngine
    sessionId: string
    namespace: string
    projectId: string
    taskId: string
    name?: string
    hopiTaskRole?: HopiTaskRole
}): boolean {
    return syncTaskSessionLink(options)
}

export function relinkTaskToSession(options: {
    store: Store
    engine: LinkRealtimeEngine
    task: StoredTask
    namespace: string
    sessionId: string
    preserveMergeResultOnSessionChange?: boolean
}): StoredTask | null {
    if (isStaleDbOnlyRuntimeGoalTask({
        store: options.store,
        namespace: options.namespace,
        task: options.task
    })) {
        return null
    }
    if (!getTaskRuntimeView({
        store: options.store,
        namespace: options.namespace,
        task: options.task
    })) {
        return null
    }
    const nextTask = options.store.tasks.updateTaskByNamespace(options.task.id, options.namespace, {
        activeSessionId: options.sessionId,
        mergeRuntime: syncTaskActionRuntimeSession(options.task.mergeRuntime, options.sessionId),
        previewRuntime: syncTaskActionRuntimeSession(options.task.previewRuntime, options.sessionId),
        initRuntime: syncTaskActionRuntimeSession(options.task.initRuntime, options.sessionId),
        preserveMergeResultOnSessionChange: options.preserveMergeResultOnSessionChange
    })
    if (!nextTask) {
        return null
    }
    const runtimeTask = getTaskRuntimeView({
        store: options.store,
        namespace: options.namespace,
        task: nextTask
    })
    if (!runtimeTask) {
        return null
    }

    syncTaskSessionLink({
        store: options.store,
        engine: options.engine,
        sessionId: options.sessionId,
        namespace: options.namespace,
        projectId: runtimeTask.projectId,
        taskId: runtimeTask.id,
        name: runtimeTask.title
    })

    options.engine.handleRealtimeEvent({
        type: 'task-updated',
        taskId: runtimeTask.id,
        projectId: runtimeTask.projectId,
        namespace: options.namespace,
        data: { taskId: runtimeTask.id, activeSessionId: options.sessionId }
    })

    return runtimeTask
}

function getRuntimeSession(engine: SyncEngine, sessionId: string, namespace: string): Session | null {
    const engineWithLookup = engine as unknown as {
        getSessionByNamespace?: (sessionId: string, namespace: string) => Session | undefined
        resolveSessionAccess?: (sessionId: string, namespace: string) => { ok: true; session: Session } | { ok: false }
    }

    if (typeof engineWithLookup.getSessionByNamespace === 'function') {
        return engineWithLookup.getSessionByNamespace(sessionId, namespace) ?? null
    }

    if (typeof engineWithLookup.resolveSessionAccess === 'function') {
        const access = engineWithLookup.resolveSessionAccess(sessionId, namespace)
        return access.ok ? access.session : null
    }

    return null
}

function getRuntimeSessionsByNamespace(engine: SyncEngine, namespace: string): Session[] {
    const engineWithLookup = engine as unknown as {
        getSessionsByNamespace?: (namespace: string) => Session[]
    }

    if (typeof engineWithLookup.getSessionsByNamespace === 'function') {
        return engineWithLookup.getSessionsByNamespace(namespace)
    }

    return []
}

function getCandidateUpdatedAt(session: Session | null, stored: StoredSession | null): number {
    if (session) {
        return session.updatedAt
    }
    return stored?.updatedAt ?? 0
}

function sortMetadataCandidates(runtimeSessions: Session[], storedSessions: StoredSession[]): Array<{ sessionId: string; session: Session | null; stored: StoredSession | null }> {
    const byId = new Map<string, { sessionId: string; session: Session | null; stored: StoredSession | null }>()

    for (const session of runtimeSessions) {
        byId.set(session.id, { sessionId: session.id, session, stored: null })
    }

    for (const stored of storedSessions) {
        const existing = byId.get(stored.id)
        if (existing) {
            existing.stored = stored
            continue
        }
        byId.set(stored.id, { sessionId: stored.id, session: null, stored })
    }

    return Array.from(byId.values()).sort((left, right) => {
        if (left.session?.active !== right.session?.active) {
            return left.session?.active ? -1 : 1
        }
        return getCandidateUpdatedAt(right.session, right.stored) - getCandidateUpdatedAt(left.session, left.stored)
    })
}

function buildFoundResolution(options: {
    sessionId: string
    session: Session | null
    source: 'task-active-session' | 'merge-runtime' | 'session-metadata'
    task: StoredTask
}): FoundBestTaskSessionResolution {
    return {
        ok: true,
        sessionId: options.sessionId,
        session: options.session,
        source: options.source,
        needsRelink: options.sessionId !== options.task.activeSessionId,
        needsResume: options.session ? options.session.active === false : true
    }
}

function resolveExplicitSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTask
    sessionId: string
    source: 'task-active-session' | 'merge-runtime'
}): BestTaskSessionResolution {
    const access = options.engine.resolveSessionAccess(options.sessionId, options.namespace)
    if (access.ok) {
        return buildFoundResolution({
            sessionId: access.sessionId,
            session: access.session,
            source: options.source,
            task: options.task
        })
    }

    if (access.reason === 'access-denied') {
        return { ok: false, reason: 'access-denied' }
    }

    const stored = options.store.sessions.getSessionByNamespace(options.sessionId, options.namespace)
    if (stored) {
        return buildFoundResolution({
            sessionId: options.sessionId,
            session: getRuntimeSession(options.engine, options.sessionId, options.namespace),
            source: options.source,
            task: options.task
        })
    }

    return { ok: false, reason: 'not-found' }
}

function resolveMetadataSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTask
    requireActive?: boolean
}): FoundBestTaskSessionResolution | null {
    const runtimeMatches = getRuntimeSessionsByNamespace(options.engine, options.namespace)
        .filter((session) => sessionMetadataMatchesTask({
            current: session.metadata,
            task: options.task
        }))
    const storedMatches = options.store.sessions.getSessionsByNamespace(options.namespace)
        .filter((session) => sessionMetadataMatchesTask({
            current: session.metadata,
            task: options.task
        }))
    const metadataCandidates = sortMetadataCandidates(runtimeMatches, storedMatches)
    const bestMetadataMatch = metadataCandidates.find((candidate) => {
        return !options.requireActive || isSessionActive(candidate.session)
    })

    if (!bestMetadataMatch) {
        return null
    }

    return buildFoundResolution({
        sessionId: bestMetadataMatch.sessionId,
        session: bestMetadataMatch.session,
        source: 'session-metadata',
        task: options.task
    })
}

export function resolveBestTaskSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTask
}): BestTaskSessionResolution {
    if (isStaleDbOnlyRuntimeGoalTask({
        store: options.store,
        namespace: options.namespace,
        task: options.task
    })) {
        return { ok: false, reason: 'not-found' }
    }
    const linkedSessionId = trimString(options.task.activeSessionId)
    if (linkedSessionId) {
        const linked = resolveExplicitSession({
            ...options,
            sessionId: linkedSessionId,
            source: 'task-active-session'
        })
        if (linked.ok && isSessionActive(linked.session)) {
            return linked
        }
        if (linked.ok) {
            const activeMetadataMatch = resolveMetadataSession({
                ...options,
                requireActive: true
            })
            if (activeMetadataMatch && activeMetadataMatch.sessionId !== linked.sessionId) {
                return activeMetadataMatch
            }
            return linked
        }
        if (linked.reason === 'access-denied') {
            return linked
        }
    }

    const runtimeSessionId = trimString(options.task.mergeRuntime?.sessionId)
    if (runtimeSessionId) {
        const runtime = resolveExplicitSession({
            ...options,
            sessionId: runtimeSessionId,
            source: 'merge-runtime'
        })
        if (runtime.ok && isSessionActive(runtime.session)) {
            return runtime
        }
        if (runtime.ok) {
            const activeMetadataMatch = resolveMetadataSession({
                ...options,
                requireActive: true
            })
            if (activeMetadataMatch && activeMetadataMatch.sessionId !== runtime.sessionId) {
                return activeMetadataMatch
            }
            return runtime
        }
        if (runtime.reason === 'access-denied') {
            return runtime
        }
    }

    const metadataMatch = resolveMetadataSession(options)
    if (metadataMatch) {
        return metadataMatch
    }

    return { ok: false, reason: 'not-found' }
}

export async function resolveBestUsableTaskSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTask
    requireWorktree?: boolean
    allowResume?: boolean
}): Promise<ResolveBestUsableTaskSessionResult> {
    const resolution = resolveBestTaskSession(options)
    if (!resolution.ok) {
        return {
            ok: false,
            reason: resolution.reason === 'access-denied' ? 'session_access_denied' : 'session_not_found'
        }
    }

    let session = resolution.session ?? getRuntimeSession(options.engine, resolution.sessionId, options.namespace)
    let sessionId = resolution.sessionId
    let resumed = false

    if ((!session || !isSessionActive(session)) && options.allowResume) {
        const engineWithResume = options.engine as unknown as {
            resumeSession?: (sessionId: string, namespace: string) => Promise<
                | { type: 'success'; sessionId: string }
                | { type: 'error'; code: 'access_denied' | 'session_not_found' | 'no_machine_online' | 'resume_unavailable' | 'resume_failed' }
            >
        }

        if (typeof engineWithResume.resumeSession === 'function') {
            const resumedSession = await engineWithResume.resumeSession(sessionId, options.namespace)
            if (resumedSession.type === 'success') {
                sessionId = resumedSession.sessionId
                session = getRuntimeSession(options.engine, sessionId, options.namespace)
                resumed = true
            } else if (resumedSession.code === 'access_denied') {
                return { ok: false, reason: 'session_access_denied' }
            }
        }
    }

    if (!session || session.active === false) {
        return { ok: false, reason: 'session_not_found' }
    }

    if (options.requireWorktree && !session.metadata?.worktree) {
        return { ok: false, reason: 'not_worktree_session' }
    }

    const relinkedTask = (resolution.needsRelink || sessionId !== options.task.activeSessionId)
        ? relinkTaskToSession({
            store: options.store,
            engine: options.engine,
            task: options.task,
            namespace: options.namespace,
            sessionId,
            preserveMergeResultOnSessionChange: true
        })
        : options.task

    const runtimeTask = getTaskRuntimeView({
        store: options.store,
        namespace: options.namespace,
        task: relinkedTask ?? options.task
    })
    if (!runtimeTask) {
        return { ok: false, reason: 'session_not_found' }
    }

    return {
        ok: true,
        task: runtimeTask,
        sessionId,
        session,
        relinked: Boolean(relinkedTask && relinkedTask.activeSessionId === sessionId && sessionId !== options.task.activeSessionId),
        resumed,
        source: resolution.source
    }
}
