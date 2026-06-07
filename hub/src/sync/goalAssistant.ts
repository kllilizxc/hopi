import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { normalizeAutomationLaneLimits } from '@hopi/protocol'
import {
    GOAL_ASSISTANT_SYSTEM_PROMPT,
    GoalAssistantPlanningRequestItemSchema,
    GoalAssistantSessionProfileSchema,
    GoalAssistantSnapshotSchema,
    type GoalAssistantPlanningRequestItem,
    type GoalAssistantSessionProfile,
    type GoalAssistantTaskLane
} from '@hopi/protocol/goal-assistant'
import type { GoalTaskCanonicalStatus, TaskInitRuntime, TaskMergeRuntime, TaskPreviewRuntime } from '@hopi/protocol/types'
import type { Store, StoredGoal, StoredGoalDecisionTopic, StoredProject, StoredTask, StoredWorkspace } from '../store'
import type { RpcReadFileResponse, RpcWriteFileResponse, SyncEngine } from './syncEngine'
import {
    getDocsRoot,
    getGoalDocPath,
    getGoalEventsPath,
    getGoalPlanningRequestsPath,
    getGoalTodoPath,
    getPreferencePath
} from './goals/goalDocPaths'
import { listGoalDecisionTopicsFromDocs } from './goals/goalDecisionStore'
import { overlayGoalWithCanonicalDoc } from './goals/goalDocs'
import { createGoalWorkflowEventLine } from './goals/goalEventLog'
import { parseGoalPlannerMail } from './goals/goalPlannerMail'
import { parseGoalPlanningRequests, stringifyGoalPlanningRequests } from './goals/goalPlanningRequests'
import { getGoalCanonicalStatusForStoredTask } from './goals/goalTaskState'
import { buildGoalTodoTaskProjection } from './goals/goalTodoProjection'

type GoalAssistantContext = {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace
    docsRoot: string
}

type GoalAssistantEngine = Pick<
    SyncEngine,
    'getSessionsByNamespace' | 'readFileOnMachine' | 'writeFileOnMachine'
>

const DEFAULT_PREFERENCE_MARKDOWN = [
    '# HOPI Preferences',
    '',
    '- No saved preferences yet.',
    ''
].join('\n')
const DEFAULT_PLANNER_MAIL_DOCUMENT = 'version: 1\nmail: []\n'
const DEFAULT_PLANNING_REQUESTS_DOCUMENT = 'version: 1\nrequests: []\n'
const GOAL_ASSISTANT_MACHINE_FILE_TIMEOUT_MS = 10_000

const LANE_PRIORITY = {
    planner: 0,
    generator: 1,
    evaluator: 2,
    radar: 3
} as const

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
}

type GoalAssistantTaskStatusInput = StoredTask & {
    goalCanonicalStatus?: GoalTaskCanonicalStatus | null
}

export function getGoalAssistantTaskLane(task: GoalAssistantTaskStatusInput): 'planned' | 'in_progress' | 'in_review' | 'merging' | 'done' {
    if (task.goalCanonicalStatus) {
        return task.goalCanonicalStatus
    }
    return getGoalCanonicalStatusForStoredTask(task)
}

function getGoalAssistantTaskStatus(task: GoalAssistantTaskStatusInput): 'planned' | 'in_progress' | 'in_review' | 'merging' | 'done' {
    return getGoalAssistantTaskLane(task)
}

function getTaskRole(task: Pick<StoredTask, 'source' | 'status'>): 'planner' | 'generator' | 'evaluator' | 'radar' {
    if (task.status === 'review' || task.status === 'in_review') {
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

function resolveSessionLane(metadata: unknown): keyof typeof LANE_PRIORITY | null {
    const record = asRecord(metadata)
    const lane = record?.hopiTaskRole
    return lane === 'planner' || lane === 'generator' || lane === 'evaluator' || lane === 'radar'
        ? lane
        : null
}

function pushBlocker(blockers: string[], value: string | null | undefined): void {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!normalized || blockers.includes(normalized)) {
        return
    }
    blockers.push(normalized)
}

function runtimeBlockedReason(runtime: TaskInitRuntime | TaskMergeRuntime | TaskPreviewRuntime | null | undefined): string | null {
    if (!runtime) return null
    if (runtime.status === 'blocked' || runtime.status === 'canceled') {
        return runtime.blockedReason ?? runtime.failure?.blockedReason ?? runtime.failure?.message ?? runtime.latestNote ?? null
    }
    if (runtime.status === 'waiting' && runtime.failure) {
        return runtime.failure.blockedReason ?? runtime.failure.message ?? runtime.blockedReason ?? runtime.latestNote ?? null
    }
    return null
}

function deriveTaskBlockers(task: StoredTask, topics: StoredGoalDecisionTopic[]): string[] {
    const blockers: string[] = []
    if (task.blockedSource === 'decision') {
        const topic = topics.find((candidate) => candidate.taskId === task.id && candidate.status === 'waiting')
        pushBlocker(blockers, topic?.title ?? task.blockedReason)
    }
    pushBlocker(blockers, task.blockedReason)
    if (task.initRuntime?.status === 'waiting' && task.initRuntime.failure?.code === 'runner_offline') {
        pushBlocker(blockers, 'Runner offline. Auto-resume queued when the machine reconnects.')
    }
    pushBlocker(blockers, runtimeBlockedReason(task.initRuntime))
    pushBlocker(blockers, runtimeBlockedReason(task.previewRuntime))
    pushBlocker(blockers, runtimeBlockedReason(task.mergeRuntime))
    return blockers
}

function readTextContent(result: RpcReadFileResponse, fallback: string): string {
    if (!result.success || typeof result.content !== 'string') {
        return fallback
    }
    try {
        return Buffer.from(result.content, 'base64').toString('utf8')
    } catch {
        return fallback
    }
}

function encodeTextContent(content: string): string {
    return Buffer.from(content, 'utf8').toString('base64')
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error(`${label} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
        promise.then(
            (value) => {
                clearTimeout(timer)
                resolve(value)
            },
            (error) => {
                clearTimeout(timer)
                reject(error)
            }
        )
    })
}

async function readFileOnMachineWithTimeout(
    engine: GoalAssistantEngine,
    machineId: string,
    path: string,
    timeoutMs: number = GOAL_ASSISTANT_MACHINE_FILE_TIMEOUT_MS
): Promise<RpcReadFileResponse> {
    return await withTimeout(
        engine.readFileOnMachine(machineId, path),
        timeoutMs,
        `Goal Assistant file read (${path})`
    )
}

async function writeFileOnMachineWithTimeout(
    engine: GoalAssistantEngine,
    machineId: string,
    path: string,
    options: {
        content: string
        cwd?: string
        expectedHash?: string | null
        createParents?: boolean
        overwrite?: boolean
    },
    timeoutMs: number = GOAL_ASSISTANT_MACHINE_FILE_TIMEOUT_MS
): Promise<RpcWriteFileResponse> {
    return await withTimeout(
        engine.writeFileOnMachine(machineId, path, options),
        timeoutMs,
        `Goal Assistant file write (${path})`
    )
}

function requireWriteSuccess(result: RpcWriteFileResponse, message: string): void {
    if (!result.success) {
        throw new Error(result.error || message)
    }
}

async function appendGoalWorkflowEventOnMachine(options: {
    engine: GoalAssistantEngine
    machineId: string
    docsRoot: string
    goalKey: string
    writer: string
    action: string
    entity: {
        type: string
        id: string
    }
    before: Record<string, unknown> | null
    after: Record<string, unknown> | null
    reason: string
    metadata?: Record<string, unknown> | null
    timeoutMs?: number
}): Promise<void> {
    const path = getGoalEventsPath(options.docsRoot, options.goalKey)
    const current = readTextContent(
        await readFileOnMachineWithTimeout(options.engine, options.machineId, path, options.timeoutMs)
            .catch(() => ({ success: false } as RpcReadFileResponse)),
        ''
    )
    const next = `${current}${createGoalWorkflowEventLine({
        writer: options.writer,
        action: options.action,
        entity: options.entity,
        before: options.before,
        after: options.after,
        reason: options.reason,
        metadata: options.metadata ?? null
    })}`
    const written = await writeFileOnMachineWithTimeout(options.engine, options.machineId, path, {
        content: encodeTextContent(next),
        createParents: true,
        overwrite: true
    }, options.timeoutMs).catch(() => ({ success: false } as RpcWriteFileResponse))
    if (!written.success) {
        // Best-effort for now: planning request writes already succeeded and remote writes are not atomic.
        return
    }
}

export function buildGoalAssistantSessionProfile(projectId: string, goalId: string): GoalAssistantSessionProfile {
    return GoalAssistantSessionProfileSchema.parse({
        kind: 'goal_assistant',
        projectId,
        goalId
    })
}

export function getGoalAssistantSystemPrompt(): string {
    return GOAL_ASSISTANT_SYSTEM_PROMPT
}

export function resolveGoalAssistantContext(options: {
    store: Store
    namespace: string
    projectId: string
    goalId: string
}): GoalAssistantContext {
    const project = options.store.projects.getProjectByNamespace(options.projectId, options.namespace)
    if (!project) {
        throw new Error('Project not found')
    }
    const goal = options.store.goals.getGoalByNamespace(options.goalId, options.namespace)
    if (!goal || goal.projectId !== project.id || goal.archivedAt !== null) {
        throw new Error('Goal not found')
    }
    const defaultWorkspace = project.defaultWorkspaceId
        ? options.store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : options.store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
    if (!defaultWorkspace) {
        throw new Error('Project has no workspace')
    }
    const docsRoot = getDocsRoot(defaultWorkspace)
    if (!docsRoot) {
        throw new Error('Workspace docs root unavailable')
    }
    if (
        !existsSync(getGoalDocPath(docsRoot, goal.goalKey))
        && !existsSync(getGoalTodoPath(docsRoot, goal.goalKey))
    ) {
        throw new Error('Goal not found')
    }
    return {
        project,
        goal: overlayGoalWithCanonicalDoc({
            goal,
            defaultWorkspace
        }),
        defaultWorkspace,
        docsRoot
    }
}

export function buildDefaultLaneRequestMessage(lane: GoalAssistantTaskLane): string {
    if (lane === 'planned') {
        return 'The user re-added this task to the execution plan. Re-evaluate the current state and continue when scheduler conditions are satisfied.'
    }
    return 'The user asked to retry merging this task. Re-check the current base state before continuing.'
}

export async function readGoalAssistantPreference(options: {
    engine: GoalAssistantEngine
    machineId: string
    docsRoot: string
    timeoutMs?: number
}): Promise<string> {
    try {
        const result = await readFileOnMachineWithTimeout(options.engine, options.machineId, getPreferencePath(options.docsRoot), options.timeoutMs)
        if (result.success && typeof result.content === 'string') {
            return readTextContent(result, DEFAULT_PREFERENCE_MARKDOWN)
        }
    } catch {
    }
    return DEFAULT_PREFERENCE_MARKDOWN
}

export async function writeGoalAssistantPreference(options: {
    engine: GoalAssistantEngine
    machineId: string
    docsRoot: string
    markdown: string
    timeoutMs?: number
}): Promise<void> {
    const result = await writeFileOnMachineWithTimeout(options.engine, options.machineId, getPreferencePath(options.docsRoot), {
        content: encodeTextContent(options.markdown),
        createParents: true,
        overwrite: true
    }, options.timeoutMs)
    requireWriteSuccess(result, 'Failed to write preference.md')
}

export async function readGoalAssistantPlanningRequests(options: {
    engine: GoalAssistantEngine
    machineId: string
    docsRoot: string
    goalKey: string
    timeoutMs?: number
}): Promise<GoalAssistantPlanningRequestItem[]> {
    const canonicalPath = getGoalPlanningRequestsPath(options.docsRoot, options.goalKey)
    try {
        const result = await readFileOnMachineWithTimeout(options.engine, options.machineId, canonicalPath, options.timeoutMs)
        if (result.success && typeof result.content === 'string') {
            const document = parseGoalPlanningRequests(readTextContent(result, DEFAULT_PLANNING_REQUESTS_DOCUMENT))
            return document.requests.filter((item) => item.status === 'pending')
        }
    } catch {
    }
    return []
}

export async function appendGoalAssistantPlanningRequest(options: {
    engine: GoalAssistantEngine
    machineId: string
    docsRoot: string
    goalKey: string
    body: string
    relatedTaskIds?: string[]
    timeoutMs?: number
}): Promise<GoalAssistantPlanningRequestItem> {
    const canonicalPath = getGoalPlanningRequestsPath(options.docsRoot, options.goalKey)
    let existingRequests = readTextContent(
        await readFileOnMachineWithTimeout(options.engine, options.machineId, canonicalPath, options.timeoutMs).catch(() => ({ success: false } as RpcReadFileResponse)),
        DEFAULT_PLANNING_REQUESTS_DOCUMENT
    )
    let document = parseGoalPlanningRequests(existingRequests)
    const item = GoalAssistantPlanningRequestItemSchema.parse({
        id: randomUUID(),
        body: options.body,
        relatedTaskIds: options.relatedTaskIds ?? [],
        createdAt: Date.now(),
        status: 'pending'
    })
    document.requests.push(item)
    const next = stringifyGoalPlanningRequests(document)
    const written = await writeFileOnMachineWithTimeout(options.engine, options.machineId, canonicalPath, {
        content: encodeTextContent(next),
        createParents: true,
        overwrite: true
    }, options.timeoutMs)
    requireWriteSuccess(written, 'Failed to append planner mail')
    await appendGoalWorkflowEventOnMachine({
        engine: options.engine,
        machineId: options.machineId,
        docsRoot: options.docsRoot,
        goalKey: options.goalKey,
        writer: 'goal-assistant',
        action: 'planning_request_appended',
        entity: {
            type: 'planning_request',
            id: item.id
        },
        before: null,
        after: {
            id: item.id,
            body: item.body,
            relatedTaskIds: item.relatedTaskIds,
            status: item.status,
            createdAt: item.createdAt
        },
        reason: 'User requested planner follow-through for this Goal.',
        metadata: {
            path: canonicalPath,
            source: 'appendGoalAssistantPlanningRequest'
        },
        timeoutMs: options.timeoutMs
    })
    return item
}

export const readGoalAssistantPlannerMail = readGoalAssistantPlanningRequests
export const appendGoalAssistantPlannerMail = appendGoalAssistantPlanningRequest

export async function buildGoalAssistantSnapshot(options: {
    store: Store
    engine: GoalAssistantEngine
    namespace: string
    projectId: string
    goalId: string
    machineFileTimeoutMs?: number
}): Promise<ReturnType<typeof GoalAssistantSnapshotSchema.parse>> {
    const context = resolveGoalAssistantContext(options)
    const topics = listGoalDecisionTopicsFromDocs({
        project: context.project,
        goal: context.goal,
        defaultWorkspace: context.defaultWorkspace
    })
    const tasks = buildGoalTodoTaskProjection({
        store: options.store,
        project: context.project,
        goalId: context.goal.id,
        namespace: options.namespace,
        includeArchived: false
    })
    const sessions = options.engine.getSessionsByNamespace(options.namespace)
    const limits = normalizeAutomationLaneLimits(context.project.automationLaneLimits)
    const runningCounts = {
        planner: 0,
        generator: 0,
        evaluator: 0,
        radar: 0
    }
    const activeRuntimes: Array<{
        taskId: string
        taskTitle: string
        lane: 'planned' | 'in_progress' | 'in_review' | 'merging' | 'done'
        sessionId: string
        thinking: boolean
    }> = []

    for (const session of sessions) {
        const metadata = asRecord(session.metadata)
        if (metadata?.projectId !== context.project.id) {
            continue
        }
        const lane = resolveSessionLane(session.metadata)
        if (lane && session.thinking) {
            runningCounts[lane] += 1
        }
        if (typeof metadata?.taskId === 'string') {
            const task = tasks.find((candidate) => (
                candidate.id === metadata.taskId
                || candidate.goalTodoRef === metadata.taskId
            ))
            if (task) {
                activeRuntimes.push({
                    taskId: task.id,
                    taskTitle: task.title,
                    lane: getGoalAssistantTaskLane(task),
                    sessionId: session.id,
                    thinking: Boolean(session.thinking)
                })
            }
        }
    }

    const planningRequests = await readGoalAssistantPlanningRequests({
        engine: options.engine,
        machineId: context.project.machineId,
        docsRoot: context.docsRoot,
        goalKey: context.goal.goalKey,
        timeoutMs: options.machineFileTimeoutMs
    })
    const preferenceMarkdown = await readGoalAssistantPreference({
        engine: options.engine,
        machineId: context.project.machineId,
        docsRoot: context.docsRoot,
        timeoutMs: options.machineFileTimeoutMs
    })
    return GoalAssistantSnapshotSchema.parse({
        projectId: context.project.id,
        goalId: context.goal.id,
        goalKey: context.goal.goalKey,
        goalTitle: context.goal.title,
        goalStatus: context.goal.status,
        goalAutomationPaused: context.goal.automationPausedAt !== null,
        goalDescription: context.goal.description,
        currentFocus: context.goal.currentFocus,
        successCriteria: context.goal.successCriteria,
        tasks: tasks.map((task) => ({
            id: task.id,
            title: task.title,
            status: getGoalAssistantTaskStatus(task),
            lane: getGoalAssistantTaskLane(task),
            source: task.source,
            activeSessionId: task.activeSessionId,
            blockers: deriveTaskBlockers(task, topics)
        })),
        decisionTopics: topics.map((topic) => ({
            id: topic.id,
            scope: topic.scope ?? (topic.taskId ? 'task' : 'goal'),
            taskId: topic.taskId,
            title: topic.title,
            body: topic.body,
            prompt: topic.prompt ?? null,
            blocking: topic.blocking,
            status: topic.status
        })),
        planningRequests,
        laneBudgetSaturation: {
            planner: { running: runningCounts.planner, limit: limits.planner },
            generator: { running: runningCounts.generator, limit: limits.generator },
            evaluator: { running: runningCounts.evaluator, limit: limits.evaluator },
            radar: { running: runningCounts.radar, limit: limits.radar }
        },
        activeRuntimes,
        preferenceMarkdown
    })
}
