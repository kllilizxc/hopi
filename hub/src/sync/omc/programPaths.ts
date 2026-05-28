import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

function normalizeCandidate(candidate: string): string {
    return resolve(candidate)
}

export function buildRepoLocalOmcPlanningRoot(repoRoot: string): string {
    return normalizeCandidate(join(repoRoot, '.planning'))
}

export function hasOmcPlanningPhases(planningRoot: string): boolean {
    return existsSync(join(planningRoot, 'phases'))
}

export function resolveOmcPlanningRoot(repoRoot: string, options?: {
    env?: NodeJS.ProcessEnv
    homeDir?: string
}): string {
    const env = options?.env ?? process.env
    const homeDir = options?.homeDir ?? homedir()
    const repoName = basename(repoRoot)
    const explicitPlanningRoot = env.HOPI_OMC_PLANNING_ROOT?.trim()

    const candidates = [
        explicitPlanningRoot,
        join(repoRoot, '..', '.planning'),
        join(homeDir, 'gsd-workspaces', `${repoName}-omc`, '.planning'),
        buildRepoLocalOmcPlanningRoot(repoRoot)
    ]
        .filter((candidate): candidate is string => Boolean(candidate))
        .map(normalizeCandidate)

    for (const candidate of candidates) {
        if (hasOmcPlanningPhases(candidate)) {
            return candidate
        }
    }

    return candidates[0] ?? buildRepoLocalOmcPlanningRoot(repoRoot)
}
