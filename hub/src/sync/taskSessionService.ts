import { createHash } from 'node:crypto'
import { isModelModeAllowedForFlavor, isPermissionModeAllowedForFlavor, normalizeModelName, resolveClaudeModelMode, resolveStoredModel } from '@hopi/protocol'
import { PRODUCT_INIT_SCRIPT_RELATIVE_PATH } from '@hopi/protocol/brand'
import { AgentFlavorSchema, ModelModeSchema, PermissionModeSchema } from '@hopi/protocol/schemas'
import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import { z } from 'zod'
import type { Store, StoredMessage, StoredTask } from '../store'
import {
    buildRepeatedTaskActionFailureNote,
    buildTaskActionCommandReportLines,
    trimTaskActionOutput,
    waitForSessionToBecomeRunnable
} from '../utils/taskActionFlow'
import { buildTaskInitRuntime as buildSharedTaskInitRuntime } from '../utils/taskActionRuntime'
import type { SyncEngine } from './syncEngine'
import { setSessionTaskLink } from './sessionTaskLink'
import { buildInitScriptCommand, runInitScriptIfPresent, type ScriptExecutionResult } from './projectScripts'
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

function formatErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error) {
        const normalized = normalizeText(error.message)
        if (normalized) {
            return normalized
        }
    }
    const message = normalizeText(stringifyUnknown(error))
    return message || fallback
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

type TaskInitRuntimeStatus = NonNullable<StoredTask['initRuntime']>['status']

const AUTO_INIT_SETUP_LOCAL_ID_PREFIX = 'auto:init_setup:'
const INIT_REPAIR_WAIT_TIMEOUT_MS = 120_000
const INIT_REPAIR_POLL_INTERVAL_MS = 250
const INIT_REPAIR_MANUAL_STEP = 'Inspect the linked session tool output, fix `.hopi/init.sh` or workspace blockers, then retry task start.'
const INIT_SESSION_MANUAL_STEP = 'Restart or relink the task session inside the workspace, then retry task start.'
const INIT_WAIT_MANUAL_STEP = 'Wait for the linked session to become idle, then retry task start.'
const INIT_SESSION_INACTIVE_BLOCKED_REASON = 'Linked session became inactive before init retry could run.'
const INIT_WAIT_TIMEOUT_BLOCKED_REASON = 'Init retry stayed queued because the linked session never became idle.'

async function waitForSessionToBecomeInitRunnable(options: {
    engine: SyncEngine
    sessionId: string
    namespace: string
    timeoutMs: number
}): Promise<'ready' | 'session_inactive' | 'timeout'> {
    return waitForSessionToBecomeRunnable({
        ...options,
        pollIntervalMs: INIT_REPAIR_POLL_INTERVAL_MS
    })
}

function emitSessionMessageReceivedEvent(options: {
    engine: SyncEngine
    sessionId: string
    message: {
        id: string
        seq: number
        localId: string | null
        content: unknown
        createdAt: number
    }
}): void {
    const handler = options.engine.handleRealtimeEvent

    if (typeof handler !== 'function') {
        return
    }

    handler.call(options.engine, {
        type: 'message-received',
        sessionId: options.sessionId,
        message: options.message
    })
}

function appendAssistantTextMessage(options: {
    store: Store
    engine: SyncEngine
    sessionId: string
    text: string
    localId?: string
}): void {
    const message = options.store.messages.addMessage(options.sessionId, {
        role: 'assistant',
        content: {
            type: 'text',
            text: options.text
        },
        meta: {
            sentFrom: 'webapp'
        }
    }, options.localId)

    emitSessionMessageReceivedEvent({
        engine: options.engine,
        sessionId: options.sessionId,
        message: {
            id: message.id,
            seq: message.seq,
            localId: message.localId,
            content: message.content,
            createdAt: message.createdAt
        }
    })
}

function trimInitCommandOutput(output: string | undefined, maxChars: number): string | null {
    return trimTaskActionOutput(output, maxChars)
}

function buildInitCommandReportLines(options: {
    command: string
    summary: string
    stdout?: string
    stderr?: string
    maxChars: number
}): string[] {
    return buildTaskActionCommandReportLines(options)
}

function buildTaskKickoffSummary(task: Pick<StoredTask, 'title' | 'description' | 'subTasks'>): string {
    const title = (task.title ?? '').trim()
    const description = (task.description ?? '').trim()
    const subTasks = Array.isArray(task.subTasks)
        ? task.subTasks as Array<{ content?: unknown; status?: unknown }>
        : []
    const subTaskLines = subTasks
        .map((subTask) => {
            const content = typeof subTask.content === 'string' ? subTask.content.trim() : ''
            if (!content) {
                return null
            }
            const done = subTask.status === 'completed'
            return `- [${done ? 'x' : ' '}] ${content}`
        })
        .filter((line): line is string => Boolean(line))
    const subTasksSection = subTaskLines.length > 0
        ? `\n\nSubtasks:\n${subTaskLines.join('\n')}`
        : ''

    if (title && description) {
        return `Task: ${title}\n\nDescription:\n${description}${subTasksSection}`
    }
    if (description) {
        return `${description}${subTasksSection}`
    }
    if (title) {
        return `Task: ${title}${subTasksSection}`
    }
    if (subTasksSection) {
        return `Task${subTasksSection}`
    }
    return 'Task'
}

function buildInitScriptResultMessage(options: {
    rootPath: string
    command: string
    summary: string
    stdout?: string
    stderr?: string
    attempt: 'initial' | 'retry'
    success: boolean
}): string {
    const header = options.attempt === 'retry'
        ? options.success
            ? `HOPI re-ran \`${PRODUCT_INIT_SCRIPT_RELATIVE_PATH}\` after in-session repair.`
            : `HOPI re-ran \`${PRODUCT_INIT_SCRIPT_RELATIVE_PATH}\` after in-session repair, but init still failed.`
        : options.success
            ? `HOPI auto-ran \`${PRODUCT_INIT_SCRIPT_RELATIVE_PATH}\` while starting the task session.`
            : `HOPI auto-ran \`${PRODUCT_INIT_SCRIPT_RELATIVE_PATH}\` before switching to same-session init repair.`

    return [
        header,
        '',
        `Working directory: ${options.rootPath}`,
        ...buildInitCommandReportLines({
            command: options.command,
            summary: options.summary,
            stdout: options.stdout,
            stderr: options.stderr,
            maxChars: 8_000
        })
    ].join('\n')
}

function buildInitScriptRepairPrompt(options: {
    task: Pick<StoredTask, 'id' | 'title' | 'description' | 'subTasks'>
    rootPath: string
    command: string
    summary: string
    stdout?: string
    stderr?: string
}): string {
    return [
        'Task session started, but direct init failed before normal kickoff.',
        '',
        `Task: ${options.task.title}`,
        `Task id: ${options.task.id}`,
        `Working directory: ${options.rootPath}`,
        '',
        'Direct CLI result:',
        ...buildInitCommandReportLines({
            command: options.command,
            summary: options.summary,
            stdout: options.stdout,
            stderr: options.stderr,
            maxChars: 4_000
        }),
        '',
        'Repair loop:',
        '- Inspect the current workspace state before editing anything.',
        '- Fix `.hopi/init.sh` or the real workspace blocker inside the sandbox.',
        '- Re-run the init command after repairs:',
        `  \`${options.command}\``,
        '- Keep important stdout/stderr in the thread.',
        '- Stop only for missing external access or other out-of-sandbox blockers; if blocked, name the blocker, last failing command, and next manual step.',
        '',
        'After init is stable, continue with the main task:',
        buildTaskKickoffSummary(options.task),
        '',
        'Reply with a short summary of the repair result or blocker.'
    ].join('\n')
}

function buildRepeatedInitFailureNote(options: {
    blockedReason: string
    manualStep: string
}): string {
    return buildRepeatedTaskActionFailureNote(options)
}

function buildBlockedInitRuntimeState(options: {
    task: Pick<StoredTask, 'initRuntime'>
    note: string
    blockedReason: string
    failureFingerprint: string
    manualStep: string
}): {
    latestNote: string
    blockedReason: string
    failureFingerprint: string
} {
    const repeated = options.task.initRuntime?.failureFingerprint === options.failureFingerprint

    return {
        latestNote: repeated
            ? buildRepeatedInitFailureNote({
                blockedReason: options.blockedReason,
                manualStep: options.manualStep
            })
            : options.note,
        blockedReason: options.blockedReason,
        failureFingerprint: options.failureFingerprint
    }
}

function getNextInitRepairAttemptRetryCount(task: Pick<StoredTask, 'initRuntime'>): number {
    return (task.initRuntime?.retryCount ?? 0) + 1
}

function buildTaskInitFailureFingerprint(options: {
    reason: string
    blockedReason: string
    initScriptCwd?: string
    initScript?: {
        error?: string | null
        stdout?: string
        stderr?: string
    } | null
}): string {
    const digest = createHash('sha1').update(JSON.stringify({
        reason: options.reason,
        blockedReason: options.blockedReason,
        initScriptCwd: options.initScriptCwd ?? null,
        initScript: options.initScript
            ? {
                error: options.initScript.error ?? null,
                stdout: trimInitCommandOutput(options.initScript.stdout, 512),
                stderr: trimInitCommandOutput(options.initScript.stderr, 512)
            }
            : null
    })).digest('hex').slice(0, 12)

    return `init:${digest}`
}

function buildTaskInitRuntime(options: {
    task: Pick<StoredTask, 'activeSessionId' | 'initRuntime'>
    status: TaskInitRuntimeStatus
    sessionId?: string | null
    retryCount?: number
    failureFingerprint?: string | null
    latestNote?: string | null
    blockedReason?: string | null
    startedAt?: number | null
    completedAt?: number | null
}): NonNullable<StoredTask['initRuntime']> {
    return buildSharedTaskInitRuntime({
        current: options.task.initRuntime,
        activeSessionId: options.task.activeSessionId,
        status: options.status,
        sessionId: options.sessionId,
        retryCount: options.retryCount,
        failureFingerprint: options.failureFingerprint,
        latestNote: options.latestNote,
        blockedReason: options.blockedReason,
        startedAt: options.startedAt,
        completedAt: options.completedAt
    })
}

export type StartTaskSessionResult =
    | {
        ok: true
        task: StoredTask
        sessionId: string
        initRecoveryAttempted?: boolean
        initRecoveryError?: string
    }
    | { ok: false; error: string }


async function startSessionFromTaskInternal(options: {
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

    const overrideModel = normalizeModelName(overrides.model)
    const taskModel = resolveStoredModel(task.model, task.modelMode)
    const projectDefaultModel = resolveStoredModel(project.defaultModel, project.defaultModelMode)
    const model = overrideModel ?? taskModel ?? projectDefaultModel ?? undefined

    const permissionMode = overrides.permissionMode
        ?? (task.permissionMode as z.infer<typeof PermissionModeSchema> | null)
        ?? (project.defaultPermissionMode as z.infer<typeof PermissionModeSchema> | null)
        ?? undefined
    const modelMode = (() => {
        if (overrides.modelMode !== undefined) {
            return overrides.modelMode
        }
        if (overrideModel !== null) {
            return agent === 'claude' ? resolveClaudeModelMode(overrideModel) ?? undefined : undefined
        }
        if (agent !== 'claude') {
            return undefined
        }
        if (taskModel !== null) {
            return (task.modelMode as z.infer<typeof ModelModeSchema> | null)
                ?? resolveClaudeModelMode(taskModel)
                ?? undefined
        }
        if (projectDefaultModel !== null) {
            return (project.defaultModelMode as z.infer<typeof ModelModeSchema> | null)
                ?? resolveClaudeModelMode(projectDefaultModel)
                ?? undefined
        }
        return (task.modelMode as z.infer<typeof ModelModeSchema> | null)
            ?? (project.defaultModelMode as z.infer<typeof ModelModeSchema> | null)
            ?? undefined
    })()
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

    const runInitAttempt = async (): Promise<{ initScript: ScriptExecutionResult; initScriptCwd: string }> => {
        let initScript: ScriptExecutionResult = {
            ok: true as const,
            executed: false,
            stdout: '',
            stderr: ''
        }
        let initScriptCwd = initScriptCwdCandidates[0] ?? workspace.path

        for (const scriptCwd of initScriptCwdCandidates) {
            initScriptCwd = scriptCwd
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

        return { initScript, initScriptCwd }
    }

    const workflowStrategy = getWorkflowStrategy(task)
    const workflowPatch = workflowStrategy.getTaskPatchForTransition('session_started', task) ?? { status: 'in_progress' }
    let runtimeTask = task

    const emitStartedTaskUpdate = (updatedTask: StoredTask): void => {
        options.engine.handleRealtimeEvent({
            type: 'task-updated',
            taskId: updatedTask.id,
            projectId: updatedTask.projectId,
            namespace: options.namespace,
            data: {
                taskId: updatedTask.id,
                activeSessionId: updatedTask.activeSessionId,
                initRuntime: updatedTask.initRuntime
            }
        })
    }

    const updateStartedTask = (patch?: {
        activeSessionId?: string | null
        status?: string
        workflowPhase?: string | null
        source?: string | null
        initRuntime?: StoredTask['initRuntime'] | null
    }): StoredTask | null => {
        const updatedTask = options.store.tasks.updateTaskByNamespace(options.taskId, options.namespace, {
            activeSessionId: patch?.activeSessionId !== undefined ? patch.activeSessionId : spawn.sessionId,
            status: patch?.status ?? workflowPatch.status ?? 'in_progress',
            workflowPhase: patch?.workflowPhase !== undefined ? patch.workflowPhase : workflowPatch.workflowPhase,
            source: patch?.source !== undefined
                ? patch.source
                : task.source === 'improvements_scan'
                    ? 'manual'
                    : undefined,
            initRuntime: patch?.initRuntime
        })
        if (updatedTask) {
            runtimeTask = updatedTask
        }
        return updatedTask
    }

    const applyBlockedInitState = (options: {
        blockedReason: string
        note: string
        manualStep: string
        failureFingerprint: string
    }): StoredTask | null => {
        const blockedState = buildBlockedInitRuntimeState({
            task: runtimeTask,
            note: options.note,
            blockedReason: options.blockedReason,
            failureFingerprint: options.failureFingerprint,
            manualStep: options.manualStep
        })
        return updateStartedTask({
            initRuntime: buildTaskInitRuntime({
                task: runtimeTask,
                status: 'blocked',
                sessionId: spawn.sessionId,
                retryCount: runtimeTask.initRuntime?.retryCount,
                failureFingerprint: blockedState.failureFingerprint,
                latestNote: blockedState.latestNote,
                blockedReason: blockedState.blockedReason
            })
        })
    }

    let initRecoveryAttempted = false
    let initRecoveryError: string | undefined

    let directAttempt = await runInitAttempt()
    let initScript = directAttempt.initScript
    let initScriptCwd = directAttempt.initScriptCwd
    let initCommand = buildInitScriptCommand({
        rootPath: initScriptCwd,
        taskId: task.id,
        projectId: project.id
    })

    if (!initScript.ok) {
        const directFailureFingerprint = buildTaskInitFailureFingerprint({
            reason: 'script_failure',
            blockedReason: initScript.error,
            initScriptCwd,
            initScript
        })

        if (initScript.executed) {
            appendAssistantTextMessage({
                store: options.store,
                engine: options.engine,
                sessionId: spawn.sessionId,
                localId: `${AUTO_INIT_SETUP_LOCAL_ID_PREFIX}${task.id}:direct-result:${Date.now()}`,
                text: buildInitScriptResultMessage({
                    rootPath: initScriptCwd,
                    command: initCommand,
                    summary: `Init script failed: ${initScript.error}.`,
                    stdout: initScript.stdout,
                    stderr: initScript.stderr,
                    attempt: 'initial',
                    success: false
                })
            })
        }

        const retryingTask = updateStartedTask({
            initRuntime: buildTaskInitRuntime({
                task: runtimeTask,
                status: 'retrying',
                sessionId: spawn.sessionId,
                retryCount: getNextInitRepairAttemptRetryCount(runtimeTask),
                failureFingerprint: directFailureFingerprint,
                latestNote: 'Direct init failed; queued one in-session repair attempt.',
                blockedReason: initScript.error
            })
        })
        if (!retryingTask) {
            return { ok: false, error: 'Task not found' }
        }
        emitStartedTaskUpdate(retryingTask)

        try {
            await options.engine.sendMessage(spawn.sessionId, {
                text: buildInitScriptRepairPrompt({
                    task,
                    rootPath: initScriptCwd,
                    command: initCommand,
                    summary: `Init script failed: ${initScript.error}.`,
                    stdout: initScript.stdout,
                    stderr: initScript.stderr
                }),
                localId: `${AUTO_INIT_SETUP_LOCAL_ID_PREFIX}${task.id}:${Date.now()}`,
                sentFrom: 'webapp'
            })
            initRecoveryAttempted = true
        } catch (error) {
            const recoveryError = formatErrorMessage(error, 'Failed to send init recovery prompt')
            initRecoveryError = recoveryError
            appendAssistantTextMessage({
                store: options.store,
                engine: options.engine,
                sessionId: spawn.sessionId,
                localId: `${AUTO_INIT_SETUP_LOCAL_ID_PREFIX}${task.id}:prompt-error:${Date.now()}`,
                text: `HOPI could not send the automatic init repair prompt: ${recoveryError}`
            })

            const blockedTask = applyBlockedInitState({
                blockedReason: recoveryError,
                note: `Init repair prompt could not be delivered. ${INIT_REPAIR_MANUAL_STEP}`,
                manualStep: INIT_REPAIR_MANUAL_STEP,
                failureFingerprint: buildTaskInitFailureFingerprint({
                    reason: 'repair_prompt_failed',
                    blockedReason: recoveryError,
                    initScriptCwd,
                    initScript
                })
            })
            if (!blockedTask) {
                return { ok: false, error: 'Task not found' }
            }
            emitStartedTaskUpdate(blockedTask)
            return {
                ok: true,
                task: blockedTask,
                sessionId: spawn.sessionId,
                initRecoveryAttempted,
                initRecoveryError
            }
        }

        const runnableResult = await waitForSessionToBecomeInitRunnable({
            engine: options.engine,
            sessionId: spawn.sessionId,
            namespace: options.namespace,
            timeoutMs: INIT_REPAIR_WAIT_TIMEOUT_MS
        })
        if (runnableResult !== 'ready') {
            const blockedReason = runnableResult === 'session_inactive'
                ? INIT_SESSION_INACTIVE_BLOCKED_REASON
                : INIT_WAIT_TIMEOUT_BLOCKED_REASON
            const manualStep = runnableResult === 'session_inactive'
                ? INIT_SESSION_MANUAL_STEP
                : INIT_WAIT_MANUAL_STEP
            const blockedTask = applyBlockedInitState({
                blockedReason,
                note: `${blockedReason} ${manualStep}`,
                manualStep,
                failureFingerprint: buildTaskInitFailureFingerprint({
                    reason: runnableResult,
                    blockedReason
                })
            })
            if (!blockedTask) {
                return { ok: false, error: 'Task not found' }
            }
            emitStartedTaskUpdate(blockedTask)
            return {
                ok: true,
                task: blockedTask,
                sessionId: spawn.sessionId,
                initRecoveryAttempted,
                initRecoveryError
            }
        }

        const retryAttempt = await runInitAttempt()
        initScript = retryAttempt.initScript
        initScriptCwd = retryAttempt.initScriptCwd
        initCommand = buildInitScriptCommand({
            rootPath: initScriptCwd,
            taskId: task.id,
            projectId: project.id
        })

        if (initScript.executed) {
            appendAssistantTextMessage({
                store: options.store,
                engine: options.engine,
                sessionId: spawn.sessionId,
                localId: `${AUTO_INIT_SETUP_LOCAL_ID_PREFIX}${task.id}:retry-result:${Date.now()}`,
                text: buildInitScriptResultMessage({
                    rootPath: initScriptCwd,
                    command: initCommand,
                    summary: initScript.ok
                        ? 'Init retry succeeded after in-session repair.'
                        : `Init retry failed: ${initScript.error}.`,
                    stdout: initScript.stdout,
                    stderr: initScript.stderr,
                    attempt: 'retry',
                    success: initScript.ok
                })
            })
        }

        if (!initScript.ok) {
            const blockedTask = applyBlockedInitState({
                blockedReason: initScript.error,
                note: `Init still failed after one in-session repair attempt. ${INIT_REPAIR_MANUAL_STEP}`,
                manualStep: INIT_REPAIR_MANUAL_STEP,
                failureFingerprint: buildTaskInitFailureFingerprint({
                    reason: 'script_failure',
                    blockedReason: initScript.error,
                    initScriptCwd,
                    initScript
                })
            })
            if (!blockedTask) {
                return { ok: false, error: 'Task not found' }
            }
            emitStartedTaskUpdate(blockedTask)
            return {
                ok: true,
                task: blockedTask,
                sessionId: spawn.sessionId,
                initRecoveryAttempted,
                initRecoveryError
            }
        }
    }

    const updatedTask = updateStartedTask({
        initRuntime: buildTaskInitRuntime({
            task: runtimeTask,
            status: 'succeeded',
            sessionId: spawn.sessionId,
            retryCount: runtimeTask.initRuntime?.retryCount,
            latestNote: initRecoveryAttempted
                ? 'Init repair succeeded; kickoff resumed.'
                : null
        })
    })
    if (!updatedTask) {
        return { ok: false, error: 'Task not found' }
    }

    emitStartedTaskUpdate(updatedTask)


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
            try {
                await options.engine.sendMessage(spawn.sessionId, {
                    text: kickoffText,
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

    return {
        ok: true,
        task: updatedTask,
        sessionId: spawn.sessionId,
        initRecoveryAttempted,
        initRecoveryError
    }
}

export async function startSessionFromTask(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    taskId: string
    overrides?: StartSessionOverrides
    kickoff?: StartSessionKickoffOptions
}): Promise<StartTaskSessionResult> {
    try {
        return await startSessionFromTaskInternal(options)
    } catch (error) {
        return {
            ok: false,
            error: formatErrorMessage(error, 'Failed to start task session')
        }
    }
}
