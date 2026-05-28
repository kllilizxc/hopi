import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createWorktree, removeWorktree } from './worktree'

const execFileAsync = promisify(execFile)

async function runGit(cwd: string, args: string[]): Promise<string> {
    const result = await execFileAsync('git', args, { cwd })
    return result.stdout.toString().trim()
}

describe('createWorktree', () => {
    let repoDir = ''
    let createdWorktreePath: string | null = null

    beforeEach(async () => {
        repoDir = join(tmpdir(), `hopi-worktree-${Date.now()}-${Math.random().toString(16).slice(2)}`)
        await mkdir(repoDir, { recursive: true })
        await runGit(repoDir, ['init', '-b', 'main'])

        await writeFile(join(repoDir, 'README.md'), 'main\n', 'utf8')
        await runGit(repoDir, ['add', 'README.md'])
        await runGit(repoDir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'init'])

        await runGit(repoDir, ['switch', '-c', 'dev'])
        await mkdir(join(repoDir, '.hopi'), { recursive: true })
        await writeFile(join(repoDir, '.hopi', 'actions.yaml'), 'version: 1\n', 'utf8')
        await writeFile(join(repoDir, 'DEV_ONLY.txt'), 'dev\n', 'utf8')
        await runGit(repoDir, ['add', '.hopi/actions.yaml', 'DEV_ONLY.txt'])
        await runGit(repoDir, ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-m', 'dev setup'])
        await runGit(repoDir, ['switch', 'main'])
    })

    afterEach(async () => {
        if (createdWorktreePath) {
            const removal = await removeWorktree({ repoRoot: repoDir, worktreePath: createdWorktreePath })
            if (!removal.ok) {
                throw new Error(removal.error)
            }
            createdWorktreePath = null
        }

        if (repoDir) {
            await rm(repoDir, { recursive: true, force: true })
        }
    })

    it('creates a task branch from the configured target branch instead of current HEAD', async () => {
        const devHead = await runGit(repoDir, ['rev-parse', 'dev'])

        const result = await createWorktree({
            basePath: repoDir,
            nameHint: 'from-dev',
            baseBranch: 'dev'
        })

        expect(result.ok).toBe(true)
        if (!result.ok) {
            throw new Error(result.error)
        }

        createdWorktreePath = result.info.worktreePath
        expect(result.info.baseCommit).toBe(devHead)

        const worktreeHead = await runGit(result.info.worktreePath, ['rev-parse', 'HEAD'])
        expect(worktreeHead).toBe(devHead)

        const manifest = await readFile(join(result.info.worktreePath, '.hopi', 'actions.yaml'), 'utf8')
        expect(manifest).toContain('version: 1')
        const devOnly = await readFile(join(result.info.worktreePath, 'DEV_ONLY.txt'), 'utf8')
        expect(devOnly).toBe('dev\n')
    })
})
