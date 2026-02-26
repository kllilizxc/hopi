import type { Database } from 'bun:sqlite'

import type { StoredWorkspace } from './types'
import { createWorkspace, deleteWorkspace, getWorkspace, listWorkspacesByProject, updateWorkspace } from './workspaces'

export class WorkspaceStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getWorkspace(workspaceId: string): StoredWorkspace | null {
        return getWorkspace(this.db, workspaceId)
    }

    listWorkspacesByProject(projectId: string): StoredWorkspace[] {
        return listWorkspacesByProject(this.db, projectId)
    }

    createWorkspace(workspace: {
        id: string
        projectId: string
        label?: string | null
        path: string
        sort?: number | null
    }): StoredWorkspace {
        return createWorkspace(this.db, workspace)
    }

    updateWorkspace(workspaceId: string, patch: { label?: string | null; path?: string; sort?: number | null }): StoredWorkspace | null {
        return updateWorkspace(this.db, workspaceId, patch)
    }

    deleteWorkspace(workspaceId: string): boolean {
        return deleteWorkspace(this.db, workspaceId)
    }
}

