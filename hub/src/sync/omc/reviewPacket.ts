import { OmcMergePacketSchema } from '@hopi/protocol/schemas'
import type {
    OmcAttempt,
    OmcAttemptCheck,
    OmcEvidence,
    OmcMergePacket,
    OmcPlanDetailResponse,
    OmcPlanRuntime,
    OmcProgram
} from '@hopi/protocol/types'

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    const seen = new Set<string>()

    for (const value of values) {
        if (!isNonEmptyString(value)) {
            continue
        }

        seen.add(value.trim())
    }

    return [...seen]
}

function extractDiffSummaryFiles(evidence: OmcEvidence[]): string[] {
    const files: string[] = []

    for (const item of evidence) {
        if (item.kind !== 'diff' || item.label !== 'diff-summary' || !item.payload) {
            continue
        }

        const payloadFiles = item.payload.files
        if (!Array.isArray(payloadFiles)) {
            continue
        }

        for (const file of payloadFiles) {
            if (!file || typeof file !== 'object') {
                continue
            }

            const fullPath = 'fullPath' in file ? file.fullPath : undefined
            if (isNonEmptyString(fullPath)) {
                files.push(fullPath.trim())
            }
        }
    }

    return uniqueStrings(files)
}

function summarizeChecks(checks: OmcAttemptCheck[]): OmcMergePacket['checksSummary'] {
    const summary: OmcMergePacket['checksSummary'] = {
        total: checks.length,
        passed: 0,
        failed: 0,
        warning: 0,
        skipped: 0,
        items: checks
    }

    for (const check of checks) {
        if (check.result === 'passed') {
            summary.passed += 1
            continue
        }
        if (check.result === 'failed') {
            summary.failed += 1
            continue
        }
        if (check.result === 'warning') {
            summary.warning += 1
            continue
        }
        summary.skipped += 1
    }

    return summary
}

function buildPreconditions(options: {
    attempts: OmcAttempt[]
    reviewApprovedAt: number | null
    sourceBranch: string | null
    targetBranch: string | null
    worktreePath: string | null
    mergeStatus: OmcPlanRuntime['mergeStatus']
    mergeBlockedReason: string | null | undefined
}): OmcMergePacket['preconditions'] {
    return [
        {
            key: 'attempt-history',
            label: 'Attempt history available',
            status: options.attempts.length > 0 ? 'ready' : 'blocked',
            detail: options.attempts.length > 0 ? `${options.attempts.length} attempts recorded.` : 'No attempts recorded for this plan yet.'
        },
        {
            key: 'review-approval',
            label: 'Review approved',
            status: options.reviewApprovedAt ? 'ready' : 'blocked',
            detail: options.reviewApprovedAt
                ? `Approved at ${new Date(options.reviewApprovedAt).toISOString()}.`
                : 'Human review has not been approved yet.'
        },
        {
            key: 'source-branch',
            label: 'Source branch available',
            status: options.sourceBranch ? 'ready' : 'blocked',
            detail: options.sourceBranch ?? 'Current source branch is missing.'
        },
        {
            key: 'target-branch',
            label: 'Target branch available',
            status: options.targetBranch ? 'ready' : 'blocked',
            detail: options.targetBranch ?? 'Target branch is missing.'
        },
        {
            key: 'worktree',
            label: 'Worktree available',
            status: options.worktreePath ? 'ready' : 'blocked',
            detail: options.worktreePath ?? 'Worktree path is missing.'
        },
        {
            key: 'merge-state',
            label: 'Merge state',
            status: options.mergeStatus === 'blocked' || options.mergeStatus === 'conflict' ? 'blocked' : 'ready',
            detail: options.mergeStatus === 'blocked' || options.mergeStatus === 'conflict'
                ? options.mergeBlockedReason ?? `Merge status is ${options.mergeStatus}.`
                : options.mergeStatus === 'merged'
                    ? 'Plan is already merged.'
                    : `Merge status is ${options.mergeStatus ?? 'idle'}.`
        }
    ]
}

export function buildOmcMergePacket(options: {
    program: OmcProgram
    plan: OmcPlanDetailResponse['plan']
    runtime: OmcPlanRuntime
    attempts: OmcAttempt[]
    evidence: OmcEvidence[]
}): OmcMergePacket {
    const latestAttempt = options.attempts[0] ?? null
    const latestTerminalAttempt = options.attempts.find((attempt) => attempt.completedAt || (attempt.status !== 'queued' && attempt.status !== 'running'))
        ?? latestAttempt

    const sourceBranch = options.runtime.currentBranch
        ?? latestTerminalAttempt?.contextPack?.workspace.currentBranch
        ?? null
    const targetBranch = options.runtime.targetBranch
        ?? latestTerminalAttempt?.contextPack?.workspace.targetBranch
        ?? options.program.targetBranch
        ?? options.program.primaryBranch
        ?? null
    const worktreePath = options.runtime.currentWorktreePath
        ?? latestTerminalAttempt?.contextPack?.workspace.worktreePath
        ?? null
    const reviewApprovedAt = options.runtime.reviewApprovedAt ?? null
    const mergeStatus = options.runtime.mergeStatus ?? 'idle'
    const checks = latestTerminalAttempt?.checks ?? []
    const checksSummary = summarizeChecks(checks)
    const changedFiles = uniqueStrings([
        ...extractDiffSummaryFiles(options.evidence),
        ...options.attempts.flatMap((attempt) => attempt.changedFiles)
    ])

    const warnings = uniqueStrings([
        checksSummary.warning > 0 ? `${checksSummary.warning} checks reported warnings.` : null,
        checksSummary.skipped > 0 ? `${checksSummary.skipped} checks were skipped.` : null,
        changedFiles.length === 0 ? 'No changed files were recorded for this plan yet.' : null,
        latestTerminalAttempt?.status === 'canceled'
            ? latestTerminalAttempt.summary ?? 'Latest attempt was canceled.'
            : null,
        mergeStatus === 'merged' ? 'Plan is already merged.' : null
    ])

    const blockers = uniqueStrings([
        options.attempts.length === 0 ? 'No attempts recorded for this plan.' : null,
        reviewApprovedAt ? null : 'Review has not been approved yet.',
        sourceBranch ? null : 'Source branch is missing.',
        targetBranch ? null : 'Target branch is missing.',
        worktreePath ? null : 'Worktree path is missing.',
        checksSummary.failed > 0 ? `${checksSummary.failed} failing checks were recorded on the latest attempt.` : null,
        latestTerminalAttempt?.status === 'blocked'
            ? latestTerminalAttempt.summary ?? 'Latest attempt is blocked.'
            : null,
        latestTerminalAttempt?.status === 'failed'
            ? latestTerminalAttempt.summary ?? 'Latest attempt failed.'
            : null,
        mergeStatus === 'blocked'
            ? options.runtime.mergeBlockedReason ?? 'Merge is blocked and needs operator action.'
            : null,
        mergeStatus === 'conflict'
            ? options.runtime.mergeBlockedReason ?? 'Merge conflict requires resolution before merge.'
            : null
    ])

    return OmcMergePacketSchema.parse({
        phaseLabel: options.plan.phaseLabel,
        planKey: options.plan.planKey,
        planTitle: options.plan.planTitle,
        targetBranch,
        sourceBranch,
        worktreePath,
        attemptCount: Math.max(options.runtime.attemptCount, options.attempts.length),
        changedFilesSummary: {
            totalFiles: changedFiles.length,
            files: changedFiles
        },
        checksSummary,
        completionSummary: {
            status: latestTerminalAttempt?.status ?? null,
            summary: latestTerminalAttempt?.summary?.trim()
                || options.runtime.latestEvidenceSummary?.trim()
                || 'No completion summary recorded yet.',
            terminationReason: latestTerminalAttempt?.terminationReason ?? null,
            nextSuggestedStep: latestTerminalAttempt?.nextSuggestedStep ?? null
        },
        warnings,
        blockers,
        preconditions: buildPreconditions({
            attempts: options.attempts,
            reviewApprovedAt,
            sourceBranch,
            targetBranch,
            worktreePath,
            mergeStatus,
            mergeBlockedReason: options.runtime.mergeBlockedReason
        })
    })
}
