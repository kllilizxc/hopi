import { randomUUID } from 'node:crypto'
import type { Session } from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { resolveSessionPreferredRootPath, resolveSessionWorktreePath } from '../sessionRootPaths'
import { buildOmcAttemptAddedEvent, buildOmcPlanRuntimeUpdatedEvent, buildOmcProgramUpdatedEvent } from './events'
import { buildOmcContextPack } from './contextPackBuilder'
import { collectOmcEvidence } from './evidenceCollector'
import type { OmcPlanDetailResponse, OmcPlanRuntime, OmcProgram } from '@hopi/protocol/types'

function buildWorktreeName(plan: OmcPlanDetailResponse['plan']): string {
    const slug = `${plan.planKey}-${plan.planTitle}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)

    return slug || `omc-${plan.planKey}`
}

function resolveMachineId(engine: SyncEngine, program: OmcProgram, namespace: string): string {
    if (program.machineId) {
        const machine = engine.getMachineByNamespace(program.machineId, namespace)
        if (machine?.active) {
            return machine.id
        }
    }

    const onlineMachine = engine.getOnlineMachinesByNamespace(namespace)[0]
    if (!onlineMachine) {
        throw new Error('No machine online. Start the runner and try again: hopi runner start')
    }

    return onlineMachine.id
}

function resolveSessionBranch(session: Session | undefined): string | null {
    return session?.metadata?.worktree?.branch?.trim() || null
}

export async function startOmcPlanAttempt(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    program: OmcProgram
    plan: OmcPlanDetailResponse['plan']
    runtime: OmcPlanRuntime
}): Promise<{
    program: OmcProgram
    runtime: OmcPlanRuntime
    attempt: import('@hopi/protocol/types').OmcAttempt
    evidence: import('@hopi/protocol/types').OmcEvidence[]
}> {
    if (options.runtime.loopStatus === 'running') {
        throw new Error('This plan already has a running loop.')
    }

    const machineId = resolveMachineId(options.engine, options.program, options.namespace)
    const persistedProgram = options.program.machineId === machineId
        ? options.program
        : options.store.omcRuntime.upsertProgram({
            id: options.program.id,
            namespace: options.namespace,
            machineId,
            name: options.program.name,
            repoRoot: options.program.repoRoot,
            planningRoot: options.program.planningRoot,
            primaryBranch: options.program.primaryBranch ?? null,
            targetBranch: options.program.targetBranch ?? null
        })

    if (persistedProgram.machineId === machineId) {
        options.engine.handleRealtimeEvent(buildOmcProgramUpdatedEvent(persistedProgram))
    }

    const loopRunId = randomUUID()
    const attemptId = randomUUID()
    const attemptNumber = options.runtime.attemptCount + 1
    const targetBranch = persistedProgram.targetBranch ?? persistedProgram.primaryBranch ?? null
    const spawnDirectory = options.runtime.currentWorktreePath ?? persistedProgram.repoRoot
    const useExistingWorktree = Boolean(options.runtime.currentWorktreePath)

    const spawnResult = await options.engine.spawnSession(
        machineId,
        spawnDirectory,
        'codex',
        undefined,
        false,
        useExistingWorktree ? 'simple' : 'worktree',
        useExistingWorktree ? undefined : buildWorktreeName(options.plan),
        undefined,
        undefined,
        targetBranch ?? undefined
    )

    if (spawnResult.type !== 'success') {
        throw new Error(spawnResult.message)
    }

    const sessionId = spawnResult.sessionId
    const becameActive = await options.engine.waitForSessionActive(sessionId, 20_000)
    if (!becameActive) {
        throw new Error('Session failed to become active')
    }

    let sessionConfigError: string | null = null
    try {
        await options.engine.applySessionConfig(sessionId, {
            permissionMode: 'acceptEdits'
        })
    } catch (error) {
        sessionConfigError = error instanceof Error ? error.message : String(error)
    }

    const session = options.engine.getSessionByNamespace(sessionId, options.namespace)
    const worktreePath = resolveSessionWorktreePath(session ?? {}) ?? resolveSessionPreferredRootPath(session ?? {}) ?? options.runtime.currentWorktreePath ?? spawnDirectory
    const currentBranch = resolveSessionBranch(session) ?? options.runtime.currentBranch ?? null
    const previousAttempt = options.store.omcRuntime.listAttempts(persistedProgram.id, options.plan.planKey, options.namespace)[0] ?? null
    const contextPack = buildOmcContextPack({
        program: persistedProgram,
        plan: options.plan,
        attemptId,
        loopRunId,
        attemptNumber,
        sessionId,
        worktreePath,
        currentBranch,
        targetBranch,
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
        currentWorktreePath: worktreePath,
        currentBranch,
        targetBranch,
        attemptCount: attemptNumber,
        reviewRequired: false,
        doneAt: null,
        lastAttemptAt: Date.now(),
        updatedAt: Date.now()
    })
    options.engine.handleRealtimeEvent(buildOmcPlanRuntimeUpdatedEvent(runtime, options.namespace))

    let attempt = options.store.omcRuntime.addAttempt(options.namespace, {
        id: attemptId,
        programId: persistedProgram.id,
        planKey: options.plan.planKey,
        planPath: options.plan.planPath,
        loopRunId,
        sessionId,
        attemptNumber,
        status: 'running',
        summary: 'Context pack prepared and session started.',
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
            summary: 'Deterministic context pack prepared for this manual OMC attempt.',
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
            summary: `Started Codex session ${sessionId} for plan ${options.plan.planKey}.`,
            payload: {
                sessionId,
                worktreePath,
                currentBranch,
                targetBranch
            }
        })
    ]

    if (sessionConfigError) {
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
                summary: `Session started, but apply-session-config returned: ${sessionConfigError}`,
                payload: {
                    sessionId,
                    error: sessionConfigError
                }
            })
        )
    }

    try {
        await options.engine.sendMessage(sessionId, {
            text: contextPack.promptText,
            sentFrom: 'webapp'
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        attempt = options.store.omcRuntime.updateAttempt(options.namespace, attempt.id, {
            status: 'failed',
            summary: 'Failed to dispatch the context pack into the Codex session.',
            failureFingerprint: 'prompt-dispatch',
            completedAt: Date.now()
        }) ?? attempt

        const failedRuntime = options.store.omcRuntime.upsertPlanRuntime(options.namespace, {
            programId: persistedProgram.id,
            planKey: options.plan.planKey,
            planPath: options.plan.planPath,
            phaseKey: options.plan.phaseKey,
            phaseLabel: options.plan.phaseLabel,
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: loopRunId,
            currentWorktreePath: worktreePath,
            currentBranch,
            targetBranch,
            lastFailureFingerprint: 'prompt-dispatch',
            reviewRequired: true,
            latestEvidenceSummary: message,
            lastAttemptAt: Date.now(),
            updatedAt: Date.now()
        })
        options.engine.handleRealtimeEvent(buildOmcPlanRuntimeUpdatedEvent(failedRuntime, options.namespace))

        collectOmcEvidence({
            store: options.store,
            engine: options.engine,
            namespace: options.namespace,
            programId: persistedProgram.id,
            planKey: options.plan.planKey,
            attemptId: attempt.id,
            kind: 'note',
            label: 'prompt-dispatch',
            status: 'failed',
            summary: `Failed to dispatch context pack to session ${sessionId}: ${message}`,
            payload: {
                sessionId,
                error: message
            }
        })

        throw new Error(message)
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
            summary: 'Context pack prompt sent to the Codex session.',
            payload: {
                sessionId
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
        currentWorktreePath: worktreePath,
        currentBranch,
        targetBranch,
        latestEvidenceSummary: 'Context pack sent to Codex session.',
        lastAttemptAt: Date.now(),
        updatedAt: Date.now()
    })
    options.engine.handleRealtimeEvent(buildOmcPlanRuntimeUpdatedEvent(refreshedRuntime, options.namespace))

    return {
        program: persistedProgram,
        runtime: refreshedRuntime,
        attempt,
        evidence
    }
}
