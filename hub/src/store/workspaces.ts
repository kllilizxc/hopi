import type { Database } from 'bun:sqlite'

import type { StoredWorkspace } from './types'

type DbWorkspaceRow = {
    id: string
    project_id: string
    label: string | null
    path: string
    sort: number | null
    created_at: number
    updated_at: number
}

function toStoredWorkspace(row: DbWorkspaceRow): StoredWorkspace {
    return {
        id: row.id,
        projectId: row.project_id,
        label: row.label,
        path: row.path,
        sort: row.sort,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

export function getWorkspace(db: Database, workspaceId: string): StoredWorkspace | null {
    const row = db.prepare('SELECT * FROM workspaces WHERE id = ? LIMIT 1').get(workspaceId) as DbWorkspaceRow | undefined
    return row ? toStoredWorkspace(row) : null
}

export function listWorkspacesByProject(db: Database, projectId: string): StoredWorkspace[] {
    const rows = db.prepare(
        'SELECT * FROM workspaces WHERE project_id = ? ORDER BY (sort IS NULL) ASC, sort ASC, created_at ASC, id ASC'
    ).all(projectId) as DbWorkspaceRow[]
    return rows.map(toStoredWorkspace)
}

export function createWorkspace(
    db: Database,
    workspace: {
        id: string
        projectId: string
        label?: string | null
        path: string
        sort?: number | null
    }
): StoredWorkspace {
    const now = Date.now()
    db.prepare(`
        INSERT INTO workspaces (
            id, project_id, label, path, sort, created_at, updated_at
        ) VALUES (
            @id, @project_id, @label, @path, @sort, @created_at, @updated_at
        )
    `).run({
        id: workspace.id,
        project_id: workspace.projectId,
        label: workspace.label ?? null,
        path: workspace.path,
        sort: workspace.sort ?? null,
        created_at: now,
        updated_at: now
    })

    const stored = getWorkspace(db, workspace.id)
    if (!stored) {
        throw new Error('Failed to create workspace')
    }
    return stored
}

export function updateWorkspace(
    db: Database,
    workspaceId: string,
    patch: {
        label?: string | null
        path?: string
        sort?: number | null
    }
): StoredWorkspace | null {
    const current = getWorkspace(db, workspaceId)
    if (!current) {
        return null
    }

    const next = {
        ...current,
        label: patch.label !== undefined ? patch.label : current.label,
        path: patch.path ?? current.path,
        sort: patch.sort !== undefined ? patch.sort : current.sort
    }

    const now = Date.now()
    db.prepare(`
        UPDATE workspaces SET
            label = @label,
            path = @path,
            sort = @sort,
            updated_at = @updated_at
        WHERE id = @id
    `).run({
        id: workspaceId,
        label: next.label,
        path: next.path,
        sort: next.sort,
        updated_at: now
    })

    return getWorkspace(db, workspaceId)
}

export function deleteWorkspace(db: Database, workspaceId: string): boolean {
    const result = db.prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)
    return result.changes > 0
}
