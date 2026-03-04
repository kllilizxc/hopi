import { isModelModeAllowedForFlavor, isPermissionModeAllowedForFlavor } from '@hapi/protocol'
import { AgentFlavorSchema, ModelModeSchema, PermissionModeSchema } from '@hapi/protocol/schemas'
import { z } from 'zod'
import type { Store, StoredTask } from '../store'
import type { SyncEngine } from './syncEngine'
import { setSessionTaskLink } from './sessionTaskLink'

function dataUrlToBase64(dataUrl: string): string {
    const comma = dataUrl.indexOf(',')
    return comma < 0 ? dataUrl : dataUrl.slice(comma + 1)
}

export type StartSessionOverrides = {
    workspaceId?: string
    agent?: z.infer<typeof AgentFlavorSchema>
    model?: string
    yolo?: boolean
    permissionMode?: z.infer<typeof PermissionModeSchema>
    modelMode?: z.infer<typeof ModelModeSchema>
}

type SessionConfigPatch = {
    permissionMode?: z.infer<typeof PermissionModeSchema>
    modelMode?: z.infer<typeof ModelModeSchema>
    collaborationMode?: string
}

const SESSION_CONFIG_APPLY_ATTEMPTS = 8
const SESSION_CONFIG_APPLY_RETRY_DELAY_MS = 250

function shouldRetrySessionConfigApply(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error)
    return message.startsWith('RPC handler not registered:') || message.startsWith('RPC socket disconnected:')
}

async function applySessionConfigWithRetry(options: {
    engine: SyncEngine
    sessionId: string
    patch: SessionConfigPatch
}): Promise<void> {
    for (let attempt = 1; attempt <= SESSION_CONFIG_APPLY_ATTEMPTS; attempt += 1) {
        try {
            await options.engine.applySessionConfig(options.sessionId, options.patch)
            return
        } catch (error) {
            if (!shouldRetrySessionConfigApply(error) || attempt >= SESSION_CONFIG_APPLY_ATTEMPTS) {
                return
            }
            await new Promise((resolve) => setTimeout(resolve, SESSION_CONFIG_APPLY_RETRY_DELAY_MS))
        }
    }
}

export type StartTaskSessionResult =
    | { ok: true; task: StoredTask; sessionId: string }
    | { ok: false; error: string }

export async function startSessionFromTask(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
    overrides?: StartSessionOverrides
}): Promise<StartTaskSessionResult> {
    const overrides = options.overrides ?? {}

    const task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!task) {
        return { ok: false, error: 'Task not found' }
    }

    const project = options.store.projects.getProjectByNamespace(task.projectId, options.namespace)
    if (!project) {
        return { ok: false, error: 'Project not found' }
    }

    const resolvedWorkspaceId = overrides.workspaceId
        ?? task.workspaceId
        ?? project.defaultWorkspaceId

    if (!resolvedWorkspaceId) {
        return { ok: false, error: 'No workspace selected' }
    }

    const workspace = options.store.workspaces.getWorkspace(resolvedWorkspaceId)
    if (!workspace || workspace.projectId !== project.id) {
        return { ok: false, error: 'Workspace not found' }
    }

    const agent = overrides.agent
        ?? (task.agentFlavor as z.infer<typeof AgentFlavorSchema> | undefined)
        ?? (project.defaultAgentFlavor as z.infer<typeof AgentFlavorSchema> | undefined)
        ?? 'claude'

    const model = (() => {
        if (overrides.model && overrides.model !== 'auto') {
            return overrides.model
        }
        if (task.modelMode && task.modelMode !== 'default') {
            return task.modelMode
        }
        if (agent === 'claude' && project.defaultModelMode && project.defaultModelMode !== 'default') {
            return project.defaultModelMode
        }
        return undefined
    })()

    const permissionMode = overrides.permissionMode
        ?? (task.permissionMode as z.infer<typeof PermissionModeSchema> | null)
        ?? (project.defaultPermissionMode as z.infer<typeof PermissionModeSchema> | null)
        ?? undefined
    const modelMode = overrides.modelMode
        ?? (project.defaultModelMode as z.infer<typeof ModelModeSchema> | null)
        ?? undefined
    const inferredYolo = permissionMode === 'yolo' && isPermissionModeAllowedForFlavor(permissionMode, agent)
    const yolo = overrides.yolo ?? inferredYolo

    const sessionType = project.defaultSessionType === 'worktree' ? 'worktree' : 'simple'
    const worktreeName = sessionType === 'worktree'
        ? `task-${task.id.slice(0, 8)}-${task.title}`.slice(0, 80)
        : undefined

    const machine = options.engine.getMachineByNamespace(project.machineId, options.namespace)
    if (!machine) {
        return { ok: false, error: 'Machine not found' }
    }

    const runnerSeemsOnline = machine.active || (() => {
        if (!machine.runnerState || typeof machine.runnerState !== 'object') {
            return false
        }
        const status = (machine.runnerState as Record<string, unknown>).status
        return status === 'running'
    })()

    if (!runnerSeemsOnline) {
        return {
            ok: false,
            error: 'Runner offline or not connected. Start it on the machine and try again: hapi runner start'
        }
    }

    const spawn = await options.engine.spawnSession(project.machineId, workspace.path, agent, model, yolo, sessionType, worktreeName)
    if (spawn.type !== 'success') {
        return { ok: false, error: spawn.message }
    }

    const becameActive = await options.engine.waitForSessionActive(spawn.sessionId, 20_000)
    if (!becameActive) {
        return { ok: false, error: 'Session failed to become active' }
    }
    setSessionTaskLink({
        store: options.store,
        engine: options.engine,
        sessionId: spawn.sessionId,
        namespace: options.namespace,
        projectId: project.id,
        taskId: task.id,
        name: task.title
    })

    const sessionConfigPatch: SessionConfigPatch = {}
    if (permissionMode === 'plan' && agent === 'codex') {
        sessionConfigPatch.collaborationMode = 'plan'
    } else if (permissionMode && isPermissionModeAllowedForFlavor(permissionMode, agent)) {
        sessionConfigPatch.permissionMode = permissionMode
    }
    if (Object.keys(sessionConfigPatch).length > 0) {
        await applySessionConfigWithRetry({
            engine: options.engine,
            sessionId: spawn.sessionId,
            patch: sessionConfigPatch
        })
    }
    if (modelMode && isModelModeAllowedForFlavor(modelMode, agent)) {
        await applySessionConfigWithRetry({
            engine: options.engine,
            sessionId: spawn.sessionId,
            patch: { modelMode }
        })
    }

    const updatedTask = options.store.tasks.updateTaskByNamespace(options.taskId, options.namespace, {
        activeSessionId: spawn.sessionId,
        status: 'in_progress'
    })
    if (!updatedTask) {
        return { ok: false, error: 'Task not found' }
    }

    // Broadcast immediately after status/link persistence so UI does not wait on
    // attachment upload or kickoff message delivery.
    options.engine.handleRealtimeEvent({
        type: 'task-updated',
        taskId: updatedTask.id,
        projectId: updatedTask.projectId,
        namespace: options.namespace,
        data: { taskId: updatedTask.id, activeSessionId: spawn.sessionId }
    })

    const uploadedAttachments: Array<{
        id: string
        filename: string
        mimeType: string
        size: number
        path: string
        previewUrl?: string
    }> = []

    const attachments = Array.isArray(updatedTask.attachments) ? updatedTask.attachments as Array<{
        id: string
        filename: string
        mimeType: string
        size: number
        dataUrl: string
        previewUrl?: string
    }> : []

    for (const attachment of attachments) {
        const base64 = dataUrlToBase64(attachment.dataUrl)
        try {
            const result = await options.engine.uploadFile(spawn.sessionId, attachment.filename, base64, attachment.mimeType)
            if (result && result.success && result.path) {
                uploadedAttachments.push({
                    id: attachment.id,
                    filename: attachment.filename,
                    mimeType: attachment.mimeType,
                    size: attachment.size,
                    path: result.path,
                    previewUrl: attachment.previewUrl
                })
            }
        } catch {
        }
    }

    const kickoffText = (() => {
        const title = (updatedTask.title ?? '').trim()
        const desc = (updatedTask.description ?? '').trim()
        const subTasks = Array.isArray(updatedTask.subTasks)
            ? updatedTask.subTasks as Array<{
                content?: unknown
                status?: unknown
            }>
            : []
        const subTaskLines = subTasks
            .map((subTask) => {
                const content = typeof subTask.content === 'string' ? subTask.content.trim() : ''
                if (!content) return null
                const done = subTask.status === 'completed'
                return `- [${done ? 'x' : ' '}] ${content}`
            })
            .filter((line): line is string => Boolean(line))
        const subTasksSection = subTaskLines.length > 0
            ? `\n\nSubtasks:\n${subTaskLines.join('\n')}`
            : ''

        if (title && desc) {
            return `Task: ${title}\n\nDescription:\n${desc}${subTasksSection}`
        }
        if (desc) return `${desc}${subTasksSection}`
        if (title) return `Task: ${title}${subTasksSection}`
        if (subTasksSection) return `Task${subTasksSection}`
        return 'Task'
    })()

    try {
        await options.engine.sendMessage(spawn.sessionId, {
            text: kickoffText,
            localId: `auto:kickoff:${updatedTask.id}:${Date.now()}`,
            attachments: uploadedAttachments,
            sentFrom: 'webapp'
        })
    } catch {
    }

    return { ok: true, task: updatedTask, sessionId: spawn.sessionId }
}
