import type { Database } from 'bun:sqlite'

import type { StoredProject } from './types'
import { archiveProject, createProject, getProject, getProjectByNamespace, listProjectsByNamespace, updateProject } from './projects'

export class ProjectStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    createProject(project: {
        id: string
        namespace: string
        machineId: string
        name: string
        description?: string | null
        defaultWorkspaceId?: string | null
        defaultAgentFlavor?: string | null
        defaultPermissionMode?: string | null
        defaultModelMode?: string | null
        autoRunEnabled?: boolean
        maxRunningSessions?: number
        improvementsEnabled?: boolean
        improvementsMaxGeneratedNew?: number
    }): StoredProject {
        return createProject(this.db, project)
    }

    getProject(projectId: string): StoredProject | null {
        return getProject(this.db, projectId)
    }

    getProjectByNamespace(projectId: string, namespace: string): StoredProject | null {
        return getProjectByNamespace(this.db, projectId, namespace)
    }

    listProjectsByNamespace(namespace: string, options?: { includeArchived?: boolean }): StoredProject[] {
        return listProjectsByNamespace(this.db, namespace, options)
    }

    updateProject(
        projectId: string,
        namespace: string,
        patch: {
            name?: string
            description?: string | null
            defaultWorkspaceId?: string | null
            defaultAgentFlavor?: string | null
            defaultPermissionMode?: string | null
            defaultModelMode?: string | null
            autoRunEnabled?: boolean
            maxRunningSessions?: number
            improvementsEnabled?: boolean
            improvementsMaxGeneratedNew?: number
            lastImprovementsAt?: number | null
            archivedAt?: number | null
        }
    ): StoredProject | null {
        return updateProject(this.db, projectId, namespace, patch)
    }

    archiveProject(projectId: string, namespace: string): boolean {
        return archiveProject(this.db, projectId, namespace)
    }
}

