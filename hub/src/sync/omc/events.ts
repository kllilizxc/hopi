import type {
    OmcAttempt,
    OmcEvidence,
    OmcGuidedPlanningRun,
    OmcMergePacket,
    OmcPlanRuntime,
    OmcProgram,
    OmcProgramPlanningState,
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
