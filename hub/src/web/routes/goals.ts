import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { buildUniqueGoalKey } from '@hopi/protocol'
import { GoalStatusSchema } from '@hopi/protocol/schemas'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Store, StoredGoal, StoredProject, StoredTask, StoredWorkspace } from '../../store'
import { bootstrapGoalDocs, overlayGoalWithCanonicalDoc, syncGoalOwnedDocs } from '../../sync/goals/goalDocs'
import { buildGoalDocsImportPreview, importGoalDocs } from '../../sync/goals/goalDocsImport'
import { createGoalDecisionTopic, resolveGoalDecisionTopic, resumeGoalAutomation } from '../../sync/goals/goalControl'
import { listGoalDecisionTopicsFromDocs } from '../../sync/goals/goalDecisionStore'
import { appendGoalWorkflowEvent, buildDocsBackedGoalWorkflowGoalSnapshot } from '../../sync/goals/goalEventLog'
import { getDocsRoot, getGoalDocPath, getGoalEventsPath, getGoalTodoPath } from '../../sync/goals/goalDocPaths'
import { createGoalTodoTaskId, readGoalTodo, upsertGoalTodoTaskState } from '../../sync/goals/goalTodo'
import {
    buildGoalTodoTaskProjection,
    findGoalTodoTaskProjectionById,
    getTaskByNamespaceOrGoalTodoProjection
} from '../../sync/goals/goalTodoProjection'
import { notifyProjectController } from '../../sync/projectController'
import { getProjectDefaultTaskRuntimeSettings } from '../../sync/projectTaskDefaults'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

const createGoalSchema = z.object({
    title: z.string().trim().min(1).max(255),
    description: z.string().max(20_000).nullable().optional(),
    successCriteria: z.string().max(20_000).nullable().optional(),
    autopilotEnabled: z.boolean().optional(),
    deployRequiresApproval: z.boolean().optional()
})

const updateGoalSchema = z.object({
    title: z.string().trim().min(1).max(255).optional(),
    description: z.string().max(20_000).nullable().optional(),
    status: GoalStatusSchema.optional(),
    successCriteria: z.string().max(20_000).nullable().optional(),
    autopilotEnabled: z.boolean().optional(),
    deployRequiresApproval: z.boolean().optional(),
    currentFocus: z.string().max(20_000).nullable().optional()
})

const createTopicSchema = z.object({
    taskId: z.string().min(1).nullable().optional(),
    title: z.string().trim().min(1).max(255),
    body: z.string().max(20_000),
    blocking: z.boolean().optional()
})

const resolveTopicSchema = z.object({
    resolution: z.string().trim().min(1).max(20_000)
})

function emitProjectUpdated(options: {
    engine: SyncEngine | null
    projectId: string
    namespace: string
}): void {
    options.engine?.handleRealtimeEvent({
        type: 'project-updated',
        projectId: options.projectId,
        namespace: options.namespace,
        data: { projectId: options.projectId }
    })
}

function emitTaskAdded(options: {
    engine: SyncEngine | null
    projectId: string
    namespace: string
    taskId: string
}): void {
    options.engine?.handleRealtimeEvent({
        type: 'task-added',
        taskId: options.taskId,
        projectId: options.projectId,
        namespace: options.namespace,
        data: { taskId: options.taskId }
    })
}

function buildPlannerSeedTaskContract(goal: {
    id: string
    goalKey: string
    title: string
    description: string | null
    successCriteria: string | null
}): string {
    return [
        '## Objective',
        '',
        `Use the brainstorming protocol to clarify this Goal before implementation: ${goal.title}`,
        '',
        goal.description?.trim() ? 'Initial description:' : '',
        goal.description?.trim() ? goal.description.trim() : '',
        '',
        '## Acceptance',
        '',
        `- Read and update .hopi/docs/goals/${goal.goalKey}/goal.md.`,
        `- Read and update .hopi/docs/goals/${goal.goalKey}/design.md before reshaping substantial engineering work.`,
        `- Update .hopi/docs/goals/${goal.goalKey}/todo.yml as canonical YAML with \`goal\` + \`items[]\`, stable \`ref\`, \`kind\`, and statuses such as \`planned\` / \`in_progress\` / \`in_review\` / \`done\`.`,
        `- Use .hopi/docs/goals/${goal.goalKey}/planning-requests.yml for durable planner follow-through instead of creating new candidate/deferred reservoir status.`,
        '- Create the first small batch of goal-scoped kanban tasks when the Goal is clear enough, usually 2-3 independent tasks when the lane is empty.',
        '- Create fewer tasks when candidates depend on each other, would edit the same files, or need a human decision.',
        '- If product intent is unclear, create one blocking DecisionTopic with a concrete question and stop.',
        '- Finish with a HOPI_ACTIONS JSON packet that creates planning/ready kanban tasks or a blocking DecisionTopic.',
        '- For each create_goal_task, write a concise description and a lightweight markdown contract with Type, Context, Involved Files / Areas, Scope, Acceptance, Suggested Checks, and Non-goals / Constraints.',
        '- Include verified files when known; otherwise name likely areas and unknowns instead of inventing paths.',
        '- Use update_current_task inside HOPI_ACTIONS to record handoff/evidence before marking this planning task done.',
        '- HOPI applies the final JSON packet after the turn; do not call separate HOPI state mutation tools.',
        '',
        '## Suggested Checks',
        '',
        '- Confirm the Goal objective, success criteria, and constraints are captured in repo docs.',
        '- Confirm generated tasks have lightweight but executable contracts and stay scoped to this Goal.',
        '',
        '## Non-goals / Constraints',
        '',
        '- Do not implement product/code changes in this planning task.',
        '- Do not promote the entire todo reservoir into the kanban.',
        '- Keep the first task batch small, verifiable, and easy to review.',
        '',
        goal.successCriteria?.trim() ? '## User-Provided Success Criteria' : '',
        goal.successCriteria?.trim() ? goal.successCriteria.trim() : ''
    ].filter((line, index, lines) => {
        if (line !== '') return true
        return lines[index - 1] !== '' || lines[index + 1] !== ''
    }).join('\n').trim()
}

function getDefaultWorkspace(store: Store, project: StoredProject): StoredWorkspace | null {
    return project.defaultWorkspaceId
        ? store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
}

function buildGoalRouteResponseGoal(options: {
    store: Store
    goal: StoredGoal
}): StoredGoal {
    const project = options.store.projects.getProjectByNamespace(options.goal.projectId, options.goal.namespace)
    if (!project) {
        return options.goal
    }

    return overlayGoalWithCanonicalDoc({
        goal: options.goal,
        defaultWorkspace: getDefaultWorkspace(options.store, project)
    })
}

function hasDocsBackedGoalState(options: {
    store: Store
    project: StoredProject
    goal: StoredGoal
}): boolean {
    const docsRoot = getDocsRoot(getDefaultWorkspace(options.store, options.project))
    if (!docsRoot) {
        return true
    }
    return existsSync(getGoalDocPath(docsRoot, options.goal.goalKey))
        || existsSync(getGoalTodoPath(docsRoot, options.goal.goalKey))
}

function appendGoalRouteWorkflowEvent(options: {
    project: StoredProject
    goalId: string
    goalKey: string
    before: Record<string, unknown> | null
    after: Record<string, unknown> | null
    defaultWorkspace: StoredWorkspace | null
    action: string
    reason: string
    metadata?: Record<string, unknown>
}): void {
    const docsRoot = getDocsRoot(options.defaultWorkspace)
    if (!docsRoot) {
        return
    }

    appendGoalWorkflowEvent(getGoalEventsPath(docsRoot, options.goalKey), {
        writer: 'hopi-api',
        action: options.action,
        entity: {
            type: 'goal',
            id: options.goalId
        },
        before: options.before,
        after: options.after,
        reason: options.reason,
        metadata: {
            projectId: options.project.id,
            ...(options.metadata ?? {})
        }
    })
}

function ensurePlannerSeedTask(options: {
    store: Store
    project: StoredProject
    goal: StoredGoal
    namespace: string
}): StoredTask | null {
    if (options.goal.automationPausedAt !== null) {
        return null
    }

    if (options.goal.status !== 'planning') {
        return null
    }

    const defaultWorkspace = getDefaultWorkspace(options.store, options.project)
    const existingTodo = readGoalTodo({
        project: options.project,
        goal: options.goal,
        defaultWorkspace
    })
    const hasNonReservoirTodoItem = existingTodo.board.items.some((item) => !(
        item.status === 'planned' && (item.tag === 'candidate' || item.tag === 'deferred')
    ))
    if (hasNonReservoirTodoItem) {
        return null
    }

    bootstrapGoalDocs({
        project: options.project,
        goal: options.goal,
        defaultWorkspace
    })

    const taskTitle = 'Clarify goal and plan first iteration'
    const taskId = createGoalTodoTaskId({
        project: options.project,
        goal: options.goal,
        defaultWorkspace,
        title: taskTitle
    })
    const taskDescription = 'Clarify the Goal, update repo memory, and create the first small batch of executable tasks.'
    const wroteDocsFirst = Boolean(defaultWorkspace) && upsertGoalTodoTaskState({
        project: options.project,
        goal: options.goal,
        defaultWorkspace,
        taskId,
        status: 'planning',
        tag: 'ready',
        taskKind: 'planning',
        title: taskTitle,
        body: taskDescription,
        blocked: null,
        event: {
            writer: 'hopi-goals-api',
            action: 'goal_planner_seed_backfilled',
            reason: 'Backfilled a missing planner seed todo item for an existing planning goal.',
            metadata: {
                source: 'ensurePlannerSeedTask',
                route: '/api/projects/:projectId/goals'
            }
        }
    })
    const task = options.store.tasks.createTask({
        id: taskId,
        projectId: options.project.id,
        goalId: options.goal.id,
        goalTodoRef: taskId,
        title: taskTitle,
        description: taskDescription,
        status: 'planning',
        priority: 'high',
        sortKey: Date.now(),
        workspaceId: defaultWorkspace?.id ?? null,
        ...getProjectDefaultTaskRuntimeSettings(options.project, { autonomous: true }),
        workflowProfile: 'default',
        source: 'planner',
        contract: buildPlannerSeedTaskContract(options.goal),
        subTasks: [
            {
                id: randomUUID(),
                content: 'Clarify goal intent using the brainstorming protocol',
                status: 'pending',
                priority: 'high'
            },
            {
                id: randomUUID(),
                content: 'Update goal docs and todo reservoir',
                status: 'pending',
                priority: 'medium'
            },
            {
                id: randomUUID(),
                content: 'Create the first small batch of independent goal-scoped tasks',
                status: 'pending',
                priority: 'medium'
            }
        ],
        subTasksUpdatedAt: Date.now()
    })
    if (!wroteDocsFirst) {
        upsertGoalTodoTaskState({
            project: options.project,
            goal: options.goal,
            defaultWorkspace,
            taskId: task.goalTodoRef ?? task.id,
            status: 'planning',
            tag: 'ready',
            taskKind: 'planning',
            title: task.title,
            body: task.description,
            blocked: null,
            event: {
                writer: 'hopi-goals-api',
                action: 'goal_planner_seed_backfilled',
                reason: 'Backfilled a missing planner seed todo item for an existing planning goal.',
                metadata: {
                    source: 'ensurePlannerSeedTask',
                    route: '/api/projects/:projectId/goals'
                }
            }
        })
    }
    return task
}

export function createGoalsRoutes(options: {
    store: Store
    getSyncEngine: () => SyncEngine | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/projects/:projectId/goals', (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const engine = options.getSyncEngine()
        const defaultWorkspace = getDefaultWorkspace(options.store, project)
        const imported = importGoalDocs({
            store: options.store,
            project,
            namespace,
            defaultWorkspace
        })
        const storedGoals = options.store.goals.listGoalsByProjectAndNamespace(projectId, namespace)
        const goals = storedGoals.map((goal) => overlayGoalWithCanonicalDoc({ goal, defaultWorkspace }))
        let repaired = false
        for (const goal of goals) {
            const seedTask = ensurePlannerSeedTask({
                store: options.store,
                project,
                goal,
                namespace
            })
            if (!seedTask) {
                continue
            }
            repaired = true
            emitTaskAdded({
                engine,
                projectId,
                namespace,
                taskId: seedTask.id
            })
        }
        if (imported.imported.length > 0 || repaired) {
            emitProjectUpdated({
                engine,
                projectId,
                namespace
            })
        }
        const docsPreview = buildGoalDocsImportPreview({
            store: options.store,
            project,
            namespace,
            defaultWorkspace
        })
        const docsBackedGoalKeys = new Set(docsPreview.goals.map((goal) => goal.goalKey))
        const visibleGoals = docsPreview.docsRoot
            ? options.store.goals
                .listGoalsByProjectAndNamespace(projectId, namespace)
                .filter((goal) => docsBackedGoalKeys.has(goal.goalKey))
                .map((goal) => overlayGoalWithCanonicalDoc({ goal, defaultWorkspace }))
            : goals
        return c.json({ goals: visibleGoals })
    })

    app.get('/projects/:projectId/goals/:goalId/todo', (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const goalId = c.req.param('goalId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const goal = options.store.goals.getGoalByNamespace(goalId, namespace)
        if (!goal || goal.projectId !== project.id) {
            return c.json({ error: 'Goal not found' }, 404)
        }
        if (!hasDocsBackedGoalState({ store: options.store, project, goal })) {
            return c.json({ error: 'Goal not found' }, 404)
        }

        const todo = readGoalTodo({
            project,
            goal,
            defaultWorkspace: getDefaultWorkspace(options.store, project)
        })

        return c.json({
            board: todo.board,
            tasks: buildGoalTodoTaskProjection({
                store: options.store,
                project,
                goalId: goal.id,
                namespace,
                includeArchived: false
            })
        })
    })

    app.get('/projects/:projectId/goal-docs/import-preview', (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const preview = buildGoalDocsImportPreview({
            store: options.store,
            project,
            namespace,
            defaultWorkspace: getDefaultWorkspace(options.store, project)
        })

        return c.json({
            docsRoot: preview.docsRoot,
            goals: preview.goals.map(({ parsed: _parsed, ...goal }) => goal),
            errors: preview.errors
        })
    })

    app.post('/projects/:projectId/goal-docs/import', (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const result = importGoalDocs({
            store: options.store,
            project,
            namespace,
            defaultWorkspace: getDefaultWorkspace(options.store, project)
        })

        emitProjectUpdated({
            engine: options.getSyncEngine(),
            projectId,
            namespace
        })

        return c.json(result)
    })

    app.post('/projects/:projectId/goals', async (c) => {
        const namespace = c.get('namespace')
        const projectId = c.req.param('projectId')
        const project = options.store.projects.getProjectByNamespace(projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = createGoalSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const goalKey = buildUniqueGoalKey(parsed.data.title, (candidate) => (
            Boolean(options.store.goals.getGoalByGoalKeyAndNamespace(projectId, namespace, candidate))
        ))
        const goal = options.store.goals.createGoal({
            id: randomUUID(),
            projectId,
            namespace,
            goalKey,
            title: parsed.data.title,
            description: parsed.data.description ?? null,
            successCriteria: parsed.data.successCriteria ?? null,
            autopilotEnabled: parsed.data.autopilotEnabled ?? true,
            deployRequiresApproval: parsed.data.deployRequiresApproval ?? true
        })
        const defaultWorkspace = getDefaultWorkspace(options.store, project)
        bootstrapGoalDocs({
            project,
            goal,
            defaultWorkspace
        })
        appendGoalRouteWorkflowEvent({
            project,
            goalId: goal.id,
            goalKey: goal.goalKey,
            before: null,
            after: buildDocsBackedGoalWorkflowGoalSnapshot({
                goal,
                defaultWorkspace
            }),
            defaultWorkspace,
            action: 'goal_created_from_goals_api',
            reason: 'Goal creation route created a durable goal.',
            metadata: {
                source: 'goals_create',
                route: '/api/projects/:projectId/goals'
            }
        })
        const plannerTask = ensurePlannerSeedTask({
            store: options.store,
            project,
            goal,
            namespace
        })

        const engine = options.getSyncEngine()
        if (plannerTask) {
            emitTaskAdded({
                engine,
                projectId,
                namespace,
                taskId: plannerTask.id
            })
        }
        emitProjectUpdated({
            engine,
            projectId,
            namespace
        })

        return c.json({
            goal: buildGoalRouteResponseGoal({
                store: options.store,
                goal
            })
        })
    })

    app.patch('/goals/:goalId', async (c) => {
        const namespace = c.get('namespace')
        const goalId = c.req.param('goalId')
        const existing = options.store.goals.getGoalByNamespace(goalId, namespace)
        if (!existing) {
            return c.json({ error: 'Goal not found' }, 404)
        }
        const project = options.store.projects.getProjectByNamespace(existing.projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }
        if (!hasDocsBackedGoalState({ store: options.store, project, goal: existing })) {
            return c.json({ error: 'Goal not found' }, 404)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = updateGoalSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const goal = options.store.goals.updateGoalByNamespace(goalId, namespace, {
            title: parsed.data.title,
            description: parsed.data.description,
            status: parsed.data.status,
            successCriteria: parsed.data.successCriteria,
            autopilotEnabled: parsed.data.autopilotEnabled,
            deployRequiresApproval: parsed.data.deployRequiresApproval,
            currentFocus: parsed.data.currentFocus
        })
        if (!goal) {
            return c.json({ error: 'Goal not found' }, 404)
        }
        if (project) {
            const defaultWorkspace = getDefaultWorkspace(options.store, project)
            const beforeSnapshot = buildDocsBackedGoalWorkflowGoalSnapshot({
                goal: existing,
                defaultWorkspace
            })
            syncGoalOwnedDocs({
                project,
                goal,
                defaultWorkspace
            })
            appendGoalRouteWorkflowEvent({
                project,
                goalId: goal.id,
                goalKey: goal.goalKey,
                before: beforeSnapshot,
                after: buildDocsBackedGoalWorkflowGoalSnapshot({
                    goal,
                    defaultWorkspace
                }),
                defaultWorkspace,
                action: 'goal_updated_from_goals_api',
                reason: 'Goal patch route updated the durable goal metadata.',
                metadata: {
                    source: 'goals_patch',
                    route: '/api/goals/:goalId'
                }
            })
        }

        emitProjectUpdated({
            engine: options.getSyncEngine(),
            projectId: existing.projectId,
            namespace
        })

        return c.json({
            goal: buildGoalRouteResponseGoal({
                store: options.store,
                goal
            })
        })
    })

    app.post('/goals/:goalId/automation/pause', (c) => {
        const namespace = c.get('namespace')
        const goalId = c.req.param('goalId')
        const existing = options.store.goals.getGoalByNamespace(goalId, namespace)
        if (!existing) {
            return c.json({ error: 'Goal not found' }, 404)
        }
        const project = options.store.projects.getProjectByNamespace(existing.projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }
        if (!hasDocsBackedGoalState({ store: options.store, project, goal: existing })) {
            return c.json({ error: 'Goal not found' }, 404)
        }

        const goal = options.store.goals.updateGoalByNamespace(goalId, namespace, {
            automationPausedAt: Date.now()
        })
        if (!goal) {
            return c.json({ error: 'Goal not found' }, 404)
        }
        if (project) {
            const defaultWorkspace = getDefaultWorkspace(options.store, project)
            appendGoalRouteWorkflowEvent({
                project,
                goalId: goal.id,
                goalKey: goal.goalKey,
                before: buildDocsBackedGoalWorkflowGoalSnapshot({
                    goal: existing,
                    defaultWorkspace
                }),
                after: buildDocsBackedGoalWorkflowGoalSnapshot({
                    goal,
                    defaultWorkspace
                }),
                defaultWorkspace,
                action: 'goal_automation_paused_from_goals_api',
                reason: 'Goal automation pause route updated the automation pause state.',
                metadata: {
                    source: 'goal_automation_pause',
                    route: '/api/goals/:goalId/automation/pause'
                }
            })
        }

        emitProjectUpdated({
            engine: options.getSyncEngine(),
            projectId: existing.projectId,
            namespace
        })

        return c.json({
            goal: buildGoalRouteResponseGoal({
                store: options.store,
                goal
            })
        })
    })

    app.post('/goals/:goalId/automation/resume', (c) => {
        const namespace = c.get('namespace')
        const goalId = c.req.param('goalId')
        const existing = options.store.goals.getGoalByNamespace(goalId, namespace)
        if (!existing) {
            return c.json({ error: 'Goal not found' }, 404)
        }
        const project = options.store.projects.getProjectByNamespace(existing.projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }
        if (!hasDocsBackedGoalState({ store: options.store, project, goal: existing })) {
            return c.json({ error: 'Goal not found' }, 404)
        }

        const goal = resumeGoalAutomation({
            store: options.store,
            engine: options.getSyncEngine(),
            namespace,
            goalId
        })
        if (!goal) {
            return c.json({ error: 'Goal not found' }, 404)
        }
        if (project) {
            const defaultWorkspace = getDefaultWorkspace(options.store, project)
            appendGoalRouteWorkflowEvent({
                project,
                goalId: goal.id,
                goalKey: goal.goalKey,
                before: buildDocsBackedGoalWorkflowGoalSnapshot({
                    goal: existing,
                    defaultWorkspace
                }),
                after: buildDocsBackedGoalWorkflowGoalSnapshot({
                    goal,
                    defaultWorkspace
                }),
                defaultWorkspace,
                action: 'goal_automation_resumed_from_goals_api',
                reason: 'Goal automation resume route updated the automation pause state.',
                metadata: {
                    source: 'goal_automation_resume',
                    route: '/api/goals/:goalId/automation/resume'
                }
            })
        }

        return c.json({
            goal: buildGoalRouteResponseGoal({
                store: options.store,
                goal
            })
        })
    })

    app.get('/goals/:goalId/topics', (c) => {
        const namespace = c.get('namespace')
        const goalId = c.req.param('goalId')
        const goal = options.store.goals.getGoalByNamespace(goalId, namespace)
        if (!goal) {
            return c.json({ error: 'Goal not found' }, 404)
        }
        const project = options.store.projects.getProjectByNamespace(goal.projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }
        if (!hasDocsBackedGoalState({ store: options.store, project, goal })) {
            return c.json({ error: 'Goal not found' }, 404)
        }
        const defaultWorkspace = getDefaultWorkspace(options.store, project)
        if (!getDocsRoot(defaultWorkspace)) {
            return c.json({ error: 'Workspace docs root unavailable' }, 400)
        }
        const topics = listGoalDecisionTopicsFromDocs({
            project,
            goal,
            defaultWorkspace
        })
        return c.json({ topics })
    })

    app.post('/goals/:goalId/topics', async (c) => {
        const namespace = c.get('namespace')
        const goalId = c.req.param('goalId')
        const goal = options.store.goals.getGoalByNamespace(goalId, namespace)
        if (!goal) {
            return c.json({ error: 'Goal not found' }, 404)
        }
        const project = options.store.projects.getProjectByNamespace(goal.projectId, namespace)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }
        if (!hasDocsBackedGoalState({ store: options.store, project, goal })) {
            return c.json({ error: 'Goal not found' }, 404)
        }
        const defaultWorkspace = getDefaultWorkspace(options.store, project)
        if (!getDocsRoot(defaultWorkspace)) {
            return c.json({ error: 'Workspace docs root unavailable' }, 400)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = createTopicSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        if (parsed.data.taskId) {
            const task = findGoalTodoTaskProjectionById({
                store: options.store,
                namespace,
                taskId: parsed.data.taskId,
                includeArchived: false
            })
            if (!task || task.projectId !== goal.projectId || task.goalId !== goalId) {
                return c.json({ error: 'Task not found' }, 404)
            }
        }

        const engine = options.getSyncEngine()
        const created = createGoalDecisionTopic({
            store: options.store,
            engine,
            namespace,
            project,
            goal,
            taskId: parsed.data.taskId ?? null,
            title: parsed.data.title,
            body: parsed.data.body,
            blocking: parsed.data.blocking ?? true,
            writer: 'hopi-api',
            reason: 'Created a durable decision topic from the goals API.'
        })
        const topic = created.topic

        notifyProjectController({
            store: options.store,
            engine,
            namespace,
            projectId: topic.projectId,
            goalId: topic.goalId,
            taskId: topic.taskId,
            kind: 'decision',
            title: topic.title,
            body: topic.body
        })

        return c.json({ topic })
    })

    app.post('/goal-topics/:topicId/resolve', async (c) => {
        const namespace = c.get('namespace')
        const topicId = c.req.param('topicId')
        const json = await c.req.json().catch(() => null)
        const parsed = resolveTopicSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const resolved = resolveGoalDecisionTopic({
            store: options.store,
            engine: options.getSyncEngine(),
            namespace,
            topicId,
            resolution: parsed.data.resolution
        })
        if (!resolved) {
            return c.json({ error: 'Topic not found' }, 404)
        }

        return c.json({ topic: resolved.topic })
    })

    return app
}
