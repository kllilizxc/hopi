import { randomUUID } from 'node:crypto'
import { DEFAULT_AGENT_FLAVOR, DEFAULT_AUTONOMOUS_TASK_PERMISSION_MODE, DEFAULT_TASK_MODEL, normalizeAutomationLaneLimits } from '@hopi/protocol'
import { HopiTaskRoleSchema } from '@hopi/protocol/schemas'
import type { SyncEvent } from '@hopi/protocol/types'
import type { AutomationLane } from '@hopi/protocol/types'
import { buildTaskSessionStartFailureToast } from '@hopi/protocol/task-session-start'
import type { Store, StoredGoal, StoredProject, StoredTask, StoredWorkspace } from '../store'
import type { SyncEngine } from './syncEngine'
import { buildResolvedDecisionHandoff } from './goals/decisionHandoff'
import { bootstrapGoalDocs } from './goals/goalDocs'
import { continueTaskInLinkedSession, startSessionFromTask } from './taskSessionService'
import { getWorkflowStrategy } from './workflowStrategy'

type ProjectKey = `${string}:${string}`
type TaskAutopilotPolicy = {
    enabled: boolean
    allowBeforeReadiness: boolean
}

const GOAL_RADAR_INTERVAL_MS = 24 * 60 * 60 * 1000
const ACTIVE_GOAL_STATUSES = new Set(['planning', 'active'])
const OPEN_GOAL_TASK_STATUSES = new Set(['planned', 'in_progress', 'in_review', 'blocked'])
const AUTOMATION_LANE_PRIORITY: Record<AutomationLane, number> = {
    evaluator: 0,
    planner: 1,
    generator: 2,
    radar: 3
}

function toProjectKey(namespace: string, projectId: string): ProjectKey {
    return `${namespace}:${projectId}`
}

function createLaneCounts(): Record<AutomationLane, number> {
    return {
        planner: 0,
        generator: 0,
        evaluator: 0,
        radar: 0
    }
}

function toRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

function getTaskAutomationLane(task: Pick<StoredTask, 'status' | 'source'>): AutomationLane {
    if (task.status === 'in_review') {
        return 'evaluator'
    }
    if (task.source === 'planner') {
        return 'planner'
    }
    if (task.source === 'radar') {
        return 'radar'
    }
    return 'generator'
}

function getSessionAutomationLane(session: { metadata?: unknown }): AutomationLane | null {
    const metadata = toRecord(session.metadata)
    if (!metadata) {
        return null
    }
    const parsed = HopiTaskRoleSchema.safeParse(metadata.hopiTaskRole)
    return parsed.success ? parsed.data : 'generator'
}

function countRunningSessionsByLane(
    sessions: Array<{ thinking?: boolean; metadata?: unknown }>,
    projectId: string
): Record<AutomationLane, number> {
    const counts = createLaneCounts()
    for (const session of sessions) {
        if (!session.thinking) {
            continue
        }
        const metadata = toRecord(session.metadata)
        if (metadata?.projectId !== projectId) {
            continue
        }
        const lane = getSessionAutomationLane(session)
        if (!lane) {
            continue
        }
        counts[lane] += 1
    }
    return counts
}

function sessionHasPendingRequests(session: { agentState?: unknown } | null | undefined): boolean {
    const agentState = session?.agentState
    if (!agentState || typeof agentState !== 'object') {
        return false
    }
    const requests = (agentState as { requests?: unknown }).requests
    return Boolean(requests && typeof requests === 'object' && Object.keys(requests).length > 0)
}

function sortAutomationCandidates(tasks: StoredTask[]): StoredTask[] {
    return tasks
        .map((task, index) => ({ task, index, lane: getTaskAutomationLane(task) }))
        .sort((left, right) => {
            const laneOrder = AUTOMATION_LANE_PRIORITY[left.lane] - AUTOMATION_LANE_PRIORITY[right.lane]
            if (laneOrder !== 0) {
                return laneOrder
            }
            return left.index - right.index
        })
        .map((item) => item.task)
}

function isTaskAutoRunnable(task: {
    status: string
    archivedAt: number | null
    activeSessionId: string | null
    source: string | null
    goalId: string | null
    workflowPhase: string | null
    workflowProfile: string
}, options: {
    namespace: string
    project: StoredProject
    store: Store
    engine: Pick<SyncEngine, 'getSessionByNamespace'>
}): boolean {
    const isReviewTask = task.status === 'in_review'
    if (task.status !== 'planned' && !isReviewTask) return false
    if (task.archivedAt) return false
    if (task.activeSessionId) {
        const linkedSession = options.engine.getSessionByNamespace(task.activeSessionId, options.namespace)
        if (
            task.status === 'planned'
            && linkedSession?.active
            && (!task.goalId || linkedSession.thinking || sessionHasPendingRequests(linkedSession))
        ) {
            return false
        }
        if (isReviewTask && linkedSession?.thinking) {
            return false
        }
    }
    if (task.source === 'improvements_scan') return false
    if (isReviewTask && task.source === 'evaluator') return false
    if (!getTaskAutopilotPolicy({ task, ...options }).enabled) return false
    const strategy = getWorkflowStrategy(task)
    return strategy.canAutoRunTask(task)
}

function isGoalRunnable(goal: StoredGoal): boolean {
    return !goal.archivedAt
        && ACTIVE_GOAL_STATUSES.has(goal.status)
}

function isGoalAutomationPaused(goal: StoredGoal): boolean {
    return goal.automationPausedAt !== null
}

function isGoalAutopilotRunnable(goal: StoredGoal): boolean {
    return goal.autopilotEnabled
        && !isGoalAutomationPaused(goal)
        && isGoalRunnable(goal)
}

function getTaskAutopilotPolicy(options: {
    task: Pick<StoredTask, 'goalId' | 'source'>
    project: StoredProject
    store: Store
    namespace: string
}): TaskAutopilotPolicy {
    if (!options.task.goalId) {
        return {
            enabled: options.project.autoRunEnabled,
            allowBeforeReadiness: options.task.source === 'project_init'
        }
    }

    const goal = options.store.goals.getGoalByNamespace(options.task.goalId, options.namespace)
    if (
        !goal
        || goal.projectId !== options.project.id
        || isGoalAutomationPaused(goal)
        || !isGoalRunnable(goal)
    ) {
        return {
            enabled: false,
            allowBeforeReadiness: false
        }
    }

    const goalAutopilotEnabled = isGoalAutopilotRunnable(goal)

    return {
        enabled: options.project.autoRunEnabled || goalAutopilotEnabled,
        allowBeforeReadiness: true
    }
}

function buildPlannerLoopContract(options: {
    goal: StoredGoal
    targetOpenGeneratorTasks: number
    currentOpenGeneratorTasks: number
}): string {
    const taskBudget = Math.max(0, options.targetOpenGeneratorTasks - options.currentOpenGeneratorTasks)
    return [
        '## Objective',
        '',
        `Continue the Planner loop for Goal ${options.goal.id}: ${options.goal.title}.`,
        '',
        '## Kanban Fill Target',
        '',
        `- Target open generator tasks: ${options.targetOpenGeneratorTasks}.`,
        `- Current open generator tasks: ${options.currentOpenGeneratorTasks}.`,
        `- Create up to ${taskBudget} independent ready generator tasks to fill the generator lane.`,
        '- Create fewer tasks when candidates depend on each other, would edit the same files, or need a human decision.',
        '',
        '## Acceptance',
        '',
        `- Read and update .hopi/docs/goals/${options.goal.goalKey}.md when strategy or status changed.`,
        '- Read and curate .hopi/docs/todo.md; promote only a small ready batch into kanban.',
        '- Update .hopi/docs/decisions.md when human answers have lasting impact.',
        '- Create blocking DecisionTopics for unclear product direction, one question at a time.',
        '- Create goal-scoped tasks with lightweight contracts using the final HOPI_ACTIONS packet.',
        '- Leave Goal completion to explicit user archive/done actions; do not create a completion DecisionTopic.',
        '- Do not mark the Goal paused, done, or archived just because the current iteration looks complete.',
        '- If later candidates remain, promote enough independent ready candidates to keep the generator lane usefully filled.',
        '- If no next work is actionable, update docs/currentFocus and finish without changing Goal lifecycle status.',
        '',
        '## Suggested Checks',
        '',
        '- Confirm active kanban work is not overfilled beyond the fill target.',
        '- Confirm todo items are candidate/ready/active/done/parked rather than an uncurated dump.',
        '',
        '## Non-goals / Constraints',
        '',
        '- Do not implement code in this Planner task.',
        '- Keep docs maintenance concise and durable.',
        '- Do not deploy or release without explicit human approval.'
    ].join('\n')
}

function buildRadarContract(goal: StoredGoal): string {
    return [
        '## Objective',
        '',
        `Run background Radar for Goal ${goal.id}: ${goal.title}.`,
        '',
        '## Acceptance',
        '',
        '- Scan .hopi/docs/index.md, .hopi/docs/todo.md, .hopi/docs/decisions.md, .hopi/docs/tech-debt.md, and this Goal doc for drift.',
        '- Scan recent code signals such as TODO/FIXME comments, stale docs references, repeated failures, and obvious technical debt.',
        '- Update .hopi/docs/tech-debt.md only with curated, durable debt worth tracking.',
        '- Update .hopi/docs/todo.md with candidate work only when it is actionable and scoped.',
        '- Create goal-scoped tasks only for small, verifiable, high-confidence maintenance work.',
        '',
        '## Suggested Checks',
        '',
        '- Prefer rg-based scans and recent task evidence over broad guesses.',
        '- Verify docs remain coherent after edits.',
        '',
        '## Non-goals / Constraints',
        '',
        '- Do not treat every TODO/FIXME as actionable.',
        '- Do not make product/code changes directly in Radar unless the task contract is explicitly changed.',
        '- Avoid noisy human interruptions; use DecisionTopic only for strategic or risky debt.'
    ].join('\n')
}

export class AutoRunScheduler {
    private readonly lastThinkingBySessionId: Map<string, boolean> = new Map()
    private readonly lastActiveBySessionId: Map<string, boolean> = new Map()
    private readonly tickTimers: Map<ProjectKey, NodeJS.Timeout> = new Map()
    private readonly runningTicks: Set<ProjectKey> = new Set()
    private readonly pendingTicks: Set<ProjectKey> = new Set()
    private readonly knownProjects: Map<ProjectKey, { namespace: string; projectId: string }> = new Map()

    constructor(
        private readonly store: Store,
        private readonly engine: SyncEngine
    ) {
    }

    requestTick(namespace: string, projectId: string, options?: { delayMs?: number }): void {
        const delayMs = options?.delayMs ?? 250
        const key = toProjectKey(namespace, projectId)
        this.knownProjects.set(key, { namespace, projectId })

        if (this.runningTicks.has(key)) {
            this.pendingTicks.add(key)
            return
        }

        if (this.tickTimers.has(key)) {
            return
        }

        const timer = setTimeout(() => {
            this.tickTimers.delete(key)
            void this.tickProject(namespace, projectId)
        }, delayMs)

        this.tickTimers.set(key, timer)
    }

    requestKnownProjectTicks(options?: { delayMs?: number }): void {
        for (const project of this.knownProjects.values()) {
            this.requestTick(project.namespace, project.projectId, options)
        }
    }

    seedKnownProjects(projects: Array<Pick<StoredProject, 'id' | 'namespace' | 'archivedAt'>>): void {
        for (const project of projects) {
            if (project.archivedAt) {
                continue
            }
            const key = toProjectKey(project.namespace, project.id)
            this.knownProjects.set(key, { namespace: project.namespace, projectId: project.id })
        }
    }

    handleEvent(event: SyncEvent): void {
        if (event.type === 'session-added' && event.sessionId) {
            const session = this.engine.getSession(event.sessionId)
            if (session) {
                this.lastThinkingBySessionId.set(event.sessionId, Boolean(session.thinking))
                this.lastActiveBySessionId.set(event.sessionId, session.active !== false)
            }
            return
        }

        if (event.type === 'session-removed' && event.sessionId) {
            this.lastThinkingBySessionId.delete(event.sessionId)
            this.lastActiveBySessionId.delete(event.sessionId)
            return
        }

        if (event.type === 'session-updated' && event.sessionId) {
            const session = this.engine.getSession(event.sessionId)
            if (!session) {
                return
            }

            const previous = this.lastThinkingBySessionId.get(event.sessionId)
            const current = Boolean(session.thinking)
            this.lastThinkingBySessionId.set(event.sessionId, current)
            const previousActive = this.lastActiveBySessionId.get(event.sessionId)
            const currentActive = session.active !== false
            this.lastActiveBySessionId.set(event.sessionId, currentActive)

            if ((previous === true && current === false) || (previousActive === true && currentActive === false)) {
                const projectId = session.metadata?.projectId
                if (projectId && session.namespace) {
                    this.requestTick(session.namespace, projectId, { delayMs: 500 })
                }
            }
            return
        }

        if (event.type === 'project-updated' && event.projectId && event.namespace) {
            this.requestTick(event.namespace, event.projectId, { delayMs: 500 })
            return
        }

        if ((event.type === 'task-added' || event.type === 'task-updated') && event.projectId && event.taskId && event.namespace) {
            const task = this.store.tasks.getTaskByNamespace(event.taskId, event.namespace)
            const project = this.store.projects.getProjectByNamespace(event.projectId, event.namespace)
            if (task && project) {
                if (isTaskAutoRunnable(task, {
                    namespace: event.namespace,
                    project,
                    store: this.store,
                    engine: this.engine
                })) {
                    this.requestTick(event.namespace, event.projectId, { delayMs: 250 })
                    return
                }

                if (task.goalId) {
                    const goal = this.store.goals.getGoalByNamespace(task.goalId, event.namespace)
                    if (goal && goal.projectId === project.id && isGoalAutopilotRunnable(goal)) {
                        this.requestTick(event.namespace, event.projectId, { delayMs: 250 })
                    }
                }
            }
        }
    }

    private getDefaultWorkspace(project: StoredProject): StoredWorkspace | null {
        return project.defaultWorkspaceId
            ? this.store.workspaces.getWorkspace(project.defaultWorkspaceId)
            : this.store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
    }

    private emitTaskAdded(namespace: string, task: StoredTask): void {
        this.engine.handleRealtimeEvent({
            type: 'task-added',
            taskId: task.id,
            projectId: task.projectId,
            namespace,
            data: { taskId: task.id }
        })
    }

    private ensurePlannerLoopTask(options: {
        project: StoredProject
        goal: StoredGoal
        tasks: StoredTask[]
        defaultWorkspace: StoredWorkspace | null
    }): StoredTask | null {
        const openPlanner = options.tasks.some((task) => (
            task.source === 'planner'
            && !task.archivedAt
            && task.status !== 'finished'
        ))
        if (openPlanner) {
            return null
        }

        const activeGoalWork = options.tasks.some((task) => (
            task.source !== 'planner'
            && task.source !== 'radar'
            && !task.archivedAt
            && (task.status === 'in_progress' || task.status === 'in_review')
        ))
        if (activeGoalWork) {
            return null
        }

        const targetOpenGeneratorTasks = normalizeAutomationLaneLimits(options.project.automationLaneLimits).generator
        const activeWorkCount = options.tasks.filter((task) => (
            task.source !== 'planner'
            && task.source !== 'radar'
            && !task.archivedAt
            && (task.status === 'planned' || task.status === 'in_progress' || task.status === 'in_review')
        )).length
        if (activeWorkCount >= targetOpenGeneratorTasks) {
            return null
        }

        const handoff = buildResolvedDecisionHandoff(
            this.store.goalDecisionTopics.listByGoalAndNamespace(options.goal.id, options.project.namespace)
        )

        return this.store.tasks.createTask({
            id: randomUUID(),
            projectId: options.project.id,
            goalId: options.goal.id,
            title: 'Plan next goal iteration',
            description: 'Refresh Goal strategy, curate repo memory, and promote the next small batch of work.',
            status: 'planned',
            priority: 'high',
            sortKey: Date.now(),
            workspaceId: options.defaultWorkspace?.id ?? null,
            agentFlavor: DEFAULT_AGENT_FLAVOR,
            permissionMode: DEFAULT_AUTONOMOUS_TASK_PERMISSION_MODE,
            model: DEFAULT_TASK_MODEL,
            modelMode: null,
            workflowProfile: 'default',
            source: 'planner',
            contract: buildPlannerLoopContract({
                goal: options.goal,
                targetOpenGeneratorTasks,
                currentOpenGeneratorTasks: activeWorkCount
            }),
            handoff
        })
    }

    private ensureRadarTask(options: {
        project: StoredProject
        goal: StoredGoal
        tasks: StoredTask[]
        defaultWorkspace: StoredWorkspace | null
    }): StoredTask | null {
        if (options.goal.status !== 'active') {
            return null
        }

        const openRadar = options.tasks.some((task) => (
            task.source === 'radar'
            && !task.archivedAt
            && task.status !== 'finished'
        ))
        if (openRadar) {
            return null
        }

        const latestRadarAt = options.tasks
            .filter((task) => task.source === 'radar')
            .reduce((latest, task) => Math.max(latest, task.createdAt), 0)
        if (latestRadarAt > 0 && Date.now() - latestRadarAt < GOAL_RADAR_INTERVAL_MS) {
            return null
        }

        return this.store.tasks.createTask({
            id: randomUUID(),
            projectId: options.project.id,
            goalId: options.goal.id,
            title: 'Radar: scan goal docs and technical debt',
            description: 'Run the periodic background radar pass for docs drift, technical debt, and stale planning state.',
            status: 'planned',
            priority: 'low',
            sortKey: Date.now(),
            workspaceId: options.defaultWorkspace?.id ?? null,
            agentFlavor: DEFAULT_AGENT_FLAVOR,
            permissionMode: DEFAULT_AUTONOMOUS_TASK_PERMISSION_MODE,
            model: DEFAULT_TASK_MODEL,
            modelMode: null,
            workflowProfile: 'default',
            source: 'radar',
            contract: buildRadarContract(options.goal)
        })
    }

    private ensureGoalAutopilotTasks(namespace: string, project: StoredProject): StoredGoal[] {
        const goals = this.store.goals
            .listGoalsByProjectAndNamespace(project.id, namespace)
            .filter(isGoalAutopilotRunnable)
        const defaultWorkspace = this.getDefaultWorkspace(project)

        for (const goal of goals) {
            bootstrapGoalDocs({
                project,
                goal,
                defaultWorkspace
            })
            const tasks = this.store.tasks.listTasksByProjectAndNamespace(project.id, namespace, {
                includeArchived: true,
                goalId: goal.id
            })
            const planner = this.ensurePlannerLoopTask({
                project,
                goal,
                tasks,
                defaultWorkspace
            })
            if (planner) {
                this.emitTaskAdded(namespace, planner)
                tasks.push(planner)
            }

            const radar = this.ensureRadarTask({
                project,
                goal,
                tasks,
                defaultWorkspace
            })
            if (radar) {
                this.emitTaskAdded(namespace, radar)
            }
        }

        return goals
    }

    private async tickProject(namespace: string, projectId: string): Promise<void> {
        const key = toProjectKey(namespace, projectId)
        if (this.runningTicks.has(key)) {
            return
        }
        this.runningTicks.add(key)

        try {
            const project = this.store.projects.getProjectByNamespace(projectId, namespace)
            if (!project || project.archivedAt) {
                return
            }
            const autopilotGoals = this.ensureGoalAutopilotTasks(namespace, project)
            if (!project.autoRunEnabled && autopilotGoals.length === 0) {
                return
            }

            const projectReadinessReady = project.automationReadinessStatus === 'ready'

            const laneLimits = normalizeAutomationLaneLimits(project.automationLaneLimits)
            const runningByLane = countRunningSessionsByLane(this.engine.getSessionsByNamespace(namespace), projectId)
            const startedByLane = createLaneCounts()
            const projectTasks = this.store.tasks.listTasksByProjectAndNamespace(projectId, namespace)
            const planned = this.store.tasks.listPlannedTasksByProjectAndNamespace(projectId, namespace, { limit: 200 })
            const review = projectTasks.filter((task) => task.status === 'in_review')
            const candidates = sortAutomationCandidates([...review, ...planned])
            if (candidates.length === 0) {
                return
            }

            for (const task of candidates) {
                const lane = getTaskAutomationLane(task)
                if (runningByLane[lane] + startedByLane[lane] >= laneLimits[lane]) continue

                const policy = getTaskAutopilotPolicy({
                    task,
                    project,
                    store: this.store,
                    namespace
                })
                if (!policy.enabled) {
                    continue
                }
                if (!projectReadinessReady && !policy.allowBeforeReadiness) {
                    continue
                }
                if (!isTaskAutoRunnable(task, {
                    namespace,
                    project,
                    store: this.store,
                    engine: this.engine
                })) continue

                const continued = await continueTaskInLinkedSession({
                    store: this.store,
                    engine: this.engine,
                    namespace,
                    taskId: task.id
                })
                const result = continued ?? await startSessionFromTask({
                    store: this.store,
                    engine: this.engine,
                    namespace,
                    taskId: task.id
                })

                startedByLane[lane] += 1

                if (result.ok) {
                    continue
                }

                const blocked = this.store.tasks.updateTaskByNamespace(task.id, namespace, {
                    status: 'blocked'
                })
                if (blocked) {
                    this.engine.handleRealtimeEvent({
                        type: 'task-updated',
                        taskId: blocked.id,
                        projectId: blocked.projectId,
                        namespace,
                        data: { taskId: blocked.id }
                    })
                }

                this.engine.handleRealtimeEvent({
                    type: 'toast',
                    namespace,
                    data: {
                        ...buildTaskSessionStartFailureToast({
                            taskTitle: task.title,
                            failure: result.error
                        }),
                        sessionId: '',
                        url: '',
                        taskStartFailure: result.error
                    }
                })
            }
        } finally {
            this.runningTicks.delete(key)
            if (this.pendingTicks.has(key)) {
                this.pendingTicks.delete(key)
                this.requestTick(namespace, projectId, { delayMs: 0 })
            }
        }
    }
}
