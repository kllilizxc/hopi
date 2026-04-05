import type { OmcAttempt, OmcMergePacket, OmcPlanDetailResponse, OmcPlanRuntime, OmcProgram } from '@hopi/protocol/types'
import type { Store } from '../../store'
import type { SyncEngine } from '../syncEngine'
import { collectOmcEvidence } from './evidenceCollector'
import {
    buildOmcMergeUpdatedEvent,
    buildOmcPlanRuntimeUpdatedEvent,
    buildOmcReviewUpdatedEvent
} from './events'
import { buildOmcMergePacket } from './reviewPacket'

type OmcMergeOutcome = 'merged' | 'blocked' | 'conflict'

export type OmcMergeApprovalResult = {
    programId: string
    planKey: string
    runtime: OmcPlanRuntime
    attempt: OmcAttempt | null
    packet: OmcMergePacket
    merge: {
        outcome: OmcMergeOutcome
        targetBranch: string | null
        sourceBranch: string | null
        blockedReason: string | null
        conflictFiles: string[]
        commitHash: string | null
        sessionId: string | null
        sessionUrl: string | null
    }
}

export class OmcReviewControllerPreconditionError extends Error {
    readonly runtime: OmcPlanRuntime
    readonly status: number

    constructor(message: string, runtime: OmcPlanRuntime, status: number = 409) {
        super(message)
        this.name = 'OmcReviewControllerPreconditionError'
        this.runtime = runtime
        this.status = status
    }
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
}

function normalizeBranchName(value: string | null | undefined): string | null {
    return isNonEmptyString(value) ? value.trim() : null
}

function normalizeConflictFiles(files: string[] | null | undefined): string[] {
    return Array.isArray(files)
        ? files.map((file) => file.trim()).filter((file) => file.length > 0)
        : []
}

function formatErrorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && isNonEmptyString(error.message)) {
        return error.message.trim()
    }

    if (isNonEmptyString(error)) {
        return error.trim()
    }

    return fallback
}

function pickReadableMergeError(result: {
    error?: string
    stderr?: string
    stdout?: string
}, fallback: string): string {
    const candidates = [result.error, result.stderr, result.stdout]
    for (const candidate of candidates) {
        if (isNonEmptyString(candidate)) {
            return candidate.trim()
        }
    }

    return fallback
}

function buildDefaultRuntime(programId: string, plan: OmcPlanDetailResponse['plan']): OmcPlanRuntime {
    const checklistDone = plan.checklist.filter((item) => item.checked).length
    const checklistOpen = plan.checklist.length - checklistDone
    const done = plan.checklist.length > 0 && checklistOpen === 0

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
        reviewApprovedAt: null,
        mergeStatus: 'idle',
        mergeBlockedReason: null,
        lastMergeAttemptAt: null,
        mergeApprovedAt: null,
        doneAt: done ? plan.lastModifiedAt : null,
        latestEvidenceSummary: null,
        lastAttemptAt: null,
        updatedAt: done ? plan.lastModifiedAt : null
    }
}

function buildMissingTargetBranchReason(): string {
    return 'Target branch is missing for this plan.'
}

function buildMissingSessionReason(): string {
    return 'No worktree session is available to run the merge.'
}

function buildNoMergeableChangesReason(sourceBranch: string | null, targetBranch: string): string {
    const normalizedSource = sourceBranch ?? 'the worktree branch'
    return `No mergeable changes remain between ${normalizedSource} and ${targetBranch}.`
}

export class OmcReviewController {
    constructor(private readonly options: {
        store: Store
        engine: SyncEngine
        namespace: string
    }) {
    }

    private resolveRuntime(program: OmcProgram, plan: OmcPlanDetailResponse['plan']): OmcPlanRuntime {
        return this.options.store.omcRuntime.getPlanRuntime(program.id, plan.planKey, this.options.namespace)
            ?? buildDefaultRuntime(program.id, plan)
    }

    private upsertRuntime(
        program: OmcProgram,
        plan: OmcPlanDetailResponse['plan'],
        patch: Partial<OmcPlanRuntime>
    ): OmcPlanRuntime {
        const { updatedAt, ...rest } = patch

        return this.options.store.omcRuntime.upsertPlanRuntime(this.options.namespace, {
            programId: program.id,
            planKey: plan.planKey,
            planPath: plan.planPath,
            phaseKey: plan.phaseKey,
            phaseLabel: plan.phaseLabel,
            ...rest,
            updatedAt: updatedAt ?? undefined
        })
    }

    private emitRuntime(runtime: OmcPlanRuntime, packet: OmcMergePacket): void {
        this.options.engine.handleRealtimeEvent(buildOmcPlanRuntimeUpdatedEvent(runtime, this.options.namespace))
        this.options.engine.handleRealtimeEvent(buildOmcReviewUpdatedEvent(runtime, this.options.namespace))
        this.options.engine.handleRealtimeEvent(buildOmcMergeUpdatedEvent(runtime, this.options.namespace, packet))
    }

    private buildResult(options: {
        program: OmcProgram
        plan: OmcPlanDetailResponse['plan']
        runtime: OmcPlanRuntime
        attempt: OmcAttempt | null
        merge: OmcMergeApprovalResult['merge']
    }): OmcMergeApprovalResult {
        const attempts = this.options.store.omcRuntime.listAttempts(options.program.id, options.plan.planKey, this.options.namespace)
        const evidence = this.options.store.omcRuntime.listEvidenceForPlan(options.program.id, options.plan.planKey, this.options.namespace)
        const packet = buildOmcMergePacket({
            program: options.program,
            plan: options.plan,
            runtime: options.runtime,
            attempts,
            evidence
        })

        this.emitRuntime(options.runtime, packet)

        return {
            programId: options.program.id,
            planKey: options.plan.planKey,
            runtime: options.runtime,
            attempt: options.attempt,
            packet,
            merge: options.merge
        }
    }

    private resolveLatestAttempt(programId: string, planKey: string): OmcAttempt | null {
        return this.options.store.omcRuntime.listAttempts(programId, planKey, this.options.namespace)[0] ?? null
    }

    private resolveRunningAttempt(programId: string, planKey: string): OmcAttempt | null {
        return this.options.store.omcRuntime
            .listAttempts(programId, planKey, this.options.namespace)
            .find((attempt) => attempt.status === 'running' && !attempt.completedAt) ?? null
    }

    private resolveMergeSession(attempt: OmcAttempt | null): {
        sessionId: string | null
        sessionUrl: string | null
        worktreePath: string | null
        currentBranch: string | null
    } {
        const sessionId = attempt?.sessionId ?? attempt?.contextPack?.workspace.sessionId ?? null
        if (!sessionId) {
            return {
                sessionId: null,
                sessionUrl: null,
                worktreePath: attempt?.contextPack?.workspace.worktreePath ?? null,
                currentBranch: attempt?.contextPack?.workspace.currentBranch ?? null
            }
        }

        const session = this.options.engine.getSessionByNamespace(sessionId, this.options.namespace)
        const sessionUrl = session ? `/sessions/${encodeURIComponent(sessionId)}/terminal` : null

        return {
            sessionId,
            sessionUrl,
            worktreePath: session?.metadata?.worktree?.worktreePath
                ?? attempt?.contextPack?.workspace.worktreePath
                ?? null,
            currentBranch: session?.metadata?.worktree?.branch
                ?? attempt?.contextPack?.workspace.currentBranch
                ?? null
        }
    }

    private completeBlocked(options: {
        program: OmcProgram
        plan: OmcPlanDetailResponse['plan']
        runtime: OmcPlanRuntime
        latestAttempt: OmcAttempt | null
        outcome: 'blocked' | 'conflict'
        blockedReason: string
        mergeAttemptedAt: number
        sourceBranch: string | null
        targetBranch: string | null
        sessionId: string | null
        sessionUrl: string | null
        worktreePath: string | null
        conflictFiles?: string[]
    }): OmcMergeApprovalResult {
        const now = Date.now()
        const nextRuntime = this.upsertRuntime(options.program, options.plan, {
            column: 'Review',
            loopStatus: 'review',
            reviewRequired: false,
            reviewApprovedAt: options.runtime.reviewApprovedAt ?? now,
            currentWorktreePath: options.worktreePath ?? options.runtime.currentWorktreePath ?? null,
            currentBranch: options.sourceBranch ?? options.runtime.currentBranch ?? null,
            targetBranch: options.targetBranch ?? options.runtime.targetBranch ?? options.program.targetBranch ?? null,
            mergeStatus: options.outcome,
            mergeBlockedReason: options.blockedReason,
            lastMergeAttemptAt: options.mergeAttemptedAt,
            mergeApprovedAt: null,
            doneAt: null,
            latestEvidenceSummary: options.blockedReason,
            updatedAt: now
        })

        const conflictFiles = normalizeConflictFiles(options.conflictFiles)
        collectOmcEvidence({
            store: this.options.store,
            engine: this.options.engine,
            namespace: this.options.namespace,
            programId: options.program.id,
            planKey: options.plan.planKey,
            attemptId: options.latestAttempt?.id ?? null,
            kind: 'review',
            label: options.outcome === 'conflict' ? 'merge-conflict' : 'merge-blocked',
            status: 'warning',
            summary: options.blockedReason,
            payload: {
                targetBranch: options.targetBranch,
                sourceBranch: options.sourceBranch,
                conflictFiles,
                sessionId: options.sessionId,
                sessionUrl: options.sessionUrl
            }
        })

        return this.buildResult({
            program: options.program,
            plan: options.plan,
            runtime: nextRuntime,
            attempt: options.latestAttempt,
            merge: {
                outcome: options.outcome,
                targetBranch: options.targetBranch,
                sourceBranch: options.sourceBranch,
                blockedReason: options.blockedReason,
                conflictFiles,
                commitHash: null,
                sessionId: options.sessionId,
                sessionUrl: options.sessionUrl
            }
        })
    }

    async approveMerge(options: {
        program: OmcProgram
        plan: OmcPlanDetailResponse['plan']
    }): Promise<OmcMergeApprovalResult> {
        const runtime = this.resolveRuntime(options.program, options.plan)
        const latestAttempt = this.resolveLatestAttempt(options.program.id, options.plan.planKey)
        const runningAttempt = this.resolveRunningAttempt(options.program.id, options.plan.planKey)
        const mergeSession = this.resolveMergeSession(latestAttempt)
        const targetBranch = normalizeBranchName(
            runtime.targetBranch
            ?? latestAttempt?.contextPack?.workspace.targetBranch
            ?? options.program.targetBranch
            ?? options.program.primaryBranch
            ?? null
        )
        const runtimeSourceBranch = normalizeBranchName(
            runtime.currentBranch
            ?? latestAttempt?.contextPack?.workspace.currentBranch
            ?? mergeSession.currentBranch
            ?? null
        )

        if (runtime.column !== 'Review') {
            throw new OmcReviewControllerPreconditionError('Plan must be in Review before merge approval.', runtime)
        }

        if (!runtime.reviewApprovedAt) {
            throw new OmcReviewControllerPreconditionError('Review must be approved before merge approval.', runtime)
        }

        if (runtime.mergeStatus === 'merged') {
            throw new OmcReviewControllerPreconditionError('Plan is already merged.', runtime)
        }

        if (runningAttempt) {
            throw new OmcReviewControllerPreconditionError('Plan still has a running attempt and cannot merge yet.', runtime)
        }

        const mergeAttemptedAt = Date.now()

        if (!targetBranch) {
            return this.completeBlocked({
                program: options.program,
                plan: options.plan,
                runtime,
                latestAttempt,
                outcome: 'blocked',
                blockedReason: buildMissingTargetBranchReason(),
                mergeAttemptedAt,
                sourceBranch: runtimeSourceBranch,
                targetBranch: null,
                sessionId: mergeSession.sessionId,
                sessionUrl: mergeSession.sessionUrl,
                worktreePath: mergeSession.worktreePath
            })
        }

        if (!mergeSession.sessionId) {
            return this.completeBlocked({
                program: options.program,
                plan: options.plan,
                runtime,
                latestAttempt,
                outcome: 'blocked',
                blockedReason: buildMissingSessionReason(),
                mergeAttemptedAt,
                sourceBranch: runtimeSourceBranch,
                targetBranch,
                sessionId: null,
                sessionUrl: null,
                worktreePath: mergeSession.worktreePath
            })
        }

        let mergeStateResult
        try {
            mergeStateResult = await this.options.engine.gitMergeWorktreeState(mergeSession.sessionId, {
                targetBranch
            })
        } catch (error) {
            return this.completeBlocked({
                program: options.program,
                plan: options.plan,
                runtime,
                latestAttempt,
                outcome: 'blocked',
                blockedReason: formatErrorMessage(error, 'Merge state check failed'),
                mergeAttemptedAt,
                sourceBranch: runtimeSourceBranch,
                targetBranch,
                sessionId: mergeSession.sessionId,
                sessionUrl: mergeSession.sessionUrl,
                worktreePath: mergeSession.worktreePath
            })
        }

        const sourceBranch = normalizeBranchName(mergeStateResult.sourceBranch) ?? runtimeSourceBranch

        if (!mergeStateResult.success) {
            return this.completeBlocked({
                program: options.program,
                plan: options.plan,
                runtime,
                latestAttempt,
                outcome: 'blocked',
                blockedReason: pickReadableMergeError(mergeStateResult, 'Merge state check failed'),
                mergeAttemptedAt,
                sourceBranch,
                targetBranch,
                sessionId: mergeSession.sessionId,
                sessionUrl: mergeSession.sessionUrl,
                worktreePath: mergeSession.worktreePath
            })
        }

        if (mergeStateResult.mergeable !== true) {
            return this.completeBlocked({
                program: options.program,
                plan: options.plan,
                runtime,
                latestAttempt,
                outcome: 'blocked',
                blockedReason: buildNoMergeableChangesReason(sourceBranch, targetBranch),
                mergeAttemptedAt,
                sourceBranch,
                targetBranch,
                sessionId: mergeSession.sessionId,
                sessionUrl: mergeSession.sessionUrl,
                worktreePath: mergeSession.worktreePath
            })
        }

        let mergeResult
        try {
            mergeResult = await this.options.engine.gitMergeWorktree(mergeSession.sessionId, {
                targetBranch,
                commitMessage: `OMC merge ${options.plan.planKey}: ${options.plan.planTitle}`,
                strategy: 'merge_commit'
            })
        } catch (error) {
            return this.completeBlocked({
                program: options.program,
                plan: options.plan,
                runtime,
                latestAttempt,
                outcome: 'blocked',
                blockedReason: formatErrorMessage(error, 'OMC merge failed unexpectedly'),
                mergeAttemptedAt,
                sourceBranch,
                targetBranch,
                sessionId: mergeSession.sessionId,
                sessionUrl: mergeSession.sessionUrl,
                worktreePath: mergeSession.worktreePath
            })
        }

        if (!mergeResult.success) {
            const blockedReason = pickReadableMergeError(mergeResult, 'OMC merge failed')
            const conflictFiles = normalizeConflictFiles(mergeResult.conflictFiles)
            const hasConflict = conflictFiles.length > 0 || /conflict/i.test(`${blockedReason}\n${mergeResult.stderr ?? ''}\n${mergeResult.stdout ?? ''}`)

            return this.completeBlocked({
                program: options.program,
                plan: options.plan,
                runtime,
                latestAttempt,
                outcome: hasConflict ? 'conflict' : 'blocked',
                blockedReason,
                mergeAttemptedAt,
                sourceBranch,
                targetBranch,
                sessionId: mergeSession.sessionId,
                sessionUrl: mergeSession.sessionUrl,
                worktreePath: mergeSession.worktreePath,
                conflictFiles
            })
        }

        const mergedAt = Date.now()
        const mergedSummary = mergeResult.skippedReason === 'no_changes'
            ? `Merge approval completed. ${targetBranch} was already up to date with ${sourceBranch ?? 'the worktree branch'}.`
            : `Merged ${sourceBranch ?? 'the worktree branch'} into ${targetBranch}.`
        const nextRuntime = this.upsertRuntime(options.program, options.plan, {
            column: 'Done',
            loopStatus: 'done',
            reviewRequired: false,
            reviewApprovedAt: runtime.reviewApprovedAt,
            currentWorktreePath: mergeSession.worktreePath ?? runtime.currentWorktreePath ?? null,
            currentBranch: sourceBranch ?? runtime.currentBranch ?? null,
            targetBranch,
            mergeStatus: 'merged',
            mergeBlockedReason: null,
            lastMergeAttemptAt: mergeAttemptedAt,
            mergeApprovedAt: mergedAt,
            doneAt: mergedAt,
            latestEvidenceSummary: mergedSummary,
            updatedAt: mergedAt
        })

        collectOmcEvidence({
            store: this.options.store,
            engine: this.options.engine,
            namespace: this.options.namespace,
            programId: options.program.id,
            planKey: options.plan.planKey,
            attemptId: latestAttempt?.id ?? null,
            kind: 'review',
            label: 'merge-succeeded',
            status: 'passed',
            summary: mergedSummary,
            payload: {
                targetBranch,
                sourceBranch,
                commitHash: mergeResult.commitHash ?? null,
                skippedReason: mergeResult.skippedReason ?? null,
                sessionId: mergeSession.sessionId,
                sessionUrl: mergeSession.sessionUrl
            }
        })

        return this.buildResult({
            program: options.program,
            plan: options.plan,
            runtime: nextRuntime,
            attempt: latestAttempt,
            merge: {
                outcome: 'merged',
                targetBranch,
                sourceBranch,
                blockedReason: null,
                conflictFiles: [],
                commitHash: mergeResult.commitHash ?? null,
                sessionId: mergeSession.sessionId,
                sessionUrl: mergeSession.sessionUrl
            }
        })
    }
}
