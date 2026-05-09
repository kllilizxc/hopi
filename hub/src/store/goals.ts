import type { Database } from 'bun:sqlite'

import type { StoredGoal } from './types'

type DbGoalRow = {
    id: string
    project_id: string
    namespace: string
    title: string
    description: string | null
    status: StoredGoal['status']
    success_criteria: string | null
    autopilot_enabled: number
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
        title: row.title,
        description: row.description,
        status: row.status,
        successCriteria: row.success_criteria,
        autopilotEnabled: Boolean(row.autopilot_enabled),
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

export function createGoal(
    db: Database,
    goal: {
        id: string
        projectId: string
        namespace: string
        title: string
        description?: string | null
        status?: StoredGoal['status']
        successCriteria?: string | null
        autopilotEnabled?: boolean
        deployRequiresApproval?: boolean
        currentFocus?: string | null
    }
): StoredGoal {
    const now = Date.now()
    db.prepare(`
        INSERT INTO goals (
            id, project_id, namespace, title, description, status,
            success_criteria, autopilot_enabled, deploy_requires_approval, current_focus,
            created_at, updated_at, archived_at
        ) VALUES (
            @id, @project_id, @namespace, @title, @description, @status,
            @success_criteria, @autopilot_enabled, @deploy_requires_approval, @current_focus,
            @created_at, @updated_at, NULL
        )
    `).run({
        id: goal.id,
        project_id: goal.projectId,
        namespace: goal.namespace,
        title: goal.title,
        description: goal.description ?? null,
        status: goal.status ?? 'planning',
        success_criteria: goal.successCriteria ?? null,
        autopilot_enabled: goal.autopilotEnabled ? 1 : 0,
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
        'title' | 'description' | 'status' | 'successCriteria' | 'autopilotEnabled' | 'deployRequiresApproval' | 'currentFocus' | 'archivedAt'
    >>
): StoredGoal | null {
    const current = getGoalByNamespace(db, goalId, namespace)
    if (!current) {
        return null
    }

    const next = {
        ...current,
        title: patch.title ?? current.title,
        description: patch.description !== undefined ? patch.description : current.description,
        status: patch.status ?? current.status,
        successCriteria: patch.successCriteria !== undefined ? patch.successCriteria : current.successCriteria,
        autopilotEnabled: patch.autopilotEnabled !== undefined ? patch.autopilotEnabled : current.autopilotEnabled,
        deployRequiresApproval: patch.deployRequiresApproval !== undefined ? patch.deployRequiresApproval : current.deployRequiresApproval,
        currentFocus: patch.currentFocus !== undefined ? patch.currentFocus : current.currentFocus,
        archivedAt: patch.archivedAt !== undefined ? patch.archivedAt : current.archivedAt
    }
    const now = Date.now()

    db.prepare(`
        UPDATE goals SET
            title = @title,
            description = @description,
            status = @status,
            success_criteria = @success_criteria,
            autopilot_enabled = @autopilot_enabled,
            deploy_requires_approval = @deploy_requires_approval,
            current_focus = @current_focus,
            updated_at = @updated_at,
            archived_at = @archived_at
        WHERE id = @id AND namespace = @namespace
    `).run({
        id: goalId,
        namespace,
        title: next.title,
        description: next.description,
        status: next.status,
        success_criteria: next.successCriteria,
        autopilot_enabled: next.autopilotEnabled ? 1 : 0,
        deploy_requires_approval: next.deployRequiresApproval ? 1 : 0,
        current_focus: next.currentFocus,
        updated_at: now,
        archived_at: next.archivedAt
    })

    return getGoalByNamespace(db, goalId, namespace)
}
