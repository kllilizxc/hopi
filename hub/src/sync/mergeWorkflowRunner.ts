import { resolve } from 'node:path'
import type { MergeVerifyCheck, MergeWorkflow } from '@hopi/protocol/actions'
import { PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH, PRODUCT_ENV } from '@hopi/protocol/brand'
import type { StoredTask } from '../store'
import type { SyncEngine } from './syncEngine'
import { loadProjectActionContractFromSession } from './actionContract'
import { resolveSessionRootPathCandidates } from './sessionRootPaths'

type SessionLike = {
    metadata?: {
        path?: string | null
        worktree?: {
            worktreePath?: string | null
            basePath?: string | null
        } | null
    } | null
}

export type LoadMergeWorkflowFromSessionResult =
    | {
        kind: 'valid'
        manifestPath: string
        rootPath: string
        workflow: MergeWorkflow
    }
    | {
        kind: 'missing'
        manifestPath: string
        error: string
    }
    | {
        kind: 'invalid'
        manifestPath: string
        error: string
    }

export function createDefaultMergeWorkflow(targetBranch: string | null | undefined): MergeWorkflow {
    const normalizedTargetBranch = typeof targetBranch === 'string' && targetBranch.trim().length > 0
        ? targetBranch.trim()
        : 'main'

    return {
        targetBranch: normalizedTargetBranch,
        strategy: 'squash',
        conflictResolution: {
            mode: 'ai',
            maxAttempts: 2
        }
    }
}

export function resolveSessionActionContractRootPaths(session: SessionLike): string[] {
    return resolveSessionRootPathCandidates({ session })
}

export async function loadMergeWorkflowFromSession(options: {
    engine: SyncEngine
    sessionId: string
    session: SessionLike
}): Promise<LoadMergeWorkflowFromSessionResult> {
    const roots = resolveSessionActionContractRootPaths(options.session)
    const contract = await loadProjectActionContractFromSession({
        engine: options.engine,
        sessionId: options.sessionId,
        rootPaths: roots
    })

    if (contract.kind === 'missing') {
        return {
            kind: 'missing',
            manifestPath: contract.manifestPath,
            error: `Missing ${PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH}`
        }
    }

    if (contract.kind === 'invalid') {
        return {
            kind: 'invalid',
            manifestPath: contract.manifestPath,
            error: contract.error
        }
    }

    return {
        kind: 'valid',
        manifestPath: contract.manifestPath,
        rootPath: contract.rootPath ?? roots[0] ?? '',
        workflow: contract.contract.merge
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function globToRegExp(pattern: string): RegExp {
    let source = '^'
    for (let index = 0; index < pattern.length; index += 1) {
        const char = pattern[index]
        const next = pattern[index + 1]
        if (char === '*' && next === '*') {
            source += '.*'
            index += 1
            continue
        }
        if (char === '*') {
            source += '[^/]*'
            continue
        }
        if (char === '?') {
            source += '[^/]'
            continue
        }
        source += escapeRegExp(char)
    }
    source += '$'
    return new RegExp(source)
}

export function findBlockedMergeConflictPath(conflictFiles: string[], blockPaths: string[] | undefined): string | null {
    if (!Array.isArray(blockPaths) || blockPaths.length === 0) {
        return null
    }

    for (const pattern of blockPaths) {
        const normalizedPattern = pattern.trim()
        if (!normalizedPattern) {
            continue
        }
        const matcher = globToRegExp(normalizedPattern)
        const match = conflictFiles.find((file) => matcher.test(file))
        if (match) {
            return match
        }
    }

    return null
}

export function resolveMergeConflictResolutionMode(
    workflow: MergeWorkflow,
    override?: 'manual' | 'agent'
): 'off' | 'ai' {
    if (override === 'manual') {
        return 'off'
    }
    if (override === 'agent') {
        return 'ai'
    }
    return workflow.conflictResolution?.mode ?? 'ai'
}

export function resolveMergeConflictResolutionMaxAttempts(workflow: MergeWorkflow): number {
    return Math.max(1, workflow.conflictResolution?.maxAttempts ?? 2)
}

export function getMergeRunVerifyChecks(workflow: MergeWorkflow): Array<Extract<MergeVerifyCheck, { type: 'run' }>> {
    return (workflow.verify ?? []).filter((check): check is Extract<MergeVerifyCheck, { type: 'run' }> => check.type === 'run')
}

export function requiresSnapshotMergeVerification(workflow: MergeWorkflow): boolean {
    if (!Array.isArray(workflow.verify) || workflow.verify.length === 0) {
        return true
    }
    return workflow.verify.some((check) => check.type === 'snapshot_contains_changes')
}

export type MergeVerifyRunCheckResult = {
    command: string
    cwd: string
    status: 'succeeded' | 'failed'
    stdout: string
    stderr: string
    summary: string
    durationMs: number
}

export type MergeVerifyRunResult =
    | {
        ok: true
        checks: MergeVerifyRunCheckResult[]
    }
    | {
        ok: false
        error: string
        failedCheck: MergeVerifyRunCheckResult | null
        checks: MergeVerifyRunCheckResult[]
    }

function quoteForShell(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
}

function buildEnvPrefix(env: Record<string, string | undefined>): string {
    const entries = Object.entries(env)
        .filter(([, value]) => typeof value === 'string' && value.length > 0)
        .map(([key, value]) => `${key}=${quoteForShell(value as string)}`)
    return entries.length > 0 ? `${entries.join(' ')} ` : ''
}

function buildRunCommand(args: string[], env: Record<string, string | undefined>): string {
    const command = args.map((arg) => quoteForShell(arg)).join(' ')
    return `${buildEnvPrefix(env)}${command}`
}

function summarizeCommandResult(options: {
    command: string
    stdout?: string
    stderr?: string
    error?: string
}): string {
    const explicit = options.error?.trim()
    if (explicit) {
        return explicit
    }

    const stderr = options.stderr?.trim()
    if (stderr) {
        const first = stderr.split('\n').find((line) => line.trim().length > 0)?.trim()
        if (first) {
            return first
        }
    }

    const stdout = options.stdout?.trim()
    if (stdout) {
        const first = stdout.split('\n').find((line) => line.trim().length > 0)?.trim()
        if (first) {
            return first
        }
    }

    return `Command failed: ${options.command}`
}

function resolveRunCheckCwd(rootPath: string, cwd?: string): string {
    if (!cwd || cwd.trim().length === 0 || cwd.trim() === '.') {
        return rootPath
    }
    return resolve(rootPath, cwd)
}

export async function runMergeVerifyChecks(options: {
    engine: SyncEngine
    sessionId: string
    rootPath: string
    taskId: string
    projectId: string
    targetBranch: string
    sourceBranch: string | null
    worktreeBasePath?: string | null
    worktreePath?: string | null
    checks: Array<Extract<MergeVerifyCheck, { type: 'run' }>>
}): Promise<MergeVerifyRunResult> {
    const results: MergeVerifyRunCheckResult[] = []

    for (const check of options.checks) {
        const cwd = resolveRunCheckCwd(options.rootPath, check.cwd)
        const command = buildRunCommand(check.run, {
            ...check.env,
            [PRODUCT_ENV.PROJECT_ROOT]: options.rootPath,
            [PRODUCT_ENV.TASK_ID]: options.taskId,
            [PRODUCT_ENV.TASK_PROJECT_ID]: options.projectId,
            [PRODUCT_ENV.MERGE_TARGET_BRANCH]: options.targetBranch,
            [PRODUCT_ENV.MERGE_SOURCE_BRANCH]: options.sourceBranch ?? '',
            [PRODUCT_ENV.WORKTREE_BASE_PATH]: options.worktreeBasePath ?? '',
            [PRODUCT_ENV.WORKTREE_PATH]: options.worktreePath ?? options.rootPath
        })

        const startedAt = Date.now()
        let response: Awaited<ReturnType<SyncEngine['runBash']>>
        try {
            response = await options.engine.runBash(options.sessionId, {
                command,
                cwd,
                timeout: (check.timeoutSec ?? 300) * 1000
            })
        } catch (error) {
            const summary = error instanceof Error ? error.message : String(error)
            const failedCheck: MergeVerifyRunCheckResult = {
                command,
                cwd,
                status: 'failed',
                stdout: '',
                stderr: '',
                summary,
                durationMs: Date.now() - startedAt
            }
            results.push(failedCheck)
            return {
                ok: false,
                error: summary,
                failedCheck,
                checks: results
            }
        }

        const stdout = response.stdout ?? ''
        const stderr = response.stderr ?? ''
        const summary = summarizeCommandResult({
            command,
            stdout,
            stderr,
            error: response.success ? undefined : response.error
        })
        const result: MergeVerifyRunCheckResult = {
            command,
            cwd,
            status: response.success ? 'succeeded' : 'failed',
            stdout,
            stderr,
            summary,
            durationMs: Date.now() - startedAt
        }
        results.push(result)

        if (!response.success) {
            return {
                ok: false,
                error: summary,
                failedCheck: result,
                checks: results
            }
        }
    }

    return {
        ok: true,
        checks: results
    }
}

export function buildMergeConflictResolutionPrompt(options: {
    task: Pick<StoredTask, 'id' | 'title'>
    targetBranch: string
    sourceBranch: string | null
    rootPath: string | null
    worktreeBasePath?: string | null
    conflictFiles: string[]
    repairAttempt: number
    maxAttempts: number
    handoffNote?: string | null
}): string {
    const conflictList = options.conflictFiles.length > 0
        ? options.conflictFiles.map((file) => `- ${file}`).join('\n')
        : '- (Git did not report exact conflict paths; inspect merge stderr and repo state first.)'

    const lines = [
        options.handoffNote ?? null,
        'Platform merge found conflicts while landing this task.',
        '',
        `Task: ${options.task.title}`,
        `Task id: ${options.task.id}`,
        `Source branch: ${options.sourceBranch ?? '(inspect current branch first)'}`,
        `Target branch: ${options.targetBranch}`,
        options.rootPath
            ? `Working directory: ${options.rootPath}`
            : 'Working directory: inspect the linked worktree path before editing files.',
        options.worktreeBasePath ? `Base repo path: ${options.worktreeBasePath}` : null,
        `Repair attempt: ${options.repairAttempt} / ${options.maxAttempts}`,
        '',
        'Conflict files:',
        conflictList,
        '',
        'Repair rules:',
        '- Stay on the task source branch in this worktree. Do not switch this worktree to the target branch.',
        '- Inspect target-branch versions with safe read-only git commands when needed, for example `git show <target-branch>:path/to/file`.',
        '- Update the source branch so it can merge cleanly into the target branch on the next platform retry.',
        '- Resolve the real code conflict. Do not create or edit legacy merge scripts.',
        '- If the conflict needs product or human judgment, stop and explain the exact decision needed.',
        '',
        'Required outcome:',
        '- Source branch is updated and ready for HOPI to retry the platform merge.',
        '- Reply with a short summary of what changed or why you are blocked.'
    ]

    return lines.filter((line): line is string => Boolean(line)).join('\n')
}
