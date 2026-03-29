import type { OmcAttempt, OmcEvidence, OmcPlanRuntime, OmcProgram, SyncEvent } from '@hopi/protocol/types'

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
