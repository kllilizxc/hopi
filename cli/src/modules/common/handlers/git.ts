import { execFile, type ExecFileOptions } from 'child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'util'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
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
    timeout?: number
): Promise<GitCommandResponse> {
    try {
        const options: ExecFileOptions = {
            cwd,
            timeout: timeout ?? 10_000
        }
        const { stdout, stderr } = await execFileAsync('git', args, options)
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
            ['-c', 'user.name=HAPI', '-c', 'user.email=hapi@local', ...commitArgs],
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

    const safeBranch = targetBranch.replace(/[^a-zA-Z0-9._-]/g, '-')
    const tempPath = join(tmpdir(), `hapi-merge-target-${safeBranch}-${Date.now()}`)
    const addWorktree = await runGitCommand(['worktree', 'add', tempPath, targetBranch], basePath, timeout)
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

            const mergeResult = await runGitCommand(['merge', '--squash', worktree.branch], mergeTargetPath, timeout)
            if (!mergeResult.success) {
                const conflicts = await runGitCommand(['diff', '--name-only', '--diff-filter=U'], mergeTargetPath, timeout)
                await runGitCommand(['reset', '--hard'], mergeTargetPath, timeout)
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

            const staged = await runGitCommand(['diff', '--cached', '--name-only'], mergeTargetPath, timeout)
            if (!staged.success) {
                await runGitCommand(['reset', '--hard'], mergeTargetPath, timeout)
                return staged
            }
            if ((staged.stdout ?? '').trim().length === 0) {
                await runGitCommand(['reset', '--hard'], mergeTargetPath, timeout)
                return { success: true, skippedReason: 'no_changes' }
            }

            const commitArgs = ['commit', '-m', commitMessage, '--no-gpg-sign', '--no-verify']
            let commitResult = await runGitCommand(commitArgs, mergeTargetPath, timeout)
            if (!commitResult.success && needsGitIdentity(`${commitResult.stderr ?? ''}\n${commitResult.stdout ?? ''}\n${commitResult.error ?? ''}`)) {
                commitResult = await runGitCommand(
                    ['-c', 'user.name=HAPI', '-c', 'user.email=hapi@local', ...commitArgs],
                    mergeTargetPath,
                    timeout
                )
            }
            if (!commitResult.success) {
                await runGitCommand(['reset', '--hard'], mergeTargetPath, timeout)
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

    rpcHandlerManager.registerHandler<GitDiffFileRequest, GitCommandResponse>('git-diff-file', async (data) => {
        const resolved = resolveCwd(data.cwd, workingDirectory)
        if (resolved.error) {
            return rpcError(resolved.error)
        }
        const fileError = validateFilePath(data.filePath, workingDirectory)
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
