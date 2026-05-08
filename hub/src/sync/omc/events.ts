import type {
    OmcAttempt,
    OmcCoordinationAgentState,
    OmcDecisionTopic,
    OmcDecisionTopicTurn,
    OmcDirectiveLedgerEntry,
    OmcEvidence,
    OmcGuidedPlanningRun,
    OmcMailboxMessage,
    OmcMergePacket,
    OmcPlanRuntime,
    OmcProgram,
    OmcProgramPlanningState,
    OmcWorkAttempt,
    OmcWorkOrder,
    SyncEvent
} from '@hopi/protocol/types'

export function buildOmcProgramUpdatedEvent(program: OmcProgram): SyncEvent {
    return {
        type: 'omc-program-updated',
        namespace: program.namespace,
        programId: program.id,
        data: {
            programId: program.id,
            program
        }
    }
}

export function buildOmcGuidedPlanningUpdatedEvent(
    run: OmcGuidedPlanningRun,
    planning: OmcProgramPlanningState,
    namespace: string
): SyncEvent {
    return {
        type: 'omc-guided-planning-updated',
        namespace,
        programId: run.programId,
        runId: run.id,
        data: {
            runId: run.id,
            run,
            planning
        }
    }
}

export function buildOmcPlanRuntimeUpdatedEvent(runtime: OmcPlanRuntime, namespace: string): SyncEvent {
    return {
        type: 'omc-plan-runtime-updated',
        namespace,
        programId: runtime.programId,
        planKey: runtime.planKey,
        data: {
            planKey: runtime.planKey,
            runtime
        }
    }
}

export function buildOmcAttemptAddedEvent(attempt: OmcAttempt, namespace: string): SyncEvent {
    return {
        type: 'omc-attempt-added',
        namespace,
        programId: attempt.programId,
        planKey: attempt.planKey,
        attemptId: attempt.id,
        data: {
            attemptId: attempt.id,
            attempt
        }
    }
}

export function buildOmcAttemptUpdatedEvent(attempt: OmcAttempt, namespace: string): SyncEvent {
    return {
        type: 'omc-attempt-updated',
        namespace,
        programId: attempt.programId,
        planKey: attempt.planKey,
        attemptId: attempt.id,
        data: {
            attemptId: attempt.id,
            attempt
        }
    }
}

export function buildOmcEvidenceAddedEvent(evidence: OmcEvidence, namespace: string): SyncEvent {
    return {
        type: 'omc-evidence-added',
        namespace,
        programId: evidence.programId,
        planKey: evidence.planKey,
        evidenceId: evidence.id,
        attemptId: evidence.attemptId ?? null,
        data: {
            evidenceId: evidence.id,
            evidence
        }
    }
}

export function buildOmcReviewUpdatedEvent(runtime: OmcPlanRuntime, namespace: string): SyncEvent {
    return {
        type: 'omc-review-updated',
        namespace,
        programId: runtime.programId,
        planKey: runtime.planKey,
        data: {
            planKey: runtime.planKey,
            runtime
        }
    }
}

export function buildOmcMergeUpdatedEvent(runtime: OmcPlanRuntime, namespace: string, packet?: OmcMergePacket): SyncEvent {
    return {
        type: 'omc-merge-updated',
        namespace,
        programId: runtime.programId,
        planKey: runtime.planKey,
        data: {
            planKey: runtime.planKey,
            runtime,
            packet
        }
    }
}

export function buildOmcTopicUpdatedEvent(topic: OmcDecisionTopic, namespace: string): SyncEvent {
    return {
        type: 'omc-topic-updated',
        namespace,
        programId: topic.programId,
        topicId: topic.id,
        data: {
            topicId: topic.id,
            topic,
        },
    }
}

export function buildOmcTopicTurnAddedEvent(topic: OmcDecisionTopic, turn: OmcDecisionTopicTurn, namespace: string): SyncEvent {
    return {
        type: 'omc-topic-turn-added',
        namespace,
        programId: topic.programId,
        topicId: topic.id,
        turnId: turn.id,
        data: {
            topicId: topic.id,
            turnId: turn.id,
            turn,
        },
    }
}

export function buildOmcMailboxMessageAddedEvent(message: OmcMailboxMessage, namespace: string): SyncEvent {
    return {
        type: 'omc-mailbox-message-added',
        namespace,
        programId: message.programId,
        messageId: message.id,
        data: {
            messageId: message.id,
            message,
        },
    }
}

export function buildOmcWorkOrderUpdatedEvent(workOrder: OmcWorkOrder, namespace: string): SyncEvent {
    return {
        type: 'omc-work-order-updated',
        namespace,
        programId: workOrder.programId,
        workOrderId: workOrder.id,
        data: {
            workOrderId: workOrder.id,
            workOrder,
        },
    }
}

export function buildOmcWorkAttemptAddedEvent(workAttempt: OmcWorkAttempt, namespace: string): SyncEvent {
    return {
        type: 'omc-work-attempt-added',
        namespace,
        programId: workAttempt.programId,
        workOrderId: workAttempt.workOrderId,
        workAttemptId: workAttempt.id,
        data: {
            workOrderId: workAttempt.workOrderId,
            workAttemptId: workAttempt.id,
            workAttempt,
        },
    }
}

export function buildOmcWorkAttemptUpdatedEvent(workAttempt: OmcWorkAttempt, namespace: string): SyncEvent {
    return {
        type: 'omc-work-attempt-updated',
        namespace,
        programId: workAttempt.programId,
        workOrderId: workAttempt.workOrderId,
        workAttemptId: workAttempt.id,
        data: {
            workOrderId: workAttempt.workOrderId,
            workAttemptId: workAttempt.id,
            workAttempt,
        },
    }
}

export function buildOmcCoordinationAgentUpdatedEvent(agent: OmcCoordinationAgentState, namespace: string): SyncEvent {
    return {
        type: 'omc-coordination-agent-updated',
        namespace,
        programId: agent.programId,
        role: agent.role,
        data: {
            role: agent.role,
            agent,
        },
    }
}

export function buildOmcDirectiveLedgerUpdatedEvent(directive: OmcDirectiveLedgerEntry, namespace: string): SyncEvent {
    return {
        type: 'omc-directive-ledger-updated',
        namespace,
        programId: directive.programId,
        directiveId: directive.id,
        data: {
            directiveId: directive.id,
            directive,
        },
    }
}
