import {
    DEFAULT_AGENT_FLAVOR,
    DEFAULT_AUTONOMOUS_TASK_PERMISSION_MODE,
    DEFAULT_TASK_MODEL,
    isModelModeAllowedForFlavor,
    isPermissionModeAllowedForFlavor
} from '@hopi/protocol'
import type { AgentFlavor, ModelMode, PermissionMode, Session } from '@hopi/protocol/types'
import type { Store, StoredGoal, StoredProject, StoredSession, StoredTask, StoredWorkspace } from '../store'
import { readGoalTodo } from './goals/goalTodo'
import type { SyncEngine } from './syncEngine'

const CONTROLLER_EVENT_LOCAL_ID_PREFIX = 'controller:event:'
const CONTROLLER_BRIEFING_LOCAL_ID_PREFIX = 'controller:briefing:'
const CONTROLLER_BRIEFING_COOLDOWN_MS = 20 * 60 * 60 * 1000
const CONTROLLER_BRIEFING_IN_FLIGHT_TIMEOUT_MS = 10 * 60 * 1000

type ProjectControllerSessionResult =
    | {
        ok: true
        created: boolean
        sessionId: string
        session: Session | null
    }
    | {
        ok: false
        status: 400 | 404 | 500 | 503
        error: string
    }

type ProjectControllerBriefingResult =
    | {
        ok: true
        queued: boolean
        reason: 'queued' | 'cooldown' | 'busy' | 'in_flight' | 'controller_unavailable' | 'empty_goal'
        sessionId: string | null
    }
    | {
        ok: false
        status: 400 | 404 | 500 | 503
        error: string
    }

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function getNumber(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function getDefaultWorkspace(store: Store, project: StoredProject): StoredWorkspace | null {
    if (project.defaultWorkspaceId) {
        const workspace = store.workspaces.getWorkspace(project.defaultWorkspaceId)
        if (workspace) return workspace
    }
    return store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
}

function isProjectControllerMetadata(metadata: unknown, projectId: string, goalId: string): boolean {
    if (!isRecord(metadata)) return false
    return metadata.projectId === projectId && metadata.goalId === goalId && metadata.hopiController === true
}

function findStoredProjectControllerSession(store: Store, namespace: string, projectId: string, goalId: string): StoredSession | null {
    const sessions = store.sessions.getSessionsByNamespace(namespace)
        .filter((session) => isProjectControllerMetadata(session.metadata, projectId, goalId))
        .sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1
            return b.updatedAt - a.updatedAt
        })
    return sessions[0] ?? null
}

function mergeControllerMetadata(input: {
    current: unknown
    project: StoredProject
    goal: StoredGoal
    workspace: StoredWorkspace
    machineHost?: string | null
    agent: AgentFlavor
}): Record<string, unknown> {
    const base = isRecord(input.current) ? input.current : {}
    return {
        ...base,
        path: typeof base.path === 'string' && base.path.trim() ? base.path : input.workspace.path,
        host: typeof base.host === 'string' && base.host.trim() ? base.host : input.machineHost ?? 'controller',
        name: `Controller - ${input.project.name} - ${input.goal.title}`,
        projectId: input.project.id,
        goalId: input.goal.id,
        hopiController: true,
        flavor: typeof base.flavor === 'string' ? base.flavor : input.agent,
        machineId: typeof base.machineId === 'string' ? base.machineId : input.project.machineId
    }
}

function markProjectControllerSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    sessionId: string
    project: StoredProject
    goal: StoredGoal
    workspace: StoredWorkspace
    agent: AgentFlavor
}): boolean {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const stored = options.store.sessions.getSessionByNamespace(options.sessionId, options.namespace)
        if (!stored) return false
        const machine = options.engine.getMachineByNamespace(options.project.machineId, options.namespace)
        const nextMetadata = mergeControllerMetadata({
            current: stored.metadata,
            project: options.project,
            goal: options.goal,
            workspace: options.workspace,
            machineHost: typeof machine?.metadata?.host === 'string' ? machine.metadata.host : null,
            agent: options.agent
        })
        const result = options.store.sessions.updateSessionMetadata(
            options.sessionId,
            nextMetadata,
            stored.metadataVersion,
            options.namespace,
            { touchUpdatedAt: false }
        )
        if (result.result === 'success') {
            options.engine.handleRealtimeEvent({
                type: 'session-updated',
                sessionId: options.sessionId,
                projectId: options.project.id,
                namespace: options.namespace,
                data: { sessionId: options.sessionId }
            })
            return true
        }
        if (result.result === 'error') return false
    }
    return false
}

function updateControllerMetadata(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    sessionId: string
    projectId: string
    update: (metadata: Record<string, unknown>) => Record<string, unknown>
}): boolean {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const stored = options.store.sessions.getSessionByNamespace(options.sessionId, options.namespace)
        if (!stored) return false
        const base = isRecord(stored.metadata) ? stored.metadata : {}
        const nextMetadata = options.update(base)
        const result = options.store.sessions.updateSessionMetadata(
            options.sessionId,
            nextMetadata,
            stored.metadataVersion,
            options.namespace,
            { touchUpdatedAt: false }
        )
        if (result.result === 'success') {
            options.engine.handleRealtimeEvent({
                type: 'session-updated',
                sessionId: options.sessionId,
                projectId: options.projectId,
                namespace: options.namespace,
                data: { sessionId: options.sessionId }
            })
            return true
        }
        if (result.result === 'error') return false
    }
    return false
}

function resolveControllerAgent(project: StoredProject): AgentFlavor {
    return (project.defaultAgentFlavor as AgentFlavor | null) ?? DEFAULT_AGENT_FLAVOR
}

function resolveControllerModel(project: StoredProject, agent: AgentFlavor): string | undefined {
    return project.defaultModel ?? (agent === DEFAULT_AGENT_FLAVOR ? DEFAULT_TASK_MODEL : undefined)
}

function resolveControllerPermissionMode(project: StoredProject, agent: AgentFlavor): PermissionMode | undefined {
    const projectMode = project.defaultPermissionMode as PermissionMode | null
    if (projectMode && isPermissionModeAllowedForFlavor(projectMode, agent)) {
        return projectMode
    }
    if (isPermissionModeAllowedForFlavor(DEFAULT_AUTONOMOUS_TASK_PERMISSION_MODE, agent)) {
        return DEFAULT_AUTONOMOUS_TASK_PERMISSION_MODE
    }
    if (isPermissionModeAllowedForFlavor('acceptEdits', agent)) {
        return 'acceptEdits'
    }
    if (isPermissionModeAllowedForFlavor('yolo', agent)) {
        return 'yolo'
    }
    return undefined
}

function resolveControllerModelMode(project: StoredProject, agent: AgentFlavor): ModelMode | undefined {
    const mode = project.defaultModelMode as ModelMode | null
    return mode && isModelModeAllowedForFlavor(mode, agent) ? mode : undefined
}

function buildGoalSummary(store: Store, project: StoredProject, goal: StoredGoal, workspace: StoredWorkspace | null, namespace: string): string {
    const todo = readGoalTodo({ project, goal, defaultWorkspace: workspace })
    const counts = new Map<string, number>()
    for (const section of todo.sections) {
        const key = `${section.status}${section.tag ? `/${section.tag}` : ''}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const countText = counts.size > 0
        ? Array.from(counts.entries()).map(([key, count]) => `${key}: ${count}`).join(', ')
        : 'no todo items'
    const waitingTopics = store.goalDecisionTopics
        .listByGoalAndNamespace(goal.id, namespace)
        .filter((topic) => topic.status === 'waiting')
    const topicText = waitingTopics.length > 0
        ? `; waiting decisions: ${waitingTopics.map((topic) => `${topic.title}${topic.blocking ? ' (blocking)' : ''}`).join('; ')}`
        : ''
    return `- ${goal.title} (${goal.goalKey}, ${goal.status}): ${countText}${topicText}`
}

function resolveBriefingGoal(options: {
    store: Store
    project: StoredProject
    namespace: string
    goalId?: string | null
}): StoredGoal | null {
    const requestedGoalId = options.goalId?.trim()
    if (requestedGoalId) {
        const goal = options.store.goals.getGoalByNamespace(requestedGoalId, options.namespace)
        if (goal && goal.projectId === options.project.id && goal.archivedAt === null) {
            return goal
        }
    }

    return options.store.goals.listGoalsByProjectAndNamespace(options.project.id, options.namespace, {
        includeArchived: false
    })[0] ?? null
}

function getRequestedActiveGoal(options: {
    store: Store
    project: StoredProject
    namespace: string
    goalId?: string | null
}): StoredGoal | null {
    const requestedGoalId = options.goalId?.trim()
    if (!requestedGoalId) return null
    const goal = options.store.goals.getGoalByNamespace(requestedGoalId, options.namespace)
    if (!goal || goal.projectId !== options.project.id || goal.archivedAt !== null) return null
    return goal
}

function buildGoalDocsSummary(goal: StoredGoal | null): string {
    if (!goal) {
        return '- No current goal selected. When a goal exists, start from .hopi/docs/goals/<goalKey>/index.md and .hopi/docs/goals/<goalKey>/todo.yml.'
    }

    return [
        `- ${goal.title} (${goal.goalKey})`,
        `  - index: .hopi/docs/goals/${goal.goalKey}/index.md`,
        `  - todo: .hopi/docs/goals/${goal.goalKey}/todo.yml`
    ].join('\n')
}

function buildProjectControllerBriefingPrompt(options: {
    store: Store
    namespace: string
    project: StoredProject
    workspace: StoredWorkspace
    goal: StoredGoal | null
}): string {
    const goalLine = options.goal
        ? buildGoalSummary(options.store, options.project, options.goal, options.workspace, options.namespace)
        : '- No current goal selected.'

    return [
        `Controller briefing request for project "${options.project.name}".`,
        '',
        'Review the current project state and send the user one concise personal-assistant greeting.',
        '',
        'Start only from this current goal docs:',
        buildGoalDocsSummary(options.goal),
        '',
        'Current goal board summary:',
        goalLine,
        '',
        'Rules:',
        '- Do not edit files or run implementation work for this briefing.',
        '- Focus only on the current goal above. Do not inspect or summarize other goals unless the user asks.',
        '- Mention only useful status: what changed, what is blocked or waiting for a decision, and the best next action.',
        '- Keep it short and natural, like a project assistant greeting the user after they came back.',
        '- If there is nothing important, say that briefly and suggest one practical next step.'
    ].join('\n')
}

function hasVisibleGoalTasks(options: {
    store: Store
    namespace: string
    projectId: string
    goalId: string
}): boolean {
    return options.store.tasks.listTasksByProjectAndNamespace(options.projectId, options.namespace, {
        goalId: options.goalId,
        includeArchived: false
    }).length > 0
}

export function getProjectControllerSession(options: {
    store: Store
    engine: SyncEngine | null
    namespace: string
    projectId: string
    goalId?: string | null
}): { sessionId: string; session: Session | null } | null {
    const goalId = options.goalId?.trim()
    if (!goalId) return null
    const stored = findStoredProjectControllerSession(options.store, options.namespace, options.projectId, goalId)
    if (!stored) return null
    return {
        sessionId: stored.id,
        session: options.engine?.getSessionByNamespace(stored.id, options.namespace) ?? null
    }
}

export async function ensureProjectControllerSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    projectId: string
    goalId?: string | null
}): Promise<ProjectControllerSessionResult> {
    const project = options.store.projects.getProjectByNamespace(options.projectId, options.namespace)
    if (!project) {
        return { ok: false, status: 404, error: 'Project not found' }
    }
    const goal = getRequestedActiveGoal({
        store: options.store,
        project,
        namespace: options.namespace,
        goalId: options.goalId
    })
    if (!goal) {
        return { ok: false, status: 400, error: 'Controller requires an active goal' }
    }
    const workspace = getDefaultWorkspace(options.store, project)
    if (!workspace) {
        return { ok: false, status: 400, error: 'Project has no workspace' }
    }

    const existing = findStoredProjectControllerSession(options.store, options.namespace, project.id, goal.id)
    if (existing) {
        const runtime = options.engine.getSessionByNamespace(existing.id, options.namespace)
        if (runtime?.active) {
            return { ok: true, created: false, sessionId: existing.id, session: runtime }
        }
        const resumed = await options.engine.resumeSession(existing.id, options.namespace)
        if (resumed.type === 'success') {
            const agent = resolveControllerAgent(project)
            markProjectControllerSession({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                sessionId: resumed.sessionId,
                project,
                goal,
                workspace,
                agent
            })
            return {
                ok: true,
                created: false,
                sessionId: resumed.sessionId,
                session: options.engine.getSessionByNamespace(resumed.sessionId, options.namespace) ?? null
            }
        }
    }

    const machine = options.engine.getMachineByNamespace(project.machineId, options.namespace)
    if (!machine || machine.active === false) {
        return { ok: false, status: 503, error: 'Project machine is offline' }
    }

    const agent = resolveControllerAgent(project)
    const model = resolveControllerModel(project, agent)
    const spawned = await options.engine.spawnSession(
        project.machineId,
        workspace.path,
        agent,
        model,
        false,
        'simple',
        undefined
    )
    if (spawned.type === 'error') {
        return { ok: false, status: 503, error: spawned.message }
    }

    const becameActive = await options.engine.waitForSessionActive(spawned.sessionId, 20_000)
    if (!becameActive) {
        return { ok: false, status: 503, error: 'Controller session failed to become active' }
    }

    markProjectControllerSession({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        sessionId: spawned.sessionId,
        project,
        goal,
        workspace,
        agent
    })

    const permissionMode = resolveControllerPermissionMode(project, agent)
    const modelMode = resolveControllerModelMode(project, agent)
    if (permissionMode || modelMode) {
        try {
            await options.engine.applySessionConfig(spawned.sessionId, { permissionMode, modelMode })
        } catch {
        }
    }

    return {
        ok: true,
        created: true,
        sessionId: spawned.sessionId,
        session: options.engine.getSessionByNamespace(spawned.sessionId, options.namespace) ?? null
    }
}

export async function maybeRefreshProjectControllerBriefing(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    projectId: string
    goalId?: string | null
    now?: number
    cooldownMs?: number
}): Promise<ProjectControllerBriefingResult> {
    const now = options.now ?? Date.now()
    const project = options.store.projects.getProjectByNamespace(options.projectId, options.namespace)
    if (!project) {
        return { ok: false, status: 404, error: 'Project not found' }
    }
    const workspace = getDefaultWorkspace(options.store, project)
    if (!workspace) {
        return { ok: false, status: 400, error: 'Project has no workspace' }
    }
    const goal = resolveBriefingGoal({
        store: options.store,
        project,
        namespace: options.namespace,
        goalId: options.goalId
    })
    if (!goal) {
        return { ok: true, queued: false, reason: 'controller_unavailable', sessionId: null }
    }
    const briefingGoalId = goal.id
    if (!hasVisibleGoalTasks({
        store: options.store,
        namespace: options.namespace,
        projectId: project.id,
        goalId: briefingGoalId
    })) {
        return { ok: true, queued: false, reason: 'empty_goal', sessionId: null }
    }

    const ensured = await ensureProjectControllerSession({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        projectId: options.projectId,
        goalId: goal.id
    })
    if (!ensured.ok) {
        return { ok: true, queued: false, reason: 'controller_unavailable', sessionId: null }
    }

    const runtime = options.engine.getSessionByNamespace(ensured.sessionId, options.namespace)
    if (!runtime?.active || runtime.thinking) {
        return { ok: true, queued: false, reason: 'busy', sessionId: ensured.sessionId }
    }

    const stored = options.store.sessions.getSessionByNamespace(ensured.sessionId, options.namespace)
    const metadata = isRecord(stored?.metadata) ? stored.metadata : {}
    const lastAt = getNumber(metadata.controllerBriefingLastAt)
    const inFlightAt = getNumber(metadata.controllerBriefingInFlightAt)
    const lastGoalId = getString(metadata.controllerBriefingLastGoalId)
    const inFlightGoalId = getString(metadata.controllerBriefingInFlightGoalId)
    if (
        inFlightAt !== null
        && inFlightGoalId === briefingGoalId
        && now - inFlightAt < CONTROLLER_BRIEFING_IN_FLIGHT_TIMEOUT_MS
    ) {
        return { ok: true, queued: false, reason: 'in_flight', sessionId: ensured.sessionId }
    }
    const cooldownMs = options.cooldownMs ?? CONTROLLER_BRIEFING_COOLDOWN_MS
    if (lastAt !== null && lastGoalId === briefingGoalId && now - lastAt < cooldownMs) {
        return { ok: true, queued: false, reason: 'cooldown', sessionId: ensured.sessionId }
    }

    const marked = updateControllerMetadata({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        sessionId: ensured.sessionId,
        projectId: project.id,
        update: (current) => ({
            ...current,
            controllerBriefingInFlightAt: now,
            controllerBriefingInFlightGoalId: briefingGoalId
        })
    })
    if (!marked) {
        return { ok: true, queued: false, reason: 'in_flight', sessionId: ensured.sessionId }
    }

    try {
        await options.engine.sendMessage(ensured.sessionId, {
            text: buildProjectControllerBriefingPrompt({
                store: options.store,
                namespace: options.namespace,
                project,
                workspace,
                goal
            }),
            localId: `${CONTROLLER_BRIEFING_LOCAL_ID_PREFIX}${project.id}:${briefingGoalId}:${now}`,
            sentFrom: 'webapp'
        })
        updateControllerMetadata({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            sessionId: ensured.sessionId,
            projectId: project.id,
            update: (current) => {
                const next: Record<string, unknown> = {
                    ...current,
                    controllerBriefingLastAt: now,
                    controllerBriefingLastGoalId: briefingGoalId
                }
                delete next.controllerBriefingInFlightAt
                delete next.controllerBriefingInFlightGoalId
                return next
            }
        })
        return { ok: true, queued: true, reason: 'queued', sessionId: ensured.sessionId }
    } catch {
        updateControllerMetadata({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            sessionId: ensured.sessionId,
            projectId: project.id,
            update: (current) => {
                const next = { ...current }
                delete next.controllerBriefingInFlightAt
                delete next.controllerBriefingInFlightGoalId
                return next
            }
        })
        return { ok: false, status: 503, error: 'Failed to queue controller briefing' }
    }
}

export function notifyProjectController(options: {
    store: Store
    engine: SyncEngine | null
    namespace: string
    projectId: string
    kind: 'decision' | 'blocked'
    title: string
    body: string
    taskId?: string | null
    goalId?: string | null
}): void {
    if (!options.engine) return
    const controller = getProjectControllerSession({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        projectId: options.projectId,
        goalId: options.goalId
    })
    if (!controller?.session?.active) return

    const lines = [
        options.kind === 'decision'
            ? `Controller event: a human decision is waiting - ${options.title}`
            : `Controller event: work is blocked - ${options.title}`,
        '',
        options.body
    ]
    if (options.goalId || options.taskId) {
        lines.push('', `Context: goalId=${options.goalId ?? 'none'} taskId=${options.taskId ?? 'none'}`)
    }

    void options.engine.sendMessage(controller.sessionId, {
        text: lines.join('\n'),
        localId: `${CONTROLLER_EVENT_LOCAL_ID_PREFIX}${options.kind}:${options.projectId}:${options.goalId ?? 'none'}:${Date.now()}`,
        sentFrom: 'webapp'
    }).catch(() => {})
}

type BlockedTaskTransitionSnapshot = Pick<StoredTask,
    'id'
    | 'projectId'
    | 'goalId'
    | 'title'
    | 'status'
    | 'blockedReason'
    | 'blockedSource'
    | 'blockedSessionId'
>

function isBlockedTaskStatus(status: string | null | undefined): boolean {
    return status === 'blocked'
}

export function notifyProjectControllerTaskBlockedTransition(options: {
    store: Store
    engine: SyncEngine | null
    namespace: string
    previousTask?: Pick<BlockedTaskTransitionSnapshot, 'status'> | null
    task: BlockedTaskTransitionSnapshot
}): void {
    if (!options.task.goalId) return
    if (!isBlockedTaskStatus(options.task.status)) return
    if (isBlockedTaskStatus(options.previousTask?.status)) return

    const reason = options.task.blockedReason?.trim() || 'No blocked reason recorded.'
    const lines = [
        `Task: ${options.task.title}`,
        `Reason: ${reason}`
    ]
    if (options.task.blockedSource) {
        lines.push(`Source: ${options.task.blockedSource}`)
    }
    if (options.task.blockedSessionId) {
        lines.push(`Session: ${options.task.blockedSessionId}`)
    }

    notifyProjectController({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        projectId: options.task.projectId,
        goalId: options.task.goalId,
        taskId: options.task.id,
        kind: 'blocked',
        title: options.task.title,
        body: lines.join('\n')
    })
}
