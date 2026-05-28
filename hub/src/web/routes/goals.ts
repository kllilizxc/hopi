import { randomUUID } from 'node:crypto'
import { buildUniqueGoalKey } from '@hopi/protocol'
import { GoalStatusSchema } from '@hopi/protocol/schemas'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Store, StoredGoal, StoredGoalDecisionTopic, StoredProject, StoredTask, StoredWorkspace } from '../../store'
import { buildDecisionBlockedReason, prependTaskHandoffDecisionContext } from '../../sync/goals/decisionHandoff'
import {
    createGoalDecisionTopicInDocs,
    findGoalDecisionTopicLocation,
    readGoalDecisionTopics,
    readGoalDecisionTopicsWithLegacyBackfill,
    resolveGoalDecisionTopicInDocs
} from '../../sync/goals/goalDecisions'
import { executeGoalAssistantCommand } from '../../sync/goals/goalAssistantCommands'
import { bootstrapGoalDocs } from '../../sync/goals/goalDocs'
import { buildGoalDocsImportPreview, importGoalDocs } from '../../sync/goals/goalDocsImport'
import { appendGoalEvent } from '../../sync/goals/goalEvents'
import { createGoalTodoTaskId, readGoalTodo, upsertGoalTodoTaskState } from '../../sync/goals/goalTodo'
import { syncTaskStateToGoalTodo } from '../../sync/goals/goalTodoTaskSync'
import { notifyProjectController } from '../../sync/projectController'
import { getProjectDefaultTaskRuntimeSettings } from '../../sync/projectTaskDefaults'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

const createGoalSchema = z.object({
    title: z.string().trim().min(1).max(255),
    description: z.string().max(20_000).nullable().optional(),
    successCriteria: z.string().max(20_000).nullable().optional(),
    autopilotEnabled: z.boolean().optional(),
    deployRequiresApproval: z.boolean().optional(),
    clientRequestId: z.string().trim().min(1).max(128).optional()
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
    scope: z.enum(['goal', 'task']),
    taskId: z.string().min(1).nullable().optional(),
    title: z.string().trim().min(1).max(255),
    body: z.string().max(20_000),
    blocking: z.boolean().optional()
}).superRefine((topic, ctx) => {
    if (topic.scope === 'task' && !topic.taskId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['taskId'],
            message: 'Task-scoped decision topics require taskId'
        })
    }
    if (topic.scope === 'goal' && topic.taskId) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['taskId'],
            message: 'Goal-scoped decision topics must not include taskId'
        })
    }
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
        `- Read and update .hopi/docs/goals/${goal.goalKey}/design.md.`,
        '- Update the design doc before creating or reshaping engineering tasks.',
        `- Update .hopi/docs/goals/${goal.goalKey}/todo.yml as structured YAML using canonical statuses candidate/planned/in_progress/in_review/merging/blocked/done; blocked is an automation hold, not a separate board lane.`,
        '- Create the first small batch of goal-scoped kanban tasks when the Goal is clear enough, usually 2-3 independent tasks when the lane is empty.',
        '- Create fewer tasks when candidates depend on each other, would edit the same files, or need a human decision.',
        '- If product intent is unclear, create one goal-scoped blocking DecisionTopic with a concrete question and stop.',
        '- Finish with a HOPI_ACTIONS JSON packet that creates planning/ready kanban tasks or a scoped blocking DecisionTopic.',
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

function findGoalScopedBlockingDecision(topics: Array<{ scope: string; status: string; blocking: boolean }>): StoredGoalDecisionTopic | null {
    return topics.find((topic): topic is StoredGoalDecisionTopic => (
        topic.scope === 'goal'
        && topic.status === 'waiting'
        && topic.blocking
    )) ?? null
}

function buildGoalResponse(options: {
    store: Store
    namespace: string
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): StoredGoal & {
    blockedSource: string | null
    blockedReason: string | null
    blockedAt: number | null
} {
    if (options.goal.status !== 'blocked') {
        return {
            ...options.goal,
            blockedSource: null,
            blockedReason: null,
            blockedAt: null
        }
    }

    const topics = readGoalDecisionTopicsWithLegacyBackfill({
        store: options.store,
        namespace: options.namespace,
        project: options.project,
        goal: options.goal,
        defaultWorkspace: options.defaultWorkspace
    })
    const blocker = findGoalScopedBlockingDecision(topics)
    return {
        ...options.goal,
        blockedSource: blocker ? 'decision' : null,
        blockedReason: blocker ? buildDecisionBlockedReason(blocker) : null,
        blockedAt: blocker?.updatedAt ?? null
    }
}

function findDecisionTaskTarget(options: {
    store: Store
    namespace: string
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    taskId: string
}): { task: StoredTask | null } | null {
    const stored = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (stored) {
        return stored.projectId === options.project.id && stored.goalId === options.goal.id
            ? { task: stored }
            : null
    }

    const todo = readGoalTodo({
        project: options.project,
        goal: options.goal,
        defaultWorkspace: options.defaultWorkspace
    })
    const matchingSection = todo.sections.find((section) => (
        section.id === options.taskId
        || section.taskId === options.taskId
        || section.todoRef === options.taskId
    ))
    return matchingSection ? { task: null } : null
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

    const taskTitle = 'Clarify goal and plan first iteration'
    const taskId = createGoalTodoTaskId({
        project: options.project,
        goal: options.goal,
        defaultWorkspace,
        title: taskTitle
    })
    const task = options.store.tasks.createTask({
        id: taskId,
        projectId: options.project.id,
        goalId: options.goal.id,
        goalTodoRef: taskId,
        title: taskTitle,
        description: 'Clarify the Goal, update repo memory, and create the first small batch of executable tasks.',
        status: 'planning',
        priority: 'high',
        sortKey: Date.now(),
        workspaceId: defaultWorkspace?.id ?? null,
        ...getProjectDefaultTaskRuntimeSettings(options.project, { autonomous: true }),
        workflowProfile: 'default',
        role: 'planner',
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
    syncTaskStateToGoalTodo({
        store: options.store,
        namespace: options.namespace,
        task,
        project: options.project,
        defaultWorkspace
    })
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

        const defaultWorkspace = getDefaultWorkspace(options.store, project)
        const engine = options.getSyncEngine()
        const imported = importGoalDocs({
            store: options.store,
            project,
            namespace,
            defaultWorkspace
        })
        const goals = options.store.goals.listGoalsByProjectAndNamespace(projectId, namespace)
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
        return c.json({
            goals: goals.map((goal) => buildGoalResponse({
                store: options.store,
                namespace,
                project,
                goal,
                defaultWorkspace
            }))
        })
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

        const clientRequestId = parsed.data.clientRequestId?.trim() || null
        if (clientRequestId) {
            const existing = options.store.goals.getGoalByClientRequestIdAndNamespace(projectId, namespace, clientRequestId)
            if (existing) {
                const seedTask = ensurePlannerSeedTask({
                    store: options.store,
                    project,
                    goal: existing,
                    namespace
                })
                const engine = options.getSyncEngine()
                if (seedTask) {
                    emitTaskAdded({
                        engine,
                        projectId,
                        namespace,
                        taskId: seedTask.id
                    })
                    emitProjectUpdated({
                        engine,
                        projectId,
                        namespace
                    })
                }
                return c.json({ goal: existing })
            }
        }

        const goalKey = buildUniqueGoalKey(parsed.data.title, (candidate) => (
            Boolean(options.store.goals.getGoalByGoalKeyAndNamespace(projectId, namespace, candidate))
        ))
        let goal: StoredGoal
        try {
            goal = options.store.goals.createGoal({
                id: randomUUID(),
                projectId,
                namespace,
                goalKey,
                clientRequestId,
                title: parsed.data.title,
                description: parsed.data.description ?? null,
                successCriteria: parsed.data.successCriteria ?? null,
                autopilotEnabled: parsed.data.autopilotEnabled ?? true,
                deployRequiresApproval: parsed.data.deployRequiresApproval ?? true
            })
        } catch (error) {
            const existing = clientRequestId
                ? options.store.goals.getGoalByClientRequestIdAndNamespace(projectId, namespace, clientRequestId)
                : null
            if (!existing) {
                throw error
            }
            goal = existing
        }
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

    app.post('/goals/:goalId/automation/pause', (c) => {
        const namespace = c.get('namespace')
        const goalId = c.req.param('goalId')
        const existing = options.store.goals.getGoalByNamespace(goalId, namespace)
        if (!existing) {
            return c.json({ error: 'Goal not found' }, 404)
        }

        const goal = options.store.goals.updateGoalByNamespace(goalId, namespace, {
            automationPausedAt: Date.now()
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

    app.post('/goals/:goalId/automation/resume', (c) => {
        const namespace = c.get('namespace')
        const goalId = c.req.param('goalId')
        const existing = options.store.goals.getGoalByNamespace(goalId, namespace)
        if (!existing) {
            return c.json({ error: 'Goal not found' }, 404)
        }

        const goal = options.store.goals.updateGoalByNamespace(goalId, namespace, {
            automationPausedAt: null
        })
        if (!goal) {
            return c.json({ error: 'Goal not found' }, 404)
        }

        const engine = options.getSyncEngine()
        emitProjectUpdated({
            engine,
            projectId: existing.projectId,
            namespace
        })
        engine?.requestAutoRunTick(namespace, existing.projectId)

        return c.json({ goal })
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

        const topics = readGoalDecisionTopicsWithLegacyBackfill({
            store: options.store,
            namespace,
            project,
            goal,
            defaultWorkspace: getDefaultWorkspace(options.store, project)
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

        const json = await c.req.json().catch(() => null)
        const parsed = createTopicSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const defaultWorkspace = getDefaultWorkspace(options.store, project)
        const taskTarget = parsed.data.scope === 'task' && parsed.data.taskId
            ? findDecisionTaskTarget({
                store: options.store,
                namespace,
                project,
                goal,
                defaultWorkspace,
                taskId: parsed.data.taskId
            })
            : null
        if (parsed.data.scope === 'task' && parsed.data.taskId) {
            if (!taskTarget) {
                return c.json({ error: 'Task not found' }, 404)
            }
        }
        const taskId = parsed.data.scope === 'task' ? parsed.data.taskId! : null

        const topic = createGoalDecisionTopicInDocs({
            id: randomUUID(),
            project,
            goal,
            defaultWorkspace,
            scope: parsed.data.scope,
            taskId,
            title: parsed.data.title,
            body: parsed.data.body,
            blocking: parsed.data.blocking ?? true
        })
        if (!topic) {
            return c.json({ error: 'Project has no workspace' }, 400)
        }

        const engine = options.getSyncEngine()
        if (topic.blocking && topic.scope === 'task' && topic.taskId) {
            const task = taskTarget?.task ?? options.store.tasks.getTaskByNamespace(topic.taskId, namespace)
            if (task && task.status !== 'done' && task.status !== 'finished') {
                const blockedTask = options.store.tasks.updateTaskByNamespace(task.id, namespace, {
                    status: 'blocked',
                    blockedReason: buildDecisionBlockedReason(topic),
                    blockedSource: 'decision',
                    blockedSessionId: null
                })
                if (blockedTask) {
                    syncTaskStateToGoalTodo({
                        store: options.store,
                        namespace,
                        task: blockedTask,
                        project,
                        defaultWorkspace
                    })
                }
                emitTaskUpdated({
                    engine,
                    projectId: task.projectId,
                    namespace,
                    taskId: task.id
                })
            }
        } else if (topic.blocking && topic.scope === 'goal') {
            options.store.goals.updateGoalByNamespace(goal.id, namespace, {
                status: 'blocked'
            })
        }

        appendGoalEvent({
            project,
            goal,
            defaultWorkspace: getDefaultWorkspace(options.store, project),
            action: 'decision_topic_created',
            entity: { type: 'decision_topic', id: topic.id },
            after: {
                status: topic.status,
                scope: topic.scope,
                blocking: topic.blocking,
                taskId: topic.taskId
            },
            reason: topic.body,
            source: { kind: 'api_route', id: 'goals.topics.create' }
        })

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

        emitProjectUpdated({
            engine,
            projectId: goal.projectId,
            namespace
        })

        return c.json({ topic })
    })

    app.post('/goals/:goalId/assistant-commands', async (c) => {
        const namespace = c.get('namespace')
        const goalId = c.req.param('goalId')
        const json = await c.req.json().catch(() => null)
        const result = await executeGoalAssistantCommand({
            store: options.store,
            engine: options.getSyncEngine(),
            namespace,
            goalId,
            rawCommand: json
        })
        return c.json(result.body, result.status)
    })

    app.post('/goal-topics/:topicId/resolve', async (c) => {
        const namespace = c.get('namespace')
        const topicId = c.req.param('topicId')
        const json = await c.req.json().catch(() => null)
        const parsed = resolveTopicSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const location = findGoalDecisionTopicLocation({
            store: options.store,
            namespace,
            topicId
        })
        if (!location) {
            return c.json({ error: 'Topic not found' }, 404)
        }
        const current = location.topic
        const topic = resolveGoalDecisionTopicInDocs({
            project: location.project,
            goal: location.goal,
            defaultWorkspace: location.defaultWorkspace,
            topicId,
            resolution: parsed.data.resolution
        })
        if (!topic) {
            return c.json({ error: 'Topic not found' }, 404)
        }

        const engine = options.getSyncEngine()
        const remainingBlockingTopics = topic.blocking
            ? readGoalDecisionTopics({
                project: location.project,
                goal: location.goal,
                defaultWorkspace: location.defaultWorkspace
            })
                .filter((candidate) => candidate.blocking && candidate.status === 'waiting')
            : []
        const remainingBlockingGoalTopics = remainingBlockingTopics
            .filter((candidate) => candidate.scope === 'goal')
        if (topic.blocking && topic.scope === 'task' && topic.taskId) {
            const stillBlocked = remainingBlockingTopics
                .some((candidate) => (
                    candidate.scope === 'task' &&
                    candidate.taskId === topic.taskId &&
                    candidate.blocking &&
                    candidate.status === 'waiting'
                ))
            if (!stillBlocked) {
                const task = options.store.tasks.getTaskByNamespace(topic.taskId, namespace)
                if (task) {
                    const plannedTask = options.store.tasks.updateTaskByNamespace(task.id, namespace, {
                        status: task.status === 'blocked' ? 'planning' : task.status,
                        handoff: prependTaskHandoffDecisionContext(task, topic),
                        blockedReason: null,
                        blockedSource: null,
                        blockedSessionId: null
                    })
                    if (plannedTask) {
                        if (task.status === 'blocked' && plannedTask.goalId && plannedTask.goalTodoRef) {
                            const project = options.store.projects.getProjectByNamespace(plannedTask.projectId, namespace)
                            const goal = options.store.goals.getGoalByNamespace(plannedTask.goalId, namespace)
                            if (project && goal) {
                                upsertGoalTodoTaskState({
                                    project,
                                    goal,
                                    defaultWorkspace: getDefaultWorkspace(options.store, project),
                                    taskId: plannedTask.goalTodoRef,
                                    status: 'planning',
                                    tag: 'ready',
                                    title: plannedTask.title,
                                    body: plannedTask.description,
                                    blocked: null
                                })
                            }
                        }
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
        if (topic.blocking && topic.scope === 'goal' && remainingBlockingGoalTopics.length === 0) {
            const goal = options.store.goals.getGoalByNamespace(topic.goalId, namespace)
            if (goal?.status === 'blocked') {
                options.store.goals.updateGoalByNamespace(goal.id, namespace, {
                    status: 'active'
                })
            }
        }

        emitProjectUpdated({
            engine,
            projectId: topic.projectId,
            namespace
        })

        appendGoalEvent({
            project: location.project,
            goal: location.goal,
            defaultWorkspace: location.defaultWorkspace,
            action: 'decision_topic_resolved',
            entity: { type: 'decision_topic', id: topic.id },
            before: {
                status: current.status,
                scope: current.scope,
                taskId: current.taskId
            },
            after: {
                status: topic.status,
                scope: topic.scope,
                taskId: topic.taskId,
                resolution: topic.resolution
            },
            reason: parsed.data.resolution,
            source: { kind: 'api_route', id: 'goal-topics.resolve' }
        })

        return c.json({ topic })
    })

    return app
}
