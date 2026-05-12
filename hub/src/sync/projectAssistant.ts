import type {
    ProjectAssistantInterventionKind,
    ProjectAssistantInterventionStatus,
    ProjectAssistantSessionKind,
    ProjectAssistantSuggestedAction
} from '@hopi/protocol/types'
import type { Store, StoredGoal, StoredProject, StoredSession, StoredWorkspace } from '../store'
import {
    appendPlannerMail,
    setGoalPreference,
    type GoalPreference,
    type GoalPreferenceAutonomy,
    type GoalPreferenceCategory,
    type OperatorSource,
    type PlannerMailItem,
    type PlannerMailKind
} from './operator/operatorDocs'

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

export function ensureProjectAssistantSession(options: {
    store: Store
    namespace: string
    projectId: string
    goalId?: string | null
    kind: 'normal'
}): { session: StoredSession } {
    const project = getProject(options.store, options.projectId, options.namespace)
    const workspace = getProjectWorkspace(options.store, project)
    const goal = options.goalId
        ? getGoal(options.store, options.goalId, options.namespace, project.id)
        : null
    const tag = [
        'project-assistant',
        options.kind,
        options.projectId,
        goal?.id ?? 'project'
    ].join(':')
    const session = options.store.sessions.getOrCreateSession(
        tag,
        buildAssistantMetadata({
            project,
            workspace,
            goal,
            kind: options.kind,
            name: goal ? `Project Assistant: ${goal.title}` : 'Project Assistant'
        }),
        null,
        options.namespace
    )
    ensureInitialMessage({
        store: options.store,
        sessionId: session.id,
        localId: `auto:assistant:${options.kind}:intro`,
        text: [
            `Project Assistant for ${goal ? `goal "${goal.title}"` : `project "${project.name}"`}.`,
            '',
            'Ask about current status, send ideas for the next planner run, or record durable preferences for this goal.'
        ].join('\n')
    })
    return { session: options.store.sessions.getSession(session.id) ?? session }
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
    const actions = options.suggestedActions.length > 0
        ? options.suggestedActions
            .map((action) => `- ${action.recommended ? 'Recommended: ' : ''}${action.label}${action.description ? ` - ${action.description}` : ''}`)
            .join('\n')
        : '- Ask a follow-up question or give an instruction.'
    ensureInitialMessage({
        store: options.store,
        sessionId: session.id,
        localId: `auto:assistant:intervention:${options.interventionKey}`,
        text: [
            title,
            '',
            normalizeText(options.body),
            '',
            'Suggested actions:',
            actions
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
