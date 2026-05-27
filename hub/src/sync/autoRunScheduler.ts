import { normalizeAutomationBackstopPolicy, normalizeAutomationLaneLimits } from '@hopi/protocol'
import { HopiTaskRoleSchema } from '@hopi/protocol/schemas'
import type { SyncEvent } from '@hopi/protocol/types'
import type { AutomationLane } from '@hopi/protocol/types'
import { buildTaskSessionStartFailureToast, type TaskSessionStartFailure } from '@hopi/protocol/task-session-start'
import type { Store, StoredGoal, StoredGoalDecisionTopic, StoredProject, StoredTask, StoredWorkspace } from '../store'
import { buildTaskInitRuntime } from '../utils/taskActionRuntime'
import type { SyncEngine } from './syncEngine'
import { buildResolvedDecisionHandoff } from './goals/decisionHandoff'
import { readGoalDecisionTopicsWithLegacyBackfill } from './goals/goalDecisions'
import { bootstrapGoalDocs } from './goals/goalDocs'
import { createGoalTodoTaskId, readGoalTodo } from './goals/goalTodo'
import { syncTaskStateToGoalTodo } from './goals/goalTodoTaskSync'
import { notifyProjectControllerTaskBlockedTransition } from './projectController'
import { continueTaskInLinkedSession, isMachineRunnerReady, startSessionFromTask } from './taskSessionService'
import { getWorkflowStrategy } from './workflowStrategy'
import { getProjectDefaultTaskRuntimeSettings } from './projectTaskDefaults'

type ProjectKey = `${string}:${string}`
type MachineKey = `${string}:${string}`
type TaskAutopilotPolicy = {
    enabled: boolean
    allowBeforeReadiness: boolean
}
type PlannerBackstopSignal = {
    baselineAt: number
    elapsedHours: number
    completedGeneratorTasks: number
    completedPlannerRefills: number
    reasons: string[]
}

const GOAL_RADAR_INTERVAL_MS = 24 * 60 * 60 * 1000
const RUNNER_OFFLINE_RETRY_MESSAGE = 'Runner offline or not connected. Start it on the machine and try again: hopi runner start'
const ACTIVE_GOAL_STATUSES = new Set(['planning', 'active'])
const OPEN_GOAL_TASK_STATUSES = new Set(['planning', 'running', 'review', 'blocked', 'planned', 'in_progress', 'in_review'])
const AUTOMATION_LANE_PRIORITY: Record<AutomationLane, number> = {
    evaluator: 0,
    planner: 1,
    generator: 2,
    radar: 3
}

function toProjectKey(namespace: string, projectId: string): ProjectKey {
    return `${namespace}:${projectId}`
}

function toMachineKey(namespace: string, machineId: string): MachineKey {
    return `${namespace}:${machineId}`
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

function getTaskAutomationLane(task: Pick<StoredTask, 'status' | 'role' | 'source'>): AutomationLane {
    if (task.status === 'review' || task.status === 'in_review') {
        return 'evaluator'
    }
    if (task.role === 'planner') {
        return 'planner'
    }
    if (task.role === 'radar') {
        return 'radar'
    }
    if (task.role === 'evaluator') {
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

function isTaskWaitingForRunnerRecovery(task: Pick<StoredTask, 'initRuntime'>): boolean {
    return task.initRuntime?.status === 'waiting'
        && task.initRuntime.failure?.code === 'runner_offline'
        && task.initRuntime.failure?.retry?.action === 'wait_then_retry_start'
}

function buildRunnerOfflineRecoveryFailure(task: Pick<StoredTask, 'initRuntime'>): TaskSessionStartFailure {
    if (task.initRuntime?.failure?.code === 'runner_offline') {
        return task.initRuntime.failure
    }

    return {
        code: 'runner_offline',
        message: RUNNER_OFFLINE_RETRY_MESSAGE,
        blockedReason: null,
        retry: {
            count: task.initRuntime?.retryCount ?? 0,
            action: 'wait_then_retry_start',
            available: true
        }
    }
}

function isRecoverableSchedulerRunnerOfflineBlock(task: Pick<StoredTask, 'status' | 'archivedAt' | 'activeSessionId' | 'blockedSource' | 'blockedReason' | 'initRuntime'>): boolean {
    if (task.status !== 'blocked') return false
    if (task.archivedAt) return false
    if (task.activeSessionId) return false
    if (task.blockedSource !== 'scheduler') return false
    if (task.initRuntime?.failure?.code === 'runner_offline') return true
    return task.blockedReason?.trim().startsWith(RUNNER_OFFLINE_RETRY_MESSAGE) === true
}

function isTaskAutoRunnable(task: {
    id: string
    status: string
    archivedAt: number | null
    activeSessionId: string | null
    role: string | null
    source: string | null
    goalId: string | null
    goalTodoRef: string | null
    workflowPhase: string | null
    workflowProfile: string
    initRuntime: StoredTask['initRuntime']
}, options: {
    namespace: string
    project: StoredProject
    store: Store
    engine: Pick<SyncEngine, 'getMachineByNamespace' | 'getSessionByNamespace'>
}): boolean {
    const isPlanningTask = task.status === 'planning' || task.status === 'planned'
    const isReviewTask = task.status === 'review' || task.status === 'in_review'
    if (!isPlanningTask && !isReviewTask) return false
    if (task.archivedAt) return false
    if (isTaskWaitingForRunnerRecovery(task)) {
        const machine = options.engine.getMachineByNamespace(options.project.machineId, options.namespace)
        if (!isMachineRunnerReady(machine)) {
            return false
        }
    }
    if (task.activeSessionId) {
        const linkedSession = options.engine.getSessionByNamespace(task.activeSessionId, options.namespace)
        if (
            isPlanningTask
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
    if (isPlanningTask && !isPlanningTaskReadyForAutomation(task, options)) return false
    const strategy = getWorkflowStrategy(task)
    return strategy.canAutoRunTask(task)
}

function isGoalRunnable(goal: StoredGoal): boolean {
    return !goal.archivedAt
        && ACTIVE_GOAL_STATUSES.has(goal.status)
}

function isGoalTaskExecutionContinuation(task: Pick<StoredTask, 'source'>): boolean {
    return task.source !== 'planner' && task.source !== 'radar'
}

function isGoalAutomationPaused(goal: StoredGoal): boolean {
    return goal.automationPausedAt !== null
}

function isGoalAutopilotRunnable(goal: StoredGoal): boolean {
    return goal.autopilotEnabled
        && !isGoalAutomationPaused(goal)
        && isGoalRunnable(goal)
}

function isGoalAutomationEnabled(goal: StoredGoal): boolean {
    return goal.autopilotEnabled
        && !isGoalAutomationPaused(goal)
        && !goal.archivedAt
        && (isGoalRunnable(goal) || goal.status === 'blocked')
}

function getTaskAutopilotPolicy(options: {
    task: Pick<StoredTask, 'goalId' | 'source'>
    project: StoredProject
    store: Store
    namespace: string
}): TaskAutopilotPolicy {
    if (!options.task.goalId) {
        const isProjectBootstrap = options.task.source === 'project_init'
        return {
            enabled: options.project.autoRunEnabled || isProjectBootstrap,
            allowBeforeReadiness: isProjectBootstrap
        }
    }

    const goal = options.store.goals.getGoalByNamespace(options.task.goalId, options.namespace)
    if (
        !goal
        || goal.projectId !== options.project.id
        || isGoalAutomationPaused(goal)
        || goal.archivedAt
    ) {
        return {
            enabled: false,
            allowBeforeReadiness: false
        }
    }

    const goalAutomationEnabled = options.project.autoRunEnabled || goal.autopilotEnabled
    if (goal.status === 'blocked') {
        const allowContinuation = isGoalTaskExecutionContinuation(options.task)
        return {
            enabled: goalAutomationEnabled && allowContinuation,
            allowBeforeReadiness: allowContinuation
        }
    }

    if (!isGoalRunnable(goal)) {
        return {
            enabled: false,
            allowBeforeReadiness: false
        }
    }

    return {
        enabled: goalAutomationEnabled,
        allowBeforeReadiness: true
    }
}

function getDefaultWorkspaceForProject(store: Store, project: StoredProject): StoredWorkspace | null {
    return project.defaultWorkspaceId
        ? store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
}

function buildGoalTodoTagIndex(options: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): Map<string, string | null> {
    const tags = new Map<string, string | null>()
    const todo = readGoalTodo({
        project: options.project,
        goal: options.goal,
        defaultWorkspace: options.defaultWorkspace
    })
    for (const section of todo.sections) {
        tags.set(section.id, section.tag)
        if (section.todoRef) tags.set(section.todoRef, section.tag)
        if (section.taskId) tags.set(section.taskId, section.tag)
    }
    return tags
}

function getTaskGoalTodoTag(
    task: Pick<StoredTask, 'id' | 'goalTodoRef'>,
    tagsByTaskKey: Map<string, string | null>
): string | null | undefined {
    if (task.goalTodoRef && tagsByTaskKey.has(task.goalTodoRef)) {
        return tagsByTaskKey.get(task.goalTodoRef) ?? null
    }
    if (tagsByTaskKey.has(task.id)) {
        return tagsByTaskKey.get(task.id) ?? null
    }
    return undefined
}

function isReadyPlanningTag(tag: string | null | undefined): boolean {
    // undefined means a legacy DB-only task with no todo.yml row; keep it runnable.
    return tag === undefined || tag === 'ready'
}

function hasTaskScopedBlockingDecision(
    topics: StoredGoalDecisionTopic[],
    taskKeys: Array<string | null | undefined>
): boolean {
    const keys = new Set(taskKeys
        .filter((key): key is string => typeof key === 'string' && key.trim().length > 0)
        .map((key) => key.trim()))
    if (keys.size === 0) {
        return false
    }

    return topics.some((topic) => (
        topic.scope === 'task'
        && topic.blocking
        && topic.status === 'waiting'
        && topic.taskId !== null
        && keys.has(topic.taskId)
    ))
}

function isPlanningTaskReadyForAutomation(task: Pick<StoredTask, 'id' | 'goalId' | 'goalTodoRef' | 'source'>, options: {
    namespace: string
    project: StoredProject
    store: Store
}): boolean {
    if (!task.goalId || task.source === 'planner' || task.source === 'radar') {
        return true
    }
    const goal = options.store.goals.getGoalByNamespace(task.goalId, options.namespace)
    if (!goal || goal.projectId !== options.project.id) {
        return false
    }
    const defaultWorkspace = getDefaultWorkspaceForProject(options.store, options.project)
    const tag = getTaskGoalTodoTag(task, buildGoalTodoTagIndex({
        project: options.project,
        goal,
        defaultWorkspace
    }))
    if (!isReadyPlanningTag(tag)) {
        return false
    }
    const topics = readGoalDecisionTopicsWithLegacyBackfill({
        store: options.store,
        namespace: options.namespace,
        project: options.project,
        goal,
        defaultWorkspace
    })
    return !hasTaskScopedBlockingDecision(topics, [task.id, task.goalTodoRef])
}

function getTaskCompletedAt(task: StoredTask): number | null {
    if (task.status !== 'finished' && task.status !== 'done') {
        return null
    }
    return task.finishedAt ?? task.updatedAt
}

function buildPlannerBackstopSignal(options: {
    goal: StoredGoal
    tasks: StoredTask[]
    topics: StoredGoalDecisionTopic[]
    project: StoredProject
    now?: number
}): PlannerBackstopSignal {
    const now = options.now ?? Date.now()
    const latestResolvedDecisionAt = options.topics
        .filter((topic) => topic.status === 'resolved' && Boolean(topic.resolution?.trim()))
        .reduce((latest, topic) => Math.max(latest, topic.updatedAt), 0)
    const baselineAt = Math.max(options.goal.createdAt, latestResolvedDecisionAt)
    const policy = normalizeAutomationBackstopPolicy(options.project.automationBackstopPolicy)
    const completedGeneratorTasks = options.tasks.filter((task) => {
        const completedAt = getTaskCompletedAt(task)
        return completedAt !== null
            && completedAt >= baselineAt
            && !task.archivedAt
            && task.source !== 'planner'
            && task.source !== 'radar'
    }).length
    const completedPlannerRefills = options.tasks.filter((task) => {
        const completedAt = getTaskCompletedAt(task)
        return completedAt !== null
            && completedAt >= baselineAt
            && !task.archivedAt
            && task.source === 'planner'
    }).length
    const elapsedHours = Math.max(0, (now - baselineAt) / (60 * 60 * 1000))
    const reasons: string[] = []

    if (policy.maxHoursWithoutMilestone > 0 && elapsedHours >= policy.maxHoursWithoutMilestone) {
        reasons.push(`${Math.floor(elapsedHours)} hours since the last resolved DecisionTopic or Goal start (limit ${policy.maxHoursWithoutMilestone}h).`)
    }
    if (
        policy.maxGeneratorTasksWithoutMilestone > 0
        && completedGeneratorTasks >= policy.maxGeneratorTasksWithoutMilestone
    ) {
        reasons.push(`${completedGeneratorTasks} completed generator tasks since the last milestone baseline (limit ${policy.maxGeneratorTasksWithoutMilestone}).`)
    }
    if (
        policy.maxPlannerRefillsWithoutMilestone > 0
        && completedPlannerRefills >= policy.maxPlannerRefillsWithoutMilestone
    ) {
        reasons.push(`${completedPlannerRefills} completed Planner refills since the last milestone baseline (limit ${policy.maxPlannerRefillsWithoutMilestone}).`)
    }

    return {
        baselineAt,
        elapsedHours,
        completedGeneratorTasks,
        completedPlannerRefills,
        reasons
    }
}

function formatBackstopHours(hours: number): string {
    return hours >= 10 ? String(Math.floor(hours)) : hours.toFixed(1)
}

function buildPlannerLoopContract(options: {
    goal: StoredGoal
    targetOpenGeneratorTasks: number
    currentOpenGeneratorTasks: number
    backstop: PlannerBackstopSignal
}): string {
    const taskBudget = Math.max(0, options.targetOpenGeneratorTasks - options.currentOpenGeneratorTasks)
    const backstopLines = options.backstop.reasons.length > 0
        ? [
            '',
            '## Backstop Triggered',
            '',
            `- Baseline: ${new Date(options.backstop.baselineAt).toISOString()}.`,
            `- Elapsed: ${formatBackstopHours(options.backstop.elapsedHours)}h.`,
            `- Completed generator tasks since baseline: ${options.backstop.completedGeneratorTasks}.`,
            `- Completed Planner refills since baseline: ${options.backstop.completedPlannerRefills}.`,
            ...options.backstop.reasons.map((reason) => `- Trigger: ${reason}`),
            '- This is not an automatic stop. You must make the milestone assessment explicit before creating more work.',
            '- Prefer creating a blocking DecisionTopic with `scope: "goal"` now unless you can justify one clearly bounded, high-value next batch.'
        ]
        : []
    return [
        '## Objective',
        '',
        `Continue the Planner loop for Goal ${options.goal.id}: ${options.goal.title}.`,
        '',
        '## Milestone Stop Assessment',
        '',
        '- Before filling the lane, judge whether continuing this Goal is still clearly higher-value than a human milestone review.',
        '- Stop and ask for a milestone review when the Goal success criteria look materially satisfied, remaining candidates are mostly speculative/cleanup, the next valuable step requires a product or priority choice, or more architecture work should be validated against real content first.',
        '- For a milestone stop, create exactly one blocking DecisionTopic with `scope: "goal"`, set the Goal status to blocked with a concise currentFocus, finish this Planner task, and do not promote new generator tasks.',
        '- Time or task-count limits are only backstops; use this assessment every Planner refill even when no backstop has fired.',
        ...backstopLines,
        '',
        '## Kanban Fill Target',
        '',
        `- Target open generator tasks: ${options.targetOpenGeneratorTasks}.`,
        `- Current open generator tasks: ${options.currentOpenGeneratorTasks}.`,
        `- If the milestone assessment says continuing is worthwhile, create up to ${taskBudget} independent ready generator tasks to fill the generator lane.`,
        '- Create fewer tasks when candidates depend on each other, would edit the same files, or need a human decision.',
        '',
        '## Acceptance',
        '',
        `- Read and update .hopi/docs/goals/${options.goal.goalKey}/goal.md when strategy or status changed.`,
        `- Read and update .hopi/docs/goals/${options.goal.goalKey}/design.md before creating or reshaping substantial engineering tasks.`,
        `- Read and curate .hopi/docs/goals/${options.goal.goalKey}/todo.yml; promote only a small ready batch into kanban.`,
        `- Update .hopi/docs/goals/${options.goal.goalKey}/decisions.yml when human answers have lasting impact for this Goal.`,
        '- Create scoped blocking DecisionTopics for unclear product direction, milestone review, or risky priority choices, one question at a time.',
        '- Create goal-scoped tasks with lightweight contracts using the final HOPI_ACTIONS packet.',
        '- Leave final Goal done/archive to explicit user actions; milestone review is allowed and should block the Goal rather than marking it done.',
        '- Do not mark the Goal paused, done, or archived just because the current iteration looks complete.',
        '- If later candidates remain and the milestone assessment says continuing is valuable, promote enough independent ready candidates to keep the generator lane usefully filled.',
        '- If no next work is actionable, update docs/currentFocus and finish without changing Goal lifecycle status.',
        '',
        '## Suggested Checks',
        '',
        '- Confirm design.md explains the current task graph shape, assumptions, and any resolved decision impact.',
        '- Confirm active kanban work is not overfilled beyond the fill target.',
        '- Confirm todo.yml items use stable refs and canonical statuses candidate/planned/in_progress/in_review/merging/blocked/done; blocked is an automation hold, not a separate board lane.',
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
        `- Scan .hopi/preference.md, .hopi/docs/index.md, .hopi/docs/goals/${goal.goalKey}/goal.md, .hopi/docs/goals/${goal.goalKey}/design.md, .hopi/docs/goals/${goal.goalKey}/todo.yml, .hopi/docs/goals/${goal.goalKey}/decisions.yml, and .hopi/docs/goals/${goal.goalKey}/events.jsonl for drift.`,
        '- Scan recent code signals such as TODO/FIXME comments, stale docs references, repeated failures, and obvious technical debt.',
        `- Add durable findings to .hopi/docs/goals/${goal.goalKey}/todo.yml as candidate reservoir items; request planning for graph-shaping work instead of creating hidden work.`,
        `- Update .hopi/docs/goals/${goal.goalKey}/todo.yml with candidate work only when it is actionable and scoped.`,
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
    private readonly lastRunnerReadyByMachineId: Map<MachineKey, boolean> = new Map()
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

        if (event.type === 'machine-updated' && event.machineId && event.namespace) {
            const key = toMachineKey(event.namespace, event.machineId)
            const runnerReady = isMachineRunnerReady(
                this.engine.getMachineByNamespace(event.machineId, event.namespace)
            )
            const previousRunnerReady = this.lastRunnerReadyByMachineId.get(key)
            this.lastRunnerReadyByMachineId.set(key, runnerReady)

            if (runnerReady && previousRunnerReady !== true) {
                const projects = this.store.projects.listProjectsByNamespace(event.namespace)
                    .filter((project) => !project.archivedAt && project.machineId === event.machineId)
                for (const project of projects) {
                    this.requestTick(event.namespace, project.id, { delayMs: 250 })
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
        return getDefaultWorkspaceForProject(this.store, project)
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

    private materializeReadyGoalTodoTaskOverlays(namespace: string, project: StoredProject): StoredTask[] {
        const defaultWorkspace = this.getDefaultWorkspace(project)
        const materialized: StoredTask[] = []
        const goals = this.store.goals.listGoalsByProjectAndNamespace(project.id, namespace, {
            includeArchived: false
        })

        for (const goal of goals) {
            if (isGoalAutomationPaused(goal)) {
                continue
            }
            if (!project.autoRunEnabled && !isGoalAutomationEnabled(goal)) {
                continue
            }

            const todo = readGoalTodo({
                project,
                goal,
                defaultWorkspace
            })
            if (todo.sections.length === 0) {
                continue
            }
            const decisionTopics = readGoalDecisionTopicsWithLegacyBackfill({
                store: this.store,
                namespace,
                project,
                goal,
                defaultWorkspace
            })

            const existingTasks = this.store.tasks.listTasksByProjectAndNamespace(project.id, namespace, {
                goalId: goal.id,
                includeArchived: true
            })
            const existingByKey = new Map<string, StoredTask>()
            for (const task of existingTasks) {
                existingByKey.set(task.id, task)
                if (task.goalTodoRef) {
                    existingByKey.set(task.goalTodoRef, task)
                }
            }

            todo.sections.forEach((section, index) => {
                if (section.status !== 'planning' || !isReadyPlanningTag(section.tag)) {
                    return
                }

                const taskId = section.taskId ?? section.id
                if (hasTaskScopedBlockingDecision(decisionTopics, [taskId, section.id, section.taskId])) {
                    return
                }
                const existing = existingByKey.get(taskId) ?? existingByKey.get(section.id)
                if (existing && !existing.archivedAt) {
                    return
                }
                if (existing?.archivedAt) {
                    const restored = this.store.tasks.updateTaskByNamespace(existing.id, namespace, {
                        archivedAt: null,
                        goalTodoRef: section.id,
                        title: section.title,
                        description: section.body || existing.description,
                        status: 'planning',
                        blockedReason: null,
                        blockedSource: null,
                        blockedSessionId: null
                    })
                    if (restored) {
                        existingByKey.set(restored.id, restored)
                        if (restored.goalTodoRef) {
                            existingByKey.set(restored.goalTodoRef, restored)
                        }
                        materialized.push(restored)
                    }
                    return
                }
                if (this.store.tasks.getTaskByNamespace(taskId, namespace)) {
                    return
                }

                const created = this.store.tasks.createTask({
                    id: taskId,
                    projectId: project.id,
                    goalId: goal.id,
                    goalTodoRef: section.id,
                    title: section.title,
                    description: section.body || null,
                    status: 'planning',
                    priority: null,
                    sortKey: (todo.updatedAt ?? Date.now()) + index,
                    workspaceId: defaultWorkspace?.id ?? null,
                    ...getProjectDefaultTaskRuntimeSettings(project, { autonomous: true }),
                    workflowProfile: 'default',
                    workflowPhase: null,
                    source: 'manual'
                })
                existingByKey.set(created.id, created)
                if (created.goalTodoRef) {
                    existingByKey.set(created.goalTodoRef, created)
                }
                materialized.push(created)
            })
        }

        return materialized
    }

    private recoverSchedulerRunnerOfflineBlocks(namespace: string, project: StoredProject, tasks: StoredTask[]): StoredTask[] {
        const recovered: StoredTask[] = []
        for (const task of tasks) {
            if (!isRecoverableSchedulerRunnerOfflineBlock(task)) {
                continue
            }

            const policy = getTaskAutopilotPolicy({
                task,
                project,
                store: this.store,
                namespace
            })
            if (!policy.enabled) {
                continue
            }

            const updated = this.store.tasks.updateTaskByNamespace(task.id, namespace, {
                status: 'planning',
                blockedReason: null,
                blockedSource: null,
                blockedSessionId: null,
                initRuntime: buildTaskInitRuntime({
                    current: task.initRuntime,
                    activeSessionId: task.activeSessionId,
                    status: 'waiting',
                    failure: buildRunnerOfflineRecoveryFailure(task),
                    failureFingerprint: 'start:runner_offline',
                    latestNote: 'Runner 当前离线。HOPI 会在 machine runner 恢复后自动重试。'
                })
            })
            if (!updated) {
                continue
            }

            syncTaskStateToGoalTodo({
                store: this.store,
                namespace,
                task: updated,
                project
            })
            this.engine.handleRealtimeEvent({
                type: 'task-updated',
                taskId: updated.id,
                projectId: updated.projectId,
                namespace,
                data: { taskId: updated.id }
            })
            recovered.push(updated)
        }
        return recovered
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
            && task.status !== 'done'
        ))
        if (openPlanner) {
            return null
        }

        const activeGoalWork = options.tasks.some((task) => (
            task.source !== 'planner'
            && task.source !== 'radar'
            && !task.archivedAt
            && (task.status === 'running' || task.status === 'review' || task.status === 'in_progress' || task.status === 'in_review')
        ))
        if (activeGoalWork) {
            return null
        }

        const targetOpenGeneratorTasks = normalizeAutomationLaneLimits(options.project.automationLaneLimits).generator
        const todoTagsByTaskKey = buildGoalTodoTagIndex({
            project: options.project,
            goal: options.goal,
            defaultWorkspace: options.defaultWorkspace
        })
        const activeWorkCount = options.tasks.filter((task) => (
            task.source !== 'planner'
            && task.source !== 'radar'
            && !task.archivedAt
            && (
                task.status === 'running'
                || task.status === 'review'
                || task.status === 'in_progress'
                || task.status === 'in_review'
                || (
                    (task.status === 'planning' || task.status === 'planned')
                    && isReadyPlanningTag(getTaskGoalTodoTag(task, todoTagsByTaskKey))
                )
            )
        )).length
        if (activeWorkCount >= targetOpenGeneratorTasks) {
            return null
        }

        const topics = readGoalDecisionTopicsWithLegacyBackfill({
            store: this.store,
            namespace: options.project.namespace,
            project: options.project,
            goal: options.goal,
            defaultWorkspace: options.defaultWorkspace
        })
        const handoff = buildResolvedDecisionHandoff(topics)
        const backstop = buildPlannerBackstopSignal({
            goal: options.goal,
            tasks: options.tasks,
            topics,
            project: options.project
        })

        const taskTitle = 'Plan next goal iteration'
        const taskId = createGoalTodoTaskId({
            project: options.project,
            goal: options.goal,
            defaultWorkspace: options.defaultWorkspace,
            title: taskTitle
        })
        const task = this.store.tasks.createTask({
            id: taskId,
            projectId: options.project.id,
            goalId: options.goal.id,
            goalTodoRef: taskId,
            title: taskTitle,
            description: 'Refresh Goal strategy, curate repo memory, and promote the next small batch of work.',
            status: 'planning',
            priority: 'high',
            sortKey: Date.now(),
            workspaceId: options.defaultWorkspace?.id ?? null,
            ...getProjectDefaultTaskRuntimeSettings(options.project, { autonomous: true }),
            workflowProfile: 'default',
            source: 'planner',
            contract: buildPlannerLoopContract({
                goal: options.goal,
                targetOpenGeneratorTasks,
                currentOpenGeneratorTasks: activeWorkCount,
                backstop
            }),
            handoff
        })
        syncTaskStateToGoalTodo({
            store: this.store,
            namespace: options.project.namespace,
            task,
            project: options.project,
            defaultWorkspace: options.defaultWorkspace
        })
        return task
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
            && task.status !== 'done'
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

        const taskTitle = 'Radar: scan goal docs and technical debt'
        const taskId = createGoalTodoTaskId({
            project: options.project,
            goal: options.goal,
            defaultWorkspace: options.defaultWorkspace,
            title: taskTitle
        })
        const task = this.store.tasks.createTask({
            id: taskId,
            projectId: options.project.id,
            goalId: options.goal.id,
            goalTodoRef: taskId,
            title: taskTitle,
            description: 'Run the periodic background radar pass for docs drift, technical debt, and stale planning state.',
            status: 'planning',
            priority: 'low',
            sortKey: Date.now(),
            workspaceId: options.defaultWorkspace?.id ?? null,
            ...getProjectDefaultTaskRuntimeSettings(options.project, { autonomous: true }),
            workflowProfile: 'default',
            source: 'radar',
            contract: buildRadarContract(options.goal)
        })
        syncTaskStateToGoalTodo({
            store: this.store,
            namespace: options.project.namespace,
            task,
            project: options.project,
            defaultWorkspace: options.defaultWorkspace
        })
        return task
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
            const materializedTodoTasks = this.materializeReadyGoalTodoTaskOverlays(namespace, project)
            for (const task of materializedTodoTasks) {
                this.emitTaskAdded(namespace, task)
            }
            const autopilotGoals = this.ensureGoalAutopilotTasks(namespace, project)
            const hasEnabledGoalAutomation = this.store.goals
                .listGoalsByProjectAndNamespace(project.id, namespace)
                .some(isGoalAutomationEnabled)
            let projectTasks = this.store.tasks.listTasksByProjectAndNamespace(projectId, namespace)
            const recoveredRunnerOfflineBlocks = this.recoverSchedulerRunnerOfflineBlocks(namespace, project, projectTasks)
            if (recoveredRunnerOfflineBlocks.length > 0) {
                projectTasks = this.store.tasks.listTasksByProjectAndNamespace(projectId, namespace)
            }
            const planned = this.store.tasks.listPlannedTasksByProjectAndNamespace(projectId, namespace, { limit: 200 })
            const hasProjectBootstrapCandidate = planned.some((task) => task.source === 'project_init')
            if (!project.autoRunEnabled && !hasEnabledGoalAutomation && autopilotGoals.length === 0 && !hasProjectBootstrapCandidate) {
                return
            }

            const projectReadinessReady = project.automationReadinessStatus === 'ready'

            const laneLimits = normalizeAutomationLaneLimits(project.automationLaneLimits)
            const runningByLane = countRunningSessionsByLane(this.engine.getSessionsByNamespace(namespace), projectId)
            const startedByLane = createLaneCounts()
            const review = projectTasks.filter((task) => task.status === 'review' || task.status === 'in_review')
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

                const waitForRunnerRecovery = result.error.code === 'runner_offline'
                    && result.error.retry?.action === 'wait_then_retry_start'
                if (waitForRunnerRecovery) {
                    const waitingTask = this.store.tasks.updateTaskByNamespace(task.id, namespace, {
                        blockedReason: null,
                        blockedSource: null,
                        blockedSessionId: null,
                        initRuntime: buildTaskInitRuntime({
                            current: task.initRuntime,
                            activeSessionId: task.activeSessionId,
                            status: 'waiting',
                            failure: result.error,
                            failureFingerprint: `start:${result.error.code}`,
                            latestNote: 'Runner 当前离线。HOPI 会在 machine runner 恢复后自动重试。'
                        })
                    })
                    if (waitingTask) {
                        this.engine.handleRealtimeEvent({
                            type: 'task-updated',
                            taskId: waitingTask.id,
                            projectId: waitingTask.projectId,
                            namespace,
                            data: { taskId: waitingTask.id }
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
                    break
                }

                const blocked = this.store.tasks.updateTaskByNamespace(task.id, namespace, {
                    status: 'blocked',
                    blockedReason: result.error.message,
                    blockedSource: 'scheduler'
                })
                if (blocked) {
                    syncTaskStateToGoalTodo({
                        store: this.store,
                        namespace,
                        task: blocked,
                        project
                    })
                    notifyProjectControllerTaskBlockedTransition({
                        store: this.store,
                        engine: this.engine,
                        namespace,
                        previousTask: task,
                        task: blocked
                    })
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
