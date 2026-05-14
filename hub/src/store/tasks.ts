import type { Database } from 'bun:sqlite'
import type { TaskInitRuntime, TaskMergeRuntime, TaskPreviewRuntime } from '@hopi/protocol/schemas'

import {
    normalizeTaskInitRuntime,
    normalizeTaskMergeRuntime,
    normalizeTaskPreviewRuntime,
    parseTaskInitRuntime,
    parseTaskMergeRuntime,
    parseTaskPreviewRuntime
} from '../utils/taskActionRuntime'
import { safeJsonParse } from './json'
import type { StoredTask } from './types'

type DbTaskRow = {
    id: string
    project_id: string
    goal_id: string | null
    goal_todo_ref: string | null
    title: string
    description: string | null
    status: string
    blocked_reason: string | null
    blocked_at: number | null
    blocked_source: string | null
    blocked_session_id: string | null
    priority: string | null
    sort_key: number | null
    active_session_id: string | null
    workspace_id: string | null
    agent_flavor: string | null
    permission_mode: string | null
    model: string | null
    model_mode: string | null
    attachments: string | null
    source: string | null
    source_task_id: string | null
    depends_on_task_ids: string | null
    workflow_profile?: string | null
    workflow_phase: string | null
    sub_tasks: string | null
    sub_tasks_updated_at: number | null
    worktree_merged_at: number | null
    worktree_merge_commit: string | null
    merged_diff_snapshot: string | null
    merge_runtime: string | null
    preview_runtime: string | null
    init_runtime: string | null
    contract: string | null
    handoff: string | null
    evidence: string | null
    created_at: number
    updated_at: number
    finished_at: number | null
    archived_at: number | null
}

type TaskRuntimeWithSession = {
    sessionId?: string | null
    status?: string
    latestNote?: string | null
    blockedReason?: string | null
    failure?: { message?: string | null; blockedReason?: string | null } | null
}

function normalizeTaskBlockedText(value: string | null | undefined, maxLength = 512): string | null {
    if (typeof value !== 'string') {
        return null
    }

    const normalized = value.replace(/\s+/gu, ' ').trim()
    if (!normalized) {
        return null
    }

    return normalized.length > maxLength ? normalized.slice(0, maxLength).trim() : normalized
}

function normalizeTaskDependencyIds(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return []
    }
    const seen = new Set<string>()
    const normalized: string[] = []
    for (const item of value) {
        if (typeof item !== 'string') continue
        const id = item.trim()
        if (!id || seen.has(id)) continue
        seen.add(id)
        normalized.push(id)
        if (normalized.length >= 64) break
    }
    return normalized
}

function getRuntimeBlockedReason(runtime: TaskRuntimeWithSession | null | undefined): string | null {
    if (!runtime || runtime.status !== 'blocked') {
        return null
    }

    return normalizeTaskBlockedText(runtime.blockedReason)
        ?? normalizeTaskBlockedText(runtime.latestNote)
        ?? normalizeTaskBlockedText(runtime.failure?.blockedReason)
        ?? normalizeTaskBlockedText(runtime.failure?.message)
}

function getRuntimeBlockedSessionId(runtime: TaskRuntimeWithSession | null | undefined): string | null {
    if (!runtime || runtime.status !== 'blocked') {
        return null
    }

    return normalizeTaskBlockedText(runtime.sessionId, 128)
}

function resolveTaskBlockedSource(task: {
    mergeRuntime?: TaskMergeRuntime | null
    previewRuntime?: TaskPreviewRuntime | null
    initRuntime?: TaskInitRuntime | null
}): string | null {
    if (task.mergeRuntime?.status === 'blocked') return 'merge'
    if (task.previewRuntime?.status === 'blocked') return 'preview'
    if (task.initRuntime?.status === 'blocked') return 'init'
    return null
}

function resolveTaskBlockedReason(task: {
    mergeRuntime?: TaskMergeRuntime | null
    previewRuntime?: TaskPreviewRuntime | null
    initRuntime?: TaskInitRuntime | null
}): string | null {
    return getRuntimeBlockedReason(task.mergeRuntime)
        ?? getRuntimeBlockedReason(task.previewRuntime)
        ?? getRuntimeBlockedReason(task.initRuntime)
}

function resolveTaskBlockedSessionId(task: {
    mergeRuntime?: TaskMergeRuntime | null
    previewRuntime?: TaskPreviewRuntime | null
    initRuntime?: TaskInitRuntime | null
}): string | null {
    return getRuntimeBlockedSessionId(task.mergeRuntime)
        ?? getRuntimeBlockedSessionId(task.previewRuntime)
        ?? getRuntimeBlockedSessionId(task.initRuntime)
}

type TaskRuntimeNormalizer<Runtime extends TaskRuntimeWithSession> = (
    value: Runtime | null | undefined,
    updatedAt: number
) => Runtime | null | undefined

function prepareTaskRuntime<Runtime extends TaskRuntimeWithSession>(
    value: Runtime | null | undefined,
    activeSessionId: string | null | undefined,
    updatedAt: number,
    normalize: TaskRuntimeNormalizer<Runtime>
): Runtime | null | undefined {
    if (value === undefined || value === null) {
        return value
    }

    return normalize({
        ...value,
        sessionId: value.sessionId ?? activeSessionId ?? null
    }, updatedAt)
}

function syncTaskRuntimeForSessionChange<Runtime extends TaskRuntimeWithSession>(
    current: Runtime | null | undefined,
    nextSessionId: string | null,
    updatedAt: number,
    normalize: TaskRuntimeNormalizer<Runtime>
): Runtime | null | undefined {
    if (!current) {
        return current
    }

    return normalize({
        ...current,
        sessionId: nextSessionId,
        updatedAt
    }, updatedAt)
}

function toStoredTask(row: DbTaskRow): StoredTask {
    return {
        id: row.id,
        projectId: row.project_id,
        goalId: row.goal_id,
        goalTodoRef: row.goal_todo_ref,
        title: row.title,
        description: row.description,
        status: row.status,
        blockedReason: row.blocked_reason,
        blockedAt: row.blocked_at,
        blockedSource: row.blocked_source,
        blockedSessionId: row.blocked_session_id,
        priority: row.priority,
        sortKey: row.sort_key,
        activeSessionId: row.active_session_id,
        workspaceId: row.workspace_id,
        agentFlavor: row.agent_flavor,
        permissionMode: row.permission_mode,
        model: row.model,
        modelMode: row.model_mode,
        attachments: safeJsonParse(row.attachments),
        source: row.source,
        sourceTaskId: row.source_task_id,
        dependsOnTaskIds: normalizeTaskDependencyIds(safeJsonParse(row.depends_on_task_ids)),
        workflowProfile: (row.workflow_profile ?? '').trim() || 'default',
        workflowPhase: row.workflow_phase,
        subTasks: safeJsonParse(row.sub_tasks),
        subTasksUpdatedAt: row.sub_tasks_updated_at,
        worktreeMergedAt: row.worktree_merged_at,
        worktreeMergeCommit: row.worktree_merge_commit,
        mergedDiffSnapshot: safeJsonParse(row.merged_diff_snapshot),
        mergeRuntime: parseTaskMergeRuntime(safeJsonParse(row.merge_runtime)),
        previewRuntime: parseTaskPreviewRuntime(safeJsonParse(row.preview_runtime)),
        initRuntime: parseTaskInitRuntime(safeJsonParse(row.init_runtime)),
        contract: row.contract,
        handoff: row.handoff,
        evidence: row.evidence,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        finishedAt: row.finished_at,
        archivedAt: row.archived_at
    }
}

export function getTask(db: Database, taskId: string): StoredTask | null {
    const row = db.prepare('SELECT * FROM tasks WHERE id = ? LIMIT 1').get(taskId) as DbTaskRow | undefined
    return row ? toStoredTask(row) : null
}

export function getTaskByNamespace(db: Database, taskId: string, namespace: string): StoredTask | null {
    const row = db.prepare(`
        SELECT t.*
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE t.id = ? AND p.namespace = ?
        LIMIT 1
    `).get(taskId, namespace) as DbTaskRow | undefined
    return row ? toStoredTask(row) : null
}

export function listTasksByActiveSessionIdAndNamespace(
    db: Database,
    activeSessionId: string,
    namespace: string,
    options?: { includeArchived?: boolean }
): StoredTask[] {
    const includeArchived = Boolean(options?.includeArchived)

    const rows = includeArchived
        ? db.prepare(`
            SELECT t.*
            FROM tasks t
            JOIN projects p ON p.id = t.project_id
            WHERE t.active_session_id = ? AND p.namespace = ?
            ORDER BY t.updated_at DESC
        `).all(activeSessionId, namespace) as DbTaskRow[]
        : db.prepare(`
            SELECT t.*
            FROM tasks t
            JOIN projects p ON p.id = t.project_id
            WHERE t.active_session_id = ? AND p.namespace = ? AND t.archived_at IS NULL
            ORDER BY t.updated_at DESC
        `).all(activeSessionId, namespace) as DbTaskRow[]

    return rows.map(toStoredTask)
}

export function listTasksByProject(
    db: Database,
    projectId: string,
    options?: { includeArchived?: boolean; goalId?: string | null }
): StoredTask[] {
    const includeArchived = Boolean(options?.includeArchived)
    const goalId = options?.goalId || null
    const rows = goalId
        ? includeArchived
            ? db.prepare(
                'SELECT * FROM tasks WHERE project_id = ? AND goal_id = ? ORDER BY updated_at DESC'
            ).all(projectId, goalId) as DbTaskRow[]
            : db.prepare(
                'SELECT * FROM tasks WHERE project_id = ? AND goal_id = ? AND archived_at IS NULL ORDER BY updated_at DESC'
            ).all(projectId, goalId) as DbTaskRow[]
        : includeArchived
            ? db.prepare(
                'SELECT * FROM tasks WHERE project_id = ? ORDER BY updated_at DESC'
            ).all(projectId) as DbTaskRow[]
            : db.prepare(
                'SELECT * FROM tasks WHERE project_id = ? AND archived_at IS NULL ORDER BY updated_at DESC'
            ).all(projectId) as DbTaskRow[]
    return rows.map(toStoredTask)
}

export function listTasksByProjectAndNamespace(
    db: Database,
    projectId: string,
    namespace: string,
    options?: { includeArchived?: boolean; goalId?: string | null }
): StoredTask[] {
    const includeArchived = Boolean(options?.includeArchived)
    const goalId = options?.goalId || null
    const rows = goalId
        ? includeArchived
            ? db.prepare(`
                SELECT t.*
                FROM tasks t
                JOIN projects p ON p.id = t.project_id
                WHERE t.project_id = ? AND p.namespace = ? AND t.goal_id = ?
                ORDER BY t.updated_at DESC
            `).all(projectId, namespace, goalId) as DbTaskRow[]
            : db.prepare(`
                SELECT t.*
                FROM tasks t
                JOIN projects p ON p.id = t.project_id
                WHERE t.project_id = ? AND p.namespace = ? AND t.goal_id = ? AND t.archived_at IS NULL
                ORDER BY t.updated_at DESC
            `).all(projectId, namespace, goalId) as DbTaskRow[]
        : includeArchived
            ? db.prepare(`
                SELECT t.*
                FROM tasks t
                JOIN projects p ON p.id = t.project_id
                WHERE t.project_id = ? AND p.namespace = ?
                ORDER BY t.updated_at DESC
            `).all(projectId, namespace) as DbTaskRow[]
            : db.prepare(`
                SELECT t.*
                FROM tasks t
                JOIN projects p ON p.id = t.project_id
                WHERE t.project_id = ? AND p.namespace = ? AND t.archived_at IS NULL
                ORDER BY t.updated_at DESC
            `).all(projectId, namespace) as DbTaskRow[]
    return rows.map(toStoredTask)
}

export function createTask(
    db: Database,
    task: {
        id: string
        projectId: string
        goalId?: string | null
        goalTodoRef?: string | null
        title: string
        description?: string | null
        status: string
        blockedReason?: string | null
        blockedAt?: number | null
        blockedSource?: string | null
        blockedSessionId?: string | null
        priority?: string | null
        sortKey?: number | null
        activeSessionId?: string | null
        preserveMergeResultOnSessionChange?: boolean
        workspaceId?: string | null
        agentFlavor?: string | null
        permissionMode?: string | null
        model?: string | null
        modelMode?: string | null
        attachments?: unknown
        source?: string | null
        sourceTaskId?: string | null
        dependsOnTaskIds?: unknown
        workflowProfile?: string | null
        workflowPhase?: string | null
        subTasks?: unknown
        subTasksUpdatedAt?: number | null
        worktreeMergedAt?: number | null
        worktreeMergeCommit?: string | null
        mergeRuntime?: TaskMergeRuntime | null
        previewRuntime?: TaskPreviewRuntime | null
        initRuntime?: TaskInitRuntime | null
        contract?: string | null
        handoff?: string | null
        evidence?: string | null
    }
): StoredTask {
    const now = Date.now()
    const mergeRuntime = prepareTaskRuntime(task.mergeRuntime, task.activeSessionId, now, normalizeTaskMergeRuntime)
    const previewRuntime = prepareTaskRuntime(task.previewRuntime, task.activeSessionId, now, normalizeTaskPreviewRuntime)
    const initRuntime = prepareTaskRuntime(task.initRuntime, task.activeSessionId, now, normalizeTaskInitRuntime)
    const isBlocked = task.status === 'blocked'
    const blockedReason = isBlocked
        ? normalizeTaskBlockedText(task.blockedReason) ?? resolveTaskBlockedReason({ mergeRuntime, previewRuntime, initRuntime })
        : null
    const blockedSource = isBlocked
        ? normalizeTaskBlockedText(task.blockedSource, 64) ?? resolveTaskBlockedSource({ mergeRuntime, previewRuntime, initRuntime })
        : null
    const blockedSessionId = isBlocked
        ? normalizeTaskBlockedText(task.blockedSessionId, 128) ?? resolveTaskBlockedSessionId({ mergeRuntime, previewRuntime, initRuntime })
        : null
    const blockedAt = isBlocked ? task.blockedAt ?? now : null
    const dependsOnTaskIds = normalizeTaskDependencyIds(task.dependsOnTaskIds)
    db.prepare(`
        INSERT INTO tasks (
            id, project_id, goal_id, goal_todo_ref, title, description, status, priority,
            blocked_reason, blocked_at, blocked_source, blocked_session_id,
            sort_key, active_session_id, workspace_id, agent_flavor,
            attachments, source, source_task_id, depends_on_task_ids, workflow_profile, workflow_phase, sub_tasks, sub_tasks_updated_at, worktree_merged_at, worktree_merge_commit,
            permission_mode, model, model_mode, merge_runtime, preview_runtime, init_runtime, contract, handoff, evidence,
            created_at, updated_at, finished_at, archived_at
        ) VALUES (
            @id, @project_id, @goal_id, @goal_todo_ref, @title, @description, @status, @priority,
            @blocked_reason, @blocked_at, @blocked_source, @blocked_session_id,
            @sort_key, @active_session_id, @workspace_id, @agent_flavor,
            @attachments, @source, @source_task_id, @depends_on_task_ids, @workflow_profile, @workflow_phase, @sub_tasks, @sub_tasks_updated_at, @worktree_merged_at, @worktree_merge_commit,
            @permission_mode, @model, @model_mode, @merge_runtime, @preview_runtime, @init_runtime, @contract, @handoff, @evidence,
            @created_at, @updated_at, NULL, NULL
        )
    `).run({
        id: task.id,
        project_id: task.projectId,
        goal_id: task.goalId ?? null,
        goal_todo_ref: task.goalTodoRef ?? null,
        title: task.title,
        description: task.description ?? null,
        status: task.status,
        blocked_reason: blockedReason,
        blocked_at: blockedAt,
        blocked_source: blockedSource,
        blocked_session_id: blockedSessionId,
        priority: task.priority ?? null,
        sort_key: task.sortKey ?? null,
        active_session_id: task.activeSessionId ?? null,
        workspace_id: task.workspaceId ?? null,
        agent_flavor: task.agentFlavor ?? null,
        permission_mode: task.permissionMode ?? null,
        model: task.model ?? null,
        model_mode: task.modelMode ?? null,
        attachments: task.attachments !== undefined ? JSON.stringify(task.attachments) : null,
        source: task.source ?? null,
        source_task_id: task.sourceTaskId ?? null,
        depends_on_task_ids: JSON.stringify(dependsOnTaskIds),
        workflow_profile: (task.workflowProfile ?? '').trim() || 'default',
        workflow_phase: task.workflowPhase ?? null,
        sub_tasks: task.subTasks !== undefined ? JSON.stringify(task.subTasks) : null,
        sub_tasks_updated_at: task.subTasksUpdatedAt ?? null,
        worktree_merged_at: task.worktreeMergedAt ?? null,
        worktree_merge_commit: task.worktreeMergeCommit ?? null,
        merge_runtime: mergeRuntime !== undefined && mergeRuntime !== null ? JSON.stringify(mergeRuntime) : null,
        preview_runtime: previewRuntime !== undefined && previewRuntime !== null ? JSON.stringify(previewRuntime) : null,
        init_runtime: initRuntime !== undefined && initRuntime !== null ? JSON.stringify(initRuntime) : null,
        contract: task.contract ?? null,
        handoff: task.handoff ?? null,
        evidence: task.evidence ?? null,
        created_at: now,
        updated_at: now
    })

    const stored = getTask(db, task.id)
    if (!stored) {
        throw new Error('Failed to create task')
    }
    return stored
}

export function updateTaskByNamespace(
    db: Database,
    taskId: string,
    namespace: string,
    patch: {
        title?: string
        goalId?: string | null
        goalTodoRef?: string | null
        description?: string | null
        status?: string
        blockedReason?: string | null
        blockedAt?: number | null
        blockedSource?: string | null
        blockedSessionId?: string | null
        priority?: string | null
        sortKey?: number | null
        activeSessionId?: string | null
        preserveMergeResultOnSessionChange?: boolean
        workspaceId?: string | null
        agentFlavor?: string | null
        permissionMode?: string | null
        model?: string | null
        modelMode?: string | null
        source?: string | null
        dependsOnTaskIds?: unknown
        workflowProfile?: string
        workflowPhase?: string | null
        attachments?: unknown
        subTasks?: unknown
        subTasksUpdatedAt?: number | null
        worktreeMergedAt?: number | null
        worktreeMergeCommit?: string | null
        mergedDiffSnapshot?: unknown
        mergeRuntime?: TaskMergeRuntime | null
        previewRuntime?: TaskPreviewRuntime | null
        initRuntime?: TaskInitRuntime | null
        contract?: string | null
        handoff?: string | null
        evidence?: string | null
        finishedAt?: number | null
        archivedAt?: number | null
    }
): StoredTask | null {
    const current = getTaskByNamespace(db, taskId, namespace)
    if (!current) {
        return null
    }

    const activeSessionChanged = patch.activeSessionId !== undefined && patch.activeSessionId !== current.activeSessionId
    const preserveMergeResultOnSessionChange = patch.preserveMergeResultOnSessionChange === true
    const nextActiveSessionId = patch.activeSessionId !== undefined ? patch.activeSessionId : current.activeSessionId
    const now = Date.now()

    const next = {
        ...current,
        title: patch.title ?? current.title,
        goalId: patch.goalId !== undefined ? patch.goalId : current.goalId,
        goalTodoRef: patch.goalTodoRef !== undefined ? patch.goalTodoRef : current.goalTodoRef,
        description: patch.description !== undefined ? patch.description : current.description,
        status: patch.status ?? current.status,
        priority: patch.priority !== undefined ? patch.priority : current.priority,
        sortKey: patch.sortKey !== undefined ? patch.sortKey : current.sortKey,
        activeSessionId: nextActiveSessionId,
        workspaceId: patch.workspaceId !== undefined ? patch.workspaceId : current.workspaceId,
        agentFlavor: patch.agentFlavor !== undefined ? patch.agentFlavor : current.agentFlavor,
        permissionMode: patch.permissionMode !== undefined ? patch.permissionMode : current.permissionMode,
        model: patch.model !== undefined ? patch.model : current.model,
        modelMode: patch.modelMode !== undefined ? patch.modelMode : current.modelMode,
        source: patch.source !== undefined ? patch.source : current.source,
        dependsOnTaskIds: patch.dependsOnTaskIds !== undefined
            ? normalizeTaskDependencyIds(patch.dependsOnTaskIds)
            : current.dependsOnTaskIds,
        workflowProfile: patch.workflowProfile !== undefined ? patch.workflowProfile : current.workflowProfile,
        workflowPhase: patch.workflowPhase !== undefined ? patch.workflowPhase : current.workflowPhase,
        attachments: patch.attachments !== undefined ? patch.attachments : current.attachments,
        subTasks: patch.subTasks !== undefined ? patch.subTasks : current.subTasks,
        subTasksUpdatedAt: patch.subTasksUpdatedAt !== undefined
            ? patch.subTasksUpdatedAt
            : (patch.subTasks !== undefined ? now : current.subTasksUpdatedAt),
        mergeRuntime: patch.mergeRuntime !== undefined
            ? prepareTaskRuntime(patch.mergeRuntime, nextActiveSessionId, now, normalizeTaskMergeRuntime)
            : activeSessionChanged
                ? syncTaskRuntimeForSessionChange(current.mergeRuntime, nextActiveSessionId, now, normalizeTaskMergeRuntime)
                : current.mergeRuntime,
        previewRuntime: patch.previewRuntime !== undefined
            ? prepareTaskRuntime(patch.previewRuntime, nextActiveSessionId, now, normalizeTaskPreviewRuntime)
            : activeSessionChanged
                ? syncTaskRuntimeForSessionChange(current.previewRuntime, nextActiveSessionId, now, normalizeTaskPreviewRuntime)
                : current.previewRuntime,
        initRuntime: patch.initRuntime !== undefined
            ? prepareTaskRuntime(patch.initRuntime, nextActiveSessionId, now, normalizeTaskInitRuntime)
            : activeSessionChanged
                ? syncTaskRuntimeForSessionChange(current.initRuntime, nextActiveSessionId, now, normalizeTaskInitRuntime)
                : current.initRuntime,
        contract: patch.contract !== undefined ? patch.contract : current.contract,
        handoff: patch.handoff !== undefined ? patch.handoff : current.handoff,
        evidence: patch.evidence !== undefined ? patch.evidence : current.evidence,
        worktreeMergedAt: activeSessionChanged
            ? (preserveMergeResultOnSessionChange ? current.worktreeMergedAt : null)
            : patch.worktreeMergedAt !== undefined
                ? patch.worktreeMergedAt
                : current.worktreeMergedAt,
        worktreeMergeCommit: activeSessionChanged
            ? (preserveMergeResultOnSessionChange ? current.worktreeMergeCommit : null)
            : patch.worktreeMergeCommit !== undefined
                ? patch.worktreeMergeCommit
                : current.worktreeMergeCommit,
        mergedDiffSnapshot: activeSessionChanged
            ? (preserveMergeResultOnSessionChange ? current.mergedDiffSnapshot : null)
            : patch.mergedDiffSnapshot !== undefined
                ? patch.mergedDiffSnapshot
                : current.mergedDiffSnapshot,
        finishedAt: patch.finishedAt !== undefined ? patch.finishedAt : current.finishedAt,
        archivedAt: patch.archivedAt !== undefined ? patch.archivedAt : current.archivedAt
    }
    const runtimeBlockedReason = resolveTaskBlockedReason(next)
    const runtimeBlockedSource = resolveTaskBlockedSource(next)
    const runtimeBlockedSessionId = resolveTaskBlockedSessionId(next)
    const explicitBlockedReason = patch.blockedReason !== undefined
        ? normalizeTaskBlockedText(patch.blockedReason)
        : undefined
    const explicitBlockedSource = patch.blockedSource !== undefined
        ? normalizeTaskBlockedText(patch.blockedSource, 64)
        : undefined
    const explicitBlockedSessionId = patch.blockedSessionId !== undefined
        ? normalizeTaskBlockedText(patch.blockedSessionId, 128)
        : undefined

    if (next.status === 'blocked') {
        next.blockedReason = explicitBlockedReason !== undefined
            ? explicitBlockedReason
            : runtimeBlockedReason ?? current.blockedReason
        next.blockedSource = explicitBlockedSource !== undefined
            ? explicitBlockedSource
            : runtimeBlockedSource ?? current.blockedSource
        next.blockedSessionId = explicitBlockedSessionId !== undefined
            ? explicitBlockedSessionId
            : runtimeBlockedSessionId ?? current.blockedSessionId

        const blockerChanged = current.status !== 'blocked'
            || next.blockedReason !== current.blockedReason
            || next.blockedSource !== current.blockedSource
            || next.blockedSessionId !== current.blockedSessionId
        next.blockedAt = patch.blockedAt !== undefined
            ? patch.blockedAt
            : blockerChanged
                ? now
                : current.blockedAt
    } else {
        next.blockedReason = null
        next.blockedAt = null
        next.blockedSource = null
        next.blockedSessionId = null
    }

    db.prepare(`
        UPDATE tasks SET
            title = @title,
            goal_id = @goal_id,
            goal_todo_ref = @goal_todo_ref,
            description = @description,
            status = @status,
            blocked_reason = @blocked_reason,
            blocked_at = @blocked_at,
            blocked_source = @blocked_source,
            blocked_session_id = @blocked_session_id,
            priority = @priority,
            sort_key = @sort_key,
            active_session_id = @active_session_id,
            workspace_id = @workspace_id,
            agent_flavor = @agent_flavor,
            permission_mode = @permission_mode,
            model = @model,
            model_mode = @model_mode,
            source = @source,
            depends_on_task_ids = @depends_on_task_ids,
            workflow_profile = @workflow_profile,
            workflow_phase = @workflow_phase,
            attachments = @attachments,
            sub_tasks = @sub_tasks,
            sub_tasks_updated_at = @sub_tasks_updated_at,
            merge_runtime = @merge_runtime,
            preview_runtime = @preview_runtime,
            init_runtime = @init_runtime,
            contract = @contract,
            handoff = @handoff,
            evidence = @evidence,
            worktree_merged_at = @worktree_merged_at,
            worktree_merge_commit = @worktree_merge_commit,
            merged_diff_snapshot = @merged_diff_snapshot,
            finished_at = @finished_at,
            archived_at = @archived_at,
            updated_at = @updated_at
        WHERE id = @id AND project_id = @project_id
    `).run({
        id: taskId,
        project_id: current.projectId,
        title: next.title,
        goal_id: next.goalId,
        goal_todo_ref: next.goalTodoRef,
        description: next.description,
        status: next.status,
        blocked_reason: next.blockedReason,
        blocked_at: next.blockedAt,
        blocked_source: next.blockedSource,
        blocked_session_id: next.blockedSessionId,
        priority: next.priority,
        sort_key: next.sortKey,
        active_session_id: next.activeSessionId,
        workspace_id: next.workspaceId,
        agent_flavor: next.agentFlavor,
        permission_mode: next.permissionMode,
        model: next.model,
        model_mode: next.modelMode,
        source: next.source,
        depends_on_task_ids: JSON.stringify(next.dependsOnTaskIds),
        workflow_profile: (next.workflowProfile ?? '').trim() || 'default',
        workflow_phase: next.workflowPhase,
        attachments: next.attachments !== undefined && next.attachments !== null ? JSON.stringify(next.attachments) : null,
        sub_tasks: next.subTasks !== undefined && next.subTasks !== null ? JSON.stringify(next.subTasks) : null,
        sub_tasks_updated_at: next.subTasksUpdatedAt,
        merge_runtime: next.mergeRuntime !== undefined && next.mergeRuntime !== null ? JSON.stringify(next.mergeRuntime) : null,
        preview_runtime: next.previewRuntime !== undefined && next.previewRuntime !== null ? JSON.stringify(next.previewRuntime) : null,
        init_runtime: next.initRuntime !== undefined && next.initRuntime !== null ? JSON.stringify(next.initRuntime) : null,
        contract: next.contract,
        handoff: next.handoff,
        evidence: next.evidence,
        worktree_merged_at: next.worktreeMergedAt,
        worktree_merge_commit: next.worktreeMergeCommit,
        merged_diff_snapshot: next.mergedDiffSnapshot !== undefined && next.mergedDiffSnapshot !== null ? JSON.stringify(next.mergedDiffSnapshot) : null,
        finished_at: next.finishedAt,
        archived_at: next.archivedAt,
        updated_at: now
    })

    return getTaskByNamespace(db, taskId, namespace)
}

export function archiveTaskByNamespace(db: Database, taskId: string, namespace: string): boolean {
    const now = Date.now()
    const result = db.prepare(`
        UPDATE tasks
        SET archived_at = ?, updated_at = ?
        WHERE id = ?
            AND archived_at IS NULL
            AND project_id IN (SELECT id FROM projects WHERE namespace = ?)
    `).run(now, now, taskId, namespace)
    return result.changes > 0
}

export function deleteTaskByNamespace(db: Database, taskId: string, namespace: string): boolean {
    const result = db.prepare(`
        DELETE FROM tasks
        WHERE id = ?
            AND project_id IN (SELECT id FROM projects WHERE namespace = ?)
    `).run(taskId, namespace)
    return result.changes > 0
}

export function countPendingImprovementsTasks(db: Database, projectId: string, namespace: string): number {
    const row = db.prepare(`
        SELECT COUNT(1) AS count
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE t.project_id = ?
            AND p.namespace = ?
            AND t.status = 'planned'
            AND t.archived_at IS NULL
            AND t.source = 'improvements_scan'
    `).get(projectId, namespace) as { count: number } | undefined
    return row?.count ?? 0
}

export function listPlannedTasksByProjectAndNamespace(
    db: Database,
    projectId: string,
    namespace: string,
    options?: { limit?: number }
): StoredTask[] {
    const safeLimit = Number.isFinite(options?.limit)
        ? Math.max(1, Math.min(200, options?.limit as number))
        : 50

    const rows = db.prepare(`
        SELECT t.*
        FROM tasks t
        JOIN projects p ON p.id = t.project_id
        WHERE t.project_id = ?
            AND p.namespace = ?
            AND t.status = 'planned'
            AND (t.source IS NULL OR t.source != 'improvements_scan')
            AND t.archived_at IS NULL
        ORDER BY
            (t.sort_key IS NULL) ASC,
            t.sort_key ASC,
            t.created_at ASC
        LIMIT ?
    `).all(projectId, namespace, safeLimit) as DbTaskRow[]

    return rows.map(toStoredTask)
}
