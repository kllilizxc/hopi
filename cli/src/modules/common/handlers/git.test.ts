import { execFile } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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
        baseDir = await createTempDir('hapi-git-merge-base')
        worktreeDir = join(baseDir, '.task-worktree')

        await runGit(baseDir, ['init', '-b', 'main'])
        await writeFile(join(baseDir, 'README.md'), 'base\n')
        await runGit(baseDir, ['add', 'README.md'])
        await runGit(baseDir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'])
        await runGit(baseDir, ['worktree', 'add', '-b', 'task-branch', worktreeDir])

        await writeFile(join(worktreeDir, 'feature.txt'), 'feature\n')

        previousEnv = {
            HAPI_WORKTREE_BASE_PATH: process.env.HAPI_WORKTREE_BASE_PATH,
            HAPI_WORKTREE_BRANCH: process.env.HAPI_WORKTREE_BRANCH,
            HAPI_WORKTREE_NAME: process.env.HAPI_WORKTREE_NAME,
            HAPI_WORKTREE_PATH: process.env.HAPI_WORKTREE_PATH,
            HAPI_WORKTREE_CREATED_AT: process.env.HAPI_WORKTREE_CREATED_AT,
            HAPI_WORKTREE_BASE_COMMIT: process.env.HAPI_WORKTREE_BASE_COMMIT
        }

        process.env.HAPI_WORKTREE_BASE_PATH = baseDir
        process.env.HAPI_WORKTREE_BRANCH = 'task-branch'
        process.env.HAPI_WORKTREE_NAME = 'task-branch'
        process.env.HAPI_WORKTREE_PATH = worktreeDir
        process.env.HAPI_WORKTREE_CREATED_AT = String(Date.now())
        delete process.env.HAPI_WORKTREE_BASE_COMMIT
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
    })

    it('auto-commits worktree changes before merge', async () => {
        const rpc = new RpcHandlerManager({ scopePrefix: 'session-test' })
        registerGitHandlers(rpc, worktreeDir)

        const response = await rpc.handleRequest({
            method: 'session-test:git-merge-worktree',
            params: JSON.stringify({
                targetBranch: 'main',
                commitMessage: 'HAPI: merge test'
            })
        })

        const parsed = JSON.parse(response) as { success: boolean; commitHash?: string; error?: string }
        expect(parsed.success).toBe(true)
        expect(parsed.error).toBeUndefined()
        expect(parsed.commitHash).toBeTruthy()

        const baseHeadMessage = await runGit(baseDir, ['log', '-1', '--pretty=%s', 'main'])
        expect(baseHeadMessage).toBe('HAPI: merge test')

        const worktreeStatus = await runGit(worktreeDir, ['status', '--porcelain'])
        expect(worktreeStatus).toBe('')

        const worktreeAheadCount = await runGit(baseDir, ['rev-list', '--count', 'main..task-branch'])
        expect(worktreeAheadCount).toBe('1')
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
                commitMessage: 'HAPI: merge into dev'
            })
        })

        const parsed = JSON.parse(response) as { success: boolean; commitHash?: string; error?: string }
        expect(parsed.success).toBe(true)
        expect(parsed.error).toBeUndefined()
        expect(parsed.commitHash).toBeTruthy()

        const targetHeadMessage = await runGit(targetDir, ['log', '-1', '--pretty=%s'])
        expect(targetHeadMessage).toBe('HAPI: merge into dev')
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
                commitMessage: 'HAPI: merge into isolated dev'
            })
        })

        const parsed = JSON.parse(response) as { success: boolean; commitHash?: string; error?: string }
        expect(parsed.success).toBe(true)
        expect(parsed.error).toBeUndefined()
        expect(parsed.commitHash).toBeTruthy()

        const targetHeadMessage = await runGit(baseDir, ['log', '-1', '--pretty=%s', 'dev'])
        expect(targetHeadMessage).toBe('HAPI: merge into isolated dev')

        const baseCurrentBranch = await runGit(baseDir, ['branch', '--show-current'])
        expect(baseCurrentBranch).toBe('main')

        const baseStatus = await runGit(baseDir, ['status', '--porcelain'])
        expect(baseStatus).toContain('?? runtime.log')
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
                commitMessage: 'HAPI: merge conflict test'
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
        repoDir = await createTempDir('hapi-git-diff')

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

    it('still supports explicit staged and unstaged filters', async () => {
        const stagedResult = await callGitHandler('git-diff-numstat', { cwd: repoDir, staged: true })
        const unstagedResult = await callGitHandler('git-diff-numstat', { cwd: repoDir, staged: false })

        expect(stagedResult.success).toBe(true)
        expect(stagedResult.stdout).toContain('staged.txt')
        expect(stagedResult.stdout).not.toContain('unstaged.txt')

        expect(unstagedResult.success).toBe(true)
        expect(unstagedResult.stdout).toContain('unstaged.txt')
        expect(unstagedResult.stdout).not.toContain('staged.txt')
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
        const noHeadRepo = await createTempDir('hapi-git-diff-no-head')
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
