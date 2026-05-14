import type {
    ProjectAssistantInterventionKind,
    ProjectAssistantInterventionStatus,
    ProjectAssistantSessionKind,
    ProjectAssistantSuggestedAction,
    SessionCapabilityProfile
} from '@hopi/protocol/types'
import type { Store } from '../../store'

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

export type AssistantMetadata = {
    path: string
    host: string
    machineId?: string
    projectId: string
    goalId?: string
    taskId?: string
    name: string
    flavor?: string | null
    capabilityProfile: SessionCapabilityProfile
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

export type AssistantAgentFlavor = 'claude' | 'codex' | 'gemini' | 'opencode'

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
