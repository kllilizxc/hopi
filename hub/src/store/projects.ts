import type { Database } from 'bun:sqlite'

import type { StoredProject } from './types'

type DbProjectRow = {
    id: string
    namespace: string
    machine_id: string
    name: string
    description: string | null
    default_workspace_id: string | null
    default_agent_flavor: string | null
    default_permission_mode: string | null
    default_model: string | null
    default_model_mode: string | null
    default_session_type?: string | null
    worktree_target_branch?: string | null
    worktree_auto_commit_mode?: string | null
    worktree_cleanup_after_merge?: number
    auto_run_enabled: number
    max_running_sessions: number
    improvements_enabled: number
    improvements_max_pending_tasks?: number
    improvements_max_generated_new?: number
    automation_readiness_status?: string | null
    automation_readiness_summary?: string | null
    automation_readiness_checked_at?: number | null
    last_improvements_at: number | null
    created_at: number
    updated_at: number
    archived_at: number | null
}

function toStoredProject(row: DbProjectRow): StoredProject {
    return {
        id: row.id,
        namespace: row.namespace,
        machineId: row.machine_id,
        name: row.name,
        description: row.description,
        defaultWorkspaceId: row.default_workspace_id,
        defaultAgentFlavor: row.default_agent_flavor,
        defaultPermissionMode: row.default_permission_mode,
        defaultModel: row.default_model,
        defaultModelMode: row.default_model_mode,
        defaultSessionType: row.default_session_type === 'worktree'
            ? 'worktree'
            : row.default_session_type === 'simple'
                ? 'simple'
                : null,
        worktreeTargetBranch: row.worktree_target_branch ?? null,
        worktreeAutoCommitMode: row.worktree_auto_commit_mode === 'per_conversation'
            ? 'per_conversation'
            : row.worktree_auto_commit_mode === 'off'
                ? 'off'
                : null,
        worktreeCleanupAfterMerge: Boolean(row.worktree_cleanup_after_merge ?? 0),
        autoRunEnabled: Boolean(row.auto_run_enabled),
        maxRunningSessions: row.max_running_sessions,
        improvementsEnabled: Boolean(row.improvements_enabled),
        improvementsMaxPendingTasks: row.improvements_max_pending_tasks ?? row.improvements_max_generated_new ?? 5,
        automationReadinessStatus: row.automation_readiness_status === 'checking'
            ? 'checking'
            : row.automation_readiness_status === 'ready'
                ? 'ready'
                : row.automation_readiness_status === 'degraded'
                    ? 'degraded'
                    : row.automation_readiness_status === 'blocked'
                        ? 'blocked'
                        : 'unknown',
        automationReadinessSummary: row.automation_readiness_summary ?? null,
        automationReadinessCheckedAt: row.automation_readiness_checked_at ?? null,
        lastImprovementsAt: row.last_improvements_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archivedAt: row.archived_at
    }
}

export function createProject(
    db: Database,
    project: {
        id: string
        namespace: string
        machineId: string
        name: string
        description?: string | null
        defaultWorkspaceId?: string | null
        defaultAgentFlavor?: string | null
        defaultPermissionMode?: string | null
        defaultModel?: string | null
        defaultModelMode?: string | null
        defaultSessionType?: 'simple' | 'worktree' | null
        worktreeTargetBranch?: string | null
        worktreeAutoCommitMode?: 'off' | 'per_conversation' | null
        worktreeCleanupAfterMerge?: boolean
        autoRunEnabled?: boolean
        maxRunningSessions?: number
        improvementsEnabled?: boolean
        improvementsMaxPendingTasks?: number
        automationReadinessStatus?: 'unknown' | 'checking' | 'ready' | 'degraded' | 'blocked'
        automationReadinessSummary?: string | null
        automationReadinessCheckedAt?: number | null
    }
): StoredProject {
    const now = Date.now()
    db.prepare(`
        INSERT INTO projects (
            id, namespace, machine_id,
            name, description, default_workspace_id,
            default_agent_flavor, default_permission_mode, default_model, default_model_mode,
            default_session_type, worktree_target_branch, worktree_auto_commit_mode, worktree_cleanup_after_merge,
            auto_run_enabled, max_running_sessions,
            improvements_enabled, improvements_max_pending_tasks,
            automation_readiness_status, automation_readiness_summary, automation_readiness_checked_at,
            created_at, updated_at, archived_at
        ) VALUES (
            @id, @namespace, @machine_id,
            @name, @description, @default_workspace_id,
            @default_agent_flavor, @default_permission_mode, @default_model, @default_model_mode,
            @default_session_type, @worktree_target_branch, @worktree_auto_commit_mode, @worktree_cleanup_after_merge,
            @auto_run_enabled, @max_running_sessions,
            @improvements_enabled, @improvements_max_pending_tasks,
            @automation_readiness_status, @automation_readiness_summary, @automation_readiness_checked_at,
            @created_at, @updated_at, NULL
        )
    `).run({
        id: project.id,
        namespace: project.namespace,
        machine_id: project.machineId,
        name: project.name,
        description: project.description ?? null,
        default_workspace_id: project.defaultWorkspaceId ?? null,
        default_agent_flavor: project.defaultAgentFlavor ?? null,
        default_permission_mode: project.defaultPermissionMode ?? null,
        default_model: project.defaultModel ?? null,
        default_model_mode: project.defaultModelMode ?? null,
        default_session_type: project.defaultSessionType ?? 'simple',
        worktree_target_branch: project.worktreeTargetBranch ?? null,
        worktree_auto_commit_mode: project.worktreeAutoCommitMode ?? 'off',
        worktree_cleanup_after_merge: project.worktreeCleanupAfterMerge ? 1 : 0,
        auto_run_enabled: project.autoRunEnabled ? 1 : 0,
        max_running_sessions: project.maxRunningSessions ?? 5,
        improvements_enabled: project.improvementsEnabled ? 1 : 0,
        improvements_max_pending_tasks: project.improvementsMaxPendingTasks ?? 5,
        automation_readiness_status: project.automationReadinessStatus ?? 'unknown',
        automation_readiness_summary: project.automationReadinessSummary ?? null,
        automation_readiness_checked_at: project.automationReadinessCheckedAt ?? null,
        created_at: now,
        updated_at: now
    })

    const stored = getProject(db, project.id)
    if (!stored) {
        throw new Error('Failed to create project')
    }
    return stored
}

export function getProject(db: Database, projectId: string): StoredProject | null {
    const row = db.prepare('SELECT * FROM projects WHERE id = ? LIMIT 1').get(projectId) as DbProjectRow | undefined
    return row ? toStoredProject(row) : null
}

export function getProjectByNamespace(db: Database, projectId: string, namespace: string): StoredProject | null {
    const row = db.prepare(
        'SELECT * FROM projects WHERE id = ? AND namespace = ? LIMIT 1'
    ).get(projectId, namespace) as DbProjectRow | undefined
    return row ? toStoredProject(row) : null
}

export function listProjectsByNamespace(
    db: Database,
    namespace: string,
    options?: { includeArchived?: boolean }
): StoredProject[] {
    const includeArchived = Boolean(options?.includeArchived)
    const rows = includeArchived
        ? db.prepare(
            'SELECT * FROM projects WHERE namespace = ? ORDER BY updated_at DESC'
        ).all(namespace) as DbProjectRow[]
        : db.prepare(
            'SELECT * FROM projects WHERE namespace = ? AND archived_at IS NULL ORDER BY updated_at DESC'
        ).all(namespace) as DbProjectRow[]
    return rows.map(toStoredProject)
}

export function updateProject(
    db: Database,
    projectId: string,
    namespace: string,
    patch: {
        name?: string
        description?: string | null
        defaultWorkspaceId?: string | null
        defaultAgentFlavor?: string | null
        defaultPermissionMode?: string | null
        defaultModel?: string | null
        defaultModelMode?: string | null
        defaultSessionType?: 'simple' | 'worktree' | null
        worktreeTargetBranch?: string | null
        worktreeAutoCommitMode?: 'off' | 'per_conversation' | null
        worktreeCleanupAfterMerge?: boolean
        autoRunEnabled?: boolean
        maxRunningSessions?: number
        improvementsEnabled?: boolean
        improvementsMaxPendingTasks?: number
        automationReadinessStatus?: 'unknown' | 'checking' | 'ready' | 'degraded' | 'blocked'
        automationReadinessSummary?: string | null
        automationReadinessCheckedAt?: number | null
        lastImprovementsAt?: number | null
        archivedAt?: number | null
    }
): StoredProject | null {
    const current = getProjectByNamespace(db, projectId, namespace)
    if (!current) {
        return null
    }

    const next = {
        ...current,
        name: patch.name ?? current.name,
        description: patch.description !== undefined ? patch.description : current.description,
        defaultWorkspaceId: patch.defaultWorkspaceId !== undefined ? patch.defaultWorkspaceId : current.defaultWorkspaceId,
        defaultAgentFlavor: patch.defaultAgentFlavor !== undefined ? patch.defaultAgentFlavor : current.defaultAgentFlavor,
        defaultPermissionMode: patch.defaultPermissionMode !== undefined ? patch.defaultPermissionMode : current.defaultPermissionMode,
        defaultModel: patch.defaultModel !== undefined ? patch.defaultModel : current.defaultModel,
        defaultModelMode: patch.defaultModelMode !== undefined ? patch.defaultModelMode : current.defaultModelMode,
        defaultSessionType: patch.defaultSessionType !== undefined ? patch.defaultSessionType : current.defaultSessionType,
        worktreeTargetBranch: patch.worktreeTargetBranch !== undefined ? patch.worktreeTargetBranch : current.worktreeTargetBranch,
        worktreeAutoCommitMode: patch.worktreeAutoCommitMode !== undefined ? patch.worktreeAutoCommitMode : current.worktreeAutoCommitMode,
        worktreeCleanupAfterMerge: patch.worktreeCleanupAfterMerge !== undefined ? patch.worktreeCleanupAfterMerge : current.worktreeCleanupAfterMerge,
        autoRunEnabled: patch.autoRunEnabled !== undefined ? patch.autoRunEnabled : current.autoRunEnabled,
        maxRunningSessions: patch.maxRunningSessions ?? current.maxRunningSessions,
        improvementsEnabled: patch.improvementsEnabled !== undefined ? patch.improvementsEnabled : current.improvementsEnabled,
        improvementsMaxPendingTasks: patch.improvementsMaxPendingTasks ?? current.improvementsMaxPendingTasks,
        automationReadinessStatus: patch.automationReadinessStatus !== undefined ? patch.automationReadinessStatus : current.automationReadinessStatus,
        automationReadinessSummary: patch.automationReadinessSummary !== undefined ? patch.automationReadinessSummary : current.automationReadinessSummary,
        automationReadinessCheckedAt: patch.automationReadinessCheckedAt !== undefined ? patch.automationReadinessCheckedAt : current.automationReadinessCheckedAt,
        lastImprovementsAt: patch.lastImprovementsAt !== undefined ? patch.lastImprovementsAt : current.lastImprovementsAt,
        archivedAt: patch.archivedAt !== undefined ? patch.archivedAt : current.archivedAt
    }

    const now = Date.now()
    db.prepare(`
        UPDATE projects SET
            name = @name,
            description = @description,
            default_workspace_id = @default_workspace_id,
            default_agent_flavor = @default_agent_flavor,
            default_permission_mode = @default_permission_mode,
            default_model = @default_model,
            default_model_mode = @default_model_mode,
            default_session_type = @default_session_type,
            worktree_target_branch = @worktree_target_branch,
            worktree_auto_commit_mode = @worktree_auto_commit_mode,
            worktree_cleanup_after_merge = @worktree_cleanup_after_merge,
            auto_run_enabled = @auto_run_enabled,
            max_running_sessions = @max_running_sessions,
            improvements_enabled = @improvements_enabled,
            improvements_max_pending_tasks = @improvements_max_pending_tasks,
            automation_readiness_status = @automation_readiness_status,
            automation_readiness_summary = @automation_readiness_summary,
            automation_readiness_checked_at = @automation_readiness_checked_at,
            last_improvements_at = @last_improvements_at,
            updated_at = @updated_at,
            archived_at = @archived_at
        WHERE id = @id AND namespace = @namespace
    `).run({
        id: projectId,
        namespace,
        name: next.name,
        description: next.description,
        default_workspace_id: next.defaultWorkspaceId,
        default_agent_flavor: next.defaultAgentFlavor,
        default_permission_mode: next.defaultPermissionMode,
        default_model: next.defaultModel,
        default_model_mode: next.defaultModelMode,
        default_session_type: next.defaultSessionType ?? 'simple',
        worktree_target_branch: next.worktreeTargetBranch,
        worktree_auto_commit_mode: next.worktreeAutoCommitMode ?? 'off',
        worktree_cleanup_after_merge: next.worktreeCleanupAfterMerge ? 1 : 0,
        auto_run_enabled: next.autoRunEnabled ? 1 : 0,
        max_running_sessions: next.maxRunningSessions,
        improvements_enabled: next.improvementsEnabled ? 1 : 0,
        improvements_max_pending_tasks: next.improvementsMaxPendingTasks,
        automation_readiness_status: next.automationReadinessStatus,
        automation_readiness_summary: next.automationReadinessSummary,
        automation_readiness_checked_at: next.automationReadinessCheckedAt,
        last_improvements_at: next.lastImprovementsAt,
        updated_at: now,
        archived_at: next.archivedAt
    })

    return getProjectByNamespace(db, projectId, namespace)
}

export function archiveProject(db: Database, projectId: string, namespace: string): boolean {
    const now = Date.now()
    const result = db.prepare(
        'UPDATE projects SET archived_at = ?, updated_at = ? WHERE id = ? AND namespace = ? AND archived_at IS NULL'
    ).run(now, now, projectId, namespace)
    return result.changes > 0
}
