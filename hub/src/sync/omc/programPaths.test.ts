import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveOmcPlanningRoot } from './programPaths'

const createdPaths: string[] = []

function makeTempDir(prefix: string): string {
    const path = mkdtempSync(join(tmpdir(), prefix))
    createdPaths.push(path)
    return path
}

afterEach(() => {
    while (createdPaths.length > 0) {
        const path = createdPaths.pop()
        if (!path) {
            continue
        }
        rmSync(path, { recursive: true, force: true })
    }
})

describe('resolveOmcPlanningRoot', () => {
    it('prefers sibling workspace planning when repo is an omc worktree copy', () => {
        const workspaceRoot = makeTempDir('hopi-omc-workspace-')
        const repoRoot = join(workspaceRoot, 'hopi')
        mkdirSync(join(workspaceRoot, '.planning', 'phases'), { recursive: true })
        mkdirSync(repoRoot, { recursive: true })

        const planningRoot = resolveOmcPlanningRoot(repoRoot, {
            env: {},
            homeDir: makeTempDir('home-')
        })

        expect(planningRoot).toBe(join(workspaceRoot, '.planning'))
    })

    it('falls back to home gsd workspace planning for the main repo checkout', () => {
        const homeDir = makeTempDir('home-')
        const repoRoot = join(makeTempDir('repo-parent-'), 'hopi')
        mkdirSync(repoRoot, { recursive: true })
        mkdirSync(join(homeDir, 'gsd-workspaces', 'hopi-omc', '.planning', 'phases'), { recursive: true })

        const planningRoot = resolveOmcPlanningRoot(repoRoot, {
            env: {},
            homeDir
        })

        expect(planningRoot).toBe(join(homeDir, 'gsd-workspaces', 'hopi-omc', '.planning'))
    })

    it('falls back to repo local planning when no omc workspace planning exists', () => {
        const repoRoot = join(makeTempDir('repo-parent-'), 'hopi')
        mkdirSync(join(repoRoot, '.planning', 'phases'), { recursive: true })
        mkdirSync(repoRoot, { recursive: true })

        const planningRoot = resolveOmcPlanningRoot(repoRoot, {
            env: {},
            homeDir: makeTempDir('home-')
        })

        expect(planningRoot).toBe(join(repoRoot, '.planning'))
    })

    it('honors explicit HOPI_OMC_PLANNING_ROOT override first', () => {
        const repoRoot = join(makeTempDir('repo-parent-'), 'hopi')
        const explicitPlanningRoot = join(makeTempDir('explicit-'), '.planning')
        mkdirSync(join(explicitPlanningRoot, 'phases'), { recursive: true })
        mkdirSync(repoRoot, { recursive: true })

        const planningRoot = resolveOmcPlanningRoot(repoRoot, {
            env: { HOPI_OMC_PLANNING_ROOT: explicitPlanningRoot },
            homeDir: makeTempDir('home-')
        })

        expect(planningRoot).toBe(explicitPlanningRoot)
    })
})
