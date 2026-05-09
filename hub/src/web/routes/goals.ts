import { randomUUID } from 'node:crypto'
import { DEFAULT_AGENT_FLAVOR, DEFAULT_AUTONOMOUS_TASK_PERMISSION_MODE, DEFAULT_TASK_MODEL } from '@hopi/protocol'
import { GoalStatusSchema } from '@hopi/protocol/schemas'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Store, StoredGoal, StoredProject, StoredTask, StoredWorkspace } from '../../store'
import { bootstrapGoalDocs } from '../../sync/goals/goalDocs'
import { readGoalTodo } from '../../sync/goals/goalTodo'
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

function emitTaskUpdated(options: {
    engine: SyncEngine | null
    projectId: string
    namespace: string
    taskId: string
}): void {
    options.engine?.handleRealtimeEvent({
        type: 'task-updated',
        taskId: options.taskId,
        projectId: options.projectId,
        namespace: options.namespace,
        data: { taskId: options.taskId }
    })
}

function buildPlannerSeedTaskContract(goal: {
    id: string
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
        `- Read and update .hopi/docs/goals/${goal.id}.md.`,
        '- Update .hopi/docs/todo.md with curated candidate/ready work.',
        '- Create the first small batch of goal-scoped kanban tasks when the Goal is clear enough.',
        '- If product intent is unclear, create one blocking DecisionTopic with a concrete question and stop.',
        '- Finish with a HOPI_ACTIONS JSON packet that creates ready kanban tasks or a blocking DecisionTopic.',
        '- Use update_current_task inside HOPI_ACTIONS to record handoff/evidence before finishing this planning task.',
        '- HOPI applies the final JSON packet after the turn; do not call separate HOPI state mutation tools.',
        '',
        '## Suggested Checks',
        '',
        '- Confirm the Goal objective, success criteria, and constraints are captured in repo docs.',
        '- Confirm generated tasks have lightweight contracts and stay scoped to this Goal.',
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

function ensurePlannerSeedTask(options: {
    store: Store
    project: StoredProject
    goal: StoredGoal
    namespace: string
}): StoredTask | null {
    if (options.goal.status !== 'planning') {
        return null
    }

    const existingTasks = options.store.tasks.listTasksByProjectAndNamespace(options.project.id, options.namespace, {
        goalId: options.goal.id
    })
    if (existingTasks.length > 0) {
        return null
    }

    const defaultWorkspace = getDefaultWorkspace(options.store, options.project)
    bootstrapGoalDocs({
        project: options.project,
        goal: options.goal,
        defaultWorkspace
    })

    return options.store.tasks.createTask({
        id: randomUUID(),
        projectId: options.project.id,
        goalId: options.goal.id,
        title: 'Clarify goal and plan first iteration',
        description: 'Clarify the Goal, update repo memory, and create the first small batch of executable tasks.',
        status: 'planned',
        priority: 'high',
        sortKey: Date.now(),
        workspaceId: defaultWorkspace?.id ?? null,
        agentFlavor: DEFAULT_AGENT_FLAVOR,
        permissionMode: DEFAULT_AUTONOMOUS_TASK_PERMISSION_MODE,
        model: DEFAULT_TASK_MODEL,
        modelMode: null,
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
                content: 'Create the first small batch of goal-scoped tasks',
                status: 'pending',
                priority: 'medium'
            }
        ],
        subTasksUpdatedAt: Date.now()
    })
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

        const goals = options.store.goals.listGoalsByProjectAndNamespace(projectId, namespace)
        const engine = options.getSyncEngine()
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
        if (repaired) {
            emitProjectUpdated({
                engine,
                projectId,
                namespace
            })
        }
        return c.json({ goals })
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

        return c.json(readGoalTodo({
            project,
            goal,
            defaultWorkspace: getDefaultWorkspace(options.store, project)
        }))
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

        const goal = options.store.goals.createGoal({
            id: randomUUID(),
            projectId,
            namespace,
            title: parsed.data.title,
            description: parsed.data.description ?? null,
            successCriteria: parsed.data.successCriteria ?? null,
            autopilotEnabled: parsed.data.autopilotEnabled ?? true,
            deployRequiresApproval: parsed.data.deployRequiresApproval ?? true
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

        return c.json({ goal })
    })

    app.patch('/goals/:goalId', async (c) => {
        const namespace = c.get('namespace')
        const goalId = c.req.param('goalId')
        const existing = options.store.goals.getGoalByNamespace(goalId, namespace)
        if (!existing) {
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

        emitProjectUpdated({
            engine: options.getSyncEngine(),
            projectId: existing.projectId,
            namespace
        })

        return c.json({ goal })
    })

    app.get('/goals/:goalId/topics', (c) => {
        const namespace = c.get('namespace')
        const goalId = c.req.param('goalId')
        const goal = options.store.goals.getGoalByNamespace(goalId, namespace)
        if (!goal) {
            return c.json({ error: 'Goal not found' }, 404)
        }

        const topics = options.store.goalDecisionTopics.listByGoalAndNamespace(goalId, namespace)
        return c.json({ topics })
    })

    app.post('/goals/:goalId/topics', async (c) => {
        const namespace = c.get('namespace')
        const goalId = c.req.param('goalId')
        const goal = options.store.goals.getGoalByNamespace(goalId, namespace)
        if (!goal) {
            return c.json({ error: 'Goal not found' }, 404)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = createTopicSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        if (parsed.data.taskId) {
            const task = options.store.tasks.getTaskByNamespace(parsed.data.taskId, namespace)
            if (!task || task.projectId !== goal.projectId || task.goalId !== goalId) {
                return c.json({ error: 'Task not found' }, 404)
            }
        }

        const topic = options.store.goalDecisionTopics.create({
            id: randomUUID(),
            projectId: goal.projectId,
            goalId,
            namespace,
            taskId: parsed.data.taskId ?? null,
            title: parsed.data.title,
            body: parsed.data.body,
            blocking: parsed.data.blocking ?? true
        })

        const engine = options.getSyncEngine()
        if (topic.blocking && topic.taskId) {
            const task = options.store.tasks.getTaskByNamespace(topic.taskId, namespace)
            if (task && task.status !== 'finished' && task.status !== 'blocked') {
                const blockedTask = options.store.tasks.updateTaskByNamespace(task.id, namespace, {
                    status: 'blocked'
                })
                if (blockedTask) {
                    emitTaskUpdated({
                        engine,
                        projectId: blockedTask.projectId,
                        namespace,
                        taskId: blockedTask.id
                    })
                }
            }
        }

        emitProjectUpdated({
            engine,
            projectId: goal.projectId,
            namespace
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

        const topic = options.store.goalDecisionTopics.resolveByNamespace(topicId, namespace, parsed.data.resolution)
        if (!topic) {
            return c.json({ error: 'Topic not found' }, 404)
        }

        const engine = options.getSyncEngine()
        if (topic.blocking && topic.taskId) {
            const stillBlocked = options.store.goalDecisionTopics
                .listByGoalAndNamespace(topic.goalId, namespace)
                .some((candidate) => (
                    candidate.taskId === topic.taskId &&
                    candidate.blocking &&
                    candidate.status === 'waiting'
                ))
            if (!stillBlocked) {
                const task = options.store.tasks.getTaskByNamespace(topic.taskId, namespace)
                if (task?.status === 'blocked') {
                    const plannedTask = options.store.tasks.updateTaskByNamespace(task.id, namespace, {
                        status: 'planned'
                    })
                    if (plannedTask) {
                        emitTaskUpdated({
                            engine,
                            projectId: plannedTask.projectId,
                            namespace,
                            taskId: plannedTask.id
                        })
                    }
                }
            }
        }

        emitProjectUpdated({
            engine,
            projectId: topic.projectId,
            namespace
        })

        return c.json({ topic })
    })

    return app
}
