import type { Database } from 'bun:sqlite'
import { normalizeGoalKey } from '@hopi/protocol'

import type { StoredGoal } from './types'

type DbGoalRow = {
    id: string
    project_id: string
    namespace: string
    goal_key: string
    client_request_id: string | null
    title: string
    description: string | null
    status: StoredGoal['status']
    success_criteria: string | null
    autopilot_enabled: number
    automation_paused_at?: number | null
    deploy_requires_approval: number
    current_focus: string | null
    created_at: number
    updated_at: number
    archived_at: number | null
}

function toStoredGoal(row: DbGoalRow): StoredGoal {
    return {
        id: row.id,
        projectId: row.project_id,
        namespace: row.namespace,
        goalKey: row.goal_key,
        title: row.title,
        description: row.description,
        status: row.status,
        successCriteria: row.success_criteria,
        autopilotEnabled: Boolean(row.autopilot_enabled),
        automationPausedAt: row.automation_paused_at ?? null,
        deployRequiresApproval: Boolean(row.deploy_requires_approval),
        currentFocus: row.current_focus,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        archivedAt: row.archived_at
    }
}

export function listGoalsByProjectAndNamespace(
    db: Database,
    projectId: string,
    namespace: string,
    options?: { includeArchived?: boolean }
): StoredGoal[] {
    const includeArchived = Boolean(options?.includeArchived)
    const rows = includeArchived
        ? db.prepare(`
            SELECT *
            FROM goals
            WHERE project_id = ? AND namespace = ?
            ORDER BY updated_at DESC
        `).all(projectId, namespace) as DbGoalRow[]
        : db.prepare(`
            SELECT *
            FROM goals
            WHERE project_id = ? AND namespace = ? AND archived_at IS NULL
            ORDER BY updated_at DESC
        `).all(projectId, namespace) as DbGoalRow[]
    return rows.map(toStoredGoal)
}

export function getGoalByNamespace(db: Database, goalId: string, namespace: string): StoredGoal | null {
    const row = db.prepare(`
        SELECT *
        FROM goals
        WHERE id = ? AND namespace = ?
        LIMIT 1
    `).get(goalId, namespace) as DbGoalRow | undefined
    return row ? toStoredGoal(row) : null
}

export function getGoalByGoalKeyAndNamespace(
    db: Database,
    projectId: string,
    namespace: string,
    goalKey: string
): StoredGoal | null {
    const row = db.prepare(`
        SELECT *
        FROM goals
        WHERE project_id = ? AND namespace = ? AND goal_key = ?
        LIMIT 1
    `).get(projectId, namespace, normalizeGoalKey(goalKey)) as DbGoalRow | undefined
    return row ? toStoredGoal(row) : null
}

export function getGoalByClientRequestIdAndNamespace(
    db: Database,
    projectId: string,
    namespace: string,
    clientRequestId: string
): StoredGoal | null {
    const normalized = clientRequestId.trim()
    if (!normalized) return null
    const row = db.prepare(`
        SELECT *
        FROM goals
        WHERE project_id = ? AND namespace = ? AND client_request_id = ?
        LIMIT 1
    `).get(projectId, namespace, normalized) as DbGoalRow | undefined
    return row ? toStoredGoal(row) : null
}

export function createGoal(
    db: Database,
    goal: {
        id: string
        projectId: string
        namespace: string
        goalKey?: string
        clientRequestId?: string | null
        title: string
        description?: string | null
        status?: StoredGoal['status']
        successCriteria?: string | null
        autopilotEnabled?: boolean
        automationPausedAt?: number | null
        deployRequiresApproval?: boolean
        currentFocus?: string | null
    }
): StoredGoal {
    const now = Date.now()
    db.prepare(`
        INSERT INTO goals (
            id, project_id, namespace, goal_key, client_request_id, title, description, status,
            success_criteria, autopilot_enabled, automation_paused_at, deploy_requires_approval, current_focus,
            created_at, updated_at, archived_at
        ) VALUES (
            @id, @project_id, @namespace, @goal_key, @client_request_id, @title, @description, @status,
            @success_criteria, @autopilot_enabled, @automation_paused_at, @deploy_requires_approval, @current_focus,
            @created_at, @updated_at, NULL
        )
    `).run({
        id: goal.id,
        project_id: goal.projectId,
        namespace: goal.namespace,
        goal_key: normalizeGoalKey(goal.goalKey ?? goal.title),
        client_request_id: goal.clientRequestId?.trim() || null,
        title: goal.title,
        description: goal.description ?? null,
        status: goal.status ?? 'planning',
        success_criteria: goal.successCriteria ?? null,
        autopilot_enabled: goal.autopilotEnabled ? 1 : 0,
        automation_paused_at: goal.automationPausedAt ?? null,
        deploy_requires_approval: goal.deployRequiresApproval === false ? 0 : 1,
        current_focus: goal.currentFocus ?? null,
        created_at: now,
        updated_at: now
    })

    const stored = getGoalByNamespace(db, goal.id, goal.namespace)
    if (!stored) {
        throw new Error('Failed to create goal')
    }
    return stored
}

export function updateGoalByNamespace(
    db: Database,
    goalId: string,
    namespace: string,
    patch: Partial<Pick<
        StoredGoal,
        'goalKey' | 'title' | 'description' | 'status' | 'successCriteria' | 'autopilotEnabled' | 'automationPausedAt' | 'deployRequiresApproval' | 'currentFocus' | 'archivedAt'
    >>
): StoredGoal | null {
    const current = getGoalByNamespace(db, goalId, namespace)
    if (!current) {
        return null
    }

    const next = {
        ...current,
        goalKey: patch.goalKey !== undefined ? normalizeGoalKey(patch.goalKey) : current.goalKey,
        title: patch.title ?? current.title,
        description: patch.description !== undefined ? patch.description : current.description,
        status: patch.status ?? current.status,
        successCriteria: patch.successCriteria !== undefined ? patch.successCriteria : current.successCriteria,
        autopilotEnabled: patch.autopilotEnabled !== undefined ? patch.autopilotEnabled : current.autopilotEnabled,
        automationPausedAt: patch.automationPausedAt !== undefined ? patch.automationPausedAt : current.automationPausedAt,
        deployRequiresApproval: patch.deployRequiresApproval !== undefined ? patch.deployRequiresApproval : current.deployRequiresApproval,
        currentFocus: patch.currentFocus !== undefined ? patch.currentFocus : current.currentFocus,
        archivedAt: patch.archivedAt !== undefined ? patch.archivedAt : current.archivedAt
    }
    const now = Date.now()

    db.prepare(`
        UPDATE goals SET
            goal_key = @goal_key,
            title = @title,
            description = @description,
            status = @status,
            success_criteria = @success_criteria,
            autopilot_enabled = @autopilot_enabled,
            automation_paused_at = @automation_paused_at,
            deploy_requires_approval = @deploy_requires_approval,
            current_focus = @current_focus,
            updated_at = @updated_at,
            archived_at = @archived_at
        WHERE id = @id AND namespace = @namespace
    `).run({
        id: goalId,
        namespace,
        goal_key: next.goalKey,
        title: next.title,
        description: next.description,
        status: next.status,
        success_criteria: next.successCriteria,
        autopilot_enabled: next.autopilotEnabled ? 1 : 0,
        automation_paused_at: next.automationPausedAt,
        deploy_requires_approval: next.deployRequiresApproval ? 1 : 0,
        current_focus: next.currentFocus,
        updated_at: now,
        archived_at: next.archivedAt
    })

    return getGoalByNamespace(db, goalId, namespace)
}
