import type { ProjectAssistantInterventionStatus } from '@hopi/protocol/types'
import type { Store, StoredGoal, StoredProject, StoredSession, StoredWorkspace } from '../../store'
import {
    buildAssistantMetadata,
    getAssistantMetadata
} from './metadata'
import { findProjectWorkspace, getGoal, getProject, getProjectWorkspace } from './projectStore'
import type { AssistantMetadata, CreateProjectAssistantInterventionOptions } from './types'
import { assistantMessage, normalizeText } from './utils'

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
