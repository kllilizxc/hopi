import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PRODUCT_ENV } from '@hopi/protocol/brand'
import { RpcHandlerManager } from '../../../api/rpc/RpcHandlerManager'
import { registerGitHandlers } from './git'

const execFileAsync = promisify(execFile)

async function createTempDir(prefix: string): Promise<string> {
    const dir = join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    await mkdir(dir, { recursive: true })
    return dir
}

async function runGit(cwd: string, args: string[]): Promise<string> {
    const { stdout } = await execFileAsync('git', args, { cwd })
    return stdout.toString().trim()
}

describe('git merge worktree RPC handler', () => {
    let baseDir = ''
    let worktreeDir = ''
    let previousEnv: Record<string, string | undefined> = {}

    beforeEach(async () => {
        baseDir = await createTempDir('hopi-git-merge-base')
        worktreeDir = await createTempDir('hopi-git-merge-worktree')

        await runGit(baseDir, ['init', '-b', 'main'])
        await writeFile(join(baseDir, 'README.md'), 'base\n')
        await runGit(baseDir, ['add', 'README.md'])
        await runGit(baseDir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'])
        await runGit(baseDir, ['worktree', 'add', '-b', 'task-branch', worktreeDir])

        await writeFile(join(worktreeDir, 'feature.txt'), 'feature\n')

        previousEnv = {
            [PRODUCT_ENV.WORKTREE_BASE_PATH]: process.env[PRODUCT_ENV.WORKTREE_BASE_PATH],
            [PRODUCT_ENV.WORKTREE_BRANCH]: process.env[PRODUCT_ENV.WORKTREE_BRANCH],
            [PRODUCT_ENV.WORKTREE_NAME]: process.env[PRODUCT_ENV.WORKTREE_NAME],
            [PRODUCT_ENV.WORKTREE_PATH]: process.env[PRODUCT_ENV.WORKTREE_PATH],
            [PRODUCT_ENV.WORKTREE_CREATED_AT]: process.env[PRODUCT_ENV.WORKTREE_CREATED_AT],
            [PRODUCT_ENV.WORKTREE_BASE_COMMIT]: process.env[PRODUCT_ENV.WORKTREE_BASE_COMMIT]
        }

        process.env[PRODUCT_ENV.WORKTREE_BASE_PATH] = baseDir
        process.env[PRODUCT_ENV.WORKTREE_BRANCH] = 'task-branch'
        process.env[PRODUCT_ENV.WORKTREE_NAME] = 'task-branch'
        process.env[PRODUCT_ENV.WORKTREE_PATH] = worktreeDir
        process.env[PRODUCT_ENV.WORKTREE_CREATED_AT] = String(Date.now())
        delete process.env[PRODUCT_ENV.WORKTREE_BASE_COMMIT]
    })

    afterEach(async () => {
        const keys = Object.keys(previousEnv)
        for (const key of keys) {
            const value = previousEnv[key]
            if (value === undefined) {
                delete process.env[key]
                continue
            }
            process.env[key] = value
        }

        if (baseDir) {
            await rm(baseDir, { recursive: true, force: true })
        }
        if (worktreeDir) {
            await rm(worktreeDir, { recursive: true, force: true })
        }
    })

    it('auto-commits worktree changes before merge', async () => {
        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerGitHandlers(rpc, worktreeDir)

        const response = await rpc.handleRequest({
            method: 'session-test:git-merge-worktree',
            params: JSON.stringify({
                targetBranch: 'main',
                commitMessage: 'HOPI: merge test'
            })
        })

        const parsed = JSON.parse(response) as { success: boolean; commitHash?: string; error?: string }
        expect(parsed.success).toBe(true)
        expect(parsed.error).toBeUndefined()
        expect(parsed.commitHash).toBeTruthy()

        const baseHeadMessage = await runGit(baseDir, ['log', '-1', '--pretty=%s', 'main'])
        expect(baseHeadMessage).toBe('HOPI: merge test')

        const worktreeStatus = await runGit(worktreeDir, ['status', '--porcelain'])
        expect(worktreeStatus).toBe('')

        const taskBranchHead = await runGit(baseDir, ['rev-parse', 'task-branch'])
        expect(taskBranchHead).toBeTruthy()
    })

    it('removes the current worktree through the git cleanup handler', async () => {
        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerGitHandlers(rpc, worktreeDir)

        const response = await rpc.handleRequest({
            method: 'session-test:git-remove-worktree',
            params: JSON.stringify({})
        })

        const parsed = JSON.parse(response) as { success: boolean; error?: string }
        expect(parsed.success).toBe(true)
        expect(parsed.error).toBeUndefined()

        const worktreeList = await runGit(baseDir, ['worktree', 'list', '--porcelain'])
        expect(worktreeList).not.toContain(worktreeDir)
    })

    it('captures snapshot and verifies merged target branch', async () => {
        const targetDir = join(baseDir, '.target-verification-worktree')
        await runGit(baseDir, ['worktree', 'add', '-b', 'dev', targetDir])

        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerGitHandlers(rpc, worktreeDir)

        const snapshotResponse = await rpc.handleRequest({
            method: 'session-test:git-capture-worktree-merge-snapshot',
            params: JSON.stringify({
                targetBranch: 'dev'
            })
        })

        const snapshot = JSON.parse(snapshotResponse) as {
            success: boolean
            mergeBase?: string
            snapshotRef?: string
            expectedChangeCount?: number
            error?: string
        }
        expect(snapshot.success).toBe(true)
        expect(snapshot.error).toBeUndefined()
        expect(snapshot.expectedChangeCount).toBeGreaterThan(0)

        const mergeBase = snapshot.mergeBase
        const snapshotRef = snapshot.snapshotRef
        expect(mergeBase).toBeTruthy()
        expect(snapshotRef).toBeTruthy()

        if (!mergeBase || !snapshotRef) {
            throw new Error('Expected merge snapshot references')
        }

        const mergeResponse = await rpc.handleRequest({
            method: 'session-test:git-merge-worktree',
            params: JSON.stringify({
                targetBranch: 'dev',
                commitMessage: 'HOPI: merge snapshot verification'
            })
        })

        const merge = JSON.parse(mergeResponse) as { success: boolean; commitHash?: string; error?: string }
        expect(merge.success).toBe(true)
        expect(merge.error).toBeUndefined()
        expect(merge.commitHash).toBeTruthy()

        const verifyResponse = await rpc.handleRequest({
            method: 'session-test:git-verify-worktree-merge',
            params: JSON.stringify({
                targetBranch: 'dev',
                mergeBase,
                snapshotRef
            })
        })

        const verify = JSON.parse(verifyResponse) as {
            success: boolean
            verified?: boolean
            targetHead?: string
            error?: string
        }
        expect(verify.success).toBe(true)
        expect(verify.verified).toBe(true)
        expect(verify.error).toBeUndefined()

        const mergedHead = await runGit(targetDir, ['rev-parse', 'HEAD'])
        expect(mergedHead).toBe(merge.commitHash)
        expect(verify.targetHead).toBe(mergedHead)
    })


    it('verifies merged target branch even when target branch worktree is dirty', async () => {
        const targetDir = join(baseDir, '.target-verification-dirty-worktree')
        await runGit(baseDir, ['worktree', 'add', '-b', 'dev', targetDir])

        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerGitHandlers(rpc, worktreeDir)

        const snapshotResponse = await rpc.handleRequest({
            method: 'session-test:git-capture-worktree-merge-snapshot',
            params: JSON.stringify({
                targetBranch: 'dev'
            })
        })

        const snapshot = JSON.parse(snapshotResponse) as {
            success: boolean
            mergeBase?: string
            snapshotRef?: string
            expectedChangeCount?: number
            error?: string
        }
        expect(snapshot.success).toBe(true)
        expect(snapshot.error).toBeUndefined()
        expect(snapshot.expectedChangeCount).toBeGreaterThan(0)

        const mergeBase = snapshot.mergeBase
        const snapshotRef = snapshot.snapshotRef
        expect(mergeBase).toBeTruthy()
        expect(snapshotRef).toBeTruthy()

        if (!mergeBase || !snapshotRef) {
            throw new Error('Expected merge snapshot references')
        }

        const mergeResponse = await rpc.handleRequest({
            method: 'session-test:git-merge-worktree',
            params: JSON.stringify({
                targetBranch: 'dev',
                commitMessage: 'HOPI: merge dirty verification'
            })
        })

        const merge = JSON.parse(mergeResponse) as { success: boolean; commitHash?: string; error?: string }
        expect(merge.success).toBe(true)
        expect(merge.error).toBeUndefined()
        expect(merge.commitHash).toBeTruthy()

        await writeFile(join(targetDir, 'local-only.txt'), 'dirty target worktree\n')

        const verifyResponse = await rpc.handleRequest({
            method: 'session-test:git-verify-worktree-merge',
            params: JSON.stringify({
                targetBranch: 'dev',
                mergeBase,
                snapshotRef
            })
        })

        const verify = JSON.parse(verifyResponse) as {
            success: boolean
            verified?: boolean
            targetHead?: string
            error?: string
        }
        expect(verify.success).toBe(true)
        expect(verify.verified).toBe(true)
        expect(verify.error).toBeUndefined()
        expect(verify.targetHead).toBe(merge.commitHash)

        const dirtyStatus = await runGit(targetDir, ['status', '--porcelain'])
        expect(dirtyStatus).toContain('?? local-only.txt')
    })

    it('verifies merged target branch when unrelated target edits shift patch context', async () => {
        const contextWorktreeDir = await createTempDir('hopi-git-merge-context-worktree')

        try {
            await writeFile(join(baseDir, 'README.md'), 'a\nb old\nc\nd\ne\n')
            await runGit(baseDir, ['add', 'README.md'])
            await runGit(baseDir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'multiline base'])
            await runGit(baseDir, ['worktree', 'add', '-b', 'context-task', contextWorktreeDir])

            process.env[PRODUCT_ENV.WORKTREE_BASE_PATH] = baseDir
            process.env[PRODUCT_ENV.WORKTREE_BRANCH] = 'context-task'
            process.env[PRODUCT_ENV.WORKTREE_NAME] = 'context-task'
            process.env[PRODUCT_ENV.WORKTREE_PATH] = contextWorktreeDir

            await writeFile(join(contextWorktreeDir, 'README.md'), 'a\nb new\nc\nd\ne\n')
            await writeFile(join(baseDir, 'README.md'), 'a\nb old\nc\ntarget extra\nd\ne\n')
            await runGit(baseDir, ['add', 'README.md'])
            await runGit(baseDir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'target context'])

            const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
            registerGitHandlers(rpc, contextWorktreeDir)

            const snapshotResponse = await rpc.handleRequest({
                method: 'session-test:git-capture-worktree-merge-snapshot',
                params: JSON.stringify({
                    targetBranch: 'main'
                })
            })

            const snapshot = JSON.parse(snapshotResponse) as {
                success: boolean
                mergeBase?: string
                snapshotRef?: string
                error?: string
            }
            expect(snapshot.success).toBe(true)
            expect(snapshot.error).toBeUndefined()
            expect(snapshot.mergeBase).toBeTruthy()
            expect(snapshot.snapshotRef).toBeTruthy()

            const mergeResponse = await rpc.handleRequest({
                method: 'session-test:git-merge-worktree',
                params: JSON.stringify({
                    targetBranch: 'main',
                    commitMessage: 'HOPI: merge shifted context'
                })
            })

            const merge = JSON.parse(mergeResponse) as { success: boolean; commitHash?: string; error?: string }
            expect(merge.success).toBe(true)
            expect(merge.error).toBeUndefined()
            expect(merge.commitHash).toBeTruthy()

            const verifyResponse = await rpc.handleRequest({
                method: 'session-test:git-verify-worktree-merge',
                params: JSON.stringify({
                    targetBranch: 'main',
                    mergeBase: snapshot.mergeBase,
                    snapshotRef: snapshot.snapshotRef
                })
            })

            const verify = JSON.parse(verifyResponse) as {
                success: boolean
                verified?: boolean
                targetHead?: string
                error?: string
            }
            expect(verify.success).toBe(true)
            expect(verify.verified).toBe(true)
            expect(verify.error).toBeUndefined()
            expect(verify.targetHead).toBe(merge.commitHash)
        } finally {
            await runGit(baseDir, ['worktree', 'remove', '--force', contextWorktreeDir]).catch(() => undefined)
            await rm(contextWorktreeDir, { recursive: true, force: true })
        }
    })

    it('reports snapshot as unverified before merge', async () => {
        const targetDir = join(baseDir, '.target-verification-worktree')
        await runGit(baseDir, ['worktree', 'add', '-b', 'dev', targetDir])

        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerGitHandlers(rpc, worktreeDir)

        const snapshotResponse = await rpc.handleRequest({
            method: 'session-test:git-capture-worktree-merge-snapshot',
            params: JSON.stringify({
                targetBranch: 'dev'
            })
        })

        const snapshot = JSON.parse(snapshotResponse) as {
            success: boolean
            mergeBase?: string
            snapshotRef?: string
            error?: string
        }
        expect(snapshot.success).toBe(true)
        expect(snapshot.error).toBeUndefined()

        const mergeBase = snapshot.mergeBase
        const snapshotRef = snapshot.snapshotRef
        expect(mergeBase).toBeTruthy()
        expect(snapshotRef).toBeTruthy()

        if (!mergeBase || !snapshotRef) {
            throw new Error('Expected merge snapshot references')
        }

        const targetHeadBeforeVerify = await runGit(targetDir, ['rev-parse', 'HEAD'])

        const verifyResponse = await rpc.handleRequest({
            method: 'session-test:git-verify-worktree-merge',
            params: JSON.stringify({
                targetBranch: 'dev',
                mergeBase,
                snapshotRef
            })
        })

        const verify = JSON.parse(verifyResponse) as {
            success: boolean
            verified?: boolean
            targetHead?: string
            error?: string
        }
        expect(verify.success).toBe(true)
        expect(verify.verified).toBe(false)
        expect(verify.targetHead).toBe(targetHeadBeforeVerify)
    })

    it('merges via target branch worktree when branch is checked out elsewhere', async () => {
        const targetDir = join(baseDir, '.target-worktree')
        await runGit(baseDir, ['worktree', 'add', '-b', 'dev', targetDir])

        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerGitHandlers(rpc, worktreeDir)

        const response = await rpc.handleRequest({
            method: 'session-test:git-merge-worktree',
            params: JSON.stringify({
                targetBranch: 'dev',
                commitMessage: 'HOPI: merge into dev'
            })
        })

        const parsed = JSON.parse(response) as { success: boolean; commitHash?: string; error?: string }
        expect(parsed.success).toBe(true)
        expect(parsed.error).toBeUndefined()
        expect(parsed.commitHash).toBeTruthy()

        const targetHeadMessage = await runGit(targetDir, ['log', '-1', '--pretty=%s'])
        expect(targetHeadMessage).toBe('HOPI: merge into dev')
    })

    it('uses isolated target worktree when target branch is not checked out', async () => {
        await runGit(baseDir, ['branch', 'dev'])
        await writeFile(join(baseDir, 'runtime.log'), 'watcher file\n')

        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerGitHandlers(rpc, worktreeDir)

        const response = await rpc.handleRequest({
            method: 'session-test:git-merge-worktree',
            params: JSON.stringify({
                targetBranch: 'dev',
                commitMessage: 'HOPI: merge into isolated dev'
            })
        })

        const parsed = JSON.parse(response) as { success: boolean; commitHash?: string; error?: string }
        expect(parsed.success).toBe(true)
        expect(parsed.error).toBeUndefined()
        expect(parsed.commitHash).toBeTruthy()

        const targetHeadMessage = await runGit(baseDir, ['log', '-1', '--pretty=%s', 'dev'])
        expect(targetHeadMessage).toBe('HOPI: merge into isolated dev')

        const baseCurrentBranch = await runGit(baseDir, ['branch', '--show-current'])
        expect(baseCurrentBranch).toBe('main')

        const baseStatus = await runGit(baseDir, ['status', '--porcelain'])
        expect(baseStatus).toContain('?? runtime.log')
    })

    it('merges via target branch worktree when branch is checked out elsewhere', async () => {
        const targetDir = join(baseDir, '.target-worktree')
        await runGit(baseDir, ['worktree', 'add', '-b', 'dev', targetDir])

        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerGitHandlers(rpc, worktreeDir)

        const response = await rpc.handleRequest({
            method: 'session-test:git-merge-worktree',
            params: JSON.stringify({
                targetBranch: 'dev',
                commitMessage: 'HOPI: merge into dev'
            })
        })

        const parsed = JSON.parse(response) as { success: boolean; commitHash?: string; error?: string }
        expect(parsed.success).toBe(true)
        expect(parsed.error).toBeUndefined()
        expect(parsed.commitHash).toBeTruthy()

        const targetHeadMessage = await runGit(targetDir, ['log', '-1', '--pretty=%s'])
        expect(targetHeadMessage).toBe('HOPI: merge into dev')
    })

    it('returns normalized conflict message when merge fails with conflicts', async () => {
        await writeFile(join(worktreeDir, 'README.md'), 'worktree change\n')
        await writeFile(join(baseDir, 'README.md'), 'main change\n')
        await runGit(baseDir, ['add', 'README.md'])
        await runGit(baseDir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'main edit'])

        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerGitHandlers(rpc, worktreeDir)

        const response = await rpc.handleRequest({
            method: 'session-test:git-merge-worktree',
            params: JSON.stringify({
                targetBranch: 'main',
                commitMessage: 'HOPI: merge conflict test'
            })
        })

        const parsed = JSON.parse(response) as {
            success: boolean
            conflictFiles?: string[]
            error?: string
        }
        expect(parsed.success).toBe(false)
        expect(parsed.error).toBe('Merge conflicts detected; manual resolution required')
        expect(parsed.conflictFiles).toContain('README.md')
    })
})

describe('git diff RPC handlers', () => {
    let repoDir = ''
    let initialCommit = ''
    let rpc: RpcHandlerManager

    beforeEach(async () => {
        repoDir = await createTempDir('hopi-git-diff')

        await runGit(repoDir, ['init', '-b', 'main'])
        await writeFile(join(repoDir, 'staged.txt'), 'base staged\n')
        await writeFile(join(repoDir, 'unstaged.txt'), 'base unstaged\n')
        await runGit(repoDir, ['add', 'staged.txt', 'unstaged.txt'])
        await runGit(repoDir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'])
        initialCommit = await runGit(repoDir, ['rev-parse', 'HEAD'])

        await writeFile(join(repoDir, 'staged.txt'), 'base staged\nstaged change\n')
        await writeFile(join(repoDir, 'unstaged.txt'), 'base unstaged\nunstaged change\n')
        await runGit(repoDir, ['add', 'staged.txt'])

        rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerGitHandlers(rpc, repoDir)
    })

    afterEach(async () => {
        if (repoDir) {
            await rm(repoDir, { recursive: true, force: true })
        }
    })

    async function callGitHandler(method: string, params: Record<string, unknown>) {
        const response = await rpc.handleRequest({
            method: `session-test:${method}`,
            params: JSON.stringify(params)
        })
        return JSON.parse(response) as {
            success: boolean
            stdout?: string
            stderr?: string
            error?: string
        }
    }

    it('returns both staged and unstaged changes when staged filter is omitted', async () => {
        const result = await callGitHandler('git-diff-numstat', { cwd: repoDir })

        expect(result.success).toBe(true)
        expect(result.stdout).toContain('staged.txt')
        expect(result.stdout).toContain('unstaged.txt')
    })

    it('compares baseRef against current working tree changes', async () => {
        const result = await callGitHandler('git-diff-numstat', {
            cwd: repoDir,
            baseRef: initialCommit
        })

        expect(result.success).toBe(true)
        expect(result.stdout).toContain('staged.txt')
        expect(result.stdout).toContain('unstaged.txt')
    })

    it('compares baseRef against targetRef without including later working tree changes', async () => {
        await runGit(repoDir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'target'])
        const targetCommit = await runGit(repoDir, ['rev-parse', 'HEAD'])

        const numstatResult = await callGitHandler('git-diff-numstat', {
            cwd: repoDir,
            baseRef: initialCommit,
            targetRef: targetCommit
        })
        const fileResult = await callGitHandler('git-diff-file', {
            cwd: repoDir,
            filePath: 'unstaged.txt',
            baseRef: initialCommit,
            targetRef: targetCommit
        })

        expect(numstatResult.success).toBe(true)
        expect(numstatResult.stdout).toContain('staged.txt')
        expect(numstatResult.stdout).not.toContain('unstaged.txt')

        expect(fileResult.success).toBe(true)
        expect((fileResult.stdout ?? '').trim()).toBe('')
    })

    it('still supports explicit staged and unstaged filters', async () => {
        const stagedResult = await callGitHandler('git-diff-numstat', { cwd: repoDir, staged: true })
        const unstagedResult = await callGitHandler('git-diff-numstat', { cwd: repoDir, staged: false })
        const stagedFiles = (stagedResult.stdout ?? '').trim().split('\n').filter(Boolean).map((line) => line.split('\t').at(-1) ?? '')
        const unstagedFiles = (unstagedResult.stdout ?? '').trim().split('\n').filter(Boolean).map((line) => line.split('\t').at(-1) ?? '')

        expect(stagedResult.success).toBe(true)
        expect(stagedFiles).toContain('staged.txt')
        expect(stagedFiles).not.toContain('unstaged.txt')

        expect(unstagedResult.success).toBe(true)
        expect(unstagedFiles).toContain('unstaged.txt')
        expect(unstagedFiles).not.toContain('staged.txt')
    })

    it('returns staged file content in default file diff mode', async () => {
        const defaultResult = await callGitHandler('git-diff-file', {
            cwd: repoDir,
            filePath: 'staged.txt'
        })
        const stagedResult = await callGitHandler('git-diff-file', {
            cwd: repoDir,
            filePath: 'staged.txt',
            staged: true
        })
        const unstagedResult = await callGitHandler('git-diff-file', {
            cwd: repoDir,
            filePath: 'staged.txt',
            staged: false
        })

        expect(defaultResult.success).toBe(true)
        expect(defaultResult.stdout).toContain('+staged change')

        expect(stagedResult.success).toBe(true)
        expect(stagedResult.stdout).toContain('+staged change')

        expect(unstagedResult.success).toBe(true)
        expect((unstagedResult.stdout ?? '').trim()).toBe('')
    })

    it('returns file diff against baseRef from current working tree', async () => {
        const result = await callGitHandler('git-diff-file', {
            cwd: repoDir,
            filePath: 'staged.txt',
            baseRef: initialCommit
        })

        expect(result.success).toBe(true)
        expect(result.stdout).toContain('+staged change')
    })

    it('handles default diff mode before the first commit', async () => {
        const noHeadRepo = await createTempDir('hopi-git-diff-no-head')
        try {
            await runGit(noHeadRepo, ['init', '-b', 'main'])
            await writeFile(join(noHeadRepo, 'new-file.txt'), 'hello\nworld\n')
            await runGit(noHeadRepo, ['add', 'new-file.txt'])

            const noHeadRpc = new RpcHandlerManager({ scopePrefix: 'session-test-no-head' })
            registerGitHandlers(noHeadRpc, noHeadRepo)

            const numstatRaw = await noHeadRpc.handleRequest({
                method: 'session-test-no-head:git-diff-numstat',
                params: JSON.stringify({ cwd: noHeadRepo })
            })
            const fileRaw = await noHeadRpc.handleRequest({
                method: 'session-test-no-head:git-diff-file',
                params: JSON.stringify({ cwd: noHeadRepo, filePath: 'new-file.txt' })
            })

            const numstatResult = JSON.parse(numstatRaw) as { success: boolean; stdout?: string }
            const fileResult = JSON.parse(fileRaw) as { success: boolean; stdout?: string }

            expect(numstatResult.success).toBe(true)
            expect(numstatResult.stdout).toContain('new-file.txt')

            expect(fileResult.success).toBe(true)
            expect(fileResult.stdout).toContain('+hello')
        } finally {
            await rm(noHeadRepo, { recursive: true, force: true })
        }
    })
})
