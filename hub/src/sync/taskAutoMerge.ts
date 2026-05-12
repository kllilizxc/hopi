import type { MergeWorkflow } from '@hopi/protocol/actions'
import type { Store, StoredProject, StoredTask } from '../store'
import { buildTaskMergeRuntime } from '../utils/taskActionRuntime'
import { waitForAssistantCompletion } from './improvementsScan'
import { isLikelyMergeConflict } from './mergeConflictDetection'
import {
    buildMergeConflictResolutionPrompt,
    createDefaultMergeWorkflow,
    findBlockedMergeConflictPath,
    getMergeRunVerifyChecks,
    loadMergeWorkflowFromSession,
    requiresSnapshotMergeVerification,
    resolveMergeConflictResolutionMaxAttempts,
    resolveMergeConflictResolutionMode,
    runMergeVerifyChecks
} from './mergeWorkflowRunner'
import { tryCreateProjectAssistantIntervention } from './projectAssistant'
import { relinkTaskToSession } from './sessionTaskLink'
import { getWorkflowStrategy } from './workflowStrategy'
import { updateGoalTodoTaskState } from './goals/goalTodo'
import type { RpcGitMergeWorktreeResponse, RpcGitMergeWorktreeStateResponse, SyncEngine } from './syncEngine'

const inFlightAutoMergeKeys = new Set<string>()
const AUTO_MERGE_REPAIR_LOCAL_ID_PREFIX = 'auto:merge_runtime:'
const AUTO_MERGE_REPAIR_TIMEOUT_MS = 1_800_000

function normalizeText(value: unknown): string {
    if (typeof value === 'string') {
        return value.trim()
    }
    if (value instanceof Error) {
        return value.message.trim()
    }
    return String(value ?? '').trim()
}

function normalizeNonEmptyString(value: string | undefined | null): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

function normalizeBranchName(value: string | undefined | null): string | null {
    return normalizeNonEmptyString(value)
}

function syncAcceptedGoalTodoToDone(options: {
    store: Store
    namespace: string
    project: StoredProject
    task: StoredTask
}): void {
    if (!options.task.goalId || !options.task.goalTodoRef) {
        return
    }
    const goal = options.store.goals.getGoalByNamespace(options.task.goalId, options.namespace)
    if (!goal || goal.projectId !== options.project.id) {
        return
    }
    const defaultWorkspace = options.project.defaultWorkspaceId
        ? options.store.workspaces.getWorkspace(options.project.defaultWorkspaceId)
        : options.store.workspaces.listWorkspacesByProject(options.project.id)[0] ?? null
    updateGoalTodoTaskState({
        project: options.project,
        goal,
        defaultWorkspace,
        todoRef: options.task.goalTodoRef,
        taskId: options.task.id,
        kind: 'done',
        title: options.task.title
    })
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

function normalizeNumstatPath(rawPath: string): string {
    let path = rawPath.trim()
    if (!path) return ''

    if (path.includes('{') && path.includes('=>') && path.includes('}')) {
        path = path.replace(/\{[^{}]+?\s*=>\s*([^{}]+?)\}/g, (_match, newPart: string) => newPart.trim())
    } else if (path.includes('=>')) {
        const parts = path.split(/\s*=>\s*/)
        path = parts[parts.length - 1]?.trim() ?? path
    }

    return path
}

function parseDiffNumstat(output: string): Array<{
    fileName: string
    filePath: string
    fullPath: string
    status: 'modified'
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
}> {
    const files: Array<{
        fileName: string
        filePath: string
        fullPath: string
        status: 'modified'
        isStaged: boolean
        linesAdded: number
        linesRemoved: number
    }> = []

    for (const line of output.trim().split('\n')) {
        const parts = line.split('\t')
        if (parts.length < 3) continue

        const addedText = parts[0]?.trim() ?? '0'
        const removedText = parts[1]?.trim() ?? '0'
        const fullPath = normalizeNumstatPath(parts.slice(2).join('\t'))
        if (!fullPath) continue

        const pathParts = fullPath.split('/')
        const fileName = pathParts[pathParts.length - 1] || fullPath
        const filePath = pathParts.slice(0, -1).join('/')

        files.push({
            fileName,
            filePath,
            fullPath,
            status: 'modified',
            isStaged: true,
            linesAdded: addedText === '-' ? 0 : Number.parseInt(addedText, 10) || 0,
            linesRemoved: removedText === '-' ? 0 : Number.parseInt(removedText, 10) || 0
        })
    }

    return files
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

function emitSessionAdded(options: {
    engine: SyncEngine
    namespace: string
    projectId: string
    sessionId: string
}): void {
    options.engine.handleRealtimeEvent({
        type: 'session-added',
        sessionId: options.sessionId,
        projectId: options.projectId,
        namespace: options.namespace,
        data: { sessionId: options.sessionId }
    })
}

function isAutoMergeCandidate(task: StoredTask): boolean {
    const isAcceptedTask = task.status === 'finished'
    const isRecoverableMergeRuntime = task.status === 'in_review'
        && isActiveAutoMergeRuntimeStatus(task.mergeRuntime?.status)

    return !task.archivedAt
        && (isAcceptedTask || isRecoverableMergeRuntime)
        && !task.worktreeMergedAt
        && !task.worktreeMergeCommit
        && Boolean(task.activeSessionId)
}

function isActiveAutoMergeRuntimeStatus(
    status: NonNullable<StoredTask['mergeRuntime']>['status'] | null | undefined
): boolean {
    return status === 'queued'
        || status === 'waiting'
        || status === 'approval_pending'
        || status === 'running'
        || status === 'retrying'
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
    retryCount?: number
    startedAt?: number | null
    completedAt?: number | null
    forceReviewStatus?: boolean
}): StoredTask | null {
    const taskStatus = options.status === 'blocked'
        ? 'blocked'
        : options.forceReviewStatus
            ? 'in_review'
            : undefined
    const finishedAt = options.status === 'blocked' || options.forceReviewStatus
        ? null
        : undefined
    const updated = options.store.tasks.updateTaskByNamespace(options.task.id, options.namespace, {
        status: taskStatus,
        finishedAt,
        mergeRuntime: buildTaskMergeRuntime({
            current: options.task.mergeRuntime,
            activeSessionId: options.task.activeSessionId,
            status: options.status,
            sessionId: options.sessionId,
            latestNote: options.latestNote,
            blockedReason: options.blockedReason ?? null,
            retryCount: options.retryCount,
            startedAt: options.startedAt,
            completedAt: options.completedAt
        })
    })
    if (updated) {
        emitTaskUpdated({
            engine: options.engine,
            namespace: options.namespace,
            task: updated,
            data: {
                mergeRuntime: updated.mergeRuntime,
                status: updated.status,
                finishedAt: updated.finishedAt
            }
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
    const blocked = updateMergeRuntime({
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
    if (blocked) {
        const intervention = tryCreateProjectAssistantIntervention({
            store: options.store,
            namespace: options.namespace,
            projectId: blocked.projectId,
            goalId: blocked.goalId,
            taskId: blocked.id,
            interventionKey: `merge-blocked:${blocked.id}`,
            interventionKind: 'merge_blocked',
            title: `Auto-merge blocked: ${blocked.title}`,
            body: [
                'Auto-merge could not complete and needs user attention.',
                '',
                options.reason,
                '',
                `Task: ${blocked.id}`,
                `Linked session: ${options.sessionId}`
            ].join('\n'),
            suggestedActions: [
                {
                    id: 'inspect_merge',
                    label: 'Inspect merge',
                    description: 'Review the linked worktree/session before deciding how to proceed.',
                    recommended: true
                },
                {
                    id: 'dismiss',
                    label: 'Dismiss',
                    description: 'Leave the blocked task unchanged and close this assistant intervention.'
                }
            ]
        })
        if (intervention) {
            emitSessionAdded({
                engine: options.engine,
                namespace: options.namespace,
                projectId: blocked.projectId,
                sessionId: intervention.session.id
            })
        }
    }
    return blocked
}

function mergeStateCanMerge(result: RpcGitMergeWorktreeStateResponse): boolean {
    if (!result.success) return false
    return result.mergeable === true
}

function buildNoCommittedChangesBlockedReason(result: RpcGitMergeWorktreeStateResponse): string {
    const sourceBranch = normalizeBranchName(result.sourceBranch)
    const branchSuffix = sourceBranch ? ` on ${sourceBranch}` : ''
    return `No committed changes are waiting to merge${branchSuffix}. Confirm the linked worktree changes were committed to the source branch, then retry merge.`
}

function resolveDefaultMergeRootPath(taskSession: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>>): string {
    return taskSession.metadata?.worktree?.worktreePath
        ?? taskSession.metadata?.path
        ?? ''
}

function isUsableWorktreeSession(
    session: ReturnType<SyncEngine['getSessionByNamespace']> | null | undefined
): session is NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>> {
    return Boolean(session && session.active !== false && session.metadata?.worktree)
}

function resolveAutoMergeTaskSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTask
    preferredSessionId?: string
}): {
    task: StoredTask
    sessionId: string
    session: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>>
} | null {
    const preferredSessionId = normalizeNonEmptyString(options.preferredSessionId)
    if (preferredSessionId) {
        const preferredSession = options.engine.getSessionByNamespace(preferredSessionId, options.namespace)
        if (isUsableWorktreeSession(preferredSession)) {
            const task = preferredSessionId === options.task.activeSessionId
                ? options.task
                : relinkTaskToSession({
                    store: options.store,
                    engine: options.engine,
                    task: options.task,
                    namespace: options.namespace,
                    sessionId: preferredSessionId,
                    preserveMergeResultOnSessionChange: true
                }) ?? options.task
            return {
                task,
                sessionId: preferredSessionId,
                session: preferredSession
            }
        }
    }

    const activeSessionId = normalizeNonEmptyString(options.task.activeSessionId)
    if (!activeSessionId) {
        return null
    }

    const activeSession = options.engine.getSessionByNamespace(activeSessionId, options.namespace)
    if (!isUsableWorktreeSession(activeSession)) {
        return null
    }

    return {
        task: options.task,
        sessionId: activeSessionId,
        session: activeSession
    }
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
            files: parseDiffNumstat(result.stdout),
            capturedAt: Date.now(),
            baseCommit: options.baseCommit
        }
    } catch {
        return null
    }
}

function normalizeConflictFiles(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return []
    }
    return value
        .map((file) => typeof file === 'string' ? file.trim() : '')
        .filter((file) => file.length > 0)
}

type AutoMergeAttemptOutcome =
    | {
        kind: 'success'
        targetHead: string | null
    }
    | {
        kind: 'conflict'
        reason: string
        conflictFiles: string[]
    }
    | {
        kind: 'blocked'
        reason: string
    }

async function runAutoMergeAttempt(options: {
    engine: SyncEngine
    sessionId: string
    session: NonNullable<ReturnType<SyncEngine['getSessionByNamespace']>>
    task: StoredTask
    workflow: MergeWorkflow
    workflowRootPath: string
    targetBranch: string
    sourceBranch: string | null
}): Promise<AutoMergeAttemptOutcome> {
    const verifyRunChecks = getMergeRunVerifyChecks(options.workflow)
    if (verifyRunChecks.length > 0) {
        const verifyRun = await runMergeVerifyChecks({
            engine: options.engine,
            sessionId: options.sessionId,
            rootPath: options.workflowRootPath,
            taskId: options.task.id,
            projectId: options.task.projectId,
            targetBranch: options.targetBranch,
            sourceBranch: options.sourceBranch,
            worktreeBasePath: options.session.metadata?.worktree?.basePath,
            worktreePath: options.session.metadata?.worktree?.worktreePath ?? options.session.metadata?.path,
            checks: verifyRunChecks
        })
        if (!verifyRun.ok) {
            return {
                kind: 'blocked',
                reason: verifyRun.error
            }
        }
    }

    let snapshot: { mergeBase: string; snapshotRef: string } | null = null
    if (requiresSnapshotMergeVerification(options.workflow)) {
        const snapshotResult = await options.engine.gitCaptureWorktreeMergeSnapshot(options.sessionId, { targetBranch: options.targetBranch })
        if (!snapshotResult.success || !snapshotResult.mergeBase || !snapshotResult.snapshotRef) {
            return {
                kind: 'blocked',
                reason: readableRpcError(snapshotResult)
            }
        }
        snapshot = {
            mergeBase: snapshotResult.mergeBase,
            snapshotRef: snapshotResult.snapshotRef
        }
    }

    let mergeResult: RpcGitMergeWorktreeResponse
    try {
        mergeResult = await options.engine.gitMergeWorktree(options.sessionId, {
            targetBranch: options.targetBranch,
            commitMessage: buildWorktreeMergeCommitMessage(options.task),
            strategy: options.workflow.strategy
        })
    } catch (error) {
        return {
            kind: 'blocked',
            reason: normalizeText(error) || 'Worktree merge failed'
        }
    }

    if (!mergeResult.success) {
        const reason = readableRpcError(mergeResult)
        if (isLikelyMergeConflict(mergeResult)) {
            return {
                kind: 'conflict',
                reason,
                conflictFiles: normalizeConflictFiles(mergeResult.conflictFiles)
            }
        }
        return {
            kind: 'blocked',
            reason
        }
    }

    let targetHead = mergeResult.commitHash ?? null
    if (snapshot) {
        const verifyResult = await options.engine.gitVerifyWorktreeMerge(options.sessionId, {
            targetBranch: options.targetBranch,
            mergeBase: snapshot.mergeBase,
            snapshotRef: snapshot.snapshotRef
        })
        if (!verifyResult.success || verifyResult.verified !== true) {
            return {
                kind: 'blocked',
                reason: readableRpcError(verifyResult)
            }
        }
        targetHead = verifyResult.targetHead ?? targetHead
    }

    return {
        kind: 'success',
        targetHead
    }
}

async function askAgentToRepairAutoMergeConflict(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    task: StoredTask
    sessionId: string
    targetBranch: string
    sourceBranch: string | null
    workflowRootPath: string
    worktreeBasePath?: string | null
    conflictFiles: string[]
    mergeFailureReason: string
    repairAttempt: number
    maxAttempts: number
}): Promise<
    | { ok: true; task: StoredTask }
    | { ok: false; task: StoredTask; reason: string }
> {
    const latest = options.store.messages.getMessages(options.sessionId, 1)
    const afterSeq = latest[0]?.seq ?? 0
    const localId = `${AUTO_MERGE_REPAIR_LOCAL_ID_PREFIX}${options.task.id}:${options.repairAttempt}:${Date.now()}`

    const updated = updateMergeRuntime({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        task: options.task,
        status: 'retrying',
        sessionId: options.sessionId,
        latestNote: `Auto-merge found conflicts; asked the linked agent to repair them (${options.repairAttempt}/${options.maxAttempts}).`,
        blockedReason: null,
        retryCount: options.repairAttempt,
        completedAt: null,
        forceReviewStatus: true
    }) ?? options.task

    const sendMessage = options.engine.sendMessage
    if (typeof sendMessage !== 'function') {
        return {
            ok: false,
            task: updated,
            reason: options.mergeFailureReason
        }
    }

    try {
        await sendMessage.call(options.engine, options.sessionId, {
            text: buildMergeConflictResolutionPrompt({
                task: options.task,
                targetBranch: options.targetBranch,
                sourceBranch: options.sourceBranch,
                rootPath: options.workflowRootPath || null,
                worktreeBasePath: options.worktreeBasePath,
                conflictFiles: options.conflictFiles,
                repairAttempt: options.repairAttempt,
                maxAttempts: options.maxAttempts
            }),
            localId,
            sentFrom: 'webapp'
        })
    } catch (error) {
        return {
            ok: false,
            task: updated,
            reason: normalizeText(error) || 'Failed to send merge conflict repair request'
        }
    }

    let assistantMessage: Awaited<ReturnType<typeof waitForAssistantCompletion>> | null = null
    try {
        assistantMessage = await waitForAssistantCompletion({
            store: options.store,
            engine: options.engine,
            sessionId: options.sessionId,
            namespace: options.namespace,
            afterSeq,
            timeoutMs: AUTO_MERGE_REPAIR_TIMEOUT_MS,
            requireAssistantText: false
        })
    } catch (error) {
        return {
            ok: false,
            task: updated,
            reason: normalizeText(error) || 'Agent merge conflict repair failed unexpectedly'
        }
    }

    if (!assistantMessage) {
        return {
            ok: false,
            task: updated,
            reason: 'Agent merge conflict repair timed out or session became inactive'
        }
    }

    return {
        ok: true,
        task: options.store.tasks.getTaskByNamespace(options.task.id, options.namespace) ?? updated
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
    syncAcceptedGoalTodoToDone({
        store: options.store,
        namespace: options.namespace,
        project: options.project,
        task: updated
    })

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
    preferredSessionId?: string
}): Promise<'not_applicable' | 'merged' | 'blocked'> {
    let task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!task || !isAutoMergeCandidate(task) || !task.activeSessionId) {
        return 'not_applicable'
    }

    const project = options.store.projects.getProjectByNamespace(task.projectId, options.namespace)
    if (!project || project.defaultSessionType !== 'worktree') {
        return 'not_applicable'
    }

    const resolvedSession = resolveAutoMergeTaskSession({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        task,
        preferredSessionId: options.preferredSessionId
    })
    if (!resolvedSession) {
        return 'not_applicable'
    }
    task = resolvedSession.task
    const sessionId = resolvedSession.sessionId
    const session = resolvedSession.session
    const worktree = session.metadata?.worktree
    if (!worktree) {
        return 'not_applicable'
    }

    let runningTask = updateMergeRuntime({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        task,
        status: 'running',
        sessionId,
        latestNote: 'Auto-merge started after evaluator acceptance.',
        startedAt: Date.now(),
        completedAt: null,
        forceReviewStatus: true
    }) ?? task

    const mergeWorkflowLoad = await loadMergeWorkflowFromSession({
        engine: options.engine,
        sessionId,
        session
    })
    if (mergeWorkflowLoad.kind === 'invalid') {
        blockMerge({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: runningTask,
            sessionId,
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
            sessionId,
            reason: 'Target branch not configured'
        })
        return 'blocked'
    }

    let mergeState: RpcGitMergeWorktreeStateResponse
    try {
        mergeState = await options.engine.gitMergeWorktreeState(sessionId, { targetBranch })
    } catch (error) {
        blockMerge({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: runningTask,
            sessionId,
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
                sessionId,
                reason: readableRpcError(mergeState)
            })
            return 'blocked'
        }

        blockMerge({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: runningTask,
            sessionId,
            reason: buildNoCommittedChangesBlockedReason(mergeState)
        })
        return 'blocked'
    }

    const sourceBranch = normalizeBranchName(mergeState.sourceBranch)
        ?? normalizeBranchName(worktree.branch)
    const maxRepairAttempts = resolveMergeConflictResolutionMaxAttempts(workflow)
    let repairsAttempted = runningTask.mergeRuntime?.retryCount ?? 0

    while (true) {
        const attempt = await runAutoMergeAttempt({
            engine: options.engine,
            sessionId,
            session,
            task: runningTask,
            workflow,
            workflowRootPath,
            targetBranch,
            sourceBranch
        })

        if (attempt.kind === 'success') {
            runningTask = options.store.tasks.getTaskByNamespace(task.id, options.namespace) ?? runningTask
            await persistSuccessfulAutoMerge({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                project,
                task: runningTask,
                sessionId,
                targetHead: attempt.targetHead,
                baseCommit: worktree.baseCommit
            })
            return 'merged'
        }

        if (attempt.kind === 'blocked') {
            blockMerge({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                task: runningTask,
                sessionId,
                reason: attempt.reason
            })
            return 'blocked'
        }

        const blockedConflict = findBlockedMergeConflictPath(attempt.conflictFiles, workflow.conflictResolution?.blockPaths)
        if (blockedConflict) {
            blockMerge({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                task: runningTask,
                sessionId,
                reason: `Conflict in blocked path ${blockedConflict}`
            })
            return 'blocked'
        }

        if (resolveMergeConflictResolutionMode(workflow) !== 'ai') {
            blockMerge({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                task: runningTask,
                sessionId,
                reason: attempt.reason
            })
            return 'blocked'
        }

        if (repairsAttempted >= maxRepairAttempts) {
            blockMerge({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                task: runningTask,
                sessionId,
                reason: `Merge conflicts persisted after ${maxRepairAttempts} agent repair attempt(s)`
            })
            return 'blocked'
        }

        const repairAttempt = repairsAttempted + 1
        const repair = await askAgentToRepairAutoMergeConflict({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            task: runningTask,
            sessionId,
            targetBranch,
            sourceBranch,
            workflowRootPath,
            worktreeBasePath: worktree.basePath,
            conflictFiles: attempt.conflictFiles,
            mergeFailureReason: attempt.reason,
            repairAttempt,
            maxAttempts: maxRepairAttempts
        })

        if (!repair.ok) {
            blockMerge({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                task: repair.task,
                sessionId,
                reason: repair.reason
            })
            return 'blocked'
        }

        repairsAttempted = repairAttempt
        runningTask = repair.task
    }
}

export function requestAutoMergeAcceptedTask(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
    preferredSessionId?: string
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
