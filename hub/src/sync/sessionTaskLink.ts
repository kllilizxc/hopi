import type { HopiTaskRole, Session } from '@hopi/protocol/types'

import type { StoredSession, StoredTask, Store } from '../store'
import { syncTaskActionRuntimeSession } from '../utils/taskActionRuntime'
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

function isSessionActive(session: Session | null | undefined): boolean {
    return session ? session.active !== false : false
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
    const ok = updateStoredSessionTaskLink({
        store: options.store,
        sessionId: options.sessionId,
        namespace: options.namespace,
        patch: {
            projectId: options.projectId,
            taskId: options.taskId,
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

    syncTaskSessionLink({
        store: options.store,
        engine: options.engine,
        sessionId: options.sessionId,
        namespace: options.namespace,
        projectId: nextTask.projectId,
        taskId: nextTask.id,
        name: nextTask.title
    })

    options.engine.handleRealtimeEvent({
        type: 'task-updated',
        taskId: nextTask.id,
        projectId: nextTask.projectId,
        namespace: options.namespace,
        data: { taskId: nextTask.id, activeSessionId: options.sessionId }
    })

    return nextTask
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
}): BestTaskSessionResolution {
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

export function resolveBestTaskSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTask
}): BestTaskSessionResolution {
    const linkedSessionId = trimString(options.task.activeSessionId)
    if (linkedSessionId) {
        const linked = resolveExplicitSession({
            ...options,
            sessionId: linkedSessionId,
            source: 'task-active-session'
        })
        if (linked.ok || linked.reason === 'access-denied') {
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
        if (runtime.ok || runtime.reason === 'access-denied') {
            return runtime
        }
    }

    const runtimeMatches = getRuntimeSessionsByNamespace(options.engine, options.namespace)
        .filter((session) => sessionMetadataMatchesTaskLink(session.metadata, options.task.projectId, options.task.id))
    const storedMatches = options.store.sessions.getSessionsByNamespace(options.namespace)
        .filter((session) => sessionMetadataMatchesTaskLink(session.metadata, options.task.projectId, options.task.id))
    const metadataCandidates = sortMetadataCandidates(runtimeMatches, storedMatches)
    const bestMetadataMatch = metadataCandidates[0]

    if (bestMetadataMatch) {
        return buildFoundResolution({
            sessionId: bestMetadataMatch.sessionId,
            session: bestMetadataMatch.session,
            source: 'session-metadata',
            task: options.task
        })
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

    return {
        ok: true,
        task: relinkedTask ?? options.task,
        sessionId,
        session,
        relinked: Boolean(relinkedTask && relinkedTask.activeSessionId === sessionId && sessionId !== options.task.activeSessionId),
        resumed,
        source: resolution.source
    }
}
