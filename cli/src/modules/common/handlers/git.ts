import { execFile, type ExecFileOptions } from 'child_process'
import { promisify } from 'util'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { readWorktreeEnv } from '@/utils/worktreeEnv'
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
    timeout?: number
}

interface GitDiffFileRequest {
    cwd?: string
    filePath: string
    staged?: boolean
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

function needsGitIdentity(message: string): boolean {
    const normalized = message.toLowerCase()
    return normalized.includes('please tell me who you are')
        || normalized.includes('unable to auto-detect email address')
        || normalized.includes('author identity unknown')
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
        const args = data.staged
            ? ['diff', '--cached', '--numstat']
            : ['diff', '--numstat']
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

        const conflictCheck = await runGitCommand(['diff', '--name-only', '--diff-filter=U'], worktree.worktreePath, timeout)
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

        const status = await runGitCommand(['status', '--porcelain'], worktree.worktreePath, timeout)
        if (!status.success) {
            return status
        }
        if ((status.stdout ?? '').trim().length === 0) {
            return { success: true, skippedReason: 'clean' }
        }

        const addResult = await runGitCommand(['add', '-A'], worktree.worktreePath, timeout)
        if (!addResult.success) {
            return addResult
        }

        const commitArgs = ['commit', '-m', message, '--no-gpg-sign', '--no-verify']
        let commitResult = await runGitCommand(commitArgs, worktree.worktreePath, timeout)
        if (!commitResult.success && needsGitIdentity(`${commitResult.stderr ?? ''}\n${commitResult.stdout ?? ''}\n${commitResult.error ?? ''}`)) {
            commitResult = await runGitCommand(
                ['-c', 'user.name=HAPI', '-c', 'user.email=hapi@local', ...commitArgs],
                worktree.worktreePath,
                timeout
            )
        }
        if (!commitResult.success) {
            return commitResult
        }

        const hashResult = await runGitCommand(['rev-parse', 'HEAD'], worktree.worktreePath, timeout)
        const commitHash = hashResult.success ? (hashResult.stdout ?? '').trim() : undefined

        return {
            success: true,
            commitHash: commitHash || undefined,
            stdout: commitResult.stdout,
            stderr: commitResult.stderr,
            exitCode: commitResult.exitCode
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

        const baseStatus = await runGitCommand(['status', '--porcelain'], worktree.basePath, timeout)
        if (!baseStatus.success) {
            return baseStatus
        }
        if ((baseStatus.stdout ?? '').trim().length > 0) {
            return rpcError('Base repository has uncommitted changes; commit/stash first', {
                stdout: baseStatus.stdout,
                stderr: baseStatus.stderr,
                exitCode: baseStatus.exitCode
            })
        }

        const worktreeStatus = await runGitCommand(['status', '--porcelain'], worktree.worktreePath, timeout)
        if (!worktreeStatus.success) {
            return worktreeStatus
        }
        if ((worktreeStatus.stdout ?? '').trim().length > 0) {
            return rpcError('Worktree has uncommitted changes; wait for auto-commit or commit manually', {
                stdout: worktreeStatus.stdout,
                stderr: worktreeStatus.stderr,
                exitCode: worktreeStatus.exitCode
            })
        }

        const originalBranchResult = await runGitCommand(['symbolic-ref', '--short', 'HEAD'], worktree.basePath, timeout)
        const originalBranch = originalBranchResult.success ? (originalBranchResult.stdout ?? '').trim() : ''

        const ensureBranch = async (branch: string): Promise<GitCommandResponse> => {
            return await runGitCommand(['show-ref', '--verify', `refs/heads/${branch}`], worktree.basePath, timeout)
        }

        const restoreBranch = async () => {
            if (!originalBranch || originalBranch === targetBranch) {
                return
            }
            await runGitCommand(['switch', originalBranch], worktree.basePath, timeout)
        }

        try {
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

            const switchResult = await runGitCommand(['switch', targetBranch], worktree.basePath, timeout)
            if (!switchResult.success) {
                return switchResult
            }

            const mergeResult = await runGitCommand(['merge', '--squash', worktree.branch], worktree.basePath, timeout)
            if (!mergeResult.success) {
                const conflicts = await runGitCommand(['diff', '--name-only', '--diff-filter=U'], worktree.basePath, timeout)
                await runGitCommand(['reset', '--hard'], worktree.basePath, timeout)
                const conflictFiles = conflicts.success
                    ? (conflicts.stdout ?? '').split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
                    : []
                const message = conflictFiles.length > 0
                    ? 'Merge conflicts detected; manual resolution required'
                    : mergeResult.error ?? mergeResult.stderr ?? 'Merge failed'

                return rpcError(message, {
                    conflictFiles,
                    stdout: mergeResult.stdout,
                    stderr: mergeResult.stderr,
                    exitCode: mergeResult.exitCode
                })
            }

            const staged = await runGitCommand(['diff', '--cached', '--name-only'], worktree.basePath, timeout)
            if (!staged.success) {
                await runGitCommand(['reset', '--hard'], worktree.basePath, timeout)
                return staged
            }
            if ((staged.stdout ?? '').trim().length === 0) {
                await runGitCommand(['reset', '--hard'], worktree.basePath, timeout)
                return { success: true, skippedReason: 'no_changes' }
            }

            const commitArgs = ['commit', '-m', commitMessage, '--no-gpg-sign', '--no-verify']
            let commitResult = await runGitCommand(commitArgs, worktree.basePath, timeout)
            if (!commitResult.success && needsGitIdentity(`${commitResult.stderr ?? ''}\n${commitResult.stdout ?? ''}\n${commitResult.error ?? ''}`)) {
                commitResult = await runGitCommand(
                    ['-c', 'user.name=HAPI', '-c', 'user.email=hapi@local', ...commitArgs],
                    worktree.basePath,
                    timeout
                )
            }
            if (!commitResult.success) {
                await runGitCommand(['reset', '--hard'], worktree.basePath, timeout)
                return commitResult
            }

            const hashResult = await runGitCommand(['rev-parse', 'HEAD'], worktree.basePath, timeout)
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

        const args = data.staged
            ? ['diff', '--cached', '--no-ext-diff', '--', data.filePath]
            : ['diff', '--no-ext-diff', '--', data.filePath]
        return await runGitCommand(args, resolved.cwd, data.timeout)
    })
}
