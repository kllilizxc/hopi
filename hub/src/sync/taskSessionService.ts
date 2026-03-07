import { isModelModeAllowedForFlavor, isPermissionModeAllowedForFlavor } from '@hopi/protocol'
import { PRODUCT_INIT_SCRIPT_RELATIVE_PATH } from '@hopi/protocol/brand'
import { AgentFlavorSchema, ModelModeSchema, PermissionModeSchema } from '@hopi/protocol/schemas'
import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import { z } from 'zod'
import type { Store, StoredMessage, StoredTask } from '../store'
import type { SyncEngine } from './syncEngine'
import { setSessionTaskLink } from './sessionTaskLink'
import { runInitScriptIfPresent, type ScriptExecutionResult } from './projectScripts'
import { getWorkflowStrategy } from './workflowStrategy'

function dataUrlToBase64(dataUrl: string): string {
    const comma = dataUrl.indexOf(',')
    return comma < 0 ? dataUrl : dataUrl.slice(comma + 1)
}

const KICKOFF_LOCAL_ID_PREFIX = 'auto:kickoff:'
const MESSAGE_HISTORY_PAGE_SIZE = 200

function toRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function stringifyUnknown(value: unknown): string {
    if (typeof value === 'string') return value
    try {
        const serialized = JSON.stringify(value)
        if (typeof serialized === 'string') return serialized
    } catch {
    }
    return String(value)
}

function normalizeText(value: string): string {
    return value.replace(/\r\n/g, '\n').trim()
}

function isLikelyMissingInitScriptFailure(result: ScriptExecutionResult): boolean {
    if (result.ok) {
        return false
    }

    const combined = `${result.error}\n${result.stderr}\n${result.stdout}`.toLowerCase()
    const mentionsInitScript = combined.includes(PRODUCT_INIT_SCRIPT_RELATIVE_PATH.toLowerCase()) || combined.includes('init.sh')
    const isMissingFile = combined.includes('no such file or directory') || combined.includes('cannot open')
    return mentionsInitScript && isMissingFile
}

function collectCodexPlanText(data: Record<string, unknown>): string | null {
    const explanation = typeof data.explanation === 'string' ? normalizeText(data.explanation) : ''
    const entries = Array.isArray(data.entries) ? data.entries : []
    const lines: string[] = []
    for (const entry of entries) {
        const item = toRecord(entry)
        if (!item) continue
        const content = typeof item.content === 'string'
            ? normalizeText(item.content)
            : typeof item.step === 'string'
                ? normalizeText(item.step)
                : typeof item.text === 'string'
                    ? normalizeText(item.text)
                    : ''
        if (!content) continue
        const rawStatus = typeof item.status === 'string' ? item.status.toLowerCase().replace(/[\s_-]/g, '') : ''
        const done = rawStatus === 'completed'
        lines.push(`- [${done ? 'x' : ' '}] ${content}`)
    }

    if (lines.length === 0) {
        return explanation || null
    }
    return explanation
        ? `${explanation}\n${lines.join('\n')}`
        : lines.join('\n')
}

function extractMessageText(content: unknown): string | null {
    if (typeof content === 'string') {
        const normalized = normalizeText(content)
        return normalized || null
    }

    if (Array.isArray(content)) {
        const blocks = content
            .map((item) => extractMessageText(item))
            .filter((text): text is string => Boolean(text))
        if (blocks.length === 0) return null
        return blocks.join('\n')
    }

    const objectContent = toRecord(content)
    if (!objectContent) {
        return null
    }

    if (objectContent.type === 'event') {
        return null
    }

    if (objectContent.type === 'text' && typeof objectContent.text === 'string') {
        const normalized = normalizeText(objectContent.text)
        return normalized || null
    }

    if (objectContent.type === 'output') {
        const data = toRecord(objectContent.data)
        if (!data || data.isMeta || data.isCompactSummary) {
            return null
        }

        if (data.type === 'summary' && typeof data.summary === 'string') {
            const normalized = normalizeText(data.summary)
            return normalized || null
        }

        if (data.type === 'assistant' || data.type === 'user') {
            const message = toRecord(data.message)
            if (message) {
                return extractMessageText(message.content)
            }
        }
    }

    if (objectContent.type === 'codex') {
        const data = toRecord(objectContent.data)
        if (!data) {
            return null
        }

        if ((data.type === 'message' || data.type === 'reasoning') && typeof data.message === 'string') {
            const normalized = normalizeText(data.message)
            return normalized || null
        }

        if (data.type === 'plan') {
            return collectCodexPlanText(data)
        }

        if (data.type === 'tool-call-result') {
            return extractMessageText(data.output)
        }
    }

    if (typeof objectContent.text === 'string') {
        const normalized = normalizeText(objectContent.text)
        if (normalized) return normalized
    }

    if ('content' in objectContent) {
        const fromContent = extractMessageText(objectContent.content)
        if (fromContent) return fromContent
    }

    if ('message' in objectContent) {
        const fromMessage = extractMessageText(objectContent.message)
        if (fromMessage) return fromMessage
    }

    const fallback = normalizeText(stringifyUnknown(content))
    return fallback || null
}

function getCarryoverMessages(store: Store, previousSessionId: string): StoredMessage[] {
    const pages: StoredMessage[][] = []
    let beforeSeq: number | undefined

    while (true) {
        const page = store.messages.getMessages(previousSessionId, MESSAGE_HISTORY_PAGE_SIZE, beforeSeq)
        if (page.length === 0) {
            break
        }

        pages.push(page)
        const oldestSeq = page[0]?.seq
        if (page.length < MESSAGE_HISTORY_PAGE_SIZE || typeof oldestSeq !== 'number' || oldestSeq <= 1) {
            break
        }
        beforeSeq = oldestSeq
    }

    const messages: StoredMessage[] = []
    for (let index = pages.length - 1; index >= 0; index -= 1) {
        messages.push(...pages[index])
    }
    return messages
}

function buildCarryoverHistorySection(store: Store, previousSessionId: string): string {
    const messages = getCarryoverMessages(store, previousSessionId)
    const lines: string[] = []

    for (const message of messages) {
        if (message.localId?.startsWith(KICKOFF_LOCAL_ID_PREFIX)) {
            continue
        }

        const record = unwrapRoleWrappedRecordEnvelope(message.content)
        const role = record?.role
        const roleLabel = role === 'user'
            ? 'User'
            : role === 'assistant' || role === 'agent'
                ? 'Assistant'
                : 'Message'
        const sourceContent = record ? record.content : message.content
        const text = extractMessageText(sourceContent)
        if (!text) continue
        lines.push(`${roleLabel}:\n${text}`)
    }

    if (lines.length === 0) {
        return ''
    }

    return `\n\nPrevious session messages:\n${lines.join('\n\n')}`
}

export type StartSessionOverrides = {
    workspaceId?: string
    agent?: z.infer<typeof AgentFlavorSchema>
    model?: string
    yolo?: boolean
    permissionMode?: z.infer<typeof PermissionModeSchema>
    modelMode?: z.infer<typeof ModelModeSchema>
}

export type StartSessionKickoffOptions =
    | { kind?: 'default' }
    | { kind: 'skip' }
    | {
        kind: 'custom'
        text: string
        localId?: string
        includeCarryoverHistory?: boolean
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

function resolveWorktreeWorkspacePaths(projectWorkspacePaths: string[], primaryPath: string): string[] | undefined {
    const normalizedPrimaryPath = primaryPath.trim()
    if (!normalizedPrimaryPath) {
        return undefined
    }

    const normalizedPaths = projectWorkspacePaths
        .map((path) => path.trim())
        .filter((path) => path.length > 0)

    if (normalizedPaths.length <= 1) {
        return undefined
    }

    const deduped = Array.from(new Set([normalizedPrimaryPath, ...normalizedPaths]))
    return deduped.length > 1 ? deduped : undefined
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
    kickoff?: StartSessionKickoffOptions
}): Promise<StartTaskSessionResult> {
    const overrides = options.overrides ?? {}
    const kickoff = options.kickoff ?? { kind: 'default' }

    const task = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (!task) {
        return { ok: false, error: 'Task not found' }
    }
    const previousSessionId = task.activeSessionId

    const project = options.store.projects.getProjectByNamespace(task.projectId, options.namespace)
    if (!project) {
        return { ok: false, error: 'Project not found' }
    }
    const projectWorkspaces = options.store.workspaces.listWorkspacesByProject(project.id)

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
        ?? (task.modelMode as z.infer<typeof ModelModeSchema> | null)
        ?? (project.defaultModelMode as z.infer<typeof ModelModeSchema> | null)
        ?? undefined
    const inferredYolo = permissionMode === 'yolo' && isPermissionModeAllowedForFlavor(permissionMode, agent)
    const yolo = overrides.yolo ?? inferredYolo

    const sessionType = project.defaultSessionType === 'worktree' ? 'worktree' : 'simple'
    const worktreeName = sessionType === 'worktree'
        ? `task-${task.id.slice(0, 8)}-${task.title}`.slice(0, 80)
        : undefined
    const worktreeWorkspacePaths = sessionType === 'worktree'
        ? resolveWorktreeWorkspacePaths(projectWorkspaces.map((item) => item.path), workspace.path)
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
            error: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start'
        }
    }

    const spawn = await options.engine.spawnSession(
        project.machineId,
        workspace.path,
        agent,
        model,
        yolo,
        sessionType,
        worktreeName,
        undefined,
        worktreeWorkspacePaths
    )
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

    const engineWithSessionLookup = options.engine as unknown as {
        getSessionByNamespace?: (sessionId: string, namespace: string) => { metadata?: { path?: unknown } } | undefined
    }
    const runtimeSession = typeof engineWithSessionLookup.getSessionByNamespace === 'function'
        ? engineWithSessionLookup.getSessionByNamespace.call(options.engine, spawn.sessionId, options.namespace)
        : undefined
    const runtimePath = typeof runtimeSession?.metadata?.path === 'string'
        ? runtimeSession.metadata.path.trim()
        : ''
    const initScriptCwdCandidates = Array.from(new Set([
        runtimePath.trim(),
        workspace.path.trim()
    ].filter((value) => value.length > 0)))

    let initScript: ScriptExecutionResult = {
        ok: true as const,
        executed: false,
        stdout: '',
        stderr: ''
    }

    for (const scriptCwd of initScriptCwdCandidates) {
        const result = await runInitScriptIfPresent({
            engine: options.engine,
            sessionId: spawn.sessionId,
            cwd: scriptCwd,
            taskId: task.id,
            projectId: project.id
        })
        if (!result.ok && isLikelyMissingInitScriptFailure(result)) {
            initScript = {
                ok: true,
                executed: false,
                stdout: result.stdout,
                stderr: result.stderr
            }
            continue
        }

        initScript = result
        if (!result.ok || result.executed) {
            break
        }
    }

    if (!initScript.ok) {
        try {
            await options.engine.archiveSession(spawn.sessionId)
        } catch {
        }
        return {
            ok: false,
            error: `${PRODUCT_INIT_SCRIPT_RELATIVE_PATH} failed: ${initScript.error}`
        }
    }
    const workflowStrategy = getWorkflowStrategy(task)
    const workflowPatch = workflowStrategy.getTaskPatchForTransition('session_started', task) ?? { status: 'in_progress' }

    const updatedTask = options.store.tasks.updateTaskByNamespace(options.taskId, options.namespace, {
        activeSessionId: spawn.sessionId,
        status: workflowPatch.status ?? 'in_progress',
        workflowPhase: workflowPatch.workflowPhase,
        source: task.source === 'improvements_scan' ? 'manual' : undefined
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

    const shouldSendKickoffMessage = kickoff.kind !== 'skip'
    const uploadedAttachments: Array<{
        id: string
        filename: string
        mimeType: string
        size: number
        path: string
        previewUrl?: string
    }> = []

    if (shouldSendKickoffMessage) {
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
            if (kickoff.kind === 'custom') {
                const baseKickoff = normalizeText(kickoff.text)
                if (!baseKickoff) {
                    return ''
                }
                if (!kickoff.includeCarryoverHistory || !previousSessionId || previousSessionId === spawn.sessionId) {
                    return baseKickoff
                }
                const historySection = buildCarryoverHistorySection(options.store, previousSessionId)
                return `${baseKickoff}${historySection}`
            }

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

            const baseKickoff = (() => {
                if (title && desc) {
                    return `Task: ${title}\n\nDescription:\n${desc}${subTasksSection}`
                }
                if (desc) return `${desc}${subTasksSection}`
                if (title) return `Task: ${title}${subTasksSection}`
                if (subTasksSection) return `Task${subTasksSection}`
                return 'Task'
            })()

            if (!previousSessionId || previousSessionId === spawn.sessionId) {
                return baseKickoff
            }

            const historySection = buildCarryoverHistorySection(options.store, previousSessionId)
            return `${baseKickoff}${historySection}`
        })()

        if (kickoffText) {
            const kickoffWithInitNotice = initScript.executed
                ? `${kickoffText}\n\nSystem note: Ran \`${PRODUCT_INIT_SCRIPT_RELATIVE_PATH}\` successfully before this prompt.`
                : kickoffText

            try {
                await options.engine.sendMessage(spawn.sessionId, {
                    text: kickoffWithInitNotice,
                    localId: kickoff.kind === 'custom' && kickoff.localId
                        ? kickoff.localId
                        : `auto:kickoff:${updatedTask.id}:${Date.now()}`,
                    attachments: uploadedAttachments,
                    sentFrom: 'webapp'
                })
            } catch {
            }
        }
    }

    return { ok: true, task: updatedTask, sessionId: spawn.sessionId }
}
