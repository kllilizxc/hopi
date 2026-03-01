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
})
