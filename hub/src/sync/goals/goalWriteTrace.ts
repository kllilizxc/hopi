import { appendFileSync, mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname } from 'node:path'
import { normalizeSessionMessage, type NormalizedAgentContent } from '@hopi/protocol/chat'
import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import type { Store, StoredMessage, StoredProject, StoredSession, StoredTask, StoredWorkspace } from '../../store'
import { readSessionTaskLinkMetadata } from '../sessionTaskLink'
import { getDocsRoot, getGoalWriteTracePath } from './goalDocPaths'
import { findGoalTodoTaskProjectionById, getTaskByNamespaceOrGoalTodoProjection } from './goalTodoProjection'

type SupportedAgentFlavor = 'claude' | 'codex' | 'gemini' | 'opencode'

type GoalWriteTraceContext = {
    project: StoredProject
    goalId: string
    goalKey: string
    task: StoredTask
    defaultWorkspace: StoredWorkspace | null
    sessionId: string
    agent: SupportedAgentFlavor | 'unknown'
    cwd: string | null
}

type GoalWriteTraceEntryInput = {
    agent: string
    sessionId: string
    projectId: string
    goalId: string
    goalKey: string
    taskId: string
    cwd: string | null
    toolName: string
    callId: string
    targetPaths: string[]
    argumentSummary: string | null
    resultSummary: string | null
    phase: 'tool_call' | 'tool_result'
    success: boolean | null
    messageId: string
    messageSeq: number
}

type ToolCallLookup = {
    toolName: string
    input: unknown
    targetPaths: string[]
}

const FILE_WRITE_TOOL_NAMES = new Set([
    'write',
    'edit',
    'multiedit',
    'notebookedit',
    'codexpatch',
    'applypatch',
    'apply_patch',
    'writefile',
    'editfile',
    'replaceinfile',
    'replacefile',
    'createfile',
    'strreplaceeditor',
    'fsedit'
])

const FILE_WRITE_TOOL_EXCLUSIONS = new Set([
    'todowrite',
    'taskcreate',
    'taskupdate',
    'tasklist',
    'requestuserinput',
    'askuserquestion',
    'exitplanmode'
])

const CONTENTISH_KEYS = new Set([
    'content',
    'contents',
    'text',
    'new_string',
    'newstring',
    'old_string',
    'oldstring',
    'patch',
    'diff',
    'replacement',
    'body'
])

const SINGLE_PATH_KEYS = [
    'path',
    'file_path',
    'filePath',
    'notebook_path',
    'notebookPath',
    'relative_workspace_path',
    'relativeWorkspacePath',
    'target_path',
    'targetPath',
    'old_path',
    'oldPath',
    'new_path',
    'newPath'
]

const MULTI_PATH_KEYS = [
    'paths',
    'file_paths',
    'filePaths',
    'targets'
]

function normalizeToolName(value: string): string {
    return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function isSupportedAgentFlavor(value: unknown): value is SupportedAgentFlavor {
    return value === 'claude' || value === 'codex' || value === 'gemini' || value === 'opencode'
}

function getDefaultWorkspaceForProject(store: Store, project: StoredProject): StoredWorkspace | null {
    if (project.defaultWorkspaceId) {
        const workspace = store.workspaces.getWorkspace(project.defaultWorkspaceId)
        if (workspace) return workspace
    }
    return store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
}

function resolveSessionCwd(session: StoredSession, fallbackWorkspace: StoredWorkspace | null): string | null {
    const metadata = session.metadata
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return fallbackWorkspace?.path ?? null
    }

    const record = metadata as Record<string, unknown>
    const worktree = record.worktree
    if (worktree && typeof worktree === 'object' && !Array.isArray(worktree)) {
        const worktreePath = (worktree as Record<string, unknown>).worktreePath
        if (typeof worktreePath === 'string' && worktreePath.trim()) {
            return worktreePath.trim()
        }
    }

    const path = record.path
    if (typeof path === 'string' && path.trim()) {
        return path.trim()
    }

    return fallbackWorkspace?.path ?? null
}

function resolveWriteTraceContext(store: Store, session: StoredSession): GoalWriteTraceContext | null {
    const link = readSessionTaskLinkMetadata(session.metadata)
    if (!link) {
        return null
    }

    const task = getTaskByNamespaceOrGoalTodoProjection({
        store,
        namespace: session.namespace,
        taskId: link.taskId
    })
    if (!task || !task.goalId) {
        return null
    }

    const project = store.projects.getProjectByNamespace(task.projectId, session.namespace)
    if (!project) {
        return null
    }

    const goal = store.goals.getGoalByNamespace(task.goalId, session.namespace)
    if (!goal || goal.projectId !== project.id) {
        return null
    }

    const defaultWorkspace = getDefaultWorkspaceForProject(store, project)
    const docsRoot = getDocsRoot(defaultWorkspace)
    if (!docsRoot) {
        return null
    }
    const projected = findGoalTodoTaskProjectionById({
        store,
        namespace: session.namespace,
        taskId: task.goalTodoRef?.trim() || task.id,
        includeArchived: true
    })
    if (!projected || projected.goalId !== goal.id) {
        return null
    }

    const metadata = session.metadata
    const flavor = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>).flavor
        : null
    const agent = isSupportedAgentFlavor(flavor)
        ? flavor
        : isSupportedAgentFlavor(task.agentFlavor)
            ? task.agentFlavor
            : isSupportedAgentFlavor(project.defaultAgentFlavor)
                ? project.defaultAgentFlavor
                : 'unknown'

    return {
        project,
        goalId: goal.id,
        goalKey: goal.goalKey?.trim() || goal.id,
        task,
        defaultWorkspace,
        sessionId: session.id,
        agent,
        cwd: resolveSessionCwd(session, defaultWorkspace)
    }
}

function collectPath(value: unknown, paths: Set<string>): void {
    if (typeof value !== 'string') {
        return
    }
    const trimmed = value.trim()
    if (!trimmed) {
        return
    }
    paths.add(trimmed)
}

function extractTargetPaths(value: unknown): string[] {
    const paths = new Set<string>()

    const visit = (input: unknown, key?: string): void => {
        if (!input || typeof input !== 'object') {
            return
        }
        if (Array.isArray(input)) {
            for (const item of input) {
                visit(item, key)
            }
            return
        }

        const record = input as Record<string, unknown>

        for (const pathKey of SINGLE_PATH_KEYS) {
            collectPath(record[pathKey], paths)
        }

        for (const listKey of MULTI_PATH_KEYS) {
            const candidate = record[listKey]
            if (Array.isArray(candidate)) {
                for (const item of candidate) {
                    collectPath(item, paths)
                }
            }
        }

        const changes = record.changes
        if (changes && typeof changes === 'object' && !Array.isArray(changes)) {
            for (const changePath of Object.keys(changes as Record<string, unknown>)) {
                collectPath(changePath, paths)
            }
        }

        if (Array.isArray(record.edits)) {
            for (const edit of record.edits) {
                visit(edit, 'edits')
            }
        }

        if (Array.isArray(record.files)) {
            for (const file of record.files) {
                if (typeof file === 'string') {
                    collectPath(file, paths)
                } else {
                    visit(file, 'files')
                }
            }
        }

        if (key === 'result' || key === 'output') {
            for (const [nestedKey, nestedValue] of Object.entries(record)) {
                if (SINGLE_PATH_KEYS.includes(nestedKey) || MULTI_PATH_KEYS.includes(nestedKey) || nestedKey === 'changes') {
                    visit({ [nestedKey]: nestedValue }, nestedKey)
                }
            }
        }
    }

    visit(value)
    return [...paths].sort()
}

function isFileWriteToolName(toolName: string, targetPaths: string[]): boolean {
    const normalized = normalizeToolName(toolName)
    if (!normalized || FILE_WRITE_TOOL_EXCLUSIONS.has(normalized)) {
        return false
    }
    if (FILE_WRITE_TOOL_NAMES.has(normalized)) {
        return true
    }
    if (targetPaths.length === 0) {
        return false
    }
    return normalized.includes('write')
        || normalized.includes('edit')
        || normalized.includes('patch')
        || normalized.includes('replace')
        || normalized.includes('notebook')
}

function summarizeString(value: string): string {
    const trimmed = value.trim()
    if (!trimmed) {
        return ''
    }
    if (trimmed.length > 160 || trimmed.split('\n').length > 3) {
        return `[omitted ${trimmed.length} chars]`
    }
    return trimmed.replace(/\s+/g, ' ')
}

function sanitizeSummaryValue(value: unknown, key?: string, depth = 0): unknown {
    if (value === null || value === undefined) {
        return value
    }
    if (typeof value === 'string') {
        if (key && CONTENTISH_KEYS.has(key)) {
            return `[omitted ${value.length} chars]`
        }
        return summarizeString(value)
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return value
    }
    if (Array.isArray(value)) {
        if (depth >= 2) {
            return `[${value.length} items]`
        }
        return value.slice(0, 5).map((item) => sanitizeSummaryValue(item, key, depth + 1))
    }
    if (typeof value === 'object') {
        if (depth >= 2) {
            return '[object]'
        }
        const output: Record<string, unknown> = {}
        for (const [entryKey, entryValue] of Object.entries(value as Record<string, unknown>).slice(0, 10)) {
            output[entryKey] = sanitizeSummaryValue(entryValue, entryKey, depth + 1)
        }
        return output
    }
    return String(value)
}

function stringifySummary(value: unknown): string | null {
    if (value === null || value === undefined) {
        return null
    }
    if (typeof value === 'string') {
        return summarizeString(value) || null
    }
    try {
        return JSON.stringify(value)
    } catch {
        return String(value)
    }
}

function summarizeToolInput(toolName: string, input: unknown, targetPaths: string[]): string | null {
    const normalized = normalizeToolName(toolName)
    if (normalized === 'codexpatch') {
        const changeCount = targetPaths.length
        return changeCount > 0 ? `patch ${changeCount} path(s)` : 'patch update'
    }
    if (normalized === 'write' && targetPaths[0]) {
        return `write ${targetPaths[0]}`
    }
    if (normalized === 'edit' && targetPaths[0]) {
        return `edit ${targetPaths[0]}`
    }
    if (normalized === 'multiedit' && targetPaths[0]) {
        const edits = input && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>).edits
            : null
        const editCount = Array.isArray(edits) ? edits.length : null
        return editCount && editCount > 0
            ? `multi-edit ${targetPaths[0]} (${editCount} edits)`
            : `multi-edit ${targetPaths[0]}`
    }
    return stringifySummary(sanitizeSummaryValue(input))
}

function summarizeToolResult(output: unknown): string | null {
    if (output && typeof output === 'object' && !Array.isArray(output)) {
        const record = output as Record<string, unknown>
        if (typeof record.stdout === 'string' && record.stdout.trim()) {
            return summarizeString(record.stdout)
        }
        if (typeof record.stderr === 'string' && record.stderr.trim()) {
            return summarizeString(record.stderr)
        }
        if (typeof record.message === 'string' && record.message.trim()) {
            return summarizeString(record.message)
        }
    }
    return stringifySummary(sanitizeSummaryValue(output))
}

function resolveSuccessfulResult(block: Extract<NormalizedAgentContent, { type: 'tool-result' }>, output: unknown): boolean | null {
    if (block.is_error) {
        return false
    }
    if (output && typeof output === 'object' && !Array.isArray(output)) {
        const record = output as Record<string, unknown>
        if (typeof record.success === 'boolean') {
            return record.success
        }
        if (typeof record.ok === 'boolean') {
            return record.ok
        }
        if (typeof record.applied === 'boolean') {
            return record.applied
        }
        if (typeof record.status === 'string') {
            const status = record.status.trim().toLowerCase()
            if (status === 'failed' || status === 'error') {
                return false
            }
            if (status === 'completed' || status === 'success' || status === 'ok') {
                return true
            }
        }
    }
    return true
}

function lookupPriorToolCall(store: Store, sessionId: string, beforeSeq: number, callId: string): ToolCallLookup | null {
    const previousMessages = store.messages.getMessages(sessionId, 50, beforeSeq)
    for (const candidate of previousMessages) {
        for (const block of extractRawWriteTraceBlocks(candidate)) {
            if (block.type !== 'tool-call' || block.id !== callId) {
                continue
            }
            return {
                toolName: block.name,
                input: block.input,
                targetPaths: extractTargetPaths(block.input)
            }
        }
    }
    return null
}

function createGoalWriteTraceLine(input: GoalWriteTraceEntryInput): string {
    return `${JSON.stringify({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        agent: input.agent,
        sessionId: input.sessionId,
        projectId: input.projectId,
        goalId: input.goalId,
        goalKey: input.goalKey,
        taskId: input.taskId,
        cwd: input.cwd,
        toolName: input.toolName,
        callId: input.callId,
        targetPaths: input.targetPaths,
        argumentSummary: input.argumentSummary,
        resultSummary: input.resultSummary,
        phase: input.phase,
        success: input.success,
        messageId: input.messageId,
        messageSeq: input.messageSeq
    })}\n`
}

function appendGoalWriteTrace(path: string, input: GoalWriteTraceEntryInput): void {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, createGoalWriteTraceLine(input), 'utf8')
}

function extractRawWriteTraceBlocks(message: StoredMessage): NormalizedAgentContent[] {
    const normalized = normalizeSessionMessage(message)
    if (normalized?.role === 'agent') {
        const toolBlocks = normalized.content.filter((block) => block.type === 'tool-call' || block.type === 'tool-result')
        if (toolBlocks.length > 0) {
            return toolBlocks
        }
    }

    const raw = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!raw || !Array.isArray(raw.content)) {
        return []
    }

    const blocks: NormalizedAgentContent[] = []
    for (const block of raw.content) {
        if (!block || typeof block !== 'object' || Array.isArray(block) || typeof (block as Record<string, unknown>).type !== 'string') {
            continue
        }
        const record = block as Record<string, unknown>
        if (record.type === 'tool_use' && typeof record.id === 'string') {
            blocks.push({
                type: 'tool-call',
                id: record.id,
                name: typeof record.name === 'string' ? record.name : 'Tool',
                input: record.input,
                description: null,
                uuid: message.id,
                parentUUID: null
            })
            continue
        }
        if (record.type === 'tool_result' && typeof record.tool_use_id === 'string') {
            blocks.push({
                type: 'tool-result',
                tool_use_id: record.tool_use_id,
                content: record.content,
                is_error: Boolean(record.is_error),
                uuid: message.id,
                parentUUID: null
            })
        }
    }
    return blocks
}

export function recordGoalWriteTraceFromSessionMessage(options: {
    store: Store
    session: StoredSession
    message: StoredMessage
}): number {
    const context = resolveWriteTraceContext(options.store, options.session)
    if (!context) {
        return 0
    }

    const docsRoot = getDocsRoot(context.defaultWorkspace)
    if (!docsRoot) {
        return 0
    }

    const blocks = extractRawWriteTraceBlocks(options.message)
    if (blocks.length === 0) {
        return 0
    }

    const path = getGoalWriteTracePath(docsRoot, context.goalKey)
    let appended = 0

    for (const block of blocks) {
        if (block.type === 'tool-call') {
            const targetPaths = extractTargetPaths(block.input)
            if (!isFileWriteToolName(block.name, targetPaths)) {
                continue
            }
            appendGoalWriteTrace(path, {
                agent: context.agent,
                sessionId: context.sessionId,
                projectId: context.project.id,
                goalId: context.goalId,
                goalKey: context.goalKey,
                taskId: context.task.id,
                cwd: context.cwd,
                toolName: block.name,
                callId: block.id,
                targetPaths,
                argumentSummary: summarizeToolInput(block.name, block.input, targetPaths),
                resultSummary: null,
                phase: 'tool_call',
                success: null,
                messageId: options.message.id,
                messageSeq: options.message.seq
            })
            appended += 1
            continue
        }

        if (block.type !== 'tool-result') {
            continue
        }

        const previousCall = lookupPriorToolCall(options.store, options.session.id, options.message.seq, block.tool_use_id)
        const toolName = previousCall?.toolName ?? 'unknown'
        const targetPaths = previousCall?.targetPaths ?? extractTargetPaths(block.content)
        if (!isFileWriteToolName(toolName, targetPaths)) {
            continue
        }

        appendGoalWriteTrace(path, {
            agent: context.agent,
            sessionId: context.sessionId,
            projectId: context.project.id,
            goalId: context.goalId,
            goalKey: context.goalKey,
            taskId: context.task.id,
            cwd: context.cwd,
            toolName,
            callId: block.tool_use_id,
            targetPaths,
            argumentSummary: previousCall
                ? summarizeToolInput(toolName, previousCall.input, targetPaths)
                : null,
            resultSummary: summarizeToolResult(block.content),
            phase: 'tool_result',
            success: resolveSuccessfulResult(block, block.content),
            messageId: options.message.id,
            messageSeq: options.message.seq
        })
        appended += 1
    }

    return appended
}
