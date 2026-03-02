import { AgentFlavorSchema, ModelModeSchema, PermissionModeSchema, TaskStatusSchema, TodoItemSchema } from '@hapi/protocol/schemas'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Store } from '../../store'
import { getMergeWorktreeErrorStatus, isLikelyMergeConflict } from '../../sync/mergeConflictDetection'
import type { RpcGitMergeWorktreeResponse, SyncEngine } from '../../sync/syncEngine'
import { waitForAssistantCompletion } from '../../sync/improvementsScan'
import { setSessionTaskLink } from '../../sync/sessionTaskLink'
import { startSessionFromTask } from '../../sync/taskSessionService'
import type { WebAppEnv } from '../middleware/auth'
import { handleTaskMovedToFinished } from './taskFinishAutomation'

const MAX_TASK_ATTACHMENTS_BYTES = 10 * 1024 * 1024
const AUTO_MERGE_CONFLICT_LOCAL_ID_PREFIX = 'auto:merge_conflict_resolve:'
const AUTO_MERGE_CONFLICT_TIMEOUT_MS = 180_000

function estimateDataUrlBytes(dataUrl: string): number {
    const comma = dataUrl.indexOf(',')
    if (comma < 0) return 0
    const base64 = dataUrl.slice(comma + 1)
    const len = base64.length
    if (len === 0) return 0
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
    return Math.floor((len * 3) / 4) - padding
}

const taskAttachmentSchema = z.object({
    id: z.string().min(1),
    filename: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    size: z.number().int().min(0),
    dataUrl: z.string().min(1),
    previewUrl: z.string().optional()
})

const createTaskSchema = z.object({
    title: z.string().min(1).max(255),
    description: z.string().max(200_000).optional(),
    status: TaskStatusSchema.optional(),
    priority: z.enum(['high', 'medium', 'low']).optional(),
    workspaceId: z.string().min(1).optional(),
    agentFlavor: AgentFlavorSchema.optional(),
    permissionMode: PermissionModeSchema.optional(),
    sortKey: z.number().optional(),
    attachments: z.array(taskAttachmentSchema).optional(),
    subTasks: z.array(TodoItemSchema).optional()
})

const updateTaskSchema = z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(200_000).nullable().optional(),
    status: TaskStatusSchema.optional(),
    priority: z.enum(['high', 'medium', 'low']).nullable().optional(),
    workspaceId: z.string().min(1).nullable().optional(),
    agentFlavor: AgentFlavorSchema.nullable().optional(),
    permissionMode: PermissionModeSchema.nullable().optional(),
    sortKey: z.number().nullable().optional(),
    activeSessionId: z.string().min(1).nullable().optional(),
    attachments: z.array(taskAttachmentSchema).optional(),
    subTasks: z.array(TodoItemSchema).optional()
})

const listTasksQuerySchema = z.object({
    includeArchived: z.enum(['true', 'false']).optional()
})

const attachSessionSchema = z.object({
    sessionId: z.string().min(1)
})

const startSessionSchema = z.object({
    workspaceId: z.string().min(1).optional(),
    agent: AgentFlavorSchema.optional(),
    model: z.string().min(1).optional(),
    yolo: z.boolean().optional(),
    permissionMode: PermissionModeSchema.optional(),
    modelMode: ModelModeSchema.optional()
})

const mergeWorktreeSchema = z.object({
    targetBranch: z.string().min(1).optional(),
    conflictStrategy: z.enum(['manual', 'agent']).optional()
})

function shouldAutoResolveMergeConflict(result: {
    error?: string
    conflictFiles?: string[]
    stdout?: string
    stderr?: string
}): boolean {
    return isLikelyMergeConflict(result)
}

function createMergeConflictPrompt(options: {
    taskTitle: string
    sourceBranch: string
    targetBranch: string
    conflictFiles: string[]
}): string {
    const lines = options.conflictFiles.length > 0
        ? options.conflictFiles.slice(0, 80).map((file) => `- ${file}`).join('\n')
        : '- (not provided by git; inspect merge output)'

    return [
        'Merge to target branch failed with conflicts.',
        '',
        'Please resolve this automatically in the CURRENT worktree branch.',
        `Task: ${options.taskTitle}`,
        `Source branch (current worktree): ${options.sourceBranch}`,
        `Target branch to integrate from: ${options.targetBranch}`,
        '',
        'Known conflict files:',
        lines,
        '',
        'Required outcome:',
        '1) Integrate target branch changes into current worktree branch.',
        '2) Resolve conflicts with minimal/safe edits aligned to task intent.',
        '3) Ensure git status is clean and all conflict resolutions are committed.',
        '4) Reply with a brief summary of conflict decisions.',
        '',
        'Important:',
        '- Keep unrelated refactors out.',
        '- If tests are available for touched code, run focused checks before finishing.'
    ].join('\n')
}

type AutoResolveMergeConflictResult =
    | { ok: true; mergeResult: RpcGitMergeWorktreeResponse }
    | {
        ok: false
        status: 409 | 500 | 503 | 504
        error: string
        conflictFiles: string[]
        stdout?: string
        stderr?: string
    }

async function tryAutoResolveMergeConflict(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    sessionId: string
    task: {
        id: string
        title: string
    }
    sourceBranch: string
    targetBranch: string
    commitMessage: string
    conflictFiles: string[]
}): Promise<AutoResolveMergeConflictResult> {
    const latest = options.store.messages.getMessages(options.sessionId, 1)
    const afterSeq = latest[0]?.seq ?? 0
    const localId = `${AUTO_MERGE_CONFLICT_LOCAL_ID_PREFIX}${options.task.id}:${Date.now()}`

    const prompt = createMergeConflictPrompt({
        taskTitle: options.task.title,
        sourceBranch: options.sourceBranch,
        targetBranch: options.targetBranch,
        conflictFiles: options.conflictFiles
    })

    try {
        await options.engine.sendMessage(options.sessionId, {
            text: prompt,
            localId,
            sentFrom: 'webapp'
        })
    } catch (error) {
        const message = formatErrorMessage(error, 'Failed to send merge conflict prompt')
        return {
            ok: false,
            status: resolveMergeExecutionErrorStatus(message),
            error: message,
            conflictFiles: options.conflictFiles
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
            timeoutMs: AUTO_MERGE_CONFLICT_TIMEOUT_MS,
            requireAssistantText: false
        })
    } catch (error) {
        const message = formatErrorMessage(error, 'Agent conflict auto-resolution failed unexpectedly')
        return {
            ok: false,
            status: resolveMergeExecutionErrorStatus(message),
            error: message,
            conflictFiles: options.conflictFiles
        }
    }

    if (!assistantMessage) {
        return {
            ok: false,
            status: 504,
            error: 'Agent conflict auto-resolution timed out or session became inactive',
            conflictFiles: options.conflictFiles
        }
    }

    let autoCommitResult: Awaited<ReturnType<SyncEngine['gitAutocommitWorktree']>>
    try {
        autoCommitResult = await options.engine.gitAutocommitWorktree(options.sessionId, {
            message: options.commitMessage
        })
    } catch (error) {
        const message = formatErrorMessage(error, 'Failed to auto-commit conflict resolution changes')
        return {
            ok: false,
            status: resolveMergeExecutionErrorStatus(message),
            error: message,
            conflictFiles: options.conflictFiles
        }
    }
    if (!autoCommitResult.success) {
        const raw = `${autoCommitResult.error ?? ''}\n${autoCommitResult.stderr ?? ''}`.toLowerCase()
        const status = raw.includes('unmerged') || raw.includes('conflict') ? 409 : 500
        return {
            ok: false,
            status,
            error: autoCommitResult.error ?? 'Failed to auto-commit conflict resolution changes',
            conflictFiles: options.conflictFiles,
            stdout: autoCommitResult.stdout,
            stderr: autoCommitResult.stderr
        }
    }

    let retryResult: RpcGitMergeWorktreeResponse
    try {
        retryResult = await options.engine.gitMergeWorktree(options.sessionId, {
            targetBranch: options.targetBranch,
            commitMessage: options.commitMessage
        })
    } catch (error) {
        const message = formatErrorMessage(error, 'Merge retry failed unexpectedly')
        const status = resolveMergeExecutionErrorStatus(message)
        return {
            ok: false,
            status,
            error: message,
            conflictFiles: options.conflictFiles
        }
    }

    if (!retryResult.success) {
        return {
            ok: false,
            status: getMergeWorktreeErrorStatus(retryResult),
            error: retryResult.error ?? 'Merge failed after agent conflict auto-resolution',
            conflictFiles: retryResult.conflictFiles ?? options.conflictFiles,
            stdout: retryResult.stdout,
            stderr: retryResult.stderr
        }
    }

    return { ok: true, mergeResult: retryResult }
}

function resolveRequestLocale(rawLocale: string | undefined): string | undefined {
    const trimmed = rawLocale?.trim()
    if (!trimmed) {
        return undefined
    }

    return trimmed.split(',')[0]?.split(';')[0]?.trim() || undefined
}

function formatErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
        const message = error.message.trim()
        if (message.length > 0) {
            return message
        }
    }

    if (typeof error === 'string') {
        const message = error.trim()
        if (message.length > 0) {
            return message
        }
    }

    if (error && typeof error === 'object') {
        const maybeMessage = (error as { message?: unknown }).message
        if (typeof maybeMessage === 'string' && maybeMessage.trim().length > 0) {
            return maybeMessage.trim()
        }
        const maybeError = (error as { error?: unknown }).error
        if (typeof maybeError === 'string' && maybeError.trim().length > 0) {
            return maybeError.trim()
        }
    }

    return fallback
}

function pickReadableMergeError(result: {
    error?: string
    stderr?: string
    stdout?: string
}, fallback: string): string {
    const explicit = result.error?.trim()
    if (explicit && !/^command failed: git /i.test(explicit)) {
        return explicit
    }

    const stderr = result.stderr?.trim()
    if (stderr) {
        const first = stderr.split('\n').find((line) => line.trim().length > 0)?.trim()
        if (first) {
            return first
        }
    }

    const stdout = result.stdout?.trim()
    if (stdout) {
        const first = stdout.split('\n').find((line) => line.trim().length > 0)?.trim()
        if (first) {
            return first
        }
    }

    if (explicit) {
        return explicit
    }

    return fallback
}

function resolveMergeExecutionErrorStatus(message: string): 500 | 503 | 504 {
    const lowered = message.toLowerCase()
    if (lowered.includes('timed out') || lowered.includes('timeout')) {
        return 504
    }

    if (
        lowered.includes('rpc handler not registered')
        || lowered.includes('rpc socket disconnected')
        || lowered.includes('runner offline')
        || lowered.includes('not connected')
    ) {
        return 503
    }

    return 500
}

function sumAttachmentBytes(attachments: Array<z.infer<typeof taskAttachmentSchema>>): number {
    let total = 0
    for (const att of attachments) {
        total += Number.isFinite(att.size) ? att.size : 0
    }
    return total
}

function validateAttachments(attachments: Array<z.infer<typeof taskAttachmentSchema>>): { ok: true } | { ok: false; error: string } {
    const total = sumAttachmentBytes(attachments)
    if (total > MAX_TASK_ATTACHMENTS_BYTES) {
        return { ok: false, error: 'Task attachments exceed 10MB total limit' }
    }

    for (const att of attachments) {
        const estimated = estimateDataUrlBytes(att.dataUrl)
        if (att.size > 0 && estimated > 0 && Math.abs(estimated - att.size) > 1024) {
            // Best-effort check only; allow minor mismatch due to encoding/metadata
            continue
        }
    }

    return { ok: true }
}

export function createTasksRoutes(options: {
    store: Store
    getSyncEngine: () => SyncEngine | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/projects/:projectId/tasks', (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const query = listTasksQuerySchema.safeParse(c.req.query())
        const includeArchived = query.success ? query.data.includeArchived === 'true' : false
        const tasks = options.store.tasks.listTasksByProjectAndNamespace(projectId, namespace, { includeArchived })
        return c.json({ tasks })
    })

    app.post('/projects/:projectId/tasks', async (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = createTaskSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const attachments = parsed.data.attachments ?? []
        const attachmentsCheck = validateAttachments(attachments)
        if (!attachmentsCheck.ok) {
            return c.json({ error: attachmentsCheck.error }, 413)
        }

        const taskId = randomUUID()
        const created = options.store.tasks.createTask({
            id: taskId,
            projectId,
            title: parsed.data.title,
            description: parsed.data.description ?? null,
            status: parsed.data.status ?? 'new',
            priority: parsed.data.priority ?? null,
            sortKey: parsed.data.sortKey ?? Date.now(),
            workspaceId: parsed.data.workspaceId ?? null,
            agentFlavor: parsed.data.agentFlavor ?? null,
            permissionMode: parsed.data.permissionMode ?? null,
            attachments: attachments.length > 0 ? attachments : undefined,
            subTasks: parsed.data.subTasks,
            subTasksUpdatedAt: parsed.data.subTasks ? Date.now() : null,
            source: 'manual'
        })

        const engine = options.getSyncEngine()
        engine?.handleRealtimeEvent({ type: 'task-added', taskId, projectId, namespace, data: { taskId } })

        return c.json({ task: created })
    })

    app.get('/tasks/:taskId', (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const task = options.store.tasks.getTaskByNamespace(taskId, namespace)
        if (!task) {
            return c.json({ error: 'Task not found' }, 404)
        }
        return c.json({ task })
    })

    app.patch('/tasks/:taskId', async (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const preferredLocale = resolveRequestLocale(
            c.req.header('x-hapi-locale')
            ?? c.req.header('accept-language')
            ?? undefined
        )
        const existing = options.store.tasks.getTaskByNamespace(taskId, namespace)
        if (!existing) {
            return c.json({ error: 'Task not found' }, 404)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = updateTaskSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const attachments = parsed.data.attachments
        if (attachments) {
            const attachmentsCheck = validateAttachments(attachments)
            if (!attachmentsCheck.ok) {
                return c.json({ error: attachmentsCheck.error }, 413)
            }
        }

        const statusChangingToFinished = parsed.data.status === 'finished' && existing.status !== 'finished'
        const finishedAt = statusChangingToFinished ? Date.now() : undefined

        const updated = options.store.tasks.updateTaskByNamespace(taskId, namespace, {
            title: parsed.data.title,
            description: parsed.data.description,
            status: parsed.data.status,
            priority: parsed.data.priority,
            workspaceId: parsed.data.workspaceId,
            agentFlavor: parsed.data.agentFlavor,
            permissionMode: parsed.data.permissionMode,
            sortKey: parsed.data.sortKey,
            activeSessionId: parsed.data.activeSessionId,
            attachments: attachments,
            subTasks: parsed.data.subTasks,
            subTasksUpdatedAt: parsed.data.subTasks !== undefined ? Date.now() : undefined,
            finishedAt
        })

        if (!updated) {
            return c.json({ error: 'Task not found' }, 404)
        }

        const engine = options.getSyncEngine()
        if (statusChangingToFinished && engine) {
            void handleTaskMovedToFinished({
                store: options.store,
                engine,
                namespace,
                taskId,
                preferredLocale
            })
        }

        engine?.handleRealtimeEvent({
            type: 'task-updated',
            taskId,
            projectId: updated.projectId,
            namespace,
            data: { taskId }
        })

        return c.json({ task: updated })
    })

    app.post('/tasks/:taskId/archive', (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const existing = options.store.tasks.getTaskByNamespace(taskId, namespace)
        if (!existing) {
            return c.json({ error: 'Task not found' }, 404)
        }

        const ok = options.store.tasks.archiveTaskByNamespace(taskId, namespace)
        if (!ok) {
            return c.json({ error: 'Failed to archive task' }, 500)
        }

        const engine = options.getSyncEngine()
        engine?.handleRealtimeEvent({ type: 'task-updated', taskId, projectId: existing.projectId, namespace, data: { taskId, archived: true } })

        return c.json({ ok: true })
    })

    app.delete('/tasks/:taskId', (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const existing = options.store.tasks.getTaskByNamespace(taskId, namespace)
        if (!existing) {
            return c.json({ error: 'Task not found' }, 404)
        }
        if (existing.source !== 'improvements_scan' || existing.status !== 'new') {
            return c.json({ error: 'Only auto-generated new tasks can be rejected' }, 409)
        }

        const ok = options.store.tasks.deleteTaskByNamespace(taskId, namespace)
        if (!ok) {
            return c.json({ error: 'Failed to delete task' }, 500)
        }

        const engine = options.getSyncEngine()
        engine?.handleRealtimeEvent({
            type: 'task-removed',
            taskId,
            projectId: existing.projectId,
            namespace
        })

        return c.json({ ok: true })
    })

    app.post('/tasks/:taskId/attach-session', async (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const task = options.store.tasks.getTaskByNamespace(taskId, namespace)
        if (!task) {
            return c.json({ error: 'Task not found' }, 404)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = attachSessionSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const access = engine.resolveSessionAccess(parsed.data.sessionId, namespace)
        if (!access.ok) {
            return c.json({ error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found' }, access.reason === 'access-denied' ? 403 : 404)
        }

        const updated = options.store.tasks.updateTaskByNamespace(taskId, namespace, {
            activeSessionId: access.sessionId
        })
        if (!updated) {
            return c.json({ error: 'Task not found' }, 404)
        }

        setSessionTaskLink({
            store: options.store,
            engine,
            sessionId: access.sessionId,
            namespace,
            projectId: updated.projectId,
            taskId: updated.id,
            name: updated.title
        })

        engine.handleRealtimeEvent({ type: 'task-updated', taskId, projectId: updated.projectId, namespace, data: { taskId, activeSessionId: access.sessionId } })

        return c.json({ task: updated })
    })

    app.post('/tasks/:taskId/start-session', async (c) => {
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
        const json = await c.req.json().catch(() => null)
        const parsed = startSessionSchema.safeParse(json ?? {})
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const result = await startSessionFromTask({
            store: options.store,
            engine,
            namespace,
            taskId,
            overrides: parsed.data
        })

        if (!result.ok) {
            const status = result.error === 'Task not found'
                ? 404
                : result.error === 'Project not found' || result.error === 'Workspace not found' || result.error === 'Machine not found'
                    ? 404
                    : result.error === 'No workspace selected'
                        ? 400
                        : result.error.startsWith('Runner offline')
                            ? 503
                            : 500
            return c.json({ error: result.error }, status)
        }

        return c.json({ task: result.task, sessionId: result.sessionId })
    })

    app.post('/tasks/:taskId/worktree/merge', async (c) => {
        try {
            const namespace = c.get('namespace')
            const taskId = c.req.param('taskId')
            const preferredLocale = resolveRequestLocale(
                c.req.header('x-hapi-locale')
                ?? c.req.header('accept-language')
                ?? undefined
            )
            const json = await c.req.json().catch(() => null)
            const parsed = mergeWorktreeSchema.safeParse(json ?? {})
            if (!parsed.success) {
                return c.json({ error: 'Invalid body' }, 400)
            }

            const task = options.store.tasks.getTaskByNamespace(taskId, namespace)
            if (!task) {
                return c.json({ error: 'Task not found' }, 404)
            }
            if (task.worktreeMergedAt) {
                return c.json({
                    ok: true,
                    commitHash: task.worktreeMergeCommit ?? null,
                    skippedReason: 'already_merged',
                    mergedAt: task.worktreeMergedAt
                })
            }
            if (!task.activeSessionId) {
                return c.json({ error: 'Task has no active session' }, 400)
            }

            const project = options.store.projects.getProjectByNamespace(task.projectId, namespace)
            if (!project) {
                return c.json({ error: 'Project not found' }, 404)
            }

            const targetBranch = parsed.data.targetBranch
                ?? project.worktreeTargetBranch
                ?? ''
            if (!targetBranch) {
                return c.json({ error: 'Target branch not configured' }, 400)
            }
            const conflictStrategy = parsed.data.conflictStrategy ?? 'agent'

            const engine = options.getSyncEngine()
            if (!engine) {
                return c.json({ error: 'Not connected' }, 503)
            }

            const access = engine.resolveSessionAccess(task.activeSessionId, namespace)
            if (!access.ok) {
                return c.json({ error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found' }, access.reason === 'access-denied' ? 403 : 404)
            }

            const session = access.session
            if (!session.metadata?.worktree) {
                return c.json({ error: 'Session is not a worktree session' }, 400)
            }

            if (session.thinking) {
                return c.json({ error: 'Session is busy' }, 409)
            }

            const commitMessage = `HAPI: task ${task.id.slice(0, 8)} — ${task.title}`.slice(0, 180)
            let result: Awaited<ReturnType<SyncEngine['gitMergeWorktree']>>
            let autoResolved = false
            try {
                result = await engine.gitMergeWorktree(session.id, { targetBranch, commitMessage })
            } catch (error) {
                const message = formatErrorMessage(error, 'Merge failed unexpectedly')
                const status = resolveMergeExecutionErrorStatus(message)
                return c.json({ error: message }, status)
            }

            if (!result.success && conflictStrategy === 'agent' && shouldAutoResolveMergeConflict(result)) {
                let autoResolution: AutoResolveMergeConflictResult
                try {
                    autoResolution = await tryAutoResolveMergeConflict({
                        store: options.store,
                        engine,
                        namespace,
                        sessionId: session.id,
                        task: {
                            id: task.id,
                            title: task.title
                        },
                        sourceBranch: session.metadata.worktree.branch,
                        targetBranch,
                        commitMessage,
                        conflictFiles: result.conflictFiles ?? []
                    })
                } catch (error) {
                    const message = formatErrorMessage(error, 'Agent conflict auto-resolution failed unexpectedly')
                    return c.json({
                        error: message,
                        conflictFiles: result.conflictFiles ?? [],
                        autoResolveAttempted: true
                    }, resolveMergeExecutionErrorStatus(message))
                }

                if (!autoResolution.ok) {
                    const payload: {
                        error: string
                        conflictFiles: string[]
                        autoResolveAttempted: boolean
                        stdout?: string
                        stderr?: string
                    } = {
                        error: autoResolution.error,
                        conflictFiles: autoResolution.conflictFiles,
                        autoResolveAttempted: true
                    }
                    if (autoResolution.status >= 500) {
                        payload.stdout = autoResolution.stdout
                        payload.stderr = autoResolution.stderr
                        console.error('[Tasks] Auto-resolve merge failed with server error status', {
                            taskId,
                            sessionId: session.id,
                            targetBranch,
                            status: autoResolution.status,
                            error: payload.error,
                            stderr: autoResolution.stderr,
                            stdout: autoResolution.stdout
                        })
                    }
                    return c.json(payload, autoResolution.status)
                }

                result = autoResolution.mergeResult
                autoResolved = true
            }

            if (!result.success) {
                const status = getMergeWorktreeErrorStatus(result)
                const payload: {
                    error: string
                    conflictFiles: string[]
                    autoResolveAttempted?: boolean
                    stdout?: string
                    stderr?: string
                } = {
                    error: pickReadableMergeError(result, 'Merge failed'),
                    conflictFiles: result.conflictFiles ?? []
                }
                if (autoResolved) {
                    payload.autoResolveAttempted = true
                }

                if (status >= 500) {
                    payload.stdout = result.stdout
                    payload.stderr = result.stderr
                    console.error('[Tasks] Merge failed with server error status', {
                        taskId,
                        sessionId: session.id,
                        targetBranch,
                        status,
                        error: payload.error,
                        stderr: result.stderr,
                        stdout: result.stdout
                    })
                }

                return c.json(payload, status)
            }

            const mergedAt = Date.now()
            const statusChangingToFinished = task.status === 'in_review'
            const updatedTask = options.store.tasks.updateTaskByNamespace(taskId, namespace, {
                worktreeMergedAt: mergedAt,
                worktreeMergeCommit: result.commitHash ?? null,
                status: statusChangingToFinished ? 'finished' : undefined,
                finishedAt: statusChangingToFinished ? mergedAt : undefined
            })
            if (!updatedTask) {
                return c.json({ error: 'Task not found' }, 404)
            }

            if (statusChangingToFinished) {
                void handleTaskMovedToFinished({
                    store: options.store,
                    engine,
                    namespace,
                    taskId,
                    preferredLocale
                })
            }

            engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId,
                projectId: updatedTask.projectId,
                namespace,
                data: { taskId, worktreeMergedAt: updatedTask.worktreeMergedAt }
            })

            return c.json({
                ok: true,
                commitHash: result.commitHash ?? null,
                skippedReason: result.skippedReason ?? null,
                mergedAt: updatedTask.worktreeMergedAt,
                autoResolved: autoResolved || null
            })
        } catch (error) {
            const message = formatErrorMessage(error, 'Merge failed unexpectedly')
            console.error('[Tasks] Unexpected merge error:', error)
            return c.json({ error: message }, 500)
        }
    })

    return app
}
