import { existsSync } from 'node:fs'
import {
    DEFAULT_AGENT_FLAVOR,
    DEFAULT_TASK_MODEL,
    isModelModeAllowedForFlavor
} from '@hopi/protocol'
import { createHash } from 'node:crypto'
import type { AgentFlavor, ModelMode, PermissionMode, Session } from '@hopi/protocol/types'
import type { Store, StoredGoal, StoredProject, StoredSession, StoredTask, StoredWorkspace } from '../store'
import { listGoalDecisionTopicsFromDocs } from './goals/goalDecisionStore'
import { overlayGoalWithCanonicalDoc } from './goals/goalDocs'
import { getDocsRoot, getGoalDocPath, getGoalTodoPath } from './goals/goalDocPaths'
import { readGoalTodo } from './goals/goalTodo'
import { buildGoalAssistantSessionProfile } from './goalAssistant'
import type { SyncEngine } from './syncEngine'

const CONTROLLER_EVENT_LOCAL_ID_PREFIX = 'controller:event:'
const CONTROLLER_BRIEFING_LOCAL_ID_PREFIX = 'controller:briefing:'
const CONTROLLER_BRIEFING_COOLDOWN_MS = 20 * 60 * 60 * 1000
const CONTROLLER_BRIEFING_IN_FLIGHT_TIMEOUT_MS = 10 * 60 * 1000
const GOAL_ASSISTANT_TOOLING_VERSION = 9

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

type ProjectControllerRetireResult =
    | {
        ok: true
        retiredSessionIds: string[]
    }
    | {
        ok: false
        status: 400 | 404
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

function isGoalAssistantToolingCompatible(metadata: unknown): boolean {
    return isRecord(metadata) && metadata.goalAssistantToolingVersion === GOAL_ASSISTANT_TOOLING_VERSION
}

function compactControllerEventPart(value: string | null | undefined): string {
    return value?.trim().replace(/\s+/g, ' ') || 'none'
}

function buildControllerEventLocalId(options: {
    projectId: string
    goalId?: string | null
    taskId?: string | null
    kind: 'decision' | 'blocked'
    title: string
    body: string
}): string {
    const input = [
        options.kind,
        options.projectId,
        options.goalId ?? 'none',
        options.taskId ?? 'none',
        compactControllerEventPart(options.title),
        compactControllerEventPart(options.body)
    ].join('\n')
    const digest = createHash('sha1').update(input).digest('hex').slice(0, 16)
    return `${CONTROLLER_EVENT_LOCAL_ID_PREFIX}${options.kind}:${options.projectId}:${options.goalId ?? 'none'}:${options.taskId ?? 'none'}:${digest}`
}

function buildUserFacingBlockedReason(reason: string, source?: string | null): string {
    const normalized = reason.trim()
    const lower = normalized.toLowerCase()
    if (lower.includes('context window') || lower.includes('ran out of room')) {
        return '模型上下文窗口用完了，这个线程已经不能继续，需要开一个新线程接着做。'
    }
    if (lower.includes('systemerror') || lower.includes('system error')) {
        return '执行线程进入了系统错误状态，这次运行已经中断。'
    }
    if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('usage limit')) {
        return '模型额度或限流挡住了这次运行，需要稍后重试或切换配置。'
    }
    if (lower.includes('exited unexpectedly') || lower.includes('crashed')) {
        return '执行中的 agent 异常退出了，当前任务没有自然完成。'
    }
    if (source === 'decision') {
        return '这个任务在等用户做一个决定，决定后才能继续推进。'
    }
    return normalized || '任务被标记为 blocked，但没有记录具体原因。'
}

function buildBlockedNextAction(reason: string, source?: string | null): string {
    const lower = reason.toLowerCase()
    if (source === 'decision') {
        return '向用户说明需要决定什么，并等待用户选择。'
    }
    if (lower.includes('context window') || lower.includes('ran out of room')) {
        return '建议新开一次任务线程，并把原线程里已经完成的关键进展带过去。'
    }
    if (lower.includes('systemerror') || lower.includes('system error') || lower.includes('exited unexpectedly') || lower.includes('crashed')) {
        return '建议重新运行这个任务；如果反复出现，再让用户查看原 session 的报错细节。'
    }
    if (lower.includes('quota') || lower.includes('rate limit') || lower.includes('usage limit')) {
        return '建议稍后重试，或者让用户调整模型/权限配置。'
    }
    return '先用一句话告诉用户阻塞原因，再建议是否重试、拆分或让用户补充信息。'
}

function buildControllerEventText(options: {
    kind: 'decision' | 'blocked'
    title: string
    body: string
    taskId?: string | null
    goalId?: string | null
}): string {
    const internalLines = [
        `- goalId: ${options.goalId ?? 'none'}`,
        `- taskId: ${options.taskId ?? 'none'}`
    ]

    if (options.kind === 'decision') {
        return [
            '这里有一个需要我决定的问题。',
            '',
            '请用 Goal Assistant 的口吻，简短说明需要我决定什么、这个决定会影响什么，然后直接问我该怎么选。',
            '你不是 coding agent。不要自己代替任务实现、改代码或执行仓库写操作。',
            '你是这个 Goal 的 Kanban 管家；如果用户随后要求你继续任务、重试、补新任务或解释看板状态，优先自己通过 snapshot + typed tools 处理。',
            '如果用户直接给出这个决策答案，优先读当前 goal snapshot，找到对应 waiting DecisionTopic，然后用 typed tool 把它 resolve 掉；不要只回口头建议，也不要把现有 decision answer 改写成 planner mail。',
            '如果用户后续要求继续现有任务、重试、补新任务、或调整偏好，优先使用 HOPI typed operator tools，而不是只给口头建议。',
            '先按工作流意图判断，不要等用户说出固定关键词；必要时先读当前 goal snapshot 再决定用 lane request 还是 planner mail。',
            '',
            `决策主题：${options.title}`,
            '',
            '背景信息：',
            options.body.trim() || '没有记录更多信息。',
            '',
            '内部定位信息只供你使用，不要主动展示给我：',
            ...internalLines
        ].join('\n')
    }

    return [
        `任务「${options.title}」被阻塞了。`,
        '',
        '请用 Goal Assistant 的口吻，告诉我发生了什么、会影响当前目标吗、下一步应该怎么处理。不要直接复制原始报错，先翻译成人话。',
        '你不是 coding agent。不要自己代替任务实现、改代码或执行仓库写操作。',
        '你是这个 Goal 的 Kanban 管家；如果用户随后问看板状态、原因或要求你代操作看板，优先自己通过 snapshot + typed tools 处理。',
        '如果后续用户表达的是操作意图，比如继续、重试、重新排回计划、补新任务、保存偏好、回答现有 decision，或恢复已暂停 automation，优先使用 HOPI typed operator tools，并且只有工具成功后才能说动作已完成。',
        '按工作流意图理解请求，不要只盯关键词；如果需要 task id、lane、blocker 或 pending planner mail，先读 goal snapshot。',
        '',
        '已整理的信息：',
        options.body.trim() || '没有记录更多信息。',
        '',
        '内部定位信息只供你使用，不要主动展示给我：',
        ...internalLines
    ].join('\n')
}

function getDefaultWorkspace(store: Store, project: StoredProject): StoredWorkspace | null {
    if (project.defaultWorkspaceId) {
        const workspace = store.workspaces.getWorkspace(project.defaultWorkspaceId)
        if (workspace) return workspace
    }
    return store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
}

function overlayProjectGoal(store: Store, project: StoredProject, goal: StoredGoal): StoredGoal {
    return overlayGoalWithCanonicalDoc({
        goal,
        defaultWorkspace: getDefaultWorkspace(store, project)
    })
}

function hasDocsBackedGoalState(store: Store, project: StoredProject, goal: StoredGoal): boolean {
    const docsRoot = getDocsRoot(getDefaultWorkspace(store, project))
    if (!docsRoot) {
        return true
    }
    return existsSync(getGoalDocPath(docsRoot, goal.goalKey))
        || existsSync(getGoalTodoPath(docsRoot, goal.goalKey))
}

function getProjectGoalById(options: {
    store: Store
    project: StoredProject
    namespace: string
    goalId: string
}): StoredGoal | null {
    const goal = options.store.goals.getGoalByNamespace(options.goalId, options.namespace)
    if (!goal || goal.projectId !== options.project.id || goal.archivedAt !== null) {
        return null
    }
    if (!hasDocsBackedGoalState(options.store, options.project, goal)) {
        return null
    }
    return overlayProjectGoal(options.store, options.project, goal)
}

function listProjectGoals(options: {
    store: Store
    project: StoredProject
    namespace: string
}): StoredGoal[] {
    return options.store.goals
        .listGoalsByProjectAndNamespace(options.project.id, options.namespace, {
            includeArchived: false
        })
        .filter((goal) => hasDocsBackedGoalState(options.store, options.project, goal))
        .map((goal) => overlayProjectGoal(options.store, options.project, goal))
}

function isProjectControllerMetadata(metadata: unknown, projectId: string, goalId: string): boolean {
    if (!isRecord(metadata)) return false
    return metadata.projectId === projectId && metadata.goalId === goalId && metadata.hopiController === true
}

function findStoredProjectControllerSession(store: Store, namespace: string, projectId: string, goalId: string): StoredSession | null {
    const sessions = listStoredProjectControllerSessions(store, namespace, projectId, goalId)
        .filter((session) => isGoalAssistantToolingCompatible(session.metadata))
        .sort((a, b) => {
            if (a.active !== b.active) return a.active ? -1 : 1
            return b.updatedAt - a.updatedAt
        })
    return sessions[0] ?? null
}

function listStoredProjectControllerSessions(store: Store, namespace: string, projectId: string, goalId: string): StoredSession[] {
    return store.sessions.getSessionsByNamespace(namespace)
        .filter((session) => isProjectControllerMetadata(session.metadata, projectId, goalId))
        .sort((a, b) => b.updatedAt - a.updatedAt)
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
        name: `Goal Assistant - ${input.project.name} - ${input.goal.title}`,
        projectId: input.project.id,
        goalId: input.goal.id,
        hopiController: true,
        goalAssistantToolingVersion: GOAL_ASSISTANT_TOOLING_VERSION,
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
    engine?: SyncEngine | null
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
            options.engine?.handleRealtimeEvent({
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

export function retireProjectControllerSessions(options: {
    store: Store
    engine?: SyncEngine | null
    namespace: string
    projectId: string
    goalId?: string | null
    reason?: string
}): ProjectControllerRetireResult {
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

    const retiredSessionIds: string[] = []
    const retiredAt = Date.now()
    const sessions = listStoredProjectControllerSessions(options.store, options.namespace, project.id, goal.id)

    for (const session of sessions) {
        const updated = updateControllerMetadata({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            sessionId: session.id,
            projectId: project.id,
            update: (current) => {
                const next: Record<string, unknown> = {
                    ...current,
                    hopiController: false,
                    controllerRetiredAt: retiredAt,
                    controllerRetiredReason: options.reason ?? 'manual_reset'
                }
                delete next.controllerBriefingInFlightAt
                delete next.controllerBriefingInFlightGoalId
                return next
            }
        })
        if (updated) {
            retiredSessionIds.push(session.id)
        }
    }

    return {
        ok: true,
        retiredSessionIds
    }
}

function resolveControllerAgent(project: StoredProject): AgentFlavor {
    return (project.defaultAgentFlavor as AgentFlavor | null) ?? DEFAULT_AGENT_FLAVOR
}

function isAgentFlavor(value: unknown): value is AgentFlavor {
    return value === 'claude' || value === 'codex' || value === 'gemini' || value === 'opencode'
}

function resolveControllerSessionAgent(project: StoredProject, metadata: unknown): AgentFlavor {
    if (isRecord(metadata) && isAgentFlavor(metadata.flavor)) {
        return metadata.flavor
    }
    return resolveControllerAgent(project)
}

function resolveControllerModel(project: StoredProject, agent: AgentFlavor): string | undefined {
    return project.defaultModel ?? (agent === DEFAULT_AGENT_FLAVOR ? DEFAULT_TASK_MODEL : undefined)
}

function resolveControllerPermissionMode(_project: StoredProject, agent: AgentFlavor): PermissionMode | undefined {
    if (agent === 'claude') {
        return 'plan'
    }
    if (agent === 'codex' || agent === 'gemini') {
        return 'read-only'
    }
    return 'default'
}

function resolveControllerModelMode(project: StoredProject, agent: AgentFlavor): ModelMode | undefined {
    const mode = project.defaultModelMode as ModelMode | null
    return mode && isModelModeAllowedForFlavor(mode, agent) ? mode : undefined
}

async function applyControllerSessionPolicy(options: {
    engine: SyncEngine
    sessionId: string
    project: StoredProject
    agent: AgentFlavor
}): Promise<void> {
    const permissionMode = resolveControllerPermissionMode(options.project, options.agent)
    const modelMode = resolveControllerModelMode(options.project, options.agent)
    if (permissionMode || modelMode) {
        try {
            await options.engine.applySessionConfig(options.sessionId, { permissionMode, modelMode })
        } catch {
        }
    }
}

function buildGoalSummary(store: Store, project: StoredProject, goal: StoredGoal, workspace: StoredWorkspace | null, namespace: string): string {
    const todo = readGoalTodo({ project, goal, defaultWorkspace: workspace })
    const counts = new Map<string, number>()
    for (const item of todo.board.items) {
        const key = item.status
        counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const countText = counts.size > 0
        ? Array.from(counts.entries()).map(([key, count]) => `${key}: ${count}`).join(', ')
        : 'no todo items'
    const waitingTopics = listGoalDecisionTopicsFromDocs({
        project,
        goal,
        defaultWorkspace: workspace
    })
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
        return getProjectGoalById({
            store: options.store,
            project: options.project,
            namespace: options.namespace,
            goalId: requestedGoalId
        })
    }

    return listProjectGoals(options)[0] ?? null
}

function getRequestedActiveGoal(options: {
    store: Store
    project: StoredProject
    namespace: string
    goalId?: string | null
}): StoredGoal | null {
    const requestedGoalId = options.goalId?.trim()
    if (!requestedGoalId) return null
    return getProjectGoalById({
        store: options.store,
        project: options.project,
        namespace: options.namespace,
        goalId: requestedGoalId
    })
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
        `Goal Assistant briefing request for project "${options.project.name}".`,
        '',
        'Review the current goal state and send the user one concise Goal Assistant greeting.',
        '',
        'Start only from this current goal docs:',
        buildGoalDocsSummary(options.goal),
        '',
        'Current goal board summary:',
        goalLine,
        '',
        'Rules:',
        '- You are not a coding agent. Do not edit files, implement code, or run shell/tool actions that mutate the repo.',
        '- Stay in an operator-console role: be the user\'s Kanban butler for this Goal, explain current state, blockers, likely next lane/planner action, and what user input is needed.',
        '- Treat this assistant as the default surface for Goal/Kanban questions and Goal/Kanban instructions.',
        '- When the user intent is operational, prefer HOPI typed operator tools over prose. Use task-lane requests for retry/continue/requeue, decision resolution when the user answers an open decision, goal automation resume when the user wants paused automation running again, planner mail for new work requests, and preference tool for durable operator preferences.',
        '- Infer tool choice from workflow intent, not exact phrasing. Existing work usually maps to task-lane requests; an answered waiting decision usually maps to decision resolution; scope expansion or new work usually maps to planner mail.',
        '- Treat concrete repo failures such as build errors, test failures, stack traces, broken behavior reports, and regressions as operational by default, not just informational.',
        '- For a concrete repo failure, first decide whether it belongs to an existing task on the board. If yes, prefer a task-lane request. If not, prefer planner mail so it becomes tracked work.',
        '- For Kanban questions or Kanban instructions, prefer goal snapshot state as the source of truth before repo spelunking.',
        '- Don\'t bounce a Kanban question or board operation back to the user when you can answer or operationalize it yourself from the snapshot and typed tools.',
        '- If the user only wants an explanation of the failure, answering advisory-only is fine. Otherwise do not stop at diagnosis alone when the typed tool bridge can operationalize it.',
        '- If you need task ids, lane state, planner mail, or preferences before answering, read the goal snapshot first.',
        '- Never claim that a retry, decision resolution, planner mail, resume, or preference change happened unless the typed tool call succeeded.',
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
    forceNew?: boolean
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

    if (options.forceNew) {
        const retired = retireProjectControllerSessions({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            projectId: project.id,
            goalId: goal.id,
            reason: 'force_new'
        })
        if (!retired.ok) {
            return retired
        }
    }

    const existing = findStoredProjectControllerSession(options.store, options.namespace, project.id, goal.id)
    if (existing) {
        const runtime = options.engine.getSessionByNamespace(existing.id, options.namespace)
        const existingAgent = resolveControllerSessionAgent(project, runtime?.metadata ?? existing.metadata)
        if (runtime?.active) {
            markProjectControllerSession({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                sessionId: existing.id,
                project,
                goal,
                workspace,
                agent: existingAgent
            })
            await applyControllerSessionPolicy({
                engine: options.engine,
                sessionId: existing.id,
                project,
                agent: existingAgent
            })
            return { ok: true, created: false, sessionId: existing.id, session: runtime }
        }
        const resumed = await options.engine.resumeSession(existing.id, options.namespace)
        if (resumed.type === 'success') {
            markProjectControllerSession({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                sessionId: resumed.sessionId,
                project,
                goal,
                workspace,
                agent: existingAgent
            })
            await applyControllerSessionPolicy({
                engine: options.engine,
                sessionId: resumed.sessionId,
                project,
                agent: existingAgent
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
        undefined,
        undefined,
        undefined,
        undefined,
        buildGoalAssistantSessionProfile(project.id, goal.id)
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

    await applyControllerSessionPolicy({
        engine: options.engine,
        sessionId: spawned.sessionId,
        project,
        agent
    })

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

    const localId = buildControllerEventLocalId(options)
    if (options.store.messages.getMessageByLocalId(controller.sessionId, localId)) return

    void options.engine.sendMessage(controller.sessionId, {
        text: buildControllerEventText(options),
        localId,
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

function hasPersistedTaskBlock(task: Pick<BlockedTaskTransitionSnapshot, 'status' | 'blockedReason' | 'blockedSource' | 'blockedSessionId'> | null | undefined): boolean {
    return Boolean(
        isBlockedTaskStatus(task?.status)
        || task?.blockedReason
        || task?.blockedSource
        || task?.blockedSessionId
    )
}

export function notifyProjectControllerTaskBlockedTransition(options: {
    store: Store
    engine: SyncEngine | null
    namespace: string
    previousTask?: Pick<BlockedTaskTransitionSnapshot, 'status' | 'blockedReason' | 'blockedSource' | 'blockedSessionId'> | null
    task: BlockedTaskTransitionSnapshot
}): void {
    if (!options.task.goalId) return
    if (!hasPersistedTaskBlock(options.task)) return
    if (hasPersistedTaskBlock(options.previousTask)) return

    const reason = options.task.blockedReason?.trim() || 'No blocked reason recorded.'
    const userFacingReason = buildUserFacingBlockedReason(reason, options.task.blockedSource)
    const nextAction = buildBlockedNextAction(reason, options.task.blockedSource)
    const lines = [
        `- 被阻塞任务：${options.task.title}`,
        `- 用户可读原因：${userFacingReason}`,
        `- 建议下一步：${nextAction}`,
        '',
        '仅供定位的技术细节：',
        `- 原始阻塞原因：${reason}`
    ]
    if (options.task.blockedSource) {
        lines.push(`- 来源：${options.task.blockedSource}`)
    }
    if (options.task.blockedSessionId) {
        lines.push(`- sessionId: ${options.task.blockedSessionId}`)
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
