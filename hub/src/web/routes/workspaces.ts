import { Hono } from 'hono'
import type { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

const IMMUTABLE_WORKSPACE_ERROR = 'Workspace settings are immutable after project creation'

export function createWorkspacesRoutes(options: {
    store: Store
    getSyncEngine: () => SyncEngine | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/projects/:projectId/workspaces', (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const workspaces = options.store.workspaces.listWorkspacesByProject(projectId)
        return c.json({ workspaces })
    })

    app.post('/projects/:projectId/workspaces', async (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }
        return c.json({ error: IMMUTABLE_WORKSPACE_ERROR }, 400)
    })

    app.patch('/workspaces/:workspaceId', (c) => {
        const namespace = c.get('namespace')
        const workspaceId = c.req.param('workspaceId')
        const existing = options.store.workspaces.getWorkspace(workspaceId)
        if (!existing) {
            return c.json({ error: 'Workspace not found' }, 404)
        }

        const project = options.store.projects.getProjectByNamespace(existing.projectId, namespace)
        if (!project) {
            return c.json({ error: 'Workspace access denied' }, 403)
        }
        return c.json({ error: IMMUTABLE_WORKSPACE_ERROR }, 400)
    })

    app.delete('/workspaces/:workspaceId', (c) => {
        const namespace = c.get('namespace')
        const workspaceId = c.req.param('workspaceId')
        const existing = options.store.workspaces.getWorkspace(workspaceId)
        if (!existing) {
            return c.json({ error: 'Workspace not found' }, 404)
        }

        const project = options.store.projects.getProjectByNamespace(existing.projectId, namespace)
        if (!project) {
            return c.json({ error: 'Workspace access denied' }, 403)
        }
        return c.json({ error: IMMUTABLE_WORKSPACE_ERROR }, 400)
    })

    return app
}
