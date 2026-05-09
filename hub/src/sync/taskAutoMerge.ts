import type { Store, StoredProject, StoredTask } from '../store'
import { buildTaskMergeRuntime } from '../utils/taskActionRuntime'
import {
    createDefaultMergeWorkflow,
    getMergeRunVerifyChecks,
    loadMergeWorkflowFromSession,
    requiresSnapshotMergeVerification,
    runMergeVerifyChecks
} from './mergeWorkflowRunner'
import { getWorkflowStrategy } from './workflowStrategy'
import type { RpcGitMergeWorktreeStateResponse, SyncEngine } from './syncEngine'

const inFlightAutoMergeKeys = new Set<string>()

function normalizeText(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim()
    }
    if (value instanceof Error) {
        return value.message.trim()
    }
    return String(value ?? '').trim()
}

function normalizeBranchName(value: string | undefined | null): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

function readableRpcError(result: {
    error?: string
    stderr?: string
    stdout?: string
}): string {
    return result.error?.trim()
        || result.stderr?.trim()
        || result.stdout?.trim()
        || 'Worktree merge failed'
}

function buildWorktreeMergeCommitMessage(task: Pick<StoredTask, 'id' | 'title'>): string {
    return `HOPI: task ${task.id.slice(0, 8)} — ${task.title}`.slice(0, 180)
}

function emitTaskUpdated(options: {
    engine: SyncEngine
    namespace: string
    task: StoredTask
    data?: Record<string, unknown>
}): void {
    options.engine.handleRealtimeEvent({
        type: 'task-updated',
        taskId: options.task.id,
        projectId: options.task.projectId,
        namespace: options.namespace,
        data: {
            taskId: options.task.id,
            ...(options.data ?? {})
        }
    })
}

function isAutoMergeCandidate(task: StoredTask): boolean {
    return !task.archivedAt
        && task.status === 'finished'
        && !task.worktreeMergedAt
        && !task.worktreeMergeCommit
        && Boolean(task.activeSessionId)
}

function updateMergeRuntime(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTask
    status: NonNullable<StoredTask['mergeRuntime']>['status']
    sessionId: string
    latestNote: string
    blockedReason?: string | null
    startedAt?: number | null
    completedAt?: number | null
    forceReviewStatus?: boolean
}): StoredTask | null {
    const updated = options.store.tasks.updateTaskByNamespace(options.task.id, options.namespace, {
        status: options.forceReviewStatus ? 'in_review' : undefined,
        finishedAt: options.forceReviewStatus ? null : undefined,
        mergeRuntime: buildTaskMergeRuntime({
            current: options.task.mergeRuntime,
            activeSessionId: options.task.activeSessionId,
            status: options.status,
            sessionId: options.sessionId,
            latestNote: options.latestNote,
            blockedReason: options.blockedReason ?? null,
            startedAt: options.startedAt,
            completedAt: options.completedAt
        })
    })
    if (updated) {
        emitTaskUpdated({
            engine: options.engine,
            namespace: options.namespace,
            task: updated,
            data: { mergeRuntime: updated.mergeRuntime }
        })
    }
    return updated
}

function blockMerge(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTask
    sessionId: string
    reason: string
}): StoredTask | null {
    return updateMergeRuntime({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        task: options.task,
        status: 'blocked',
        sessionId: options.sessionId,
        latestNote: `Auto-merge blocked: ${options.reason}`,
        blockedReason: options.reason,
        completedAt: Date.now(),
        forceReviewStatus: true
    })
}

function parseMergeChangedCount(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? Math.floor(value)
        : null
}

function mergeStateCanMerge(result: RpcGitMergeWorktreeStateResponse): boolean {
    if (!result.success) return false
    return result.mergeable === true
}

function resolveDefaultMergeRootPath(taskSession: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>>): string {
    return taskSession.metadata?.worktree?.worktreePath
        ?? taskSession.metadata?.path
        ?? ''
}

async function cleanupTaskWorktreeAfterSuccessfulMerge(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    project: StoredProject
    task: StoredTask
    sessionId: string
}): Promise<void> {
    if (!options.project.worktreeCleanupAfterMerge) {
        return
    }

    const cleanup = (options.engine as unknown as {
        gitRemoveWorktree?: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    }).gitRemoveWorktree
    if (typeof cleanup !== 'function') {
        return
    }

    let result: Awaited<ReturnType<typeof cleanup>>
    try {
        result = await cleanup.call(options.engine, options.sessionId)
    } catch (error) {
        result = {
            success: false,
            error: normalizeText(error) || 'Worktree cleanup failed'
        }
    }

    if (!result.success) {
        options.engine.handleRealtimeEvent({
            type: 'toast',
            namespace: options.namespace,
            data: {
                title: 'Worktree cleanup failed',
                body: result.error ?? 'Merge succeeded, but cleanup failed.',
                sessionId: options.sessionId,
                url: ''
            }
        })
    }
}

export async function cleanupMergedTaskWorktree(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTask
    sessionId: string
}): Promise<void> {
    const project = options.store.projects.getProjectByNamespace(options.task.projectId, options.namespace)
    if (!project) {
        return
    }
    await cleanupTaskWorktreeAfterSuccessfulMerge({
        ...options,
        project
    })
}

async function captureDiffSnapshot(options: {
    engine: SyncEngine
    sessionId: string
    baseCommit: string | undefined
}): Promise<unknown> {
    if (!options.baseCommit) {
        return null
    }
    try {
        const result = await options.engine.getGitDiffNumstat(options.sessionId, { baseRef: options.baseCommit })
        if (!result.success || !result.stdout) {
            return null
        }
        return {
            rawNumstat: result.stdout,
            capturedAt: Date.now(),
            baseCommit: options.baseCommit
        }
    } catch {
        return null
    }
}

async function persistSuccessfulAutoMerge(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    project: StoredProject
    task: StoredTask
    sessionId: string
    targetHead: string | null
    baseCommit: string | undefined
}): Promise<StoredTask | null> {
    const mergedAt = Date.now()
    const strategy = getWorkflowStrategy(options.task)
    const finishedTransitionPatch = strategy.getTaskPatchForTransition('task_finished', options.task)
    const diffSnapshot = await captureDiffSnapshot({
        engine: options.engine,
        sessionId: options.sessionId,
        baseCommit: options.baseCommit
    })

    const updated = options.store.tasks.updateTaskByNamespace(options.task.id, options.namespace, {
        status: 'finished',
        workflowPhase: finishedTransitionPatch?.workflowPhase,
        finishedAt: mergedAt,
        worktreeMergedAt: mergedAt,
        worktreeMergeCommit: options.targetHead,
        mergedDiffSnapshot: diffSnapshot,
        mergeRuntime: buildTaskMergeRuntime({
            current: options.task.mergeRuntime,
            activeSessionId: options.task.activeSessionId,
            status: 'succeeded',
            sessionId: options.sessionId,
            latestNote: 'Auto-merge completed for the accepted worktree task.',
            blockedReason: null,
            startedAt: options.task.mergeRuntime?.startedAt ?? options.task.mergeRuntime?.requestedAt ?? mergedAt,
            completedAt: mergedAt
        })
    })
    if (!updated) {
        return null
    }

    emitTaskUpdated({
        engine: options.engine,
        namespace: options.namespace,
        task: updated,
        data: {
            worktreeMergedAt: updated.worktreeMergedAt,
            worktreeMergeCommit: updated.worktreeMergeCommit,
            mergeRuntime: updated.mergeRuntime
        }
    })

    await cleanupTaskWorktreeAfterSuccessfulMerge({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        project: options.project,
        task: updated,
        sessionId: options.sessionId
    })

    if (updated.activeSessionId) {
        try {
            await options.engine.archiveSession(updated.activeSessionId)
        } catch {
        }
    }

    return updated
}

export async function autoMergeAcceptedTask(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
}): Promise<'not_applicable' | 'merged' | 'blocked'> {
    const task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!task || !isAutoMergeCandidate(task) || !task.activeSessionId) {
        return 'not_applicable'
    }

    const project = options.store.projects.getProjectByNamespace(task.projectId, options.namespace)
    if (!project || project.defaultSessionType !== 'worktree') {
        return 'not_applicable'
    }

    const session = options.engine.getSessionByNamespace(task.activeSessionId, options.namespace)
    if (!session?.metadata?.worktree) {
        return 'not_applicable'
    }

    let runningTask = updateMergeRuntime({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        task,
        status: 'running',
        sessionId: task.activeSessionId,
        latestNote: 'Auto-merge started after evaluator acceptance.',
        startedAt: Date.now(),
        completedAt: null,
        forceReviewStatus: true
    }) ?? task

    const mergeWorkflowLoad = await loadMergeWorkflowFromSession({
        engine: options.engine,
        sessionId: task.activeSessionId,
        session
    })
    if (mergeWorkflowLoad.kind === 'invalid') {
        blockMerge({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: runningTask,
            sessionId: task.activeSessionId,
            reason: mergeWorkflowLoad.error
        })
        return 'blocked'
    }

    const workflow = mergeWorkflowLoad.kind === 'valid'
        ? mergeWorkflowLoad.workflow
        : createDefaultMergeWorkflow(project.worktreeTargetBranch)
    const workflowRootPath = mergeWorkflowLoad.kind === 'valid'
        ? mergeWorkflowLoad.rootPath
        : resolveDefaultMergeRootPath(session)
    const targetBranch = normalizeBranchName(workflow.targetBranch)
        ?? normalizeBranchName(project.worktreeTargetBranch)
    if (!targetBranch) {
        blockMerge({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: runningTask,
            sessionId: task.activeSessionId,
            reason: 'Target branch not configured'
        })
        return 'blocked'
    }

    let mergeState: RpcGitMergeWorktreeStateResponse
    try {
        mergeState = await options.engine.gitMergeWorktreeState(task.activeSessionId, { targetBranch })
    } catch (error) {
        blockMerge({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: runningTask,
            sessionId: task.activeSessionId,
            reason: normalizeText(error) || 'Merge state check failed'
        })
        return 'blocked'
    }

    if (!mergeStateCanMerge(mergeState)) {
        if (!mergeState.success) {
            blockMerge({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                task: runningTask,
                sessionId: task.activeSessionId,
                reason: readableRpcError(mergeState)
            })
            return 'blocked'
        }

        const changedCount = parseMergeChangedCount(mergeState.committedChangedCount)
        const targetHead = changedCount === 0 ? null : normalizeBranchName(mergeState.targetBranch)
        await persistSuccessfulAutoMerge({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            project,
            task: runningTask,
            sessionId: task.activeSessionId,
            targetHead,
            baseCommit: session.metadata.worktree.baseCommit
        })
        return 'merged'
    }

    const verifyRunChecks = getMergeRunVerifyChecks(workflow)
    if (verifyRunChecks.length > 0) {
        const verifyRun = await runMergeVerifyChecks({
            engine: options.engine,
            sessionId: task.activeSessionId,
            rootPath: workflowRootPath,
            taskId: task.id,
            projectId: task.projectId,
            targetBranch,
            sourceBranch: normalizeBranchName(session.metadata.worktree.branch),
            worktreeBasePath: session.metadata.worktree.basePath,
            worktreePath: session.metadata.worktree.worktreePath ?? session.metadata.path,
            checks: verifyRunChecks
        })
        if (!verifyRun.ok) {
            blockMerge({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                task: runningTask,
                sessionId: task.activeSessionId,
                reason: verifyRun.error
            })
            return 'blocked'
        }
    }

    let snapshot: { mergeBase: string; snapshotRef: string } | null = null
    if (requiresSnapshotMergeVerification(workflow)) {
        const snapshotResult = await options.engine.gitCaptureWorktreeMergeSnapshot(task.activeSessionId, { targetBranch })
        if (!snapshotResult.success || !snapshotResult.mergeBase || !snapshotResult.snapshotRef) {
            blockMerge({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                task: runningTask,
                sessionId: task.activeSessionId,
                reason: readableRpcError(snapshotResult)
            })
            return 'blocked'
        }
        snapshot = {
            mergeBase: snapshotResult.mergeBase,
            snapshotRef: snapshotResult.snapshotRef
        }
    }

    const mergeResult = await options.engine.gitMergeWorktree(task.activeSessionId, {
        targetBranch,
        commitMessage: buildWorktreeMergeCommitMessage(task),
        strategy: workflow.strategy
    })
    if (!mergeResult.success) {
        blockMerge({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: runningTask,
            sessionId: task.activeSessionId,
            reason: readableRpcError(mergeResult)
        })
        return 'blocked'
    }

    let targetHead = mergeResult.commitHash ?? null
    if (snapshot) {
        const verifyResult = await options.engine.gitVerifyWorktreeMerge(task.activeSessionId, {
            targetBranch,
            mergeBase: snapshot.mergeBase,
            snapshotRef: snapshot.snapshotRef
        })
        if (!verifyResult.success || verifyResult.verified !== true) {
            blockMerge({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                task: runningTask,
                sessionId: task.activeSessionId,
                reason: readableRpcError(verifyResult)
            })
            return 'blocked'
        }
        targetHead = verifyResult.targetHead ?? targetHead
    }

    runningTask = options.store.tasks.getTaskByNamespace(task.id, options.namespace) ?? runningTask
    await persistSuccessfulAutoMerge({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        project,
        task: runningTask,
        sessionId: task.activeSessionId,
        targetHead,
        baseCommit: session.metadata.worktree.baseCommit
    })
    return 'merged'
}

export function requestAutoMergeAcceptedTask(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
}): boolean {
    const key = `${options.namespace}:${options.taskId}`
    if (inFlightAutoMergeKeys.has(key)) {
        return true
    }

    const task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!task || !isAutoMergeCandidate(task)) {
        return false
    }

    inFlightAutoMergeKeys.add(key)
    void autoMergeAcceptedTask(options)
        .catch((error) => {
            const latest = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
            if (!latest || !latest.activeSessionId) {
                return
            }
            blockMerge({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                task: latest,
                sessionId: latest.activeSessionId,
                reason: normalizeText(error) || 'Auto-merge failed unexpectedly'
            })
        })
        .finally(() => {
            inFlightAutoMergeKeys.delete(key)
        })

    return true
}
