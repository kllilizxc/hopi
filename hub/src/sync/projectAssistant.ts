import type {
    DecryptedMessage,
    ProjectAssistantInterventionKind,
    ProjectAssistantInterventionStatus,
    ProjectAssistantSessionKind,
    ProjectAssistantSuggestedAction
} from '@hopi/protocol/types'
import { DEFAULT_AGENT_FLAVOR, DEFAULT_TASK_MODEL } from '@hopi/protocol'
import { unwrapRoleWrappedRecordEnvelope } from '@hopi/protocol/messages'
import { z } from 'zod'
import type { Store, StoredGoal, StoredGoalDecisionTopic, StoredProject, StoredSession, StoredTask, StoredWorkspace } from '../store'
import {
    appendPlannerMail,
    GoalPreferenceAutonomySchema,
    GoalPreferenceCategorySchema,
    PlannerMailKindSchema,
    readGoalOperatorDocs,
    setGoalPreference,
    type GoalPreference,
    type GoalPreferenceAutonomy,
    type GoalPreferenceCategory,
    type OperatorSource,
    type PlannerMailItem,
    type PlannerMailKind
} from './operator/operatorDocs'
import type { SyncEngine } from './syncEngine'
import { prependTaskHandoffDecisionContext } from './goals/decisionHandoff'

export type ProjectAssistantSessionSummary = {
    id: string
    projectId: string
    goalId: string | null
    taskId: string | null
    kind: ProjectAssistantSessionKind
    interventionKind: ProjectAssistantInterventionKind | null
    interventionStatus: ProjectAssistantInterventionStatus | null
    interventionKey: string | null
    suggestedActions: ProjectAssistantSuggestedAction[]
    createdAt: number
    updatedAt: number
    title: string | null
    pending: boolean
}

export type ProjectAssistantSessionList = {
    sessions: ProjectAssistantSessionSummary[]
    pendingCount: number
}

type AssistantMetadata = {
    path: string
    host: string
    machineId?: string
    projectId: string
    goalId?: string
    taskId?: string
    name: string
    flavor?: string | null
    hopiAssistant: true
    assistantKind: ProjectAssistantSessionKind
    interventionKind?: ProjectAssistantInterventionKind
    interventionStatus?: ProjectAssistantInterventionStatus
    interventionKey?: string
    suggestedActions?: ProjectAssistantSuggestedAction[]
    interventionResolution?: {
        actionId: string | null
        note: string | null
        resolvedAt: number
    }
}

function normalizeText(value: string): string {
    return value.replace(/\r\n/g, '\n').trim()
}

const ASSISTANT_KICKOFF_LOCAL_ID_PREFIX = 'auto:assistant:kickoff:'
const ASSISTANT_ACTIVATION_LOCAL_ID_PREFIX = 'auto:assistant:activation:'

type AssistantAgentFlavor = 'claude' | 'codex' | 'gemini' | 'opencode'

const assistantActionPacketSchema = z.object({
    actions: z.array(z.discriminatedUnion('type', [
        z.object({
            type: z.literal('resolve_decision'),
            topicId: z.string().trim().min(1),
            resolution: z.string().trim().min(1).max(20_000)
        }),
        z.object({
            type: z.literal('send_planner_mail'),
            goalId: z.string().trim().min(1),
            kind: PlannerMailKindSchema,
            body: z.string().trim().min(1).max(20_000)
        }),
        z.object({
            type: z.literal('set_goal_preference'),
            goalId: z.string().trim().min(1),
            category: GoalPreferenceCategorySchema,
            autonomy: GoalPreferenceAutonomySchema,
            instruction: z.string().trim().min(1).max(20_000)
        })
    ])).min(1).max(10)
})

type AssistantActionPacket = z.infer<typeof assistantActionPacketSchema>

function emitTaskUpdated(options: {
    engine: SyncEngine | null | undefined
    namespace: string
    task: StoredTask
}): void {
    options.engine?.handleRealtimeEvent?.({
        type: 'task-updated',
        taskId: options.task.id,
        projectId: options.task.projectId,
        namespace: options.namespace,
        data: { taskId: options.task.id }
    })
}

function emitProjectUpdated(options: {
    engine: SyncEngine | null | undefined
    namespace: string
    projectId: string
}): void {
    options.engine?.handleRealtimeEvent?.({
        type: 'project-updated',
        projectId: options.projectId,
        namespace: options.namespace,
        data: { projectId: options.projectId }
    })
}

function emitAssistantSessionUpdated(options: {
    engine: SyncEngine | null | undefined
    namespace: string
    projectId: string
    session: StoredSession
}): void {
    options.engine?.handleRealtimeEvent?.({
        type: 'session-updated',
        sessionId: options.session.id,
        projectId: options.projectId,
        namespace: options.namespace,
        data: options.session
    })
}

function applyResolvedDecisionTopicState(options: {
    store: Store
    engine: SyncEngine | null | undefined
    namespace: string
    topic: StoredGoalDecisionTopic
}): void {
    const remainingBlockingGoalTopics = options.topic.blocking
        ? options.store.goalDecisionTopics
            .listByGoalAndNamespace(options.topic.goalId, options.namespace)
            .filter((candidate) => candidate.blocking && candidate.status === 'waiting')
        : []

    if (options.topic.blocking && options.topic.taskId) {
        const stillBlocked = remainingBlockingGoalTopics
            .some((candidate) => (
                candidate.taskId === options.topic.taskId &&
                candidate.blocking &&
                candidate.status === 'waiting'
            ))
        if (!stillBlocked) {
            const task = options.store.tasks.getTaskByNamespace(options.topic.taskId, options.namespace)
            if (task) {
                const plannedTask = options.store.tasks.updateTaskByNamespace(task.id, options.namespace, {
                    status: task.status === 'blocked' ? 'planned' : task.status,
                    handoff: prependTaskHandoffDecisionContext(task, options.topic)
                })
                if (plannedTask) {
                    emitTaskUpdated({
                        engine: options.engine,
                        namespace: options.namespace,
                        task: plannedTask
                    })
                }
            }
        }
    }

    if (options.topic.blocking && remainingBlockingGoalTopics.length === 0) {
        const goal = options.store.goals.getGoalByNamespace(options.topic.goalId, options.namespace)
        if (goal?.status === 'blocked') {
            options.store.goals.updateGoalByNamespace(goal.id, options.namespace, {
                status: 'active'
            })
        }
    }

    emitProjectUpdated({
        engine: options.engine,
        namespace: options.namespace,
        projectId: options.topic.projectId
    })
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function findProjectWorkspace(store: Store, project: StoredProject): StoredWorkspace | null {
    const workspace = project.defaultWorkspaceId
        ? store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
    return workspace ?? null
}

function getProjectWorkspace(store: Store, project: StoredProject): StoredWorkspace {
    const workspace = findProjectWorkspace(store, project)
    if (!workspace) {
        throw new Error('Project default workspace is required')
    }
    return workspace
}

function getProject(store: Store, projectId: string, namespace: string): StoredProject {
    const project = store.projects.getProjectByNamespace(projectId, namespace)
    if (!project) {
        throw new Error('Project not found')
    }
    return project
}

function getGoal(store: Store, goalId: string, namespace: string, projectId: string): StoredGoal {
    const goal = store.goals.getGoalByNamespace(goalId, namespace)
    if (!goal || goal.projectId !== projectId) {
        throw new Error('Goal not found')
    }
    return goal
}

function assistantMessage(text: string): unknown {
    return {
        role: 'assistant',
        content: {
            type: 'text',
            text
        }
    }
}

function getSessionTitle(session: StoredSession): string | null {
    const metadata = isRecord(session.metadata) ? session.metadata : null
    const name = metadata?.name
    return typeof name === 'string' ? name : null
}

function buildAssistantMetadata(options: {
    project: StoredProject
    workspace: StoredWorkspace
    goal?: StoredGoal | null
    taskId?: string | null
    kind: ProjectAssistantSessionKind
    name: string
    interventionKind?: ProjectAssistantInterventionKind
    interventionStatus?: ProjectAssistantInterventionStatus
    interventionKey?: string
    suggestedActions?: ProjectAssistantSuggestedAction[]
}): AssistantMetadata {
    return {
        path: options.workspace.path,
        host: 'hopi',
        machineId: options.project.machineId,
        projectId: options.project.id,
        goalId: options.goal?.id,
        taskId: options.taskId ?? undefined,
        name: options.name,
        flavor: options.project.defaultAgentFlavor ?? undefined,
        hopiAssistant: true,
        assistantKind: options.kind,
        interventionKind: options.interventionKind,
        interventionStatus: options.interventionStatus,
        interventionKey: options.interventionKey,
        suggestedActions: options.suggestedActions
    }
}

function ensureInitialMessage(options: {
    store: Store
    sessionId: string
    text: string
    localId: string
}): void {
    const existing = options.store.messages.getMessages(options.sessionId, 1)
    if (existing.length > 0) {
        return
    }
    options.store.messages.addMessage(options.sessionId, assistantMessage(options.text), options.localId)
}

function getAssistantMetadata(session: StoredSession): AssistantMetadata | null {
    if (!isRecord(session.metadata)) {
        return null
    }
    if (session.metadata.hopiAssistant !== true) {
        return null
    }
    const projectId = typeof session.metadata.projectId === 'string' ? session.metadata.projectId : ''
    const path = typeof session.metadata.path === 'string' ? session.metadata.path : ''
    const host = typeof session.metadata.host === 'string' ? session.metadata.host : ''
    const name = typeof session.metadata.name === 'string' ? session.metadata.name : 'Project Assistant'
    const kind = session.metadata.assistantKind
    if (!projectId || !path || !host || (kind !== 'normal' && kind !== 'intervention')) {
        return null
    }
    return session.metadata as AssistantMetadata
}

function toSummary(session: StoredSession, metadata: AssistantMetadata): ProjectAssistantSessionSummary {
    const interventionStatus = metadata.interventionStatus ?? null
    return {
        id: session.id,
        projectId: metadata.projectId,
        goalId: metadata.goalId ?? null,
        taskId: metadata.taskId ?? null,
        kind: metadata.assistantKind,
        interventionKind: metadata.interventionKind ?? null,
        interventionStatus,
        interventionKey: metadata.interventionKey ?? null,
        suggestedActions: metadata.suggestedActions ?? [],
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        title: getSessionTitle(session),
        pending: metadata.assistantKind === 'intervention' && interventionStatus === 'pending'
    }
}

export function listProjectAssistantSessions(options: {
    store: Store
    namespace: string
    projectId: string
    goalId?: string | null
}): ProjectAssistantSessionList {
    const sessions = options.store.sessions.getSessionsByNamespace(options.namespace)
        .flatMap((session) => {
            const metadata = getAssistantMetadata(session)
            if (!metadata || metadata.projectId !== options.projectId) {
                return []
            }
            if (metadata.assistantKind === 'normal' && !hasAgentResumeMetadata(metadata)) {
                return []
            }
            if (options.goalId && metadata.goalId !== options.goalId) {
                return []
            }
            return [toSummary(session, metadata)]
        })
        .sort((a, b) => {
            if (a.pending !== b.pending) return a.pending ? -1 : 1
            return b.updatedAt - a.updatedAt
        })

    return {
        sessions,
        pendingCount: sessions.filter((session) => session.pending).length
    }
}

function getAssistantAgent(project: StoredProject): AssistantAgentFlavor {
    const flavor = project.defaultAgentFlavor
    if (flavor === 'claude' || flavor === 'codex' || flavor === 'gemini' || flavor === 'opencode') {
        return flavor
    }
    return DEFAULT_AGENT_FLAVOR
}

function hasAgentResumeMetadata(metadata: AssistantMetadata): boolean {
    const record = metadata as unknown as Record<string, unknown>
    return typeof record.claudeSessionId === 'string'
        || typeof record.codexSessionId === 'string'
        || typeof record.geminiSessionId === 'string'
        || typeof record.opencodeSessionId === 'string'
        || record.startedFromRunner === true
        || metadata.host !== 'hopi'
}

function mergeAssistantSessionMetadata(options: {
    current: unknown
    project: StoredProject
    workspace: StoredWorkspace
    goal: StoredGoal | null
    taskId?: string | null
    kind: ProjectAssistantSessionKind
    name: string
    agent: AssistantAgentFlavor
    interventionKind?: ProjectAssistantInterventionKind
    interventionStatus?: ProjectAssistantInterventionStatus
    interventionKey?: string
    suggestedActions?: ProjectAssistantSuggestedAction[]
}): AssistantMetadata {
    const base = isRecord(options.current)
        ? options.current
        : {}
    const baseHost = typeof base.host === 'string' && base.host.trim()
        ? base.host.trim()
        : 'assistant'
    const basePath = typeof base.path === 'string' && base.path.trim()
        ? base.path.trim()
        : options.workspace.path
    const baseMachineId = typeof base.machineId === 'string' && base.machineId.trim()
        ? base.machineId.trim()
        : options.project.machineId
    const baseFlavor = typeof base.flavor === 'string' && base.flavor.trim()
        ? base.flavor.trim()
        : options.agent

    return {
        ...base,
        path: basePath,
        host: baseHost,
        machineId: baseMachineId,
        projectId: options.project.id,
        goalId: options.goal?.id,
        taskId: options.taskId ?? undefined,
        name: options.name,
        flavor: baseFlavor,
        hopiAssistant: true,
        assistantKind: options.kind,
        interventionKind: options.interventionKind,
        interventionStatus: options.interventionStatus,
        interventionKey: options.interventionKey,
        suggestedActions: options.suggestedActions
    } as AssistantMetadata
}

function updateAssistantSessionMetadata(options: {
    store: Store
    engine?: SyncEngine | null
    namespace: string
    sessionId: string
    projectId: string
    build: (current: unknown) => AssistantMetadata
}): StoredSession {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = options.store.sessions.getSessionByNamespace(options.sessionId, options.namespace)
        if (!current) {
            throw new Error('Assistant session not found')
        }
        const result = options.store.sessions.updateSessionMetadata(
            current.id,
            options.build(current.metadata),
            current.metadataVersion,
            options.namespace,
            { touchUpdatedAt: false }
        )
        if (result.result === 'success') {
            const updated = options.store.sessions.getSessionByNamespace(current.id, options.namespace) ?? current
            emitAssistantSessionUpdated({
                engine: options.engine,
                namespace: options.namespace,
                projectId: options.projectId,
                session: updated
            })
            return updated
        }
        if (result.result === 'error') {
            break
        }
    }
    throw new Error('Failed to update assistant session metadata')
}

function findExistingProjectAssistantSession(options: {
    store: Store
    namespace: string
    projectId: string
    goalId: string | null
    kind: ProjectAssistantSessionKind
}): StoredSession | null {
    return options.store.sessions.getSessionsByNamespace(options.namespace)
        .find((session) => {
            const metadata = getAssistantMetadata(session)
            if (!metadata) return false
            if (metadata.projectId !== options.projectId) return false
            if ((metadata.goalId ?? null) !== options.goalId) return false
            if (metadata.assistantKind !== options.kind) return false
            return hasAgentResumeMetadata(metadata)
        }) ?? null
}

function formatCountByStatus(tasks: StoredTask[]): string {
    const counts = new Map<string, number>()
    for (const task of tasks) {
        counts.set(task.status, (counts.get(task.status) ?? 0) + 1)
    }
    const lines = Array.from(counts.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([status, count]) => `- ${status}: ${count}`)
    return lines.length > 0 ? lines.join('\n') : '- No tasks yet'
}

function formatTaskSnapshot(tasks: StoredTask[]): string {
    if (tasks.length === 0) {
        return '- No kanban tasks yet.'
    }
    return tasks.slice(0, 40).map((task) => [
        `- [${task.status}] ${task.title}`,
        task.priority ? ` priority=${task.priority}` : '',
        task.goalId ? ` goal=${task.goalId}` : '',
        task.activeSessionId ? ` session=${task.activeSessionId}` : '',
        task.blockedReason ? ` blocked="${task.blockedReason}"` : ''
    ].join('')).join('\n')
}

function formatDecisionTopics(topics: StoredGoalDecisionTopic[]): string {
    const waiting = topics.filter((topic) => topic.status === 'waiting')
    if (waiting.length === 0) {
        return '- No waiting decisions.'
    }
    return waiting.map((topic) => [
        `- ${topic.title} (${topic.id})`,
        topic.blocking ? ' blocking' : '',
        topic.taskId ? ` task=${topic.taskId}` : '',
        `: ${topic.body}`
    ].join('')).join('\n')
}

function buildProjectAssistantSystemPrompt(): string {
    return [
        'You are HOPI Project Assistant inside a normal HOPI agent session.',
        'You help the user inspect project/goal workflow state and decide what operator guidance to provide.',
        'Workflow ownership stays with Planner, Generator, Evaluator, merge, and scheduler services.',
        'Do not directly claim that you changed kanban/task state unless HOPI exposes and confirms a typed action result.',
        'When you need HOPI to apply a narrow operator action, include a visible HOPI_ASSISTANT_ACTIONS JSON block with actions: resolve_decision, send_planner_mail, or set_goal_preference.',
        'When the user gives a decision, restate the exact decision and the goal/task it applies to before suggesting the narrow operator action.',
        'Keep replies concise and practical.'
    ].join('\n')
}

export function buildProjectAssistantBriefingPrompt(options: {
    store: Store
    namespace: string
    projectId: string
    goalId?: string | null
}): string {
    const project = getProject(options.store, options.projectId, options.namespace)
    const workspace = getProjectWorkspace(options.store, project)
    const goal = options.goalId
        ? getGoal(options.store, options.goalId, options.namespace, project.id)
        : null
    const tasks = options.store.tasks.listTasksByProjectAndNamespace(project.id, options.namespace, {
        includeArchived: false,
        goalId: goal?.id ?? null
    })
    const topics = goal
        ? options.store.goalDecisionTopics.listByGoalAndNamespace(goal.id, options.namespace)
        : []
    const operatorDocs = (() => {
        if (!goal) return null
        try {
            return readGoalOperatorDocs({
                workspacePath: workspace.path,
                goalKey: goal.goalKey
            })
        } catch {
            return null
        }
    })()
    const activePreferences = operatorDocs?.preferences.policies
        .filter((preference) => preference.archivedAt === null) ?? []
    const unreadMail = operatorDocs?.mail.mail
        .filter((mail) => mail.status === 'unread') ?? []

    return [
        'Start this Project Assistant conversation.',
        '',
        'Scope:',
        `- Project: ${project.name} (${project.id})`,
        goal ? `- Goal: ${goal.title} (${goal.id}, key=${goal.goalKey}, status=${goal.status})` : '- Goal: project-wide',
        `- Workspace: ${workspace.path}`,
        '',
        'Current kanban counts:',
        formatCountByStatus(tasks),
        '',
        'Current kanban tasks:',
        formatTaskSnapshot(tasks),
        '',
        'Waiting decisions:',
        formatDecisionTopics(topics),
        '',
        'Operator docs snapshot:',
        `- Active preferences: ${activePreferences.length}`,
        `- Unread planner mail: ${unreadMail.length}`,
        '',
        'Reply with a brief greeting and ask what the user wants to inspect or decide next.'
    ].join('\n')
}

export async function ensureProjectAssistantSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    projectId: string
    goalId?: string | null
    kind: 'normal'
}): Promise<{ session: StoredSession }> {
    const project = getProject(options.store, options.projectId, options.namespace)
    const workspace = getProjectWorkspace(options.store, project)
    const goal = options.goalId
        ? getGoal(options.store, options.goalId, options.namespace, project.id)
        : null
    const existing = findExistingProjectAssistantSession({
        store: options.store,
        namespace: options.namespace,
        projectId: project.id,
        goalId: goal?.id ?? null,
        kind: options.kind
    })
    if (existing) {
        return { session: existing }
    }

    const agent = getAssistantAgent(project)
    const model = project.defaultModel ?? (agent === DEFAULT_AGENT_FLAVOR ? DEFAULT_TASK_MODEL : undefined)
    const spawn = await options.engine.spawnSession(
        project.machineId,
        workspace.path,
        agent,
        model ?? undefined,
        false,
        'simple'
    )
    if (spawn.type !== 'success') {
        throw new Error(spawn.message)
    }

    const active = await options.engine.waitForSessionActive(spawn.sessionId, 20_000)
    if (!active) {
        throw new Error('Assistant session did not become active')
    }

    const session = updateAssistantSessionMetadata({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        sessionId: spawn.sessionId,
        projectId: project.id,
        build: (current) => mergeAssistantSessionMetadata({
            current,
            project,
            workspace,
            goal,
            kind: options.kind,
            name: goal ? `Project Assistant: ${goal.title}` : 'Project Assistant',
            agent
        })
    })

    const existingMessages = options.store.messages.getMessages(session.id, 1)
    if (existingMessages.length === 0) {
        await options.engine.sendMessage(session.id, {
            text: buildProjectAssistantBriefingPrompt({
                store: options.store,
                namespace: options.namespace,
                projectId: project.id,
                goalId: goal?.id ?? null
            }),
            localId: `${ASSISTANT_KICKOFF_LOCAL_ID_PREFIX}${project.id}:${goal?.id ?? 'project'}:${Date.now()}`,
            sentFrom: 'webapp',
            appendSystemPrompt: buildProjectAssistantSystemPrompt()
        })
    }

    return { session }
}

function formatVisibleConversationForActivation(store: Store, sessionId: string): string {
    const messages = store.messages.getMessages(sessionId, 20)
        .filter((message) => !message.localId?.startsWith(ASSISTANT_ACTIVATION_LOCAL_ID_PREFIX))
        .filter((message) => !message.localId?.startsWith(ASSISTANT_KICKOFF_LOCAL_ID_PREFIX))
    if (messages.length === 0) {
        return '- No previous visible messages.'
    }
    return messages.map((message) => {
        const record = unwrapRoleWrappedRecordEnvelope(message.content)
        const role = typeof record?.role === 'string' ? record.role : 'message'
        const text = extractMessageText(message.content) ?? JSON.stringify(message.content)
        return `- ${role}: ${normalizeText(text).slice(0, 2000)}`
    }).join('\n')
}

function buildProjectAssistantActivationPrompt(options: {
    store: Store
    namespace: string
    session: StoredSession
    metadata: AssistantMetadata
}): string {
    const briefing = buildProjectAssistantBriefingPrompt({
        store: options.store,
        namespace: options.namespace,
        projectId: options.metadata.projectId,
        goalId: options.metadata.goalId ?? null
    })
    const intervention = options.metadata.assistantKind === 'intervention'
        ? [
            'Intervention:',
            `- Kind: ${options.metadata.interventionKind ?? 'unknown'}`,
            `- Status: ${options.metadata.interventionStatus ?? 'unknown'}`,
            options.metadata.interventionKey ? `- Key: ${options.metadata.interventionKey}` : null,
            options.metadata.taskId ? `- Task: ${options.metadata.taskId}` : null
        ].filter(Boolean).join('\n')
        : 'Intervention: none'

    return [
        'Activate this existing Project Assistant conversation as a normal HOPI agent session.',
        '',
        briefing,
        '',
        intervention,
        '',
        'Existing visible conversation:',
        formatVisibleConversationForActivation(options.store, options.session.id),
        '',
        'Continue from this context. The next user message belongs to this same conversation.'
    ].join('\n')
}

export async function activateProjectAssistantSession(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    projectId: string
    sessionId: string
}): Promise<{ session: StoredSession }> {
    const session = options.store.sessions.getSessionByNamespace(options.sessionId, options.namespace)
    if (!session) {
        throw new Error('Assistant session not found')
    }
    const metadata = getAssistantMetadata(session)
    if (!metadata || metadata.projectId !== options.projectId) {
        throw new Error('Assistant session not found')
    }
    if (session.active || hasAgentResumeMetadata(metadata)) {
        return { session }
    }
    if (!session.tag) {
        throw new Error('Assistant session cannot be activated')
    }

    const project = getProject(options.store, options.projectId, options.namespace)
    const workspace = getProjectWorkspace(options.store, project)
    const agent = getAssistantAgent(project)
    const model = project.defaultModel ?? (agent === DEFAULT_AGENT_FLAVOR ? DEFAULT_TASK_MODEL : undefined)
    const spawn = await options.engine.spawnSession(
        project.machineId,
        workspace.path,
        agent,
        model ?? undefined,
        false,
        'simple',
        undefined,
        undefined,
        undefined,
        undefined,
        session.tag
    )
    if (spawn.type !== 'success') {
        throw new Error(spawn.message)
    }
    if (spawn.sessionId !== session.id) {
        throw new Error('Assistant session activation created a different session')
    }
    const active = await options.engine.waitForSessionActive(session.id, 20_000)
    if (!active) {
        throw new Error('Assistant session did not become active')
    }

    const refreshed = options.store.sessions.getSessionByNamespace(session.id, options.namespace) ?? session
    const alreadyActivated = options.store.messages
        .getMessages(session.id, 50)
        .some((message) => message.localId?.startsWith(ASSISTANT_ACTIVATION_LOCAL_ID_PREFIX))
    if (!alreadyActivated) {
        await options.engine.sendMessage(session.id, {
            text: buildProjectAssistantActivationPrompt({
                store: options.store,
                namespace: options.namespace,
                session: refreshed,
                metadata
            }),
            localId: `${ASSISTANT_ACTIVATION_LOCAL_ID_PREFIX}${session.id}:${Date.now()}`,
            sentFrom: 'webapp',
            appendSystemPrompt: buildProjectAssistantSystemPrompt()
        })
    }

    return { session: options.store.sessions.getSessionByNamespace(session.id, options.namespace) ?? refreshed }
}

export type CreateProjectAssistantInterventionOptions = {
    store: Store
    namespace: string
    projectId: string
    goalId?: string | null
    taskId?: string | null
    interventionKey: string
    interventionKind: ProjectAssistantInterventionKind
    title: string
    body: string
    suggestedActions: ProjectAssistantSuggestedAction[]
}

function createProjectAssistantInterventionForContext(
    options: CreateProjectAssistantInterventionOptions,
    context: {
        project: StoredProject
        workspace: StoredWorkspace
        goal: StoredGoal | null
    }
): { session: StoredSession } {
    const title = normalizeText(options.title)
    const tag = ['project-assistant', 'intervention', options.projectId, options.interventionKey].join(':')
    const session = options.store.sessions.getOrCreateSession(
        tag,
        buildAssistantMetadata({
            project: context.project,
            workspace: context.workspace,
            goal: context.goal,
            taskId: options.taskId,
            kind: 'intervention',
            name: title || 'Project Assistant Intervention',
            interventionKind: options.interventionKind,
            interventionStatus: 'pending',
            interventionKey: options.interventionKey,
            suggestedActions: options.suggestedActions
        }),
        null,
        options.namespace
    )
    ensureInitialMessage({
        store: options.store,
        sessionId: session.id,
        localId: `auto:assistant:intervention:${options.interventionKey}`,
        text: [
            title,
            '',
            normalizeText(options.body)
        ].join('\n')
    })
    return { session: options.store.sessions.getSession(session.id) ?? session }
}

export function createProjectAssistantIntervention(
    options: CreateProjectAssistantInterventionOptions
): { session: StoredSession } {
    const project = getProject(options.store, options.projectId, options.namespace)
    const workspace = getProjectWorkspace(options.store, project)
    const goal = options.goalId
        ? getGoal(options.store, options.goalId, options.namespace, project.id)
        : null
    return createProjectAssistantInterventionForContext(options, { project, workspace, goal })
}

export function tryCreateProjectAssistantIntervention(
    options: CreateProjectAssistantInterventionOptions
): { session: StoredSession } | null {
    const project = options.store.projects.getProjectByNamespace(options.projectId, options.namespace)
    if (!project) {
        return null
    }
    const workspace = findProjectWorkspace(options.store, project)
    if (!workspace) {
        return null
    }
    const goal = options.goalId
        ? options.store.goals.getGoalByNamespace(options.goalId, options.namespace)
        : null
    if (options.goalId && (!goal || goal.projectId !== project.id)) {
        return null
    }
    return createProjectAssistantInterventionForContext(options, { project, workspace, goal })
}

export function resolveProjectAssistantIntervention(options: {
    store: Store
    namespace: string
    sessionId: string
    projectId?: string
    status: Extract<ProjectAssistantInterventionStatus, 'resolved' | 'dismissed'>
    actionId?: string | null
    note?: string | null
    now?: number
}): StoredSession | null {
    const session = options.store.sessions.getSessionByNamespace(options.sessionId, options.namespace)
    if (!session) {
        return null
    }
    const metadata = getAssistantMetadata(session)
    if (!metadata || metadata.assistantKind !== 'intervention') {
        return null
    }
    if (options.projectId && metadata.projectId !== options.projectId) {
        return null
    }
    const nextMetadata: AssistantMetadata = {
        ...metadata,
        interventionStatus: options.status,
        interventionResolution: {
            actionId: options.actionId ?? null,
            note: options.note ?? null,
            resolvedAt: options.now ?? Date.now()
        }
    }
    const result = options.store.sessions.updateSessionMetadata(
        session.id,
        nextMetadata,
        session.metadataVersion,
        options.namespace
    )
    if (result.result !== 'success') {
        return null
    }
    options.store.messages.addMessage(session.id, assistantMessage([
        options.status === 'resolved' ? 'Intervention resolved.' : 'Intervention dismissed.',
        options.actionId ? `Action: ${options.actionId}` : '',
        options.note ? `Note: ${options.note}` : ''
    ].filter(Boolean).join('\n')), `auto:assistant:intervention-resolution:${Date.now()}`)
    return options.store.sessions.getSession(session.id)
}

function extractAssistantActionJsonPayload(text: string): string | null {
    const fenced = /HOPI_ASSISTANT_ACTIONS\s*:?\s*```(?:json)?\s*([\s\S]*?)```/iu.exec(text)
    if (fenced?.[1]) {
        return fenced[1].trim()
    }

    const markerIndex = text.lastIndexOf('HOPI_ASSISTANT_ACTIONS')
    if (markerIndex < 0) {
        return null
    }

    const afterMarker = text.slice(markerIndex + 'HOPI_ASSISTANT_ACTIONS'.length)
    const jsonStart = afterMarker.indexOf('{')
    if (jsonStart < 0) {
        return null
    }

    let depth = 0
    let inString = false
    let escaped = false
    for (let index = jsonStart; index < afterMarker.length; index += 1) {
        const char = afterMarker[index]
        if (inString) {
            if (escaped) {
                escaped = false
            } else if (char === '\\') {
                escaped = true
            } else if (char === '"') {
                inString = false
            }
            continue
        }
        if (char === '"') {
            inString = true
            continue
        }
        if (char === '{') {
            depth += 1
            continue
        }
        if (char === '}') {
            depth -= 1
            if (depth === 0) {
                return afterMarker.slice(jsonStart, index + 1).trim()
            }
        }
    }

    return null
}

function extractMessageText(value: unknown): string | null {
    if (typeof value === 'string') {
        return normalizeText(value) || null
    }
    if (Array.isArray(value)) {
        const parts = value
            .map((item) => extractMessageText(item))
            .filter((item): item is string => Boolean(item))
        return parts.length > 0 ? parts.join('\n') : null
    }
    if (!isRecord(value)) {
        return null
    }
    if (value.type === 'text' && typeof value.text === 'string') {
        return normalizeText(value.text) || null
    }
    if ('content' in value) {
        const text = extractMessageText(value.content)
        if (text) return text
    }
    if ('message' in value) {
        const text = extractMessageText(value.message)
        if (text) return text
    }
    return null
}

function extractAssistantText(message: DecryptedMessage): string | null {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) return null
    if (record.role !== 'assistant' && record.role !== 'agent') return null
    return extractMessageText(record.content)
}

function isReadyEventMessage(message: DecryptedMessage): boolean {
    const record = unwrapRoleWrappedRecordEnvelope(message.content)
    if (!record) return false
    const content = isRecord(record.content) ? record.content : null
    if (!content) return false
    if (content.type === 'event') {
        const data = isRecord(content.data) ? content.data : null
        return data?.type === 'ready'
    }
    return content.type === 'ready'
}

function findLatestAssistantActionPacket(messages: DecryptedMessage[]): { packet: AssistantActionPacket; message: DecryptedMessage } | null {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
        const message = messages[index]!
        const text = extractAssistantText(message)
        if (!text) continue
        const payload = extractAssistantActionJsonPayload(text)
        if (!payload) continue
        try {
            const parsed = JSON.parse(payload)
            return {
                packet: assistantActionPacketSchema.parse(parsed),
                message
            }
        } catch {
            return null
        }
    }
    return null
}

function resolveAssistantDecisionAction(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    projectId: string
    sessionId: string
    action: Extract<AssistantActionPacket['actions'][number], { type: 'resolve_decision' }>
}): boolean {
    const existingTopic = options.store.goalDecisionTopics.getByNamespace(options.action.topicId, options.namespace)
    if (!existingTopic || existingTopic.projectId !== options.projectId || existingTopic.status !== 'waiting') {
        return false
    }

    const topic = options.store.goalDecisionTopics.resolveByNamespace(existingTopic.id, options.namespace, options.action.resolution)
    if (!topic) {
        return false
    }

    applyResolvedDecisionTopicState({
        store: options.store,
        engine: options.engine,
        namespace: options.namespace,
        topic
    })

    for (const session of options.store.sessions.getSessionsByNamespace(options.namespace)) {
        const metadata = getAssistantMetadata(session)
        if (!metadata) continue
        if (metadata.projectId !== options.projectId) continue
        if (metadata.interventionKey !== `decision-topic:${topic.id}`) continue
        if (metadata.interventionStatus !== 'pending') continue
        const resolvedSession = resolveProjectAssistantIntervention({
            store: options.store,
            namespace: options.namespace,
            sessionId: session.id,
            projectId: options.projectId,
            status: 'resolved',
            actionId: 'assistant_resolve_decision',
            note: options.action.resolution
        })
        if (resolvedSession) {
            emitAssistantSessionUpdated({
                engine: options.engine,
                namespace: options.namespace,
                projectId: options.projectId,
                session: resolvedSession
            })
        }
    }

    return true
}

export function applyProjectAssistantActionPacketFromReady(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    sessionId: string
    readyMessage: DecryptedMessage
}): boolean {
    if (!isReadyEventMessage(options.readyMessage)) {
        return false
    }

    const session = options.store.sessions.getSessionByNamespace(options.sessionId, options.namespace)
    if (!session) {
        return false
    }
    const metadata = getAssistantMetadata(session)
    if (!metadata) {
        return false
    }

    const found = findLatestAssistantActionPacket(options.store.messages.getMessages(options.sessionId, 50).map((message) => ({
        id: message.id,
        seq: message.seq,
        localId: message.localId,
        content: message.content,
        createdAt: message.createdAt
    })))
    if (!found) {
        return false
    }

    let applied = false
    for (const action of found.packet.actions) {
        if (action.type === 'resolve_decision') {
            applied = resolveAssistantDecisionAction({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                projectId: metadata.projectId,
                sessionId: options.sessionId,
                action
            }) || applied
            continue
        }
        if (action.type === 'send_planner_mail') {
            try {
                sendProjectAssistantPlannerMail({
                    store: options.store,
                    namespace: options.namespace,
                    projectId: metadata.projectId,
                    goalId: action.goalId,
                    kind: action.kind,
                    body: action.body,
                    source: {
                        sessionId: options.sessionId,
                        messageId: found.message.id
                    }
                })
                emitProjectUpdated({
                    engine: options.engine,
                    namespace: options.namespace,
                    projectId: metadata.projectId
                })
                applied = true
            } catch {
            }
            continue
        }
        if (action.type === 'set_goal_preference') {
            try {
                setProjectAssistantGoalPreference({
                    store: options.store,
                    namespace: options.namespace,
                    projectId: metadata.projectId,
                    goalId: action.goalId,
                    category: action.category,
                    autonomy: action.autonomy,
                    instruction: action.instruction,
                    source: {
                        sessionId: options.sessionId,
                        messageId: found.message.id
                    }
                })
                emitProjectUpdated({
                    engine: options.engine,
                    namespace: options.namespace,
                    projectId: metadata.projectId
                })
                applied = true
            } catch {
            }
        }
    }

    return applied
}

export function sendProjectAssistantPlannerMail(options: {
    store: Store
    namespace: string
    projectId: string
    goalId: string
    kind: PlannerMailKind
    body: string
    source: OperatorSource
    now?: number
}): PlannerMailItem {
    const project = getProject(options.store, options.projectId, options.namespace)
    const workspace = getProjectWorkspace(options.store, project)
    const goal = getGoal(options.store, options.goalId, options.namespace, project.id)
    return appendPlannerMail({
        workspacePath: workspace.path,
        goalKey: goal.goalKey,
        kind: options.kind,
        body: options.body,
        source: options.source,
        now: options.now
    })
}

export function setProjectAssistantGoalPreference(options: {
    store: Store
    namespace: string
    projectId: string
    goalId: string
    category: GoalPreferenceCategory
    autonomy: GoalPreferenceAutonomy
    instruction: string
    source: OperatorSource
    now?: number
}): GoalPreference {
    const project = getProject(options.store, options.projectId, options.namespace)
    const workspace = getProjectWorkspace(options.store, project)
    const goal = getGoal(options.store, options.goalId, options.namespace, project.id)
    return setGoalPreference({
        workspacePath: workspace.path,
        goalKey: goal.goalKey,
        category: options.category,
        autonomy: options.autonomy,
        instruction: options.instruction,
        source: options.source,
        now: options.now
    })
}
