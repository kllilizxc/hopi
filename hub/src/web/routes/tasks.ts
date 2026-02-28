import { AgentFlavorSchema, ModelModeSchema, PermissionModeSchema, TaskStatusSchema } from '@hapi/protocol/schemas'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { runImprovementsScan, selectLatestActiveProjectSession } from '../../sync/improvementsScan'
import { setSessionTaskLink } from '../../sync/sessionTaskLink'
import { startSessionFromTask } from '../../sync/taskSessionService'
import type { WebAppEnv } from '../middleware/auth'

const MAX_TASK_ATTACHMENTS_BYTES = 10 * 1024 * 1024

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
    sortKey: z.number().optional(),
    attachments: z.array(taskAttachmentSchema).optional()
})

const updateTaskSchema = z.object({
    title: z.string().min(1).max(255).optional(),
    description: z.string().max(200_000).nullable().optional(),
    status: TaskStatusSchema.optional(),
    priority: z.enum(['high', 'medium', 'low']).nullable().optional(),
    workspaceId: z.string().min(1).nullable().optional(),
    sortKey: z.number().nullable().optional(),
    activeSessionId: z.string().min(1).nullable().optional(),
    attachments: z.array(taskAttachmentSchema).optional()
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
    targetBranch: z.string().min(1).optional()
})

function getMergeWorktreeErrorStatus(result: {
    error?: string
    conflictFiles?: string[]
}): 400 | 409 | 500 | 504 {
    const conflictFiles = result.conflictFiles ?? []
    if (conflictFiles.length > 0) {
        return 409
    }

    const error = (result.error ?? '').toLowerCase()
    if (!error) {
        return 500
    }

    if (error.includes('uncommitted changes') || error.includes('merge conflict')) {
        return 409
    }

    if (error.includes('target branch') && error.includes('not found')) {
        return 400
    }
    if (error.includes('worktree branch') && error.includes('not found')) {
        return 400
    }

    if (error.includes('required')) {
        return 400
    }

    if (error.includes('timed out')) {
        return 504
    }

    return 500
}

async function handleTaskMovedToFinished(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
}): Promise<void> {
    const task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!task || task.status !== 'finished' || task.archivedAt) {
        return
    }

    const project = options.store.projects.getProjectByNamespace(task.projectId, options.namespace)
    if (!project) {
        return
    }

    if (project.improvementsEnabled) {
        const currentGenerated = options.store.tasks.countGeneratedNewTasks(project.id, options.namespace)
        const maxGenerated = project.improvementsMaxGeneratedNew ?? 5
        const remaining = Math.max(0, maxGenerated - currentGenerated)

        if (remaining <= 0) {
            options.engine.handleRealtimeEvent({
                type: 'toast',
                namespace: options.namespace,
                data: {
                    title: 'Improvements scan',
                    body: `Skipped (limit ${maxGenerated} reached)`,
                    sessionId: '',
                    url: ''
                }
            })
        } else {
            const preferredSession = task.activeSessionId
                ? options.engine.getSessionByNamespace(task.activeSessionId, options.namespace)
                : null
            const fallbackSession = selectLatestActiveProjectSession({
                engine: options.engine,
                namespace: options.namespace,
                projectId: project.id
            })
            const targetSessionId = (preferredSession?.active ? preferredSession.id : null)
                ?? (fallbackSession?.active ? fallbackSession.id : null)

            if (!targetSessionId) {
                options.engine.handleRealtimeEvent({
                    type: 'toast',
                    namespace: options.namespace,
                    data: {
                        title: 'Improvements scan',
                        body: 'Skipped (no active session available)',
                        sessionId: '',
                        url: ''
                    }
                })
            } else {
                const result = await runImprovementsScan({
                    store: options.store,
                    engine: options.engine,
                    namespace: options.namespace,
                    project: {
                        id: project.id,
                        name: project.name,
                        improvementsMaxGeneratedNew: maxGenerated
                    },
                    finishedTask: task,
                    targetSessionId,
                    maxToCreate: remaining
                })

                options.store.projects.updateProject(project.id, options.namespace, {
                    lastImprovementsAt: Date.now()
                })

                if (result.ok) {
                    options.engine.handleRealtimeEvent({
                        type: 'toast',
                        namespace: options.namespace,
                        data: {
                            title: 'Improvements scan',
                            body: result.createdTaskIds.length > 0
                                ? `Created ${result.createdTaskIds.length} task(s)`
                                : 'No suggestions',
                            sessionId: '',
                            url: ''
                        }
                    })
                } else {
                    const raw = result.rawAssistantText ? ` Raw: ${result.rawAssistantText.slice(0, 500)}` : ''
                    options.engine.handleRealtimeEvent({
                        type: 'toast',
                        namespace: options.namespace,
                        data: {
                            title: 'Improvements scan failed',
                            body: `${result.error}${raw}`,
                            sessionId: '',
                            url: ''
                        }
                    })
                }
            }
        }
    }

    const latestTask = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!latestTask || latestTask.archivedAt || latestTask.status !== 'finished') {
        return
    }

    if (project.improvementsEnabled) {
        const archived = options.store.tasks.archiveTaskByNamespace(latestTask.id, options.namespace)
        if (archived) {
            options.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: latestTask.id,
                projectId: latestTask.projectId,
                namespace: options.namespace,
                data: { taskId: latestTask.id, archived: true }
            })
        }
    }

    if (latestTask.activeSessionId) {
        try {
            await options.engine.archiveSession(latestTask.activeSessionId)
        } catch {
        }
    }
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
            attachments: attachments.length > 0 ? attachments : undefined,
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
            sortKey: parsed.data.sortKey,
            activeSessionId: parsed.data.activeSessionId,
            attachments: attachments,
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
                taskId
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
        const namespace = c.get('namespace')
        const taskId = c.req.param('taskId')
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
        try {
            result = await engine.gitMergeWorktree(session.id, { targetBranch, commitMessage })
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            const lowered = message.toLowerCase()
            const status = lowered.includes('timed out')
                ? 504
                : lowered.includes('rpc handler not registered') || lowered.includes('rpc socket disconnected')
                    ? 503
                    : 500
            return c.json({ error: message }, status)
        }

        if (!result.success) {
            const status = getMergeWorktreeErrorStatus(result)
            const payload: {
                error: string
                conflictFiles: string[]
                stdout?: string
                stderr?: string
            } = {
                error: result.error ?? 'Merge failed',
                conflictFiles: result.conflictFiles ?? []
            }

            if (status >= 500) {
                payload.stdout = result.stdout
                payload.stderr = result.stderr
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
                taskId
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
            mergedAt: updatedTask.worktreeMergedAt
        })
    })

    return app
}
