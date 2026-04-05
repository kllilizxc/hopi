import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import type { OmcProgram, OmcProgramPlanningState } from '@hopi/protocol/types'

const SEED_PHASE_KEY = '01-bootstrap'

function sanitizeName(input: string): string {
    return input
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
}

function normalizeAbsolutePath(path: string, label: string): string {
    const trimmed = path.trim()
    if (!trimmed) {
        throw new Error(`${label} is required`)
    }
    if (!isAbsolute(trimmed)) {
        throw new Error(`${label} must be an absolute path`)
    }

    return resolve(trimmed)
}

function resolveGitMetadataPath(repoRoot: string): string | null {
    const dotGitPath = join(repoRoot, '.git')
    if (!existsSync(dotGitPath)) {
        return null
    }

    try {
        const stats = statSync(dotGitPath)
        if (stats.isDirectory()) {
            return dotGitPath
        }

        if (stats.isFile()) {
            const content = readFileSync(dotGitPath, 'utf8')
            const match = content.match(/^gitdir:\s*(.+)\s*$/im)
            if (!match?.[1]) {
                return null
            }

            return resolve(repoRoot, match[1].trim())
        }
    } catch {
        return null
    }

    return null
}

function detectPrimaryBranch(repoRoot: string): string | null {
    const gitMetadataPath = resolveGitMetadataPath(repoRoot)
    if (!gitMetadataPath) {
        return null
    }

    try {
        const headContent = readFileSync(join(gitMetadataPath, 'HEAD'), 'utf8').trim()
        const match = headContent.match(/^ref:\s+refs\/heads\/(.+)$/)
        return match?.[1]?.trim() || null
    } catch {
        return null
    }
}

function collectPlanFiles(root: string): string[] {
    if (!existsSync(root)) {
        return []
    }

    const entries = readdirSync(root, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
        const fullPath = join(root, entry.name)
        if (entry.isDirectory()) {
            files.push(...collectPlanFiles(fullPath))
            continue
        }
        if (entry.isFile() && entry.name.endsWith('-PLAN.md')) {
            files.push(fullPath)
        }
    }

    return files
}

export function inspectOmcPlanningRoot(planningRoot: string): Omit<OmcProgramPlanningState, 'status' | 'seedFiles'> {
    const normalized = resolve(planningRoot)
    const phasesRoot = join(normalized, 'phases')
    const hasProject = existsSync(join(normalized, 'PROJECT.md'))
    const hasRoadmap = existsSync(join(normalized, 'ROADMAP.md'))
    const hasPhasesDir = existsSync(phasesRoot)
    const hasPlanning = hasProject && hasRoadmap && hasPhasesDir
    const planFiles = collectPlanFiles(phasesRoot)
    const phaseCount = hasPhasesDir
        ? readdirSync(phasesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length
        : 0

    return {
        planningRoot: normalized,
        hasPlanning,
        hasPlans: planFiles.length > 0,
        phaseCount,
        planCount: planFiles.length
    }
}

export function validateLocalGitRepo(repoRoot: string): {
    repoRoot: string
    repoName: string
    primaryBranch: string | null
} {
    const normalized = normalizeAbsolutePath(repoRoot, 'repoRoot')
    if (!existsSync(normalized)) {
        throw new Error(`Repo path does not exist: ${normalized}`)
    }

    let stats
    try {
        stats = statSync(normalized)
    } catch {
        throw new Error(`Repo path is not readable: ${normalized}`)
    }

    if (!stats.isDirectory()) {
        throw new Error(`Repo path must point to a directory: ${normalized}`)
    }

    if (!resolveGitMetadataPath(normalized)) {
        throw new Error(`Repo path is not a local git repo: ${normalized}`)
    }

    return {
        repoRoot: normalized,
        repoName: basename(normalized),
        primaryBranch: detectPrimaryBranch(normalized)
    }
}

export function ensureRepoNotAlreadyAttached(programs: OmcProgram[], repoRoot: string, currentProgramId?: string): void {
    const normalized = resolve(repoRoot)
    const duplicate = programs.find((program) => resolve(program.repoRoot) === normalized && program.id !== currentProgramId)
    if (duplicate) {
        throw new Error(`Repo is already attached as ${duplicate.name}`)
    }
}

export function validatePlanningRoot(planningRoot: string): Omit<OmcProgramPlanningState, 'status' | 'seedFiles'> {
    const normalized = normalizeAbsolutePath(planningRoot, 'planningRoot')
    if (!existsSync(normalized)) {
        throw new Error(`Planning root does not exist: ${normalized}`)
    }

    let stats
    try {
        stats = statSync(normalized)
    } catch {
        throw new Error(`Planning root is not readable: ${normalized}`)
    }

    if (!stats.isDirectory()) {
        throw new Error(`Planning root must point to a directory: ${normalized}`)
    }

    const inspection = inspectOmcPlanningRoot(normalized)
    if (!inspection.hasPlanning) {
        throw new Error(`Planning root is missing PROJECT.md, ROADMAP.md, or phases/: ${normalized}`)
    }

    return inspection
}

export function createProgramId(repoRoot: string): string {
    const slug = sanitizeName(basename(repoRoot)) || 'repo'
    const hash = createHash('sha1').update(resolve(repoRoot)).digest('hex').slice(0, 8)
    return `omc-${slug}-${hash}`
}

export function deriveProgramName(repoRoot: string, explicitName?: string): string {
    const trimmed = explicitName?.trim()
    if (trimmed) {
        return trimmed
    }

    const repoName = basename(repoRoot).replace(/[-_]+/g, ' ').trim()
    if (!repoName) {
        return 'OMC Program'
    }

    return repoName
        .split(/\s+/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ')
}

export function writePlanningSeed(options: {
    repoRoot: string
    programName: string
}): {
    planningRoot: string
    seedFiles: string[]
} {
    const planningRoot = join(resolve(options.repoRoot), '.planning')
    const phaseDir = join(planningRoot, 'phases', SEED_PHASE_KEY)
    mkdirSync(phaseDir, { recursive: true })

    const files = new Map<string, string>([
        [
            join(planningRoot, 'PROJECT.md'),
            `# ${options.programName}\n\nBootstrap planning seed created by OMC.\n`
        ],
        [
            join(planningRoot, 'REQUIREMENTS.md'),
            `# Requirements\n\n- Define the first milestone for ${options.programName}.\n- Capture product goals before creating executable plans.\n`
        ],
        [
            join(planningRoot, 'ROADMAP.md'),
            `# Roadmap\n\n## Milestone 1\n\n### Phase 01: Bootstrap\nEstablish the first planning artifacts for ${options.programName}.\n`
        ],
        [
            join(planningRoot, 'STATE.md'),
            `# State\n\n- Current phase: 01-bootstrap\n- Current status: planning-seed-created\n- Next step: discuss and plan Phase 01\n`
        ],
        [
            join(phaseDir, '01-CONTEXT.md'),
            `# Phase 01: Bootstrap - Context\n\n## Goal\nCreate enough context to begin formal GSD planning for ${options.programName}.\n\n## What Exists\n- Repo root: ${resolve(options.repoRoot)}\n- Planning root: ${planningRoot}\n\n## Next Steps\n- Clarify product intent\n- Capture requirements\n- Break work into the first executable plans\n`
        ]
    ])

    const seedFiles: string[] = []
    for (const [absolutePath, content] of files) {
        if (!existsSync(absolutePath)) {
            writeFileSync(absolutePath, content, 'utf8')
        }
        seedFiles.push(relative(resolve(options.repoRoot), absolutePath))
    }

    return {
        planningRoot,
        seedFiles
    }
}
