import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

const createWorkspacesSchema = z.object({
    workspaces: z.array(z.object({
        path: z.string().min(1).max(4096),
        label: z.string().max(255).optional()
    })).min(1).max(50)
})

const updateWorkspaceSchema = z.object({
    path: z.string().min(1).max(4096).optional(),
    label: z.string().max(255).nullable().optional(),
    sort: z.number().int().nullable().optional()
})

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

        const json = await c.req.json().catch(() => null)
        const parsed = createWorkspacesSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const created = []
        try {
            for (const input of parsed.data.workspaces) {
                const workspaceId = randomUUID()
                created.push(options.store.workspaces.createWorkspace({
                    id: workspaceId,
                    projectId,
                    path: input.path,
                    label: input.label ?? null
                }))
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to create workspace'
            if (message.includes('UNIQUE') || message.includes('unique')) {
                return c.json({ error: 'Workspace path already exists' }, 409)
            }
            return c.json({ error: message }, 500)
        }

        const engine = options.getSyncEngine()
        for (const workspace of created) {
            engine?.handleRealtimeEvent({
                type: 'workspace-added',
                workspaceId: workspace.id,
                projectId,
                namespace,
                data: { workspaceId: workspace.id }
            })
        }

        return c.json({ workspaces: created })
    })

    app.patch('/workspaces/:workspaceId', async (c) => {
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

        const json = await c.req.json().catch(() => null)
        const parsed = updateWorkspaceSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const updated = options.store.workspaces.updateWorkspace(workspaceId, {
                path: parsed.data.path,
                label: parsed.data.label,
                sort: parsed.data.sort
            })
            if (!updated) {
                return c.json({ error: 'Workspace not found' }, 404)
            }

            const engine = options.getSyncEngine()
            engine?.handleRealtimeEvent({
                type: 'workspace-updated',
                workspaceId,
                projectId: existing.projectId,
                namespace,
                data: { workspaceId }
            })

            return c.json({ workspace: updated })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to update workspace'
            if (message.includes('UNIQUE') || message.includes('unique')) {
                return c.json({ error: 'Workspace path already exists' }, 409)
            }
            return c.json({ error: message }, 500)
        }
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

        const ok = options.store.workspaces.deleteWorkspace(workspaceId)
        if (!ok) {
            return c.json({ error: 'Failed to delete workspace' }, 500)
        }

        const engine = options.getSyncEngine()
        engine?.handleRealtimeEvent({
            type: 'workspace-removed',
            workspaceId,
            projectId: existing.projectId,
            namespace
        })

        return c.json({ ok: true })
    })

    return app
}

