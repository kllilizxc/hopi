import { randomUUID } from 'node:crypto'
import type { OmcAttempt, OmcAttemptOutcome, OmcEvidence, OmcPlanDetailResponse, OmcPlanRuntime, OmcProgram } from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { buildSystemOmcAttemptOutcome } from './attemptOutcome'
import {
    buildOmcAttemptAddedEvent,
    buildOmcPlanRuntimeUpdatedEvent,
    buildOmcProgramUpdatedEvent
} from './events'
import { buildOmcContextPack } from './contextPackBuilder'
import { collectOmcEvidence } from './evidenceCollector'
import {
    createDefaultOmcAttemptRuntimeAdapter,
    type OmcAttemptRuntimeAdapter
} from './runtimeAdapter'

export type OmcPlanAttemptLaunchResult =
    | {
        kind: 'started'
        program: OmcProgram
        runtime: OmcPlanRuntime
        attempt: OmcAttempt
        evidence: OmcEvidence[]
        adapterId: string
    }
    | {
        kind: 'dispatch-failed'
        program: OmcProgram
        runtime: OmcPlanRuntime
        attempt: OmcAttempt
        evidence: OmcEvidence[]
        adapterId: string
        error: string
        outcome: OmcAttemptOutcome
    }

export async function startOmcPlanAttempt(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    program: OmcProgram
    plan: OmcPlanDetailResponse['plan']
    runtime: OmcPlanRuntime
    loopRunId?: string | null
    adapter?: OmcAttemptRuntimeAdapter
}): Promise<OmcPlanAttemptLaunchResult> {
    const existingRunningAttempt = options.store.omcRuntime
        .listAttempts(options.program.id, options.plan.planKey, options.namespace)
        .find((attempt) => attempt.status === 'running' && !attempt.completedAt)

    if (existingRunningAttempt) {
        throw new Error('This plan already has a running loop.')
    }

    const adapter = options.adapter ?? createDefaultOmcAttemptRuntimeAdapter()
    const launch = await adapter.startAttemptSession({
        engine: options.engine,
        namespace: options.namespace,
        program: options.program,
        plan: options.plan,
        runtime: options.runtime
    })

    const persistedProgram = options.program.machineId === launch.machineId
        ? options.program
        : options.store.omcRuntime.upsertProgram({
            id: options.program.id,
            namespace: options.namespace,
            machineId: launch.machineId,
            name: options.program.name,
            repoRoot: options.program.repoRoot,
            planningRoot: options.program.planningRoot,
            primaryBranch: options.program.primaryBranch ?? null,
            targetBranch: options.program.targetBranch ?? null
        })

    options.engine.handleRealtimeEvent(buildOmcProgramUpdatedEvent(persistedProgram))

    const loopRunId = options.loopRunId ?? options.runtime.currentLoopRunId ?? randomUUID()
    const attemptId = randomUUID()
    const attemptNumber = options.runtime.attemptCount + 1
    const previousAttempt = options.store.omcRuntime.listAttempts(
        persistedProgram.id,
        options.plan.planKey,
        options.namespace
    )[0] ?? null

    const contextPack = buildOmcContextPack({
        program: persistedProgram,
        plan: options.plan,
        attemptId,
        loopRunId,
        attemptNumber,
        sessionId: launch.sessionId,
        worktreePath: launch.worktreePath,
        currentBranch: launch.currentBranch,
        targetBranch: launch.targetBranch,
        previousAttempt
    })

    const runtime = options.store.omcRuntime.upsertPlanRuntime(options.namespace, {
        programId: persistedProgram.id,
        planKey: options.plan.planKey,
        planPath: options.plan.planPath,
        phaseKey: options.plan.phaseKey,
        phaseLabel: options.plan.phaseLabel,
        column: 'Running',
        loopStatus: 'running',
        currentLoopRunId: loopRunId,
        currentWorktreePath: launch.worktreePath,
        currentBranch: launch.currentBranch,
        targetBranch: launch.targetBranch,
        attemptCount: attemptNumber,
        reviewRequired: false,
        doneAt: null,
        lastAttemptAt: Date.now(),
        updatedAt: Date.now()
    })
    options.engine.handleRealtimeEvent(buildOmcPlanRuntimeUpdatedEvent(runtime, options.namespace))

    const attempt = options.store.omcRuntime.addAttempt(options.namespace, {
        id: attemptId,
        programId: persistedProgram.id,
        planKey: options.plan.planKey,
        planPath: options.plan.planPath,
        loopRunId,
        sessionId: launch.sessionId,
        attemptNumber,
        status: 'running',
        summary: `Attempt started via ${adapter.id}.`,
        contextPack
    })
    options.engine.handleRealtimeEvent(buildOmcAttemptAddedEvent(attempt, options.namespace))

    const evidence = [
        collectOmcEvidence({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            programId: persistedProgram.id,
            planKey: options.plan.planKey,
            attemptId: attempt.id,
            kind: 'note',
            label: 'context-pack',
            status: 'info',
            summary: `Deterministic context pack prepared for ${adapter.id}.`,
            payload: { contextPack }
        }),
        collectOmcEvidence({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            programId: persistedProgram.id,
            planKey: options.plan.planKey,
            attemptId: attempt.id,
            kind: 'summary',
            label: 'session-start',
            status: 'info',
            summary: `Started ${adapter.id} session ${launch.sessionId} for plan ${options.plan.planKey}.`,
            payload: {
                adapterId: adapter.id,
                sessionId: launch.sessionId,
                worktreePath: launch.worktreePath,
                currentBranch: launch.currentBranch,
                targetBranch: launch.targetBranch
            }
        })
    ]

    if (launch.sessionConfigError) {
        evidence.push(
            collectOmcEvidence({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                programId: persistedProgram.id,
                planKey: options.plan.planKey,
                attemptId: attempt.id,
                kind: 'note',
                label: 'session-config',
                status: 'warning',
                summary: `Session started, but apply-session-config returned: ${launch.sessionConfigError}`,
                payload: {
                    sessionId: launch.sessionId,
                    error: launch.sessionConfigError
                }
            })
        )
    }

    try {
        await adapter.dispatchContextPack({
            engine: options.engine,
            sessionId: launch.sessionId,
            promptText: contextPack.promptText
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const failedAttempt = options.store.omcRuntime.updateAttempt(options.namespace, attempt.id, {
            status: 'failed',
            summary: 'Failed to dispatch the context pack into the runtime session.',
            failureFingerprint: 'prompt-dispatch',
            terminationReason: 'prompt-dispatch',
            completedAt: Date.now()
        }) ?? attempt

        evidence.push(
            collectOmcEvidence({
                store: options.store,
                engine: options.engine,
                namespace: options.namespace,
                programId: persistedProgram.id,
                planKey: options.plan.planKey,
                attemptId: failedAttempt.id,
                kind: 'note',
                label: 'prompt-dispatch',
                status: 'failed',
                summary: `Failed to dispatch context pack to session ${launch.sessionId}: ${message}`,
                payload: {
                    sessionId: launch.sessionId,
                    adapterId: adapter.id,
                    error: message
                }
            })
        )

        const failedRuntime = options.store.omcRuntime.upsertPlanRuntime(options.namespace, {
            programId: persistedProgram.id,
            planKey: options.plan.planKey,
            planPath: options.plan.planPath,
            phaseKey: options.plan.phaseKey,
            phaseLabel: options.plan.phaseLabel,
            column: 'Running',
            loopStatus: 'running',
            currentLoopRunId: loopRunId,
            currentWorktreePath: launch.worktreePath,
            currentBranch: launch.currentBranch,
            targetBranch: launch.targetBranch,
            latestEvidenceSummary: message,
            lastAttemptAt: Date.now(),
            updatedAt: Date.now()
        })
        options.engine.handleRealtimeEvent(buildOmcPlanRuntimeUpdatedEvent(failedRuntime, options.namespace))

        return {
            kind: 'dispatch-failed',
            program: persistedProgram,
            runtime: failedRuntime,
            attempt: failedAttempt,
            evidence,
            adapterId: adapter.id,
            error: message,
            outcome: buildSystemOmcAttemptOutcome({
                status: 'failed',
                summary: `Context-pack dispatch failed: ${message}`,
                terminationReason: 'prompt-dispatch',
                failureFingerprint: 'prompt-dispatch',
                nextSuggestedStep: 'Re-open the loop after fixing the dispatch or runner issue.'
            })
        }
    }

    evidence.push(
        collectOmcEvidence({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            programId: persistedProgram.id,
            planKey: options.plan.planKey,
            attemptId: attempt.id,
            kind: 'summary',
            label: 'prompt-dispatched',
            status: 'info',
            summary: 'Context pack prompt sent to the runtime session.',
            payload: {
                adapterId: adapter.id,
                sessionId: launch.sessionId
            }
        })
    )

    const refreshedRuntime = options.store.omcRuntime.upsertPlanRuntime(options.namespace, {
        programId: persistedProgram.id,
        planKey: options.plan.planKey,
        planPath: options.plan.planPath,
        phaseKey: options.plan.phaseKey,
        phaseLabel: options.plan.phaseLabel,
        column: 'Running',
        loopStatus: 'running',
        currentLoopRunId: loopRunId,
        currentWorktreePath: launch.worktreePath,
        currentBranch: launch.currentBranch,
        targetBranch: launch.targetBranch,
        latestEvidenceSummary: `Context pack sent to ${adapter.id} session.`,
        lastAttemptAt: Date.now(),
        updatedAt: Date.now()
    })
    options.engine.handleRealtimeEvent(buildOmcPlanRuntimeUpdatedEvent(refreshedRuntime, options.namespace))

    return {
        kind: 'started',
        program: persistedProgram,
        runtime: refreshedRuntime,
        attempt,
        evidence,
        adapterId: adapter.id
    }
}
