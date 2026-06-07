import { existsSync } from 'node:fs'
import { normalizeAutomationBackstopPolicy, normalizeAutomationLaneLimits } from '@hopi/protocol'
import type { GoalAssistantTaskLane } from '@hopi/protocol/goal-assistant'
import { HopiTaskRoleSchema } from '@hopi/protocol/schemas'
import type { GoalTaskCanonicalStatus, SyncEvent } from '@hopi/protocol/types'
import type { AutomationLane } from '@hopi/protocol/types'
import { buildTaskSessionStartFailureToast, type TaskSessionStartFailure } from '@hopi/protocol/task-session-start'
import type { Store, StoredGoal, StoredGoalDecisionTopic, StoredProject, StoredTask, StoredWorkspace } from '../store'
import { buildTaskInitRuntime } from '../utils/taskActionRuntime'
import { buildTaskMergeRuntime } from '../utils/taskActionRuntime'
import type { SyncEngine } from './syncEngine'
import { buildResolvedDecisionHandoff } from './goals/decisionHandoff'
import { listGoalDecisionTopicsFromDocs } from './goals/goalDecisionStore'
import { bootstrapGoalDocs, overlayGoalWithCanonicalDoc } from './goals/goalDocs'
import { getDocsRoot, getGoalDocPath, getGoalTodoPath } from './goals/goalDocPaths'
import {
    buildGoalTodoTaskProjection,
    findGoalTodoTaskProjectionById,
    getTaskByNamespaceOrGoalTodoProjection,
    materializeGoalTodoTaskOverlayForWrite
} from './goals/goalTodoProjection'
import {
    buildGoalTodoBlockedStateFromStoredTask,
    getGoalTodoStatusForStoredTask,
    getGoalTodoTagForStoredTask,
    recoverStoredTaskStatusFromLegacyBlocked
} from './goals/goalTaskState'
import {
    createGoalTodoTaskId,
    upsertGoalTodoTaskState,
    type GoalTodoEventOptions
} from './goals/goalTodo'
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
const ACTIVE_GOAL_STATUSES = new Set(['planning', 'active'])
const RUNNER_OFFLINE_BLOCKED_REASON = 'Runner offline or not connected. Start it on the machine and try again: hopi runner start'
const AUTOMATION_LANE_PRIORITY: Record<AutomationLane, number> = {
    evaluator: 0,
    planner: 1,
    generator: 2,
    radar: 3
}

type AutoRunnableTask = Pick<
    StoredTask,
    'id'
    | 'status'
    | 'archivedAt'
    | 'activeSessionId'
    | 'blockedReason'
    | 'blockedSource'
    | 'source'
    | 'goalId'
    | 'goalTodoRef'
    | 'workflowPhase'
    | 'workflowProfile'
    | 'initRuntime'
    | 'mergeRuntime'
    | 'previewRuntime'
> & {
    goalCanonicalStatus?: GoalTaskCanonicalStatus | null
}

type AutoRunnableTaskLaneInput = Pick<
    StoredTask,
    'status' | 'source' | 'goalId' | 'blockedSource' | 'mergeRuntime' | 'previewRuntime' | 'initRuntime'
> & {
    goalCanonicalStatus?: GoalTaskCanonicalStatus | null
    tag?: string | null
}

function getTaskCanonicalLaneForAutomation(task: AutoRunnableTaskLaneInput): GoalTaskCanonicalStatus | null {
    if (task.goalCanonicalStatus) {
        return task.goalCanonicalStatus
    }

    const status = task.goalId
        ? recoverStoredTaskStatusFromLegacyBlocked(task)
        : task.status

    switch (status) {
        case 'planning':
        case 'planned':
            return 'planned'
        case 'running':
        case 'in_progress':
            return 'in_progress'
        case 'review':
        case 'in_review':
            return 'in_review'
        case 'done':
        case 'finished':
            return 'done'
        default:
            return null
    }
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

function getTaskAutomationLane(task: Pick<StoredTask, 'status' | 'source' | 'goalId' | 'blockedSource' | 'mergeRuntime' | 'previewRuntime' | 'initRuntime'> & {
    goalCanonicalStatus?: GoalTaskCanonicalStatus | null
}): AutomationLane {
    const lane = getTaskCanonicalLaneForAutomation(task)
    if (lane === 'in_review' || lane === 'merging') {
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
    const ranked = tasks
        .map((task, index) => ({ task, index, lane: getTaskAutomationLane(task) }))
        .sort((left, right) => {
            const laneOrder = AUTOMATION_LANE_PRIORITY[left.lane] - AUTOMATION_LANE_PRIORITY[right.lane]
            if (laneOrder !== 0) {
                return laneOrder
            }
            return left.index - right.index
        })
    const seen = new Set<string>()
    return ranked
        .map((item) => item.task)
        .filter((task) => {
            const key = task.goalTodoRef?.trim() || task.id
            if (seen.has(key)) {
                return false
            }
            seen.add(key)
            return true
        })
}

function isTaskWaitingForRunnerRecovery(task: Pick<StoredTask, 'initRuntime'>): boolean {
    return task.initRuntime?.status === 'waiting'
        && task.initRuntime.failure?.code === 'runner_offline'
        && task.initRuntime.failure?.retry?.action === 'wait_then_retry_start'
}

function getTaskRuntimeView(options: {
    store: Store
    namespace: string
    task: StoredTask
}): StoredTask {
    if (!options.task.goalId) {
        return options.task
    }
    const projected = getTaskByNamespaceOrGoalTodoProjection({
        store: options.store,
        namespace: options.namespace,
        taskId: options.task.id
    }) ?? options.task
    if (projected === options.task) {
        return options.task
    }

    const hasExplicitOverlayBlock = Boolean(
        options.task.blockedReason
        || options.task.blockedSource
        || options.task.blockedSessionId
        || options.task.blockedAt
    )
    const projectionAlreadyCarriesBlock = Boolean(
        projected.blockedReason
        || projected.blockedSource
        || projected.blockedSessionId
        || projected.blockedAt
    )
    if (!hasExplicitOverlayBlock || projectionAlreadyCarriesBlock) {
        return projected
    }

    return {
        ...projected,
        blockedReason: options.task.blockedReason,
        blockedSource: options.task.blockedSource,
        blockedSessionId: options.task.blockedSessionId,
        blockedAt: options.task.blockedAt
    }
}

function getProjectedTaskRuntimeView(options: {
    store: Store
    namespace: string
    task: StoredTask
}): StoredTask | null {
    if (!options.task.goalId) {
        return options.task
    }
    const projected = getTaskByNamespaceOrGoalTodoProjection({
        store: options.store,
        namespace: options.namespace,
        taskId: options.task.id
    })
    if (!projected) {
        return null
    }
    if (projected === options.task) {
        return options.task
    }

    const hasExplicitOverlayBlock = Boolean(
        options.task.blockedReason
        || options.task.blockedSource
        || options.task.blockedSessionId
        || options.task.blockedAt
    )
    const projectionAlreadyCarriesBlock = Boolean(
        projected.blockedReason
        || projected.blockedSource
        || projected.blockedSessionId
        || projected.blockedAt
    )
    if (!hasExplicitOverlayBlock || projectionAlreadyCarriesBlock) {
        return projected
    }

    return {
        ...projected,
        blockedReason: options.task.blockedReason,
        blockedSource: options.task.blockedSource,
        blockedSessionId: options.task.blockedSessionId,
        blockedAt: options.task.blockedAt
    }
}

function buildTaskRuntimeFallback(options: {
    previousTask: StoredTask
    updatedTask: StoredTask
}): StoredTask {
    return {
        ...options.updatedTask,
        title: options.previousTask.title,
        description: options.previousTask.description,
        goalTodoRef: options.previousTask.goalTodoRef,
        subTasks: options.previousTask.subTasks,
        subTasksUpdatedAt: options.previousTask.subTasksUpdatedAt,
        attachments: options.previousTask.attachments
    }
}

function getTaskRuntimeViewOrFallback(options: {
    store: Store
    namespace: string
    previousTask: StoredTask
    updatedTask: StoredTask
}): StoredTask {
    const runtimeTask = getTaskRuntimeView({
        store: options.store,
        namespace: options.namespace,
        task: options.updatedTask
    })
    if (!options.updatedTask.goalId || runtimeTask !== options.updatedTask) {
        return runtimeTask
    }

    return buildTaskRuntimeFallback({
        previousTask: options.previousTask,
        updatedTask: options.updatedTask
    })
}

function resolveAutomationEventTask(options: {
    store: Store
    namespace: string
    taskId: string
}): StoredTask | null {
    const projected = findGoalTodoTaskProjectionById({
        store: options.store,
        namespace: options.namespace,
        taskId: options.taskId,
        includeArchived: true
    })
    if (projected) {
        return projected
    }

    const stored = options.store.tasks.getTaskByNamespace(options.taskId, options.namespace)
    if (stored?.goalId) {
        return null
    }
    return stored
}

function isTaskBlockedForRunnerRecovery(task: Pick<StoredTask, 'blockedReason' | 'blockedSource'>): boolean {
    return task.blockedSource === 'scheduler'
        && task.blockedReason === RUNNER_OFFLINE_BLOCKED_REASON
}

function isTaskAutoRunnable(task: {
    id: string
    status: string
    archivedAt: number | null
    activeSessionId: string | null
    blockedReason: string | null
    blockedSource: string | null
    source: string | null
    goalId: string | null
    goalTodoRef: string | null
    workflowPhase: string | null
    workflowProfile: string
    initRuntime: StoredTask['initRuntime']
    mergeRuntime: StoredTask['mergeRuntime']
    previewRuntime: StoredTask['previewRuntime']
    goalCanonicalStatus?: GoalTaskCanonicalStatus | null
    tag?: string | null
}, options: {
    namespace: string
    project: StoredProject
    store: Store
    engine: Pick<SyncEngine, 'getMachineByNamespace' | 'getSessionByNamespace'>
}): boolean {
    const isRunnerRecoveryTask = isTaskBlockedForRunnerRecovery(task)
    const taskLane = getTaskCanonicalLaneForAutomation(task)
    const isPlanningTask = taskLane === 'planned' || isRunnerRecoveryTask
    const isReviewTask = taskLane === 'in_review'
    if (!isPlanningTask && !isReviewTask) return false
    if (task.archivedAt) return false
    if (isTaskWaitingForRunnerRecovery(task) || isRunnerRecoveryTask) {
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
    if (isPlanningTask && !isRunnerRecoveryTask && !isPlanningTaskReadyForAutomation(task)) return false
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
        return {
            enabled: options.project.autoRunEnabled,
            allowBeforeReadiness: options.task.source === 'project_init'
        }
    }

    const goal = getDocsBackedGoalForProject({
        store: options.store,
        project: options.project,
        namespace: options.namespace,
        goalId: options.task.goalId
    })
    if (
        !goal
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

function getDocsBackedGoalForProject(options: {
    store: Store
    project: StoredProject
    namespace: string
    goalId: string
}): StoredGoal | null {
    const goal = options.store.goals.getGoalByNamespace(options.goalId, options.namespace)
    if (!goal || goal.projectId !== options.project.id) {
        return null
    }
    const defaultWorkspace = getDefaultWorkspaceForProject(options.store, options.project)
    if (!hasDocsBackedGoalState({
        defaultWorkspace,
        goal
    })) {
        return null
    }
    return overlayGoalWithCanonicalDoc({
        goal,
        defaultWorkspace
    })
}

function hasDocsBackedGoalState(options: {
    defaultWorkspace: StoredWorkspace | null
    goal: Pick<StoredGoal, 'goalKey'>
}): boolean {
    const docsRoot = getDocsRoot(options.defaultWorkspace)
    if (!docsRoot) {
        return true
    }
    return existsSync(getGoalDocPath(docsRoot, options.goal.goalKey))
        || existsSync(getGoalTodoPath(docsRoot, options.goal.goalKey))
}

function listDocsBackedGoalsForProject(options: {
    store: Store
    project: StoredProject
    namespace: string
    includeArchived?: boolean
}): StoredGoal[] {
    const defaultWorkspace = getDefaultWorkspaceForProject(options.store, options.project)
    return options.store.goals
        .listGoalsByProjectAndNamespace(options.project.id, options.namespace, {
            includeArchived: options.includeArchived
        })
        .filter((goal) => hasDocsBackedGoalState({
            defaultWorkspace,
            goal
        }))
        .map((goal) => overlayGoalWithCanonicalDoc({
            goal,
            defaultWorkspace
        }))
}

function isPlanningTaskReadyForAutomation(task: Pick<StoredTask, 'goalId' | 'source'> & {
    goalCanonicalStatus?: GoalTaskCanonicalStatus | null
    tag?: string | null
}): boolean {
    if (!task.goalId || task.source === 'planner' || task.source === 'radar') {
        return true
    }
    const tag = task.tag?.trim().toLowerCase() ?? null
    if (tag === 'candidate' || tag === 'deferred') {
        return false
    }
    if (task.goalCanonicalStatus === 'planned') {
        return true
    }
    return false
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
            '- Prefer creating a blocking goal-level DecisionTopic now unless you can justify one clearly bounded, high-value next batch.'
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
        '- For a milestone stop, create exactly one blocking goal-level DecisionTopic with taskId null, set the Goal status to blocked with a concise currentFocus, finish this Planner task, and do not promote new generator tasks.',
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
        `- Read and update .hopi/docs/goals/${options.goal.goalKey}/design.md when architecture notes or constraints changed.`,
        `- Read and curate .hopi/docs/goals/${options.goal.goalKey}/todo.yml; keep stable refs, explicit task kinds, and only a small actionable batch moving through canonical statuses such as planned / in_progress / in_review / done.`,
        `- Read .hopi/docs/goals/${options.goal.goalKey}/planning-requests.yml and incorporate any open planning follow-through before deciding the next batch.`,
        `- Update .hopi/docs/goals/${options.goal.goalKey}/decisions.yml for Goal-local answers; use .hopi/docs/decisions.md only when the impact is cross-Goal.`,
        '- Create blocking DecisionTopics for unclear product direction, milestone review, or risky priority choices, one question at a time.',
        '- Create goal-scoped tasks with lightweight contracts using the final HOPI_ACTIONS packet.',
        '- Leave final Goal done/archive to explicit user actions; milestone review is allowed and should block the Goal rather than marking it done.',
        '- Do not mark the Goal paused, done, or archived just because the current iteration looks complete.',
        '- If later candidates remain and the milestone assessment says continuing is valuable, promote enough independent ready candidates to keep the generator lane usefully filled.',
        '- If no next work is actionable, update docs/currentFocus and finish without changing Goal lifecycle status.',
        '',
        '## Suggested Checks',
        '',
        '- Confirm active kanban work is not overfilled beyond the fill target.',
        '- Confirm todo.yml items use stable refs, explicit task kinds, canonical statuses, and structured blockers/dependencies.',
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
        `- Scan .hopi/docs/index.md, .hopi/docs/decisions.md, .hopi/docs/tech-debt.md, .hopi/docs/goals/${goal.goalKey}/goal.md, .hopi/docs/goals/${goal.goalKey}/design.md, .hopi/docs/goals/${goal.goalKey}/todo.yml, .hopi/docs/goals/${goal.goalKey}/decisions.yml, and .hopi/docs/goals/${goal.goalKey}/planning-requests.yml for drift.`,
        '- Scan recent code signals such as TODO/FIXME comments, stale docs references, repeated failures, and obvious technical debt.',
        '- Update .hopi/docs/tech-debt.md only with curated, durable debt worth tracking.',
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
            const project = this.store.projects.getProjectByNamespace(event.projectId, event.namespace)
            const task = resolveAutomationEventTask({
                store: this.store,
                namespace: event.namespace,
                taskId: event.taskId
            })
            if (task && project) {
                const automationTask = task
                if (isTaskAutoRunnable(automationTask, {
                    namespace: event.namespace,
                    project,
                    store: this.store,
                    engine: this.engine
                })) {
                    this.requestTick(event.namespace, event.projectId, { delayMs: 250 })
                    return
                }

                if (automationTask.goalId) {
                    const goal = getDocsBackedGoalForProject({
                        store: this.store,
                        project,
                        namespace: event.namespace,
                        goalId: automationTask.goalId
                    })
                    if (goal && isGoalAutopilotRunnable(goal)) {
                        this.requestTick(event.namespace, event.projectId, { delayMs: 250 })
                    }
                }
            }
        }
    }

    private getDefaultWorkspace(project: StoredProject): StoredWorkspace | null {
        return getDefaultWorkspaceForProject(this.store, project)
    }

    private listGoalProjectedTasks(options: {
        namespace: string
        project: StoredProject
        includeArchived: boolean
    }): StoredTask[] {
        return this.store.goals
            .listGoalsByProjectAndNamespace(options.project.id, options.namespace, {
                includeArchived: options.includeArchived
            })
            .flatMap((goal) => buildGoalTodoTaskProjection({
                store: this.store,
                project: options.project,
                goalId: goal.id,
                namespace: options.namespace,
                includeArchived: options.includeArchived
            }))
    }

    private listProjectAutomationTasks(namespace: string, project: StoredProject): StoredTask[] {
        const nonGoalTasks = this.store.tasks.listTasksByProjectAndNamespace(project.id, namespace)
            .filter((task) => !task.goalId)
        const goalTasks = this.listGoalProjectedTasks({
            namespace,
            project,
            includeArchived: false
        })
        return [...nonGoalTasks, ...goalTasks]
    }

    private materializeAutomationTask(namespace: string, task: StoredTask): StoredTask | null {
        if (!task.goalId) {
            return this.store.tasks.getTaskByNamespace(task.id, namespace) ?? task
        }

        return materializeGoalTodoTaskOverlayForWrite({
            store: this.store,
            namespace,
            taskId: task.id
        })
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

    private prepareRunnerRecoveryTask(namespace: string, project: StoredProject, task: StoredTask): StoredTask | null {
        const currentTask = getTaskRuntimeView({
            store: this.store,
            namespace,
            task
        })
        if (!isTaskBlockedForRunnerRecovery(currentTask)) {
            return task
        }

        const event: GoalTodoEventOptions = {
            writer: 'scheduler',
            action: 'scheduler_task_recovered',
            reason: 'Scheduler reopened a runner-recovery blocked todo item for execution.',
            metadata: {
                source: 'prepareRunnerRecoveryTask',
                lane: getTaskAutomationLane(currentTask),
                taskId: task.id
            }
        }
        const nextStatus = recoverStoredTaskStatusFromLegacyBlocked(currentTask, {
            nonGoalFallback: currentTask.status
        })
        const wroteDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
            namespace,
            project,
            task: currentTask,
            patch: {
                status: nextStatus,
                blockedReason: null,
                blockedSource: null,
                blockedSessionId: null
            },
            event
        })
        const restored = this.store.tasks.updateTaskByNamespace(task.id, namespace, {
            status: nextStatus,
            blockedReason: null,
            blockedSource: null,
            blockedSessionId: null
        })
        if (!restored) {
            return null
        }
        const restoredTask = this.resolveRuntimeTask(namespace, restored, currentTask)

        if (!wroteDocsFirst) {
            this.writeGoalTodoStateForTask({
                namespace,
                project,
                task: restoredTask,
                event
            })
        } else {
            notifyProjectControllerTaskBlockedTransition({
                store: this.store,
                engine: this.engine,
                namespace,
                previousTask: currentTask,
                task: restoredTask
            })
        }
        this.emitTaskUpdated(namespace, restoredTask)
        return restoredTask
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

        const targetOpenGeneratorTasks = normalizeAutomationLaneLimits(options.project.automationLaneLimits).generator
        const activeWorkCount = options.tasks.filter((task) => {
            const lane = getTaskCanonicalLaneForAutomation(task)
            return (
            task.source !== 'planner'
            && task.source !== 'radar'
            && !task.archivedAt
            && (
                lane === 'in_progress'
                || lane === 'in_review'
                || lane === 'merging'
                || (
                    lane === 'planned'
                    && isPlanningTaskReadyForAutomation(task)
                )
            )
        )}).length
        if (activeWorkCount >= targetOpenGeneratorTasks) {
            return null
        }
        if (activeWorkCount > 0) {
            return null
        }

        const topics = listGoalDecisionTopicsFromDocs({
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
        const taskDescription = 'Refresh Goal strategy, curate repo memory, and promote the next small batch of work.'
        const plannerSeedEvent: GoalTodoEventOptions = {
            writer: 'scheduler',
            action: 'scheduler_planner_seeded',
            reason: 'Scheduler created a planner loop todo item to replenish ready work.',
            metadata: {
                source: 'ensurePlannerLoopTask',
                lane: 'planner',
                taskId
            }
        }
        const wroteDocsFirst = Boolean(options.defaultWorkspace) && upsertGoalTodoTaskState({
            project: options.project,
            goal: options.goal,
            defaultWorkspace: options.defaultWorkspace,
            taskId,
            status: 'planning',
            tag: 'ready',
            taskKind: 'planning',
            title: taskTitle,
            body: taskDescription,
            blocked: null,
            event: plannerSeedEvent
        })
        const task = this.store.tasks.createTask({
            id: taskId,
            projectId: options.project.id,
            goalId: options.goal.id,
            goalTodoRef: taskId,
            title: taskTitle,
            description: taskDescription,
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
        if (!wroteDocsFirst) {
            this.writeGoalTodoStateForTask({
                namespace: options.project.namespace,
                project: options.project,
                task,
                event: plannerSeedEvent
            })
        }
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
        const taskDescription = 'Run the periodic background radar pass for docs drift, technical debt, and stale planning state.'
        const radarSeedEvent: GoalTodoEventOptions = {
            writer: 'scheduler',
            action: 'scheduler_radar_seeded',
            reason: 'Scheduler created the periodic radar todo item.',
            metadata: {
                source: 'ensureRadarTask',
                lane: 'radar',
                taskId
            }
        }
        const wroteDocsFirst = Boolean(options.defaultWorkspace) && upsertGoalTodoTaskState({
            project: options.project,
            goal: options.goal,
            defaultWorkspace: options.defaultWorkspace,
            taskId,
            status: 'planning',
            tag: 'ready',
            taskKind: 'planning',
            title: taskTitle,
            body: taskDescription,
            blocked: null,
            event: radarSeedEvent
        })
        const task = this.store.tasks.createTask({
            id: taskId,
            projectId: options.project.id,
            goalId: options.goal.id,
            goalTodoRef: taskId,
            title: taskTitle,
            description: taskDescription,
            status: 'planning',
            priority: 'low',
            sortKey: Date.now(),
            workspaceId: options.defaultWorkspace?.id ?? null,
            ...getProjectDefaultTaskRuntimeSettings(options.project, { autonomous: true }),
            workflowProfile: 'default',
            source: 'radar',
            contract: buildRadarContract(options.goal)
        })
        if (!wroteDocsFirst) {
            this.writeGoalTodoStateForTask({
                namespace: options.project.namespace,
                project: options.project,
                task,
                event: radarSeedEvent
            })
        }
        return task
    }

    private ensureGoalAutopilotTasks(namespace: string, project: StoredProject): StoredGoal[] {
        const goals = listDocsBackedGoalsForProject({
            store: this.store,
            project,
            namespace
        })
            .filter(isGoalAutopilotRunnable)
        const defaultWorkspace = this.getDefaultWorkspace(project)

        for (const goal of goals) {
            bootstrapGoalDocs({
                project,
                goal,
                defaultWorkspace
            })
            const tasks = buildGoalTodoTaskProjection({
                store: this.store,
                project,
                goalId: goal.id,
                namespace,
                includeArchived: true
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

    private emitTaskUpdated(namespace: string, task: StoredTask, data?: Record<string, unknown>): void {
        this.engine.handleRealtimeEvent({
            type: 'task-updated',
            taskId: task.id,
            projectId: task.projectId,
            namespace,
            data: {
                taskId: task.id,
                ...(data ?? {})
            }
        })
    }

    private resolveRuntimeTask(namespace: string, task: StoredTask, previousTask?: StoredTask | null): StoredTask {
        if (previousTask) {
            return getTaskRuntimeViewOrFallback({
                store: this.store,
                namespace,
                previousTask,
                updatedTask: task
            })
        }
        return getTaskRuntimeView({
            store: this.store,
            namespace,
            task
        })
    }

    private syncGoalTodoBeforeTaskUpdate(options: {
        namespace: string
        project: StoredProject
        task: StoredTask
        patch: Partial<StoredTask>
        event?: GoalTodoEventOptions
    }): boolean {
        const task = getProjectedTaskRuntimeView({
            store: this.store,
            namespace: options.namespace,
            task: options.task
        })
        if (!task || !task.goalId || !task.goalTodoRef) {
            return false
        }

        const nextTask = {
            ...task,
            ...options.patch
        } as StoredTask

        return this.writeGoalTodoStateForResolvedTask({
            namespace: options.namespace,
            project: options.project,
            task: nextTask,
            event: options.event
        })
    }

    private writeGoalTodoStateForTask(options: {
        namespace: string
        project: StoredProject
        task: StoredTask
        event?: GoalTodoEventOptions
    }): boolean {
        const task = getProjectedTaskRuntimeView({
            store: this.store,
            namespace: options.namespace,
            task: options.task
        })
        if (!task) {
            return false
        }
        return this.writeGoalTodoStateForResolvedTask({
            namespace: options.namespace,
            project: options.project,
            task,
            event: options.event
        })
    }

    private writeGoalTodoStateForResolvedTask(options: {
        namespace: string
        project: StoredProject
        task: StoredTask
        event?: GoalTodoEventOptions
    }): boolean {
        const task = options.task
        if (!task.goalId || !task.goalTodoRef) {
            return false
        }

        const goal = this.store.goals.getGoalByNamespace(task.goalId, options.namespace)
        if (!goal || goal.projectId !== options.project.id) {
            return false
        }

        const blocked = buildGoalTodoBlockedStateFromStoredTask(task)

        return upsertGoalTodoTaskState({
            project: options.project,
            goal,
            defaultWorkspace: this.getDefaultWorkspace(options.project),
            taskId: task.goalTodoRef,
            status: getGoalTodoStatusForStoredTask(task),
            tag: getGoalTodoTagForStoredTask(task),
            taskKind: task.source === 'planner' || task.source === 'radar' ? 'planning' : 'engineering',
            title: task.title,
            body: task.description,
            blocked,
            event: options.event
        })
    }

    private applyRunnerWaitingState(
        namespace: string,
        project: StoredProject,
        task: StoredTask,
        error: TaskSessionStartFailure,
        previousTask?: StoredTask | null
    ): void {
        const waitingEvent: GoalTodoEventOptions = {
            writer: 'scheduler',
            action: 'scheduler_task_waiting_for_runner',
            reason: 'Scheduler kept the todo item on its current lane while waiting for runner recovery.',
            metadata: {
                source: 'applyRunnerWaitingState',
                lane: getTaskAutomationLane(task),
                errorCode: error.code,
                taskId: task.id
            }
        }
        const nextStatus = recoverStoredTaskStatusFromLegacyBlocked(task, {
            nonGoalFallback: task.status
        })
        const wroteDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
            namespace,
            project,
            task,
            patch: {
                status: nextStatus,
                blockedReason: RUNNER_OFFLINE_BLOCKED_REASON,
                blockedSource: 'scheduler',
                blockedSessionId: null
            },
            event: waitingEvent
        })
        const waitingTask = this.store.tasks.updateTaskByNamespace(task.id, namespace, {
            status: nextStatus,
            blockedReason: RUNNER_OFFLINE_BLOCKED_REASON,
            blockedSource: 'scheduler',
            blockedSessionId: null,
            initRuntime: buildTaskInitRuntime({
                current: task.initRuntime,
                activeSessionId: task.activeSessionId,
                status: 'waiting',
                failure: error,
                failureFingerprint: `start:${error.code}`,
                latestNote: 'Runner 当前离线。HOPI 会在 machine runner 恢复后自动重试。'
            })
        })
        const runtimeWaitingTask = waitingTask ? this.resolveRuntimeTask(namespace, waitingTask, previousTask ?? task) : null
        if (waitingTask) {
            if (!wroteDocsFirst) {
                this.writeGoalTodoStateForTask({
                    namespace,
                    project,
                    task: runtimeWaitingTask ?? waitingTask,
                    event: waitingEvent
                })
            }
            notifyProjectControllerTaskBlockedTransition({
                store: this.store,
                engine: this.engine,
                namespace,
                previousTask: task,
                task: runtimeWaitingTask ?? waitingTask
            })
            this.emitTaskUpdated(namespace, runtimeWaitingTask ?? waitingTask)
        }
        this.engine.handleRealtimeEvent({
            type: 'toast',
            namespace,
            data: {
                ...buildTaskSessionStartFailureToast({
                    taskTitle: runtimeWaitingTask?.title ?? task.title,
                    failure: error
                }),
                sessionId: '',
                url: '',
                taskStartFailure: error
            }
        })
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
            const hasEnabledGoalAutomation = listDocsBackedGoalsForProject({
                store: this.store,
                project,
                namespace
            })
                .some(isGoalAutomationEnabled)
            if (!project.autoRunEnabled && !hasEnabledGoalAutomation && autopilotGoals.length === 0) {
                return
            }

            this.engine.reconcileIdleGoalActionSessions?.(namespace, projectId)

            const projectReadinessReady = project.automationReadinessStatus === 'ready'

            const laneLimits = normalizeAutomationLaneLimits(project.automationLaneLimits)
            const runningByLane = countRunningSessionsByLane(this.engine.getSessionsByNamespace(namespace), projectId)
            const startedByLane = createLaneCounts()
            const projectTasks = this.listProjectAutomationTasks(namespace, project)
            const planned = projectTasks.filter((task) => (
                getTaskCanonicalLaneForAutomation(task) === 'planned'
                && !isTaskBlockedForRunnerRecovery(task)
            ))
            const review = projectTasks.filter((task) => getTaskCanonicalLaneForAutomation(task) === 'in_review')
            const runnerRecovery = projectTasks.filter(isTaskBlockedForRunnerRecovery)
            const candidates = sortAutomationCandidates([...review, ...planned, ...runnerRecovery])
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

                const writableTask = isTaskBlockedForRunnerRecovery(task)
                    ? (this.store.tasks.getTaskByNamespace(task.id, namespace) ?? this.materializeAutomationTask(namespace, task))
                    : this.materializeAutomationTask(namespace, task)
                if (!writableTask) continue

                const preparedTask = this.prepareRunnerRecoveryTask(namespace, project, writableTask)
                if (!preparedTask) continue

                const continued = await continueTaskInLinkedSession({
                    store: this.store,
                    engine: this.engine,
                    namespace,
                    taskId: preparedTask.id
                })
                const result = continued ?? await startSessionFromTask({
                    store: this.store,
                    engine: this.engine,
                    namespace,
                    taskId: preparedTask.id
                })

                startedByLane[lane] += 1

                if (result.ok) {
                    continue
                }

                const waitForRunnerRecovery = result.error.code === 'runner_offline'
                    && result.error.retry?.action === 'wait_then_retry_start'
                if (waitForRunnerRecovery) {
                    this.applyRunnerWaitingState(namespace, project, preparedTask, result.error, task)
                    break
                }

                const blockedEvent: GoalTodoEventOptions = {
                    writer: 'scheduler',
                    action: 'scheduler_task_blocked',
                    reason: 'Scheduler blocked the todo item because session startup failed.',
                    metadata: {
                        source: 'tickProject',
                        lane,
                        errorCode: result.error.code,
                        taskId: preparedTask.id
                    }
                }
                const nextBlockedStatus = recoverStoredTaskStatusFromLegacyBlocked(preparedTask)
                const wroteDocsFirst = this.syncGoalTodoBeforeTaskUpdate({
                    namespace,
                    project,
                    task: preparedTask,
                    patch: {
                        status: nextBlockedStatus,
                        blockedReason: result.error.message,
                        blockedSource: 'scheduler'
                    },
                    event: blockedEvent
                })
                const blocked = this.store.tasks.updateTaskByNamespace(preparedTask.id, namespace, {
                    status: nextBlockedStatus,
                    blockedReason: result.error.message,
                    blockedSource: 'scheduler'
                })
                if (blocked) {
                    const blockedTask = this.resolveRuntimeTask(namespace, blocked, task)
                    if (!wroteDocsFirst) {
                        this.writeGoalTodoStateForTask({
                            namespace,
                            project,
                            task: blockedTask,
                            event: blockedEvent
                        })
                        notifyProjectControllerTaskBlockedTransition({
                            store: this.store,
                            engine: this.engine,
                            namespace,
                            previousTask: preparedTask,
                            task: blockedTask
                        })
                    } else {
                        notifyProjectControllerTaskBlockedTransition({
                            store: this.store,
                            engine: this.engine,
                            namespace,
                            previousTask: preparedTask,
                            task: blockedTask
                        })
                    }
                    this.emitTaskUpdated(namespace, blockedTask)
                }

                this.engine.handleRealtimeEvent({
                    type: 'toast',
                    namespace,
                    data: {
                        ...buildTaskSessionStartFailureToast({
                            taskTitle: blocked ? this.resolveRuntimeTask(namespace, blocked, task).title : task.title,
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
