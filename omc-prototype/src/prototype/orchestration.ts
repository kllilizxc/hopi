import type { AgentEvent, DecisionTopic, OrchestrationTopicKind, WorldModel, WorkOrder } from './types'

export type { AgentEvent, DecisionTopic, WorldModel, WorkOrder } from './types'

function cloneAgentEvent(event: AgentEvent): AgentEvent {
    switch (event.kind) {
        case 'ReviewerVerdict':
            return {
                id: event.id,
                kind: event.kind,
                workOrderId: event.workOrderId,
                emittedBy: event.emittedBy,
                createdAt: event.createdAt,
                payload: { ...event.payload },
            }
        case 'DecisionRequest':
            return {
                id: event.id,
                kind: event.kind,
                workOrderId: event.workOrderId,
                emittedBy: event.emittedBy,
                createdAt: event.createdAt,
                payload: { ...event.payload },
            }
        case 'ManagerDecision':
            return {
                id: event.id,
                kind: event.kind,
                workOrderId: event.workOrderId,
                emittedBy: event.emittedBy,
                createdAt: event.createdAt,
                payload: { ...event.payload },
            }
        default:
            return {
                id: event.id,
                kind: event.kind,
                workOrderId: event.workOrderId,
                emittedBy: event.emittedBy,
                createdAt: event.createdAt,
                payload: { ...event.payload },
            }
    }
}

export function createInitialWorldModel(input: {
    focusGoalId: string | null
    focusStreamId?: string | null
}): WorldModel {
    return {
        currentFocus: {
            goalId: input.focusGoalId,
            streamId: input.focusStreamId ?? null,
        },
        workOrders: {},
        decisionTopics: {},
        agentEvents: [],
    }
}

export function createWorkOrder(input: {
    id: string
    goalId: string
    streamId?: string | null
    phaseId?: string | null
    planId?: string | null
    summary: string
    constraints?: string[]
}): WorkOrder {
    return {
        id: input.id,
        goalId: input.goalId,
        streamId: input.streamId ?? null,
        phaseId: input.phaseId ?? null,
        planId: input.planId ?? null,
        summary: input.summary,
        state: 'drafting',
        constraints: input.constraints ? [...input.constraints] : [],
        loop: {
            round: 0,
            reviewerVerdict: null,
            lastDriverSummary: null,
            lastReviewerSummary: null,
            lastDecisionSummary: null,
        },
        waitingOnTopicId: null,
    }
}

export function createDecisionTopic(input: {
    id: string
    kind: OrchestrationTopicKind
    title: string
    goalId: string | null
    workOrderId?: string | null
}): DecisionTopic {
    return {
        id: input.id,
        kind: input.kind,
        title: input.title,
        goalId: input.goalId,
        workOrderId: input.workOrderId ?? null,
        lifecycle: 'pending',
        unread: true,
        messages: [],
    }
}

export function appendAgentEvent(world: WorldModel, event: AgentEvent): WorldModel {
    return {
        ...world,
        agentEvents: [...world.agentEvents, cloneAgentEvent(event)],
    }
}
