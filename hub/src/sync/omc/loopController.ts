import type {
    OmcAttempt,
    OmcAttemptOutcome,
    OmcEvidence,
    OmcPlanControlResponse,
    OmcPlanDetailResponse,
    OmcPlanRuntime,
    OmcProgram
} from '@hopi/protocol/types'
import type { Store } from '../../store'
import { buildPlanDetail } from './planningIndex'
import type { SyncEngine } from '../syncEngine'
import { startOmcPlanAttempt, type OmcPlanAttemptLaunchResult } from './attemptRunner'
import { collectOmcEvidence, collectSystemOmcAttemptEvidence, mapAttemptStatusToEvidenceStatus } from './evidenceCollector'
import {
    buildSystemOmcAttemptOutcome,
    parseOmcAttemptOutcome,
    parseOmcFallbackTerminationMessage
} from './attemptOutcome'
import {
    buildOmcAttemptUpdatedEvent,
    buildOmcPlanRuntimeUpdatedEvent
} from './events'
import {
    createDefaultOmcAttemptRuntimeAdapter,
    type OmcAttemptRuntimeAdapter
} from './runtimeAdapter'

const MAX_ATTEMPTS_PER_LOOP = 5
const MAX_CONSECUTIVE_FAILURES = 3

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>()
    for (const value of values) {
        if (!value) {
            continue
        }
        const normalized = value.trim()
        if (!normalized) {
            continue
        }
        seen.add(normalized)
    }
    return [...seen]
}

function isAttemptTerminal(status: OmcAttempt['status']): boolean {
    return status === 'progressed'
        || status === 'blocked'
        || status === 'completed'
        || status === 'failed'
        || status === 'canceled'
}

function buildRuntimeFallback(programId: string, plan: OmcPlanDetailResponse['plan']): OmcPlanRuntime {
    const checklistDone = plan.checklist.filter((item) => item.checked).length
    const checklistOpen = plan.checklist.length - checklistDone
    const done = checklistOpen === 0

    return {
        programId,
        planKey: plan.planKey,
        planPath: plan.planPath,
        phaseKey: plan.phaseKey,
        phaseLabel: plan.phaseLabel,
        column: done ? 'Done' : 'Planning',
        loopStatus: done ? 'done' : 'idle',
        currentLoopRunId: null,
        currentWorktreePath: null,
        currentBranch: null,
        targetBranch: null,
        attemptCount: 0,
        consecutiveFailureCount: 0,
        lastFailureFingerprint: null,
        reviewRequired: false,
        mergeApprovedAt: null,
        doneAt: done ? plan.lastModifiedAt : null,
        latestEvidenceSummary: null,
        lastAttemptAt: null,
        updatedAt: plan.lastModifiedAt
    }
}

type OmcLoopPolicyDecision =
    | {
        action: 'auto-continue'
        nextRuntime: Partial<OmcPlanRuntime>
    }
    | {
        action: 'auto-retry'
        nextRuntime: Partial<OmcPlanRuntime>
    }
    | {
        action: 'review'
        nextRuntime: Partial<OmcPlanRuntime>
    }
    | {
        action: 'stopped'
        nextRuntime: Partial<OmcPlanRuntime>
    }

export function applyOmcLoopPolicy(options: {
    runtime: OmcPlanRuntime
    attempt: OmcAttempt
    plan: OmcPlanDetailResponse['plan']
}): OmcLoopPolicyDecision {
    const hasOpenChecklist = options.plan.checklist.some((item) => !item.checked)
    const nextConsecutiveFailures = options.attempt.status === 'failed'
        ? options.runtime.consecutiveFailureCount + 1
        : 0
    const lastFailureFingerprint = options.attempt.status === 'failed' || options.attempt.status === 'blocked'
        ? options.attempt.failureFingerprint ?? options.runtime.lastFailureFingerprint ?? null
        : null
    const latestEvidenceSummary = options.attempt.summary ?? options.runtime.latestEvidenceSummary ?? null

    switch (options.attempt.status) {
        case 'progressed':
            if (!hasOpenChecklist || options.runtime.attemptCount >= MAX_ATTEMPTS_PER_LOOP) {
                return {
                    action: 'review',
                    nextRuntime: {
                        column: 'Review',
                        loopStatus: 'review',
                        reviewRequired: true,
                        consecutiveFailureCount: 0,
                        lastFailureFingerprint: null,
                        latestEvidenceSummary
                    }
                }
            }

            return {
                action: 'auto-continue',
                nextRuntime: {
                    column: 'Running',
                    loopStatus: 'running',
                    reviewRequired: false,
                    consecutiveFailureCount: 0,
                    lastFailureFingerprint: null,
                    latestEvidenceSummary
                }
            }

        case 'blocked':
            return {
                action: 'review',
                nextRuntime: {
                    column: 'Review',
                    loopStatus: 'review',
                    reviewRequired: true,
                    consecutiveFailureCount: 0,
                    lastFailureFingerprint: lastFailureFingerprint ?? 'blocked',
                    latestEvidenceSummary
                }
            }

        case 'failed':
            if (
                nextConsecutiveFailures >= MAX_CONSECUTIVE_FAILURES
                || options.runtime.attemptCount >= MAX_ATTEMPTS_PER_LOOP
            ) {
                return {
                    action: 'review',
                    nextRuntime: {
                        column: 'Review',
                        loopStatus: 'review',
                        reviewRequired: true,
                        consecutiveFailureCount: nextConsecutiveFailures,
                        lastFailureFingerprint: lastFailureFingerprint,
                        latestEvidenceSummary
                    }
                }
            }

            return {
                action: 'auto-retry',
                nextRuntime: {
                    column: 'Running',
                    loopStatus: 'running',
                    reviewRequired: false,
                    consecutiveFailureCount: nextConsecutiveFailures,
                    lastFailureFingerprint: lastFailureFingerprint,
                    latestEvidenceSummary
                }
            }

        case 'completed':
            return {
                action: 'review',
                nextRuntime: {
                    column: 'Review',
                    loopStatus: 'review',
                    reviewRequired: true,
                    consecutiveFailureCount: 0,
                    lastFailureFingerprint: null,
                    latestEvidenceSummary
                }
            }

        case 'canceled':
            return {
                action: 'stopped',
                nextRuntime: {
                    column: 'Planning',
                    loopStatus: 'stopped',
                    reviewRequired: false,
                    consecutiveFailureCount: 0,
                    latestEvidenceSummary
                }
            }

        default:
            return {
                action: 'review',
                nextRuntime: {
                    column: 'Review',
                    loopStatus: 'review',
                    reviewRequired: true,
                    latestEvidenceSummary
                }
            }
    }
}

export class OmcLoopController {
    private readonly processingAttemptIds = new Set<string>()
    private readonly adapter: OmcAttemptRuntimeAdapter

    constructor(private readonly options: {
        store: Store
        engine: SyncEngine
        namespace: string
        adapter?: OmcAttemptRuntimeAdapter
    }) {
        this.adapter = options.adapter ?? createDefaultOmcAttemptRuntimeAdapter()
    }

    private resolvePlan(program: OmcProgram, planKey: string): OmcPlanDetailResponse['plan'] {
        const plan = buildPlanDetail(program, planKey)
        if (!plan) {
            throw new Error(`Plan ${planKey} no longer exists in markdown planning.`)
        }
        return plan
    }

    private resolveRuntime(program: OmcProgram, plan: OmcPlanDetailResponse['plan']): OmcPlanRuntime {
        return this.options.store.omcRuntime.getPlanRuntime(program.id, plan.planKey, this.options.namespace)
            ?? buildRuntimeFallback(program.id, plan)
    }

    private emitAttemptUpdated(attempt: OmcAttempt): void {
        this.options.engine.handleRealtimeEvent(buildOmcAttemptUpdatedEvent(attempt, this.options.namespace))
    }

    private emitRuntimeUpdated(runtime: OmcPlanRuntime): void {
        this.options.engine.handleRealtimeEvent(buildOmcPlanRuntimeUpdatedEvent(runtime, this.options.namespace))
    }

    private async startAttemptWithFallback(options: {
        program: OmcProgram
        plan: OmcPlanDetailResponse['plan']
        runtime: OmcPlanRuntime
        loopRunId?: string | null
    }): Promise<OmcPlanAttemptLaunchResult> {
        const result = await startOmcPlanAttempt({
            store: this.options.store,
            engine: this.options.engine,
            namespace: this.options.namespace,
            program: options.program,
            plan: options.plan,
            runtime: options.runtime,
            loopRunId: options.loopRunId,
            adapter: this.adapter
        })

        if (result.kind === 'dispatch-failed') {
            await this.handleAttemptOutcome({
                program: result.program,
                attempt: result.attempt,
                outcome: result.outcome,
                force: true
            })
        }

        return result
    }

    async startPlan(options: {
        program: OmcProgram
        plan: OmcPlanDetailResponse['plan']
        runtime: OmcPlanRuntime
    }): Promise<{
        runtime: OmcPlanRuntime
        attempt: OmcAttempt | null
        evidence: OmcEvidence[]
    }> {
        const result = await this.startAttemptWithFallback(options)
        const latestPlan = this.resolvePlan(options.program, options.plan.planKey)
        const runtime = this.resolveRuntime(options.program, latestPlan)
        const attempt = this.options.store.omcRuntime.listAttempts(options.program.id, options.plan.planKey, this.options.namespace)[0] ?? null
        const evidence = this.options.store.omcRuntime.listEvidenceForPlan(options.program.id, options.plan.planKey, this.options.namespace)

        return {
            runtime: result.kind === 'started' ? result.runtime : runtime,
            attempt,
            evidence
        }
    }

    async retryPlan(program: OmcProgram, planKey: string): Promise<OmcPlanControlResponse> {
        const plan = this.resolvePlan(program, planKey)
        const runtime = this.resolveRuntime(program, plan)
        if (runtime.loopStatus === 'running') {
            throw new Error('This plan already has a running loop.')
        }

        const result = await this.startAttemptWithFallback({
            program,
            plan,
            runtime,
            loopRunId: runtime.currentLoopRunId ?? undefined
        })

        const latestRuntime = this.resolveRuntime(program, plan)
        const latestAttempt = this.options.store.omcRuntime.listAttempts(program.id, planKey, this.options.namespace)[0] ?? null

        return {
            programId: program.id,
            planKey,
            runtime: result.kind === 'started' ? result.runtime : latestRuntime,
            attempt: latestAttempt
        }
    }

    async resumePlan(program: OmcProgram, planKey: string): Promise<OmcPlanControlResponse> {
        return await this.retryPlan(program, planKey)
    }

    async reconcilePlan(program: OmcProgram, planKey: string): Promise<{
        runtime: OmcPlanRuntime
        attempt: OmcAttempt | null
    }> {
        const plan = this.resolvePlan(program, planKey)
        const runtime = this.resolveRuntime(program, plan)
        const runningAttempt = this.options.store.omcRuntime
            .listAttempts(program.id, planKey, this.options.namespace)
            .find((attempt) => attempt.status === 'running' && !attempt.completedAt) ?? null

        if (!runningAttempt?.sessionId) {
            return {
                runtime,
                attempt: this.options.store.omcRuntime.listAttempts(program.id, planKey, this.options.namespace)[0] ?? null
            }
        }

        const messages = this.options.store.messages.getMessages(runningAttempt.sessionId, 200)
        for (let index = messages.length - 1; index >= 0; index -= 1) {
            const message = messages[index]
            if (!message) {
                continue
            }

            const fallbackMessage = {
                id: message.id,
                seq: message.seq,
                localId: message.localId ?? null,
                createdAt: message.createdAt,
                content: message.content
            }
            const outcome = parseOmcAttemptOutcome(message.content) ?? parseOmcFallbackTerminationMessage(fallbackMessage)
            if (!outcome) {
                continue
            }

            return await this.handleAttemptOutcome({
                program,
                attempt: runningAttempt,
                outcome
            })
        }

        return {
            runtime,
            attempt: runningAttempt
        }
    }

    async reconcileProgram(program: OmcProgram): Promise<void> {
        const runtimes = this.options.store.omcRuntime.listPlanRuntimes(program.id, this.options.namespace)
            .filter((runtime) => runtime.loopStatus === 'running')

        for (const runtime of runtimes) {
            await this.reconcilePlan(program, runtime.planKey)
        }
    }

    async takeoverPlan(program: OmcProgram, planKey: string): Promise<OmcPlanControlResponse> {
        const plan = this.resolvePlan(program, planKey)
        const runtime = this.resolveRuntime(program, plan)
        const latestAttempt = this.options.store.omcRuntime.listAttempts(program.id, planKey, this.options.namespace)[0] ?? null
        const takeover = await this.adapter.ensureTakeoverSession({
            engine: this.options.engine,
            namespace: this.options.namespace,
            program,
            plan,
            runtime,
            preferredSessionId: latestAttempt?.sessionId ?? null
        })

        const nextRuntime = this.options.store.omcRuntime.upsertPlanRuntime(this.options.namespace, {
            programId: program.id,
            planKey,
            planPath: plan.planPath,
            phaseKey: plan.phaseKey,
            phaseLabel: plan.phaseLabel,
            column: 'Review',
            loopStatus: 'review',
            currentLoopRunId: runtime.currentLoopRunId,
            currentWorktreePath: takeover.worktreePath,
            currentBranch: takeover.currentBranch,
            targetBranch: takeover.targetBranch,
            reviewRequired: true,
            latestEvidenceSummary: 'Human takeover session is ready.',
            updatedAt: Date.now()
        })
        this.emitRuntimeUpdated(nextRuntime)

        collectOmcEvidence({
            store: this.options.store,
            engine: this.options.engine,
            namespace: this.options.namespace,
            programId: program.id,
            planKey,
            attemptId: latestAttempt?.id ?? null,
            kind: 'review',
            label: 'takeover-ready',
            status: 'info',
            summary: `Human takeover session ${takeover.sessionId} is ready.`,
            payload: {
                sessionId: takeover.sessionId,
                sessionUrl: `/sessions/${encodeURIComponent(takeover.sessionId)}/terminal`
            }
        })

        return {
            programId: program.id,
            planKey,
            runtime: nextRuntime,
            attempt: latestAttempt,
            sessionId: takeover.sessionId,
            sessionUrl: `/sessions/${encodeURIComponent(takeover.sessionId)}/terminal`
        }
    }

    async cancelPlan(program: OmcProgram, planKey: string): Promise<OmcPlanControlResponse> {
        const plan = this.resolvePlan(program, planKey)
        const runtime = this.resolveRuntime(program, plan)
        const runningAttempt = this.options.store.omcRuntime
            .listAttempts(program.id, planKey, this.options.namespace)
            .find((attempt) => attempt.status === 'running' && !attempt.completedAt) ?? null

        if (runningAttempt?.sessionId) {
            try {
                await this.options.engine.abortSession(runningAttempt.sessionId)
            } catch {
            }
        }

        if (runningAttempt) {
            await this.handleAttemptOutcome({
                program,
                attempt: runningAttempt,
                outcome: buildSystemOmcAttemptOutcome({
                    status: 'canceled',
                    summary: 'Loop canceled from the OMC control plane.',
                    terminationReason: 'user-canceled',
                    nextSuggestedStep: 'Resume the plan when you want autonomous execution to continue.'
                })
            })
        } else {
            const stoppedRuntime = this.options.store.omcRuntime.upsertPlanRuntime(this.options.namespace, {
                programId: program.id,
                planKey,
                planPath: plan.planPath,
                phaseKey: plan.phaseKey,
                phaseLabel: plan.phaseLabel,
                column: 'Planning',
                loopStatus: 'stopped',
                reviewRequired: false,
                updatedAt: Date.now()
            })
            this.emitRuntimeUpdated(stoppedRuntime)
        }

        return {
            programId: program.id,
            planKey,
            runtime: this.resolveRuntime(program, plan),
            attempt: this.options.store.omcRuntime.listAttempts(program.id, planKey, this.options.namespace)[0] ?? null
        }
    }

    async handleAttemptOutcome(options: {
        program: OmcProgram
        attempt: OmcAttempt
        outcome: OmcAttemptOutcome
        force?: boolean
    }): Promise<{
        runtime: OmcPlanRuntime
        attempt: OmcAttempt
    }> {
        if (this.processingAttemptIds.has(options.attempt.id)) {
            return {
                runtime: this.resolveRuntime(options.program, this.resolvePlan(options.program, options.attempt.planKey)),
                attempt: this.options.store.omcRuntime.getAttemptByNamespace(options.attempt.id, this.options.namespace) ?? options.attempt
            }
        }

        this.processingAttemptIds.add(options.attempt.id)

        try {
            const plan = this.resolvePlan(options.program, options.attempt.planKey)
            const runtime = this.resolveRuntime(options.program, plan)
            const currentAttempt = this.options.store.omcRuntime.getAttemptByNamespace(options.attempt.id, this.options.namespace) ?? options.attempt

            if (!options.force && (isAttemptTerminal(currentAttempt.status) || currentAttempt.completedAt)) {
                return {
                    runtime,
                    attempt: currentAttempt
                }
            }

            const systemEvidence = await collectSystemOmcAttemptEvidence({
                engine: this.options.engine,
                attempt: currentAttempt,
                cwd: runtime.currentWorktreePath ?? currentAttempt.contextPack?.workspace.worktreePath ?? options.program.repoRoot
            })

            const changedFiles = uniqueStrings([
                ...systemEvidence.changedFiles,
                ...currentAttempt.changedFiles,
                ...options.outcome.changedFiles
            ])

            const updatedAttempt = this.options.store.omcRuntime.updateAttempt(this.options.namespace, currentAttempt.id, {
                status: options.outcome.status,
                summary: options.outcome.summary,
                failureFingerprint: options.outcome.failureFingerprint ?? currentAttempt.failureFingerprint,
                terminationReason: options.outcome.terminationReason,
                changedFiles,
                checks: options.outcome.checks,
                nextSuggestedStep: options.outcome.nextSuggestedStep ?? null,
                completedAt: Date.now()
            }) ?? currentAttempt
            this.emitAttemptUpdated(updatedAttempt)

            collectOmcEvidence({
                store: this.options.store,
                engine: this.options.engine,
                namespace: this.options.namespace,
                programId: options.program.id,
                planKey: updatedAttempt.planKey,
                attemptId: updatedAttempt.id,
                kind: 'summary',
                label: 'attempt-outcome',
                status: mapAttemptStatusToEvidenceStatus(updatedAttempt.status),
                summary: updatedAttempt.summary ?? updatedAttempt.status,
                payload: {
                    source: options.outcome.source,
                    terminationReason: updatedAttempt.terminationReason
                }
            })

            collectOmcEvidence({
                store: this.options.store,
                engine: this.options.engine,
                namespace: this.options.namespace,
                programId: options.program.id,
                planKey: updatedAttempt.planKey,
                attemptId: updatedAttempt.id,
                kind: 'note',
                label: 'termination',
                status: updatedAttempt.status === 'failed' ? 'failed' : updatedAttempt.status === 'blocked' ? 'warning' : 'info',
                summary: updatedAttempt.terminationReason ?? 'Termination reason unavailable',
                payload: {
                    terminationReason: updatedAttempt.terminationReason
                }
            })

            for (const check of updatedAttempt.checks) {
                collectOmcEvidence({
                    store: this.options.store,
                    engine: this.options.engine,
                    namespace: this.options.namespace,
                    programId: options.program.id,
                    planKey: updatedAttempt.planKey,
                    attemptId: updatedAttempt.id,
                    kind: 'check',
                    label: check.label,
                    status: check.result === 'passed' ? 'passed' : check.result === 'failed' ? 'failed' : 'warning',
                    summary: check.detail ?? check.result,
                    payload: check.detail ? { detail: check.detail } : null
                })
            }

            if (systemEvidence.diffSummary.length > 0) {
                collectOmcEvidence({
                    store: this.options.store,
                    engine: this.options.engine,
                    namespace: this.options.namespace,
                    programId: options.program.id,
                    planKey: updatedAttempt.planKey,
                    attemptId: updatedAttempt.id,
                    kind: 'diff',
                    label: 'diff-summary',
                    status: 'info',
                    summary: `${systemEvidence.diffSummary.length} files currently changed in the worktree.`,
                    payload: {
                        files: systemEvidence.diffSummary
                    }
                })
            }

            const refreshedPlan = this.resolvePlan(options.program, updatedAttempt.planKey)
            const decision = applyOmcLoopPolicy({
                runtime,
                attempt: updatedAttempt,
                plan: refreshedPlan
            })

            const nextRuntime = this.options.store.omcRuntime.upsertPlanRuntime(this.options.namespace, {
                programId: options.program.id,
                planKey: updatedAttempt.planKey,
                planPath: refreshedPlan.planPath,
                phaseKey: refreshedPlan.phaseKey,
                phaseLabel: refreshedPlan.phaseLabel,
                column: decision.nextRuntime.column,
                loopStatus: decision.nextRuntime.loopStatus,
                currentLoopRunId: runtime.currentLoopRunId ?? updatedAttempt.loopRunId ?? null,
                currentWorktreePath: runtime.currentWorktreePath,
                currentBranch: runtime.currentBranch,
                targetBranch: runtime.targetBranch,
                consecutiveFailureCount: decision.nextRuntime.consecutiveFailureCount,
                lastFailureFingerprint: decision.nextRuntime.lastFailureFingerprint,
                reviewRequired: decision.nextRuntime.reviewRequired,
                latestEvidenceSummary: decision.nextRuntime.latestEvidenceSummary,
                lastAttemptAt: runtime.lastAttemptAt ?? updatedAttempt.updatedAt,
                updatedAt: Date.now()
            })
            this.emitRuntimeUpdated(nextRuntime)

            if (decision.action === 'auto-continue' || decision.action === 'auto-retry') {
                await this.startAttemptWithFallback({
                    program: options.program,
                    plan: refreshedPlan,
                    runtime: nextRuntime,
                    loopRunId: nextRuntime.currentLoopRunId ?? updatedAttempt.loopRunId ?? undefined
                })

                return {
                    runtime: this.resolveRuntime(options.program, refreshedPlan),
                    attempt: updatedAttempt
                }
            }

            return {
                runtime: nextRuntime,
                attempt: updatedAttempt
            }
        } finally {
            this.processingAttemptIds.delete(options.attempt.id)
        }
    }
}
