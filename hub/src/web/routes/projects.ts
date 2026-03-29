import { AgentFlavorSchema, ModelModeSchema, ModelNameSchema, PermissionModeSchema, SessionTypeSchema, WorktreeAutoCommitModeSchema } from '@hopi/protocol/schemas'
import {
    PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH,
    PRODUCT_ENV,
} from '@hopi/protocol/brand'
import { Hono } from 'hono'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Store, StoredWorkspace } from '../../store'
import { verifyProjectAutomationReadiness } from '../../sync/projectAutomationReadiness'
import type { SyncEngine } from '../../sync/syncEngine'
import { listWorkflowStrategyDescriptors } from '../../sync/workflowStrategy'
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
    defaultModel: ModelNameSchema.optional(),
    defaultModelMode: ModelModeSchema.optional(),
    defaultSessionType: SessionTypeSchema.optional(),
    worktreeTargetBranch: z.string().max(255).optional(),
    worktreeAutoCommitMode: WorktreeAutoCommitModeSchema.optional(),
    worktreeCleanupAfterMerge: z.boolean().optional(),
    autoRunEnabled: z.boolean().optional(),
    maxRunningSessions: z.number().int().min(1).max(50).optional(),
    improvementsEnabled: z.boolean().optional(),
    improvementsMaxPendingTasks: z.number().int().min(1).max(50).optional(),
})

const updateProjectSchema = z.object({
    machineId: z.string().min(1).optional(),
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(10_000).nullable().optional(),
    defaultAgentFlavor: AgentFlavorSchema.nullable().optional(),
    defaultPermissionMode: PermissionModeSchema.nullable().optional(),
    defaultModel: ModelNameSchema.nullable().optional(),
    defaultModelMode: ModelModeSchema.nullable().optional(),
    defaultSessionType: SessionTypeSchema.nullable().optional(),
    worktreeTargetBranch: z.string().max(255).nullable().optional(),
    worktreeAutoCommitMode: WorktreeAutoCommitModeSchema.nullable().optional(),
    worktreeCleanupAfterMerge: z.boolean().optional(),
    autoRunEnabled: z.boolean().optional(),
    maxRunningSessions: z.number().int().min(1).max(50).optional(),
    improvementsEnabled: z.boolean().optional(),
    improvementsMaxPendingTasks: z.number().int().min(1).max(50).optional(),
})

const listQuerySchema = z.object({
    includeArchived: z.enum(['true', 'false']).optional()
})

function hasProjectHistory(store: Store, options: { projectId: string; namespace: string }): boolean {
    const tasks = store.tasks.listTasksByProjectAndNamespace(options.projectId, options.namespace, { includeArchived: true })
    const hasMeaningfulTaskHistory = tasks.some((task) => {
        if (task.source !== 'project_init') {
            return true
        }
        if (task.status !== 'planned') {
            return true
        }
        return Boolean(task.activeSessionId)
    })
    if (hasMeaningfulTaskHistory) {
        return true
    }

    const sessions = store.sessions.getSessionsByNamespace(options.namespace)
    return sessions.some((session) => {
        const metadata = session.metadata
        if (!metadata || typeof metadata !== 'object') {
            return false
        }
        return (metadata as { projectId?: unknown }).projectId === options.projectId
    })
}

function buildProjectInitTaskDescription(options: {
    projectName: string
    sessionType: 'simple' | 'worktree'
    targetBranch: string | null
}): string {
    const mergeRequirement = options.sessionType === 'worktree'
        ? [
            options.targetBranch
                ? `- This project uses worktree mode. Merge workflow must land task branches into target branch \`${options.targetBranch}\`.`
                : '- This project uses worktree mode. Merge workflow must detect or require a configured target branch before landing.',
            '- Merge action runs from the task worktree. Do not blindly `git checkout` the target branch inside that worktree; the branch may already be checked out in another worktree.',
            `- Prefer a worktree-safe strategy that uses \`${PRODUCT_ENV.WORKTREE_BASE_PATH}\` for target-branch operations, or another git flow that updates the target branch without checked-out-branch conflicts.`,
            `- Merge workflow can rely on \`${PRODUCT_ENV.MERGE_TARGET_BRANCH}\`, \`${PRODUCT_ENV.MERGE_SOURCE_BRANCH}\`, \`${PRODUCT_ENV.WORKTREE_BASE_PATH}\`, and \`${PRODUCT_ENV.WORKTREE_PATH}\` when available.`
        ].join('\n')
        : '- This project currently uses simple mode. Merge workflow should still define a clear target-branch policy when no worktree context is available.'

    return [
        `Bootstrap task for project "${options.projectName}".`,
        '',
        'Goal:',
        `Create a project automation contract at \`${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}\` by analyzing the current repository structure.`,
        '',
        'Required contract sections:',
        '1) `setup.steps`',
        '   - All setup needed before a task prompt starts: dependency install/check, generated files, env prep, submodules, etc.',
        '2) `preview.services`',
        '   - All preview/runtime services needed for review-ready work, including readiness checks and one primary exposed service.',
        '3) `merge`',
        '   - Landing strategy, target branch policy, verify checks, and conflict-resolution policy.',
        '',
        'Requirements:',
        '- Use declarative YAML as the platform API. Avoid repo-specific shell entrypoints unless they are invoked by explicit contract steps.',
        '- Keep the contract minimal and project-specific; no unrelated refactors.',
        '- Prefer deterministic commands and explicit readiness checks; no command guessing.',
        mergeRequirement,
        '',
        'Validation (must be completed before marking this task finished):',
        '- Parse the contract successfully.',
        '- Execute and verify setup workflow end-to-end.',
        '- Execute and verify preview stack reaches a stable primary URL.',
        '- Document merge workflow strategy and verify checks for this project mode.',
        '- Summarize validation commands and results in your final response.',
        '',
        'Completion rule:',
        'Do not finish this task until the contract is fully tested and confirmed working.'
    ].join('\n')
}

export function createProjectsRoutes(options: {
    store: Store
    getSyncEngine: () => SyncEngine | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/workflow-strategies', (c) => {
        return c.json({
            strategies: listWorkflowStrategyDescriptors()
        })
    })

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
            defaultModel: parsed.data.defaultModel ?? null,
            defaultModelMode: parsed.data.defaultModelMode ?? null,
            defaultSessionType: parsed.data.defaultSessionType ?? null,
            worktreeTargetBranch: parsed.data.worktreeTargetBranch ?? null,
            worktreeAutoCommitMode: parsed.data.worktreeAutoCommitMode ?? null,
            worktreeCleanupAfterMerge: parsed.data.worktreeCleanupAfterMerge,
            autoRunEnabled: parsed.data.autoRunEnabled,
            maxRunningSessions: parsed.data.maxRunningSessions,
            improvementsEnabled: parsed.data.improvementsEnabled,
            improvementsMaxPendingTasks: parsed.data.improvementsMaxPendingTasks
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

        const initTaskId = randomUUID()
        const initTaskDescription = buildProjectInitTaskDescription({
            projectName: project.name,
            sessionType: project.defaultSessionType === 'worktree' ? 'worktree' : 'simple',
            targetBranch: project.worktreeTargetBranch ?? null
        })
        options.store.tasks.createTask({
            id: initTaskId,
            projectId,
            title: 'Initialize project scripts',
            description: initTaskDescription,
            status: 'planned',
            sortKey: Date.now(),
            workspaceId: defaultWorkspaceId,
            source: 'project_init',
            workflowProfile: 'default'
        })

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
        engine?.handleRealtimeEvent({ type: 'task-added', taskId: initTaskId, projectId, namespace, data: { taskId: initTaskId } })

        const workspaceCount = options.store.workspaces.listWorkspacesByProject(projectId).length
        return c.json({
            project: {
                ...project,
                workspaceCount,
                worktreeLocked: hasProjectHistory(options.store, { projectId, namespace })
            }
        })
    })

    app.get('/projects/:projectId', (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const workspaceCount = options.store.workspaces.listWorkspacesByProject(projectId).length
        return c.json({
            project: {
                ...project,
                workspaceCount,
                worktreeLocked: hasProjectHistory(options.store, { projectId, namespace })
            }
        })
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

        const currentSessionType = existing.defaultSessionType ?? 'simple'
        const nextSessionType = parsed.data.defaultSessionType === undefined
            ? currentSessionType
            : parsed.data.defaultSessionType ?? 'simple'
        const sessionTypeChanged = nextSessionType !== currentSessionType
        if (currentSessionType === 'worktree' && nextSessionType !== 'worktree') {
            return c.json({ error: 'defaultSessionType downgrade is not supported (simple -> worktree only)' }, 400)
        }

        const targetBranchChanged = parsed.data.worktreeTargetBranch !== undefined
            && (parsed.data.worktreeTargetBranch ?? null) !== (existing.worktreeTargetBranch ?? null)
        if ((sessionTypeChanged || targetBranchChanged) && hasProjectHistory(options.store, { projectId, namespace })) {
            return c.json({ error: 'worktree mode and target branch are immutable after first task/session' }, 400)
        }

        const updated = options.store.projects.updateProject(projectId, namespace, {
            name: parsed.data.name,
            description: parsed.data.description,
            defaultAgentFlavor: parsed.data.defaultAgentFlavor,
            defaultPermissionMode: parsed.data.defaultPermissionMode,
            defaultModel: parsed.data.defaultModel,
            defaultModelMode: parsed.data.defaultModelMode,
            defaultSessionType: parsed.data.defaultSessionType,
            worktreeTargetBranch: parsed.data.worktreeTargetBranch,
            worktreeAutoCommitMode: parsed.data.worktreeAutoCommitMode,
            worktreeCleanupAfterMerge: parsed.data.worktreeCleanupAfterMerge,
            autoRunEnabled: parsed.data.autoRunEnabled,
            maxRunningSessions: parsed.data.maxRunningSessions,
            improvementsEnabled: parsed.data.improvementsEnabled,
            improvementsMaxPendingTasks: parsed.data.improvementsMaxPendingTasks
        })

        if (!updated) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const engine = options.getSyncEngine()
        engine?.handleRealtimeEvent({ type: 'project-updated', projectId, namespace, data: { projectId } })

        const workspaceCount = options.store.workspaces.listWorkspacesByProject(projectId).length
        return c.json({
            project: {
                ...updated,
                workspaceCount,
                worktreeLocked: hasProjectHistory(options.store, { projectId, namespace })
            }
        })
    })

    app.post('/projects/:projectId/verify-automation', async (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const engine = options.getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const result = await verifyProjectAutomationReadiness({
            store: options.store,
            engine,
            namespace,
            projectId
        })
        if (!result.ok) {
            return c.json({ error: result.error }, result.status)
        }

        engine.handleRealtimeEvent({ type: 'project-updated', projectId, namespace, data: { projectId } })

        const workspaceCount = options.store.workspaces.listWorkspacesByProject(projectId).length
        return c.json({
            project: {
                ...result.project,
                workspaceCount,
                worktreeLocked: hasProjectHistory(options.store, { projectId, namespace })
            },
            verification: result.report
        })
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
