import type {
    ProjectAssistantInterventionKind,
    ProjectAssistantInterventionStatus,
    ProjectAssistantSessionKind,
    ProjectAssistantSuggestedAction
} from '@hopi/protocol/types'
import type { StoredGoal, StoredProject, StoredSession, StoredWorkspace } from '../../store'
import { OPERATOR_CONSOLE_CAPABILITY_PROFILE } from '../operatorConsole'
import type { AssistantAgentFlavor, AssistantMetadata, ProjectAssistantSessionSummary } from './types'
import { getSessionTitle, isRecord } from './utils'

export function buildAssistantMetadata(options: {
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
        capabilityProfile: OPERATOR_CONSOLE_CAPABILITY_PROFILE,
        hopiAssistant: true,
        assistantKind: options.kind,
        interventionKind: options.interventionKind,
        interventionStatus: options.interventionStatus,
        interventionKey: options.interventionKey,
        suggestedActions: options.suggestedActions
    }
}

export function getAssistantMetadata(session: StoredSession): AssistantMetadata | null {
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

export function toSummary(session: StoredSession, metadata: AssistantMetadata): ProjectAssistantSessionSummary {
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

export function mergeAssistantSessionMetadata(options: {
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
        capabilityProfile: OPERATOR_CONSOLE_CAPABILITY_PROFILE,
        hopiAssistant: true,
        assistantKind: options.kind,
        interventionKind: options.interventionKind,
        interventionStatus: options.interventionStatus,
        interventionKey: options.interventionKey,
        suggestedActions: options.suggestedActions
    } as AssistantMetadata
}
