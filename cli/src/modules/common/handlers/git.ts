import { execFile, type ExecFileOptions } from 'child_process'
import { rm, writeFile } from 'fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'util'
import { PRODUCT_SLUG } from '@hopi/protocol/brand'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { resolveGitExecutable } from '@/utils/resolveGitExecutable'
import { readWorktreeEnv } from '@/utils/worktreeEnv'
import { formatMergeFailureMessage } from '../gitMergeConflictDetection'
import { validatePath } from '../pathSecurity'
import { rpcError } from '../rpcResponses'

const execFileAsync = promisify(execFile)

interface GitStatusRequest {
    cwd?: string
    timeout?: number
}

interface GitDiffNumstatRequest {
    cwd?: string
    staged?: boolean
    baseRef?: string
    timeout?: number
}

interface GitDiffFileRequest {
    cwd?: string
    filePath: string
    staged?: boolean
    baseRef?: string
    timeout?: number
}

interface GitCommandResponse {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

interface GitAutocommitWorktreeRequest {
    message: string
    timeout?: number
}

interface GitAutocommitWorktreeResponse {
    success: boolean
    commitHash?: string
    skippedReason?: 'clean'
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

interface GitMergeWorktreeRequest {
    targetBranch: string
    commitMessage: string
    strategy?: 'ff' | 'merge_commit' | 'squash'
    timeout?: number
}

interface GitMergeWorktreeResponse {
    success: boolean
    commitHash?: string
    skippedReason?: 'no_changes'
    conflictFiles?: string[]
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

interface GitRemoveWorktreeRequest {
    timeout?: number
}

interface GitRemoveWorktreeResponse {
    success: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

type MergeStrategy = 'ff' | 'merge_commit' | 'squash'

interface GitMergeWorktreeStateRequest {
    targetBranch: string
    timeout?: number
}

interface GitMergeWorktreeStateResponse {
    success: boolean
    targetBranch?: string
    sourceBranch?: string
    mergeBase?: string
    hasWorkingTreeChanges?: boolean
    committedChangedCount?: number
    mergeable?: boolean
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

interface GitCaptureWorktreeMergeSnapshotRequest {
    targetBranch: string
    timeout?: number
}

interface GitCaptureWorktreeMergeSnapshotResponse {
    success: boolean
    targetBranch?: string
    sourceBranch?: string
    mergeBase?: string
    snapshotRef?: string
    expectedChangeCount?: number
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

interface GitVerifyWorktreeMergeRequest {
    targetBranch: string
    mergeBase: string
    snapshotRef: string
    timeout?: number
}

interface GitVerifyWorktreeMergeResponse {
    success: boolean
    verified?: boolean
    targetBranch?: string
    mergeBase?: string
    snapshotRef?: string
    expectedChangeCount?: number
    targetHead?: string
    stdout?: string
    stderr?: string
    exitCode?: number
    error?: string
}

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'

function countNumstatChangedFiles(output: string): number {
    let changed = 0
    const lines = output.split('\n')
    for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line) continue
        if (!line.includes('\t')) continue
        changed += 1
    }
    return changed
}

function resolveCwd(requestedCwd: string | undefined, workingDirectory: string): { cwd: string; error?: string } {
    const cwd = requestedCwd ?? workingDirectory
    const validation = validatePath(cwd, workingDirectory)
    if (!validation.valid) {
        return { cwd, error: validation.error ?? 'Invalid working directory' }
    }
    return { cwd }
}

function validateFilePath(filePath: string, workingDirectory: string): string | null {
    const validation = validatePath(filePath, workingDirectory)
    if (!validation.valid) {
        return validation.error ?? 'Invalid file path'
    }
    return null
}

async function runGitCommand(
    args: string[],
    cwd: string,
    timeout?: number,
    env?: NodeJS.ProcessEnv
): Promise<GitCommandResponse> {
    try {
        const mergedEnv = env ? { ...process.env, ...env } : process.env
        const gitCommand = resolveGitExecutable(mergedEnv)
        const options: ExecFileOptions = {
            cwd,
            timeout: timeout ?? 10_000,
            env: mergedEnv
        }
        const { stdout, stderr } = await execFileAsync(gitCommand, args, options)
        return {
            success: true,
            stdout: stdout ? stdout.toString() : '',
            stderr: stderr ? stderr.toString() : '',
            exitCode: 0
        }
    } catch (error) {
        const execError = error as NodeJS.ErrnoException & {
            stdout?: string
            stderr?: string
            code?: number | string
            killed?: boolean
        }

        if (execError.code === 'ETIMEDOUT' || execError.killed) {
            return rpcError('Command timed out', {
                stdout: execError.stdout ? execError.stdout.toString() : '',
                stderr: execError.stderr ? execError.stderr.toString() : '',
                exitCode: typeof execError.code === 'number' ? execError.code : -1
            })
        }

        return rpcError(execError.message || 'Command failed', {
            stdout: execError.stdout ? execError.stdout.toString() : '',
            stderr: execError.stderr ? execError.stderr.toString() : execError.message || 'Command failed',
            exitCode: typeof execError.code === 'number' ? execError.code : 1
        })
    }
}

async function resolveCombinedDiffBase(cwd: string, timeout?: number): Promise<string> {
    const headResult = await runGitCommand(['rev-parse', '--verify', 'HEAD'], cwd, timeout)
    if (headResult.success) {
        return 'HEAD'
    }
    return EMPTY_TREE_HASH
}

function needsGitIdentity(message: string): boolean {
    const normalized = message.toLowerCase()
    return normalized.includes('please tell me who you are')
        || normalized.includes('unable to auto-detect email address')
        || normalized.includes('author identity unknown')
}

function normalizeBaseRef(raw: unknown): string | null {
    if (typeof raw !== 'string') return null
    const value = raw.trim()
    if (!value) return null
    if (!/^[0-9a-f]{7,64}$/i.test(value)) {
        return null
    }
    return value
}

function normalizeMergeStrategy(raw: unknown): MergeStrategy | null {
    if (raw === undefined) {
        return 'squash'
    }
    return raw === 'ff' || raw === 'merge_commit' || raw === 'squash'
        ? raw
        : null
}

async function autoCommitWorktreeIfNeeded(
    worktreePath: string,
    message: string,
    timeout: number
): Promise<GitAutocommitWorktreeResponse> {
    const conflictCheck = await runGitCommand(['diff', '--name-only', '--diff-filter=U'], worktreePath, timeout)
    if (!conflictCheck.success) {
        return conflictCheck
    }
    if ((conflictCheck.stdout ?? '').trim().length > 0) {
        return rpcError('Cannot auto-commit: merge conflicts detected', {
            stdout: conflictCheck.stdout,
            stderr: conflictCheck.stderr,
            exitCode: conflictCheck.exitCode
        })
    }

    const status = await runGitCommand(['status', '--porcelain'], worktreePath, timeout)
    if (!status.success) {
        return status
    }
    if ((status.stdout ?? '').trim().length === 0) {
        return { success: true, skippedReason: 'clean' }
    }

    const addResult = await runGitCommand(['add', '-A'], worktreePath, timeout)
    if (!addResult.success) {
        return addResult
    }

    const commitArgs = ['commit', '-m', message, '--no-gpg-sign', '--no-verify']
    let commitResult = await runGitCommand(commitArgs, worktreePath, timeout)
    if (!commitResult.success && needsGitIdentity(`${commitResult.stderr ?? ''}\n${commitResult.stdout ?? ''}\n${commitResult.error ?? ''}`)) {
        commitResult = await runGitCommand(
            ['-c', 'user.name=HOPI', '-c', 'user.email=hopi@local', ...commitArgs],
            worktreePath,
            timeout
        )
    }
    if (!commitResult.success) {
        return commitResult
    }

    const hashResult = await runGitCommand(['rev-parse', 'HEAD'], worktreePath, timeout)
    const commitHash = hashResult.success ? (hashResult.stdout ?? '').trim() : undefined

    return {
        success: true,
        commitHash: commitHash || undefined,
        stdout: commitResult.stdout,
        stderr: commitResult.stderr,
        exitCode: commitResult.exitCode
    }
}

function parseGitWorktreeEntries(raw: string): Array<{ path: string; branch: string | null }> {
    const entries: Array<{ path: string; branch: string | null }> = []
    const lines = raw.split('\n')

    let currentPath: string | null = null
    let currentBranch: string | null = null

    const flush = () => {
        if (!currentPath) {
            return
        }
        entries.push({ path: currentPath, branch: currentBranch })
        currentPath = null
        currentBranch = null
    }

    for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed.length === 0) {
            flush()
            continue
        }

        if (line.startsWith('worktree ')) {
            flush()
            currentPath = line.slice('worktree '.length).trim()
            continue
        }

        if (line.startsWith('branch ')) {
            currentBranch = line.slice('branch '.length).trim()
        }
    }

    flush()
    return entries
}

async function createIsolatedTargetWorktreeContext(
    basePath: string,
    targetBranch: string,
    timeout: number,
    options?: {
        detached?: boolean
    }
): Promise<
    | {
        ok: true
        path: string
        cleanup: () => Promise<void>
    }
    | {
        ok: false
        error: GitCommandResponse
    }
> {
    const safeBranch = targetBranch.replace(/[^a-zA-Z0-9._-]/g, '-')
    const tempPath = join(tmpdir(), `${PRODUCT_SLUG}-merge-target-${safeBranch}-${Date.now()}`)
    const addArgs = options?.detached === true
        ? ['worktree', 'add', '--detach', tempPath, targetBranch]
        : ['worktree', 'add', tempPath, targetBranch]
    const addWorktree = await runGitCommand(addArgs, basePath, timeout)
    if (!addWorktree.success) {
        return { ok: false, error: addWorktree }
    }

    return {
        ok: true,
        path: tempPath,
        cleanup: async () => {
            await runGitCommand(['worktree', 'remove', '--force', tempPath], basePath, timeout)
        }
    }
}

async function resolveMergeTargetContext(
    basePath: string,
    targetBranch: string,
    timeout: number
): Promise<
    | {
        ok: true
        path: string
        cleanup: () => Promise<void>
    }
    | {
        ok: false
        error: GitCommandResponse
    }
> {
    const worktreeList = await runGitCommand(['worktree', 'list', '--porcelain'], basePath, timeout)
    if (!worktreeList.success) {
        return { ok: false, error: worktreeList }
    }

    const targetRef = `refs/heads/${targetBranch}`
    const entries = parseGitWorktreeEntries(worktreeList.stdout ?? '')
    for (const entry of entries) {
        if (entry.branch === targetRef && entry.path.trim().length > 0) {
            return {
                ok: true,
                path: entry.path,
                cleanup: async () => {}
            }
        }
    }

    return await createIsolatedTargetWorktreeContext(basePath, targetBranch, timeout)
}

async function ensureBranchExists(basePath: string, branch: string, timeout: number): Promise<GitCommandResponse> {
    return await runGitCommand(['show-ref', '--verify', `refs/heads/${branch}`], basePath, timeout)
}

async function resolveMergeBase(basePath: string, targetBranch: string, sourceRef: string, timeout: number): Promise<
    | { ok: true; mergeBase: string }
    | { ok: false; error: GitCommandResponse }
> {
    const mergeBaseResult = await runGitCommand(['merge-base', targetBranch, sourceRef], basePath, timeout)
    if (!mergeBaseResult.success) {
        return {
            ok: false,
            error: rpcError(`Failed to resolve merge base between '${targetBranch}' and '${sourceRef}'`, {
                stdout: mergeBaseResult.stdout,
                stderr: mergeBaseResult.stderr,
                exitCode: mergeBaseResult.exitCode
            })
        }
    }

    const mergeBase = (mergeBaseResult.stdout ?? '').trim()
    if (!mergeBase) {
        return {
            ok: false,
            error: rpcError(`Failed to resolve merge base between '${targetBranch}' and '${sourceRef}'`)
        }
    }

    return { ok: true, mergeBase }
}

async function cleanupFailedMergeAttempt(mergeTargetPath: string, timeout: number): Promise<void> {
    const mergeHead = await runGitCommand(['rev-parse', '--verify', '-q', 'MERGE_HEAD'], mergeTargetPath, timeout)
    if (mergeHead.success) {
        await runGitCommand(['merge', '--abort'], mergeTargetPath, timeout)
        return
    }

    await runGitCommand(['reset', '--hard'], mergeTargetPath, timeout)
}

async function createWorktreeVerificationSnapshotRef(worktreePath: string, timeout: number): Promise<
    | { ok: true; snapshotRef: string }
    | { ok: false; error: GitCommandResponse }
> {
    const tempIndexPath = join(tmpdir(), `${PRODUCT_SLUG}-merge-snapshot-${Date.now()}-${Math.random().toString(16).slice(2)}.index`)
    const tempEnv = { GIT_INDEX_FILE: tempIndexPath }

    try {
        const readTree = await runGitCommand(['read-tree', 'HEAD'], worktreePath, timeout, tempEnv)
        if (!readTree.success) {
            return { ok: false, error: readTree }
        }

        const addResult = await runGitCommand(['add', '-A'], worktreePath, timeout, tempEnv)
        if (!addResult.success) {
            return { ok: false, error: addResult }
        }

        const writeTreeResult = await runGitCommand(['write-tree'], worktreePath, timeout, tempEnv)
        if (!writeTreeResult.success) {
            return { ok: false, error: writeTreeResult }
        }

        const treeRef = (writeTreeResult.stdout ?? '').trim()
        if (!treeRef) {
            return { ok: false, error: rpcError('Failed to create merge verification tree') }
        }

        const snapshotResult = await runGitCommand(
            ['commit-tree', treeRef, '-p', 'HEAD', '-m', 'HOPI merge verification snapshot'],
            worktreePath,
            timeout,
            tempEnv
        )
        if (!snapshotResult.success) {
            return { ok: false, error: snapshotResult }
        }

        const snapshotRef = (snapshotResult.stdout ?? '').trim()
        if (!snapshotRef) {
            return { ok: false, error: rpcError('Failed to create merge verification snapshot') }
        }

        return { ok: true, snapshotRef }
    } finally {
        await rm(tempIndexPath, { force: true }).catch(() => undefined)
    }
}

async function countDiffChangedFiles(basePath: string, fromRef: string, toRef: string, timeout: number): Promise<
    | { ok: true; changedCount: number }
    | { ok: false; error: GitCommandResponse }
> {
    const diffResult = await runGitCommand(['diff', '--numstat', `${fromRef}..${toRef}`], basePath, timeout)
    if (!diffResult.success) {
        return { ok: false, error: diffResult }
    }

    return {
        ok: true,
        changedCount: countNumstatChangedFiles(diffResult.stdout ?? '')
    }
}

async function captureWorktreeMergeSnapshot(options: {
    basePath: string
    worktreePath: string
    sourceBranch: string
    targetBranch: string
    timeout: number
}): Promise<GitCaptureWorktreeMergeSnapshotResponse> {
    const targetExists = await ensureBranchExists(options.basePath, options.targetBranch, options.timeout)
    if (!targetExists.success) {
        return rpcError(`Target branch '${options.targetBranch}' not found`, {
            stdout: targetExists.stdout,
            stderr: targetExists.stderr,
            exitCode: targetExists.exitCode
        })
    }

    const sourceExists = await ensureBranchExists(options.basePath, options.sourceBranch, options.timeout)
    if (!sourceExists.success) {
        return rpcError(`Worktree branch '${options.sourceBranch}' not found`, {
            stdout: sourceExists.stdout,
            stderr: sourceExists.stderr,
            exitCode: sourceExists.exitCode
        })
    }

    const mergeBaseResult = await resolveMergeBase(options.basePath, options.targetBranch, options.sourceBranch, options.timeout)
    if (!mergeBaseResult.ok) {
        return mergeBaseResult.error
    }

    const snapshotResult = await createWorktreeVerificationSnapshotRef(options.worktreePath, options.timeout)
    if (!snapshotResult.ok) {
        return snapshotResult.error
    }

    const changedCountResult = await countDiffChangedFiles(
        options.basePath,
        mergeBaseResult.mergeBase,
        snapshotResult.snapshotRef,
        options.timeout
    )
    if (!changedCountResult.ok) {
        return changedCountResult.error
    }

    return {
        success: true,
        targetBranch: options.targetBranch,
        sourceBranch: options.sourceBranch,
        mergeBase: mergeBaseResult.mergeBase,
        snapshotRef: snapshotResult.snapshotRef,
        expectedChangeCount: changedCountResult.changedCount
    }
}

async function verifyWorktreeMergeSnapshot(options: {
    basePath: string
    targetBranch: string
    mergeBase: string
    snapshotRef: string
    timeout: number
}): Promise<GitVerifyWorktreeMergeResponse> {
    const targetExists = await ensureBranchExists(options.basePath, options.targetBranch, options.timeout)
    if (!targetExists.success) {
        return rpcError(`Target branch '${options.targetBranch}' not found`, {
            stdout: targetExists.stdout,
            stderr: targetExists.stderr,
            exitCode: targetExists.exitCode
        })
    }

    const mergeBaseExists = await runGitCommand(['rev-parse', '--verify', options.mergeBase], options.basePath, options.timeout)
    if (!mergeBaseExists.success) {
        return rpcError(`Merge verification base '${options.mergeBase}' not found`, {
            stdout: mergeBaseExists.stdout,
            stderr: mergeBaseExists.stderr,
            exitCode: mergeBaseExists.exitCode
        })
    }

    const snapshotExists = await runGitCommand(['rev-parse', '--verify', options.snapshotRef], options.basePath, options.timeout)
    if (!snapshotExists.success) {
        return rpcError(`Merge verification snapshot '${options.snapshotRef}' not found`, {
            stdout: snapshotExists.stdout,
            stderr: snapshotExists.stderr,
            exitCode: snapshotExists.exitCode
        })
    }

    const changedCountResult = await countDiffChangedFiles(
        options.basePath,
        options.mergeBase,
        options.snapshotRef,
        options.timeout
    )
    if (!changedCountResult.ok) {
        return changedCountResult.error
    }

    const targetContext = await createIsolatedTargetWorktreeContext(options.basePath, options.targetBranch, options.timeout, {
        detached: true
    })
    if (!targetContext.ok) {
        return targetContext.error
    }

    const patchPath = join(tmpdir(), `${PRODUCT_SLUG}-merge-verify-${Date.now()}-${Math.random().toString(16).slice(2)}.patch`)

    try {
        const targetStatus = await runGitCommand(['status', '--porcelain'], targetContext.path, options.timeout)
        if (!targetStatus.success) {
            return targetStatus
        }
        if ((targetStatus.stdout ?? '').trim().length > 0) {
            return rpcError('Base repository has uncommitted changes; commit/stash first', {
                stdout: targetStatus.stdout,
                stderr: targetStatus.stderr,
                exitCode: targetStatus.exitCode
            })
        }

        const targetHeadResult = await runGitCommand(['rev-parse', 'HEAD'], targetContext.path, options.timeout)
        const targetHead = targetHeadResult.success ? (targetHeadResult.stdout ?? '').trim() : undefined

        if (changedCountResult.changedCount === 0) {
            return {
                success: true,
                verified: true,
                targetBranch: options.targetBranch,
                mergeBase: options.mergeBase,
                snapshotRef: options.snapshotRef,
                expectedChangeCount: 0,
                targetHead
            }
        }

        const patchResult = await runGitCommand(['diff', '--binary', `${options.mergeBase}..${options.snapshotRef}`], options.basePath, options.timeout)
        if (!patchResult.success) {
            return patchResult
        }

        await writeFile(patchPath, patchResult.stdout ?? '', 'utf8')
        const reverseCheck = await runGitCommand(['apply', '--reverse', '--check', '--3way', patchPath], targetContext.path, options.timeout)
        if (!reverseCheck.success) {
            return {
                success: true,
                verified: false,
                targetBranch: options.targetBranch,
                mergeBase: options.mergeBase,
                snapshotRef: options.snapshotRef,
                expectedChangeCount: changedCountResult.changedCount,
                targetHead,
                stdout: reverseCheck.stdout,
                stderr: reverseCheck.stderr,
                exitCode: reverseCheck.exitCode,
                error: 'Target branch does not contain the expected worktree changes'
            }
        }

        return {
            success: true,
            verified: true,
            targetBranch: options.targetBranch,
            mergeBase: options.mergeBase,
            snapshotRef: options.snapshotRef,
            expectedChangeCount: changedCountResult.changedCount,
            targetHead
        }
    } finally {
        await rm(patchPath, { force: true }).catch(() => undefined)
        await targetContext.cleanup()
    }
}

export function registerGitHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<GitStatusRequest, GitCommandResponse>('git-status', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        return await runGitCommand(
            ['status', '--porcelain=v2', '--branch', '--untracked-files=all'],
            resolved.cwd,
            data.timeout
        )
    })

    rpcHandlerManager.registerHandler<GitDiffNumstatRequest, GitCommandResponse>('git-diff-numstat', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        const baseRef = normalizeBaseRef(data.baseRef)
        if (data.baseRef !== undefined && !baseRef) {
            return rpcError('Invalid base reference')
        }

        const combinedBase = !baseRef && data.staged === undefined
            ? await resolveCombinedDiffBase(resolved.cwd, data.timeout)
            : null

        const args = baseRef
            ? ['diff', '--numstat', baseRef]
            : data.staged === true
                ? ['diff', '--cached', '--numstat']
                : data.staged === false
                    ? ['diff', '--numstat']
                    : ['diff', '--numstat', combinedBase ?? 'HEAD']
        return await runGitCommand(args, resolved.cwd, data.timeout)
    })

    rpcHandlerManager.registerHandler<GitAutocommitWorktreeRequest, GitAutocommitWorktreeResponse>('git-autocommit-worktree', async (data) => {
        const worktree = readWorktreeEnv()
        if (!worktree) {
            return rpcError('Not a worktree session')
        }

        const message = typeof data.message === 'string' ? data.message.trim() : ''
        if (!message) {
            return rpcError('Commit message required')
        }

        const timeout = data.timeout ?? 30_000
        return await autoCommitWorktreeIfNeeded(worktree.worktreePath, message, timeout)
    })

    rpcHandlerManager.registerHandler<GitMergeWorktreeStateRequest, GitMergeWorktreeStateResponse>('git-merge-worktree-state', async (data) => {
        const worktree = readWorktreeEnv()
        if (!worktree) {
            return rpcError('Not a worktree session')
        }

        const targetBranch = typeof data.targetBranch === 'string' ? data.targetBranch.trim() : ''
        if (!targetBranch) {
            return rpcError('Target branch required')
        }

        const timeout = data.timeout ?? 30_000

        const ensureBranch = async (branch: string): Promise<GitCommandResponse> => {
            return await runGitCommand(['show-ref', '--verify', `refs/heads/${branch}`], worktree.basePath, timeout)
        }

        const targetExists = await ensureBranch(targetBranch)
        if (!targetExists.success) {
            return rpcError(`Target branch '${targetBranch}' not found`, {
                stdout: targetExists.stdout,
                stderr: targetExists.stderr,
                exitCode: targetExists.exitCode
            })
        }

        const sourceExists = await ensureBranch(worktree.branch)
        if (!sourceExists.success) {
            return rpcError(`Worktree branch '${worktree.branch}' not found`, {
                stdout: sourceExists.stdout,
                stderr: sourceExists.stderr,
                exitCode: sourceExists.exitCode
            })
        }

        const status = await runGitCommand(['status', '--porcelain'], worktree.worktreePath, timeout)
        if (!status.success) {
            return status
        }
        const hasWorkingTreeChanges = (status.stdout ?? '').trim().length > 0

        const mergeBaseResult = await runGitCommand(['merge-base', targetBranch, worktree.branch], worktree.basePath, timeout)
        if (!mergeBaseResult.success) {
            return rpcError(`Failed to resolve merge base between '${targetBranch}' and '${worktree.branch}'`, {
                stdout: mergeBaseResult.stdout,
                stderr: mergeBaseResult.stderr,
                exitCode: mergeBaseResult.exitCode
            })
        }

        const mergeBase = (mergeBaseResult.stdout ?? '').trim()
        if (!mergeBase) {
            return rpcError(`Failed to resolve merge base between '${targetBranch}' and '${worktree.branch}'`)
        }

        const diff = await runGitCommand(['diff', '--numstat', `${mergeBase}..${worktree.branch}`], worktree.basePath, timeout)
        if (!diff.success) {
            return diff
        }

        const committedChangedCount = countNumstatChangedFiles(diff.stdout ?? '')
        const mergeable = hasWorkingTreeChanges || committedChangedCount > 0

        return {
            success: true,
            targetBranch,
            sourceBranch: worktree.branch,
            mergeBase,
            hasWorkingTreeChanges,
            committedChangedCount,
            mergeable
        }
    })

    rpcHandlerManager.registerHandler<GitCaptureWorktreeMergeSnapshotRequest, GitCaptureWorktreeMergeSnapshotResponse>('git-capture-worktree-merge-snapshot', async (data) => {
        const worktree = readWorktreeEnv()
        if (!worktree) {
            return rpcError('Not a worktree session')
        }

        const targetBranch = typeof data.targetBranch === 'string' ? data.targetBranch.trim() : ''
        if (!targetBranch) {
            return rpcError('Target branch required')
        }

        const timeout = data.timeout ?? 60_000
        return await captureWorktreeMergeSnapshot({
            basePath: worktree.basePath,
            worktreePath: worktree.worktreePath,
            sourceBranch: worktree.branch,
            targetBranch,
            timeout
        })
    })

    rpcHandlerManager.registerHandler<GitVerifyWorktreeMergeRequest, GitVerifyWorktreeMergeResponse>('git-verify-worktree-merge', async (data) => {
        const worktree = readWorktreeEnv()
        if (!worktree) {
            return rpcError('Not a worktree session')
        }

        const targetBranch = typeof data.targetBranch === 'string' ? data.targetBranch.trim() : ''
        if (!targetBranch) {
            return rpcError('Target branch required')
        }

        const mergeBase = normalizeBaseRef(data.mergeBase)
        if (!mergeBase) {
            return rpcError('Merge base required')
        }

        const snapshotRef = normalizeBaseRef(data.snapshotRef)
        if (!snapshotRef) {
            return rpcError('Snapshot reference required')
        }

        const timeout = data.timeout ?? 60_000
        return await verifyWorktreeMergeSnapshot({
            basePath: worktree.basePath,
            targetBranch,
            mergeBase,
            snapshotRef,
            timeout
        })
    })

    rpcHandlerManager.registerHandler<GitMergeWorktreeRequest, GitMergeWorktreeResponse>('git-merge-worktree', async (data) => {
        const worktree = readWorktreeEnv()
        if (!worktree) {
            return rpcError('Not a worktree session')
        }

        const targetBranch = typeof data.targetBranch === 'string' ? data.targetBranch.trim() : ''
        if (!targetBranch) {
            return rpcError('Target branch required')
        }

        const commitMessage = typeof data.commitMessage === 'string' ? data.commitMessage.trim() : ''
        if (!commitMessage) {
            return rpcError('Commit message required')
        }

        const strategy = normalizeMergeStrategy(data.strategy)
        if (!strategy) {
            return rpcError('Invalid merge strategy')
        }

        const timeout = data.timeout ?? 60_000

        const autoCommit = await autoCommitWorktreeIfNeeded(worktree.worktreePath, commitMessage, timeout)
        if (!autoCommit.success) {
            return rpcError(autoCommit.error ?? 'Failed to auto-commit worktree changes before merge', {
                stdout: autoCommit.stdout,
                stderr: autoCommit.stderr,
                exitCode: autoCommit.exitCode
            })
        }

        const ensureBranch = async (branch: string): Promise<GitCommandResponse> => {
            return await runGitCommand(['show-ref', '--verify', `refs/heads/${branch}`], worktree.basePath, timeout)
        }

        const targetExists = await ensureBranch(targetBranch)
        if (!targetExists.success) {
            return rpcError(`Target branch '${targetBranch}' not found`, {
                stdout: targetExists.stdout,
                stderr: targetExists.stderr,
                exitCode: targetExists.exitCode
            })
        }

        const sourceExists = await ensureBranch(worktree.branch)
        if (!sourceExists.success) {
            return rpcError(`Worktree branch '${worktree.branch}' not found`, {
                stdout: sourceExists.stdout,
                stderr: sourceExists.stderr,
                exitCode: sourceExists.exitCode
            })
        }

        const targetContext = await resolveMergeTargetContext(worktree.basePath, targetBranch, timeout)
        if (!targetContext.ok) {
            return targetContext.error
        }

        const mergeTargetPath = targetContext.path
        const baseStatus = await runGitCommand(['status', '--porcelain'], mergeTargetPath, timeout)
        if (!baseStatus.success) {
            await targetContext.cleanup()
            return baseStatus
        }
        if ((baseStatus.stdout ?? '').trim().length > 0) {
            await targetContext.cleanup()
            return rpcError('Base repository has uncommitted changes; commit/stash first', {
                stdout: baseStatus.stdout,
                stderr: baseStatus.stderr,
                exitCode: baseStatus.exitCode
            })
        }

        const originalBranchResult = await runGitCommand(['symbolic-ref', '--short', 'HEAD'], mergeTargetPath, timeout)
        const originalBranch = originalBranchResult.success ? (originalBranchResult.stdout ?? '').trim() : ''

        const restoreBranch = async () => {
            if (!originalBranch || originalBranch === targetBranch) {
                return
            }
            await runGitCommand(['switch', originalBranch], mergeTargetPath, timeout)
        }

        try {
            if (originalBranch !== targetBranch) {
                const switchResult = await runGitCommand(['switch', targetBranch], mergeTargetPath, timeout)
                if (!switchResult.success) {
                    return switchResult
                }
            }

            const mergeArgs = strategy === 'ff'
                ? ['merge', '--ff-only', worktree.branch]
                : strategy === 'merge_commit'
                    ? ['merge', '--no-ff', '--no-commit', worktree.branch]
                    : ['merge', '--squash', worktree.branch]
            const mergeResult = await runGitCommand(mergeArgs, mergeTargetPath, timeout)
            if (!mergeResult.success) {
                const conflicts = await runGitCommand(['diff', '--name-only', '--diff-filter=U'], mergeTargetPath, timeout)
                await cleanupFailedMergeAttempt(mergeTargetPath, timeout)
                const conflictFiles = conflicts.success
                    ? (conflicts.stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
                    : []
                const message = formatMergeFailureMessage({
                    conflictFiles,
                    error: mergeResult.error,
                    stdout: mergeResult.stdout,
                    stderr: mergeResult.stderr
                })

                return rpcError(message, {
                    conflictFiles,
                    stdout: mergeResult.stdout,
                    stderr: mergeResult.stderr,
                    exitCode: mergeResult.exitCode
                })
            }

            if (strategy === 'ff') {
                const hashResult = await runGitCommand(['rev-parse', 'HEAD'], mergeTargetPath, timeout)
                const commitHash = hashResult.success ? (hashResult.stdout ?? '').trim() : undefined

                return {
                    success: true,
                    commitHash: commitHash || undefined,
                    stdout: mergeResult.stdout,
                    stderr: mergeResult.stderr,
                    exitCode: mergeResult.exitCode
                }
            }

            const staged = await runGitCommand(['diff', '--cached', '--name-only'], mergeTargetPath, timeout)
            if (!staged.success) {
                await cleanupFailedMergeAttempt(mergeTargetPath, timeout)
                return staged
            }
            if ((staged.stdout ?? '').trim().length === 0) {
                if (strategy === 'squash') {
                    await runGitCommand(['reset', '--hard'], mergeTargetPath, timeout)
                }
                return { success: true, skippedReason: 'no_changes' }
            }

            const commitArgs = ['commit', '-m', commitMessage, '--no-gpg-sign', '--no-verify']
            let commitResult = await runGitCommand(commitArgs, mergeTargetPath, timeout)
            if (!commitResult.success && needsGitIdentity(`${commitResult.stderr ?? ''}\n${commitResult.stdout ?? ''}\n${commitResult.error ?? ''}`)) {
                commitResult = await runGitCommand(
                    ['-c', 'user.name=HOPI', '-c', 'user.email=hopi@local', ...commitArgs],
                    mergeTargetPath,
                    timeout
                )
            }
            if (!commitResult.success) {
                await cleanupFailedMergeAttempt(mergeTargetPath, timeout)
                return commitResult
            }

            const hashResult = await runGitCommand(['rev-parse', 'HEAD'], mergeTargetPath, timeout)
            const commitHash = hashResult.success ? (hashResult.stdout ?? '').trim() : undefined

            return {
                success: true,
                commitHash: commitHash || undefined,
                stdout: commitResult.stdout,
                stderr: commitResult.stderr,
                exitCode: commitResult.exitCode
            }
        } finally {
            await restoreBranch()
            await targetContext.cleanup()
        }
    })

    rpcHandlerManager.registerHandler<GitRemoveWorktreeRequest, GitRemoveWorktreeResponse>('git-remove-worktree', async (data) => {
        const worktree = readWorktreeEnv()
        if (!worktree) {
            return rpcError('Not a worktree session')
        }

        const timeout = data.timeout ?? 60_000
        return await runGitCommand(['worktree', 'remove', '--force', worktree.worktreePath], worktree.basePath, timeout)
    })

    rpcHandlerManager.registerHandler<GitDiffFileRequest, GitCommandResponse>('git-diff-file', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        const fileError = validateFilePath(data.filePath, resolved.cwd)
        if (fileError) {
            return rpcError(fileError)
        }

        const baseRef = normalizeBaseRef(data.baseRef)
        if (data.baseRef !== undefined && !baseRef) {
            return rpcError('Invalid base reference')
        }

        const combinedBase = !baseRef && data.staged === undefined
            ? await resolveCombinedDiffBase(resolved.cwd, data.timeout)
            : null

        const args = baseRef
            ? ['diff', '--no-ext-diff', baseRef, '--', data.filePath]
            : data.staged === true
                ? ['diff', '--cached', '--no-ext-diff', '--', data.filePath]
                : data.staged === false
                    ? ['diff', '--no-ext-diff', '--', data.filePath]
                    : ['diff', '--no-ext-diff', combinedBase ?? 'HEAD', '--', data.filePath]
        return await runGitCommand(args, resolved.cwd, data.timeout)
    })
}
