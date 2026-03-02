import { AgentFlavorSchema, ModelModeSchema, PermissionModeSchema, SessionTypeSchema, WorktreeAutoCommitModeSchema } from '@hapi/protocol/schemas'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Store, StoredWorkspace } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

const createProjectSchema = z.object({
    machineId: z.string().min(1),
    name: z.string().min(1).max(255),
    description: z.string().max(10_000).optional(),
    workspaces: z.array(z.object({
        path: z.string().min(1).max(4096),
        label: z.string().max(255).optional()
    })).min(1).max(50),
    defaultAgentFlavor: AgentFlavorSchema.optional(),
    defaultPermissionMode: PermissionModeSchema.optional(),
    defaultModelMode: ModelModeSchema.optional(),
    defaultSessionType: SessionTypeSchema.optional(),
    worktreeTargetBranch: z.string().max(255).optional(),
    worktreeAutoCommitMode: WorktreeAutoCommitModeSchema.optional(),
    worktreeCleanupAfterMerge: z.boolean().optional(),
    autoRunEnabled: z.boolean().optional(),
    maxRunningSessions: z.number().int().min(1).max(50).optional(),
    improvementsEnabled: z.boolean().optional(),
    improvementsMaxGeneratedNew: z.number().int().min(1).max(50).optional()
})

const updateProjectSchema = z.object({
    machineId: z.string().min(1).optional(),
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(10_000).nullable().optional(),
    defaultAgentFlavor: AgentFlavorSchema.nullable().optional(),
    defaultPermissionMode: PermissionModeSchema.nullable().optional(),
    defaultModelMode: ModelModeSchema.nullable().optional(),
    defaultSessionType: SessionTypeSchema.nullable().optional(),
    worktreeTargetBranch: z.string().max(255).nullable().optional(),
    worktreeAutoCommitMode: WorktreeAutoCommitModeSchema.nullable().optional(),
    worktreeCleanupAfterMerge: z.boolean().optional(),
    autoRunEnabled: z.boolean().optional(),
    maxRunningSessions: z.number().int().min(1).max(50).optional(),
    improvementsEnabled: z.boolean().optional(),
    improvementsMaxGeneratedNew: z.number().int().min(1).max(50).optional()
})

const listQuerySchema = z.object({
    includeArchived: z.enum(['true', 'false']).optional()
})

export function createProjectsRoutes(options: {
    store: Store
    getSyncEngine: () => SyncEngine | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/projects', (c) => {
        const namespace = c.get('namespace')
        const query = listQuerySchema.safeParse(c.req.query())
        const includeArchived = query.success ? query.data.includeArchived === 'true' : false
        const projects = options.store.projects.listProjectsByNamespace(namespace, { includeArchived })
        const items = projects.map((project) => {
            const workspaceCount = options.store.workspaces.listWorkspacesByProject(project.id).length
            return {
                ...project,
                workspaceCount
            }
        })
        return c.json({ projects: items })
    })

    app.post('/projects', async (c) => {
        const namespace = c.get('namespace')
        const json = await c.req.json().catch(() => null)
        if (json && typeof json === 'object' && !Array.isArray(json) && 'defaultWorkspaceId' in json) {
            return c.json({ error: 'defaultWorkspaceId is immutable; set workspace order at creation instead' }, 400)
        }
        const parsed = createProjectSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const normalizedWorkspaces = parsed.data.workspaces.map((input) => ({
            path: input.path.trim(),
            label: input.label?.trim() ? input.label.trim() : null
        }))
        if (normalizedWorkspaces.some((workspace) => workspace.path.length === 0)) {
            return c.json({ error: 'Workspace path is required' }, 400)
        }

        const uniquePaths = new Set(normalizedWorkspaces.map((workspace) => workspace.path))
        if (uniquePaths.size !== normalizedWorkspaces.length) {
            return c.json({ error: 'Duplicate workspace paths are not allowed' }, 400)
        }

        const projectId = randomUUID()
        const created = options.store.projects.createProject({
            id: projectId,
            namespace,
            machineId: parsed.data.machineId,
            name: parsed.data.name,
            description: parsed.data.description ?? null,
            defaultWorkspaceId: null,
            defaultAgentFlavor: parsed.data.defaultAgentFlavor ?? null,
            defaultPermissionMode: parsed.data.defaultPermissionMode ?? null,
            defaultModelMode: parsed.data.defaultModelMode ?? null,
            defaultSessionType: parsed.data.defaultSessionType ?? null,
            worktreeTargetBranch: parsed.data.worktreeTargetBranch ?? null,
            worktreeAutoCommitMode: parsed.data.worktreeAutoCommitMode ?? null,
            worktreeCleanupAfterMerge: parsed.data.worktreeCleanupAfterMerge,
            autoRunEnabled: parsed.data.autoRunEnabled,
            maxRunningSessions: parsed.data.maxRunningSessions,
            improvementsEnabled: parsed.data.improvementsEnabled,
            improvementsMaxGeneratedNew: parsed.data.improvementsMaxGeneratedNew
        })

        const createdWorkspaces: StoredWorkspace[] = []
        try {
            for (const workspace of normalizedWorkspaces) {
                createdWorkspaces.push(options.store.workspaces.createWorkspace({
                    id: randomUUID(),
                    projectId,
                    path: workspace.path,
                    label: workspace.label
                }))
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to create workspace'
            if (message.includes('UNIQUE') || message.includes('unique')) {
                return c.json({ error: 'Workspace path already exists' }, 409)
            }
            return c.json({ error: message }, 500)
        }

        const defaultWorkspaceId = createdWorkspaces[0]?.id ?? null
        const project = defaultWorkspaceId
            ? options.store.projects.updateProject(projectId, namespace, { defaultWorkspaceId }) ?? created
            : created

        const engine = options.getSyncEngine()
        engine?.handleRealtimeEvent({ type: 'project-added', projectId, namespace, data: { projectId } })
        for (const workspace of createdWorkspaces) {
            engine?.handleRealtimeEvent({
                type: 'workspace-added',
                workspaceId: workspace.id,
                projectId,
                namespace,
                data: { workspaceId: workspace.id }
            })
        }

        return c.json({ project })
    })

    app.get('/projects/:projectId', (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const workspaceCount = options.store.workspaces.listWorkspacesByProject(projectId).length
        return c.json({ project: { ...project, workspaceCount } })
    })

    app.patch('/projects/:projectId', async (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const json = await c.req.json().catch(() => null)
        if (json && typeof json === 'object' && !Array.isArray(json) && 'defaultWorkspaceId' in json) {
            return c.json({ error: 'defaultWorkspaceId is immutable after project creation' }, 400)
        }
        const parsed = updateProjectSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const existing = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!existing) {
            return c.json({ error: 'Project not found' }, 404)
        }

        if (parsed.data.machineId && parsed.data.machineId !== existing.machineId) {
            return c.json({ error: 'machineId is immutable in v1' }, 400)
        }

        const updated = options.store.projects.updateProject(projectId, namespace, {
            name: parsed.data.name,
            description: parsed.data.description,
            defaultAgentFlavor: parsed.data.defaultAgentFlavor,
            defaultPermissionMode: parsed.data.defaultPermissionMode,
            defaultModelMode: parsed.data.defaultModelMode,
            defaultSessionType: parsed.data.defaultSessionType,
            worktreeTargetBranch: parsed.data.worktreeTargetBranch,
            worktreeAutoCommitMode: parsed.data.worktreeAutoCommitMode,
            worktreeCleanupAfterMerge: parsed.data.worktreeCleanupAfterMerge,
            autoRunEnabled: parsed.data.autoRunEnabled,
            maxRunningSessions: parsed.data.maxRunningSessions,
            improvementsEnabled: parsed.data.improvementsEnabled,
            improvementsMaxGeneratedNew: parsed.data.improvementsMaxGeneratedNew
        })

        if (!updated) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const engine = options.getSyncEngine()
        engine?.handleRealtimeEvent({ type: 'project-updated', projectId, namespace, data: { projectId } })

        return c.json({ project: updated })
    })

    app.post('/projects/:projectId/archive', (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const ok = options.store.projects.archiveProject(projectId, namespace)
        if (!ok) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const engine = options.getSyncEngine()
        engine?.handleRealtimeEvent({ type: 'project-updated', projectId, namespace, data: { projectId, archived: true } })

        return c.json({ ok: true })
    })

    app.post('/projects/:projectId/auto-run/tick', (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        engine.requestAutoRunTick(namespace, projectId)
        return c.json({ ok: true })
    })

    return app
}
