import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type {
    OmcPlanChecklistItem,
    OmcPlanDetailResponse,
    OmcPlanSummary,
    OmcPlanningIndexResponse,
    OmcProgram
} from '@hopi/protocol/types'

type ParsedPlanRecord = {
    absolutePath: string
    planKey: string
    planPath: string
    phaseKey: string
    phaseLabel: string
    dependsOn: string[]
    planTitle: string
    summary: string
    checklist: OmcPlanChecklistItem[]
    lastModifiedAt: number
    refs: OmcPlanDetailResponse['plan']['refs']
    summaryExists: boolean
}

function parseFrontmatter(content: string): { frontmatter?: Record<string, unknown>; rawFrontmatter?: string; body: string } {
    const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
    if (!match) {
        return { body: content }
    }

    const rawFrontmatter = match[1] ?? ''

    try {
        const frontmatter = parseYaml(rawFrontmatter) as Record<string, unknown> | null
        return {
            frontmatter: frontmatter ?? undefined,
            rawFrontmatter,
            body: match[2] ?? ''
        }
    } catch {
        return {
            rawFrontmatter,
            body: match[2] ?? ''
        }
    }
}

function extractTaggedSection(body: string, tagName: string): string {
    const match = body.match(new RegExp(`<${tagName}>([\\s\\S]*?)</${tagName}>`, 'i'))
    return (match?.[1] ?? '').trim()
}

function normalizeInlineText(input: string): string {
    return input
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

function formatPhaseLabel(phaseKey: string): string {
    return phaseKey
        .split('-')
        .map((part, index) => {
            if (index === 0) {
                return part
            }
            if (part.toLowerCase() === 'omc') {
                return 'OMC'
            }
            return part.charAt(0).toUpperCase() + part.slice(1)
        })
        .join(' ')
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

    return files.sort((left, right) => left.localeCompare(right))
}

function buildChecklist(body: string, summaryExists: boolean): OmcPlanChecklistItem[] {
    const items: OmcPlanChecklistItem[] = []
    const taskRegex = /<task\b[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/task>/g
    let match: RegExpExecArray | null
    while ((match = taskRegex.exec(body)) !== null) {
        const text = normalizeInlineText(match[1] ?? '')
        if (!text) {
            continue
        }
        items.push({
            text,
            checked: summaryExists
        })
    }

    if (items.length > 0) {
        return items
    }

    const markdownItems = body
        .split('\n')
        .map((line) => line.match(/^\s*[-*]\s+\[( |x|X)\]\s+(.+)\s*$/))
        .filter((candidate): candidate is RegExpMatchArray => Boolean(candidate))

    return markdownItems.map((candidate) => ({
        text: normalizeInlineText(candidate[2] ?? ''),
        checked: summaryExists || (candidate[1] ?? ' ').toLowerCase() === 'x'
    }))
}

function derivePlanTitle(body: string, frontmatter?: Record<string, unknown>): string {
    const heading = body.split('\n').find((line) => line.trim().startsWith('# '))
    if (heading) {
        return heading.replace(/^#\s+/, '').trim()
    }

    const objectiveLines = extractTaggedSection(body, 'objective')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    const objectiveTitle = objectiveLines.find((line) => !line.startsWith('Purpose:') && !line.startsWith('Output:'))
    if (objectiveTitle) {
        return objectiveTitle
    }

    if (typeof frontmatter?.plan === 'string' && frontmatter.plan.trim()) {
        return `Plan ${frontmatter.plan.trim()}`
    }

    return 'Untitled Plan'
}

function deriveSummary(body: string): string {
    const objectiveLines = extractTaggedSection(body, 'objective')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)

    const purposeLine = objectiveLines.find((line) => line.startsWith('Purpose:'))
    if (purposeLine) {
        return purposeLine.replace(/^Purpose:\s*/, '').trim()
    }

    return objectiveLines[1] ?? objectiveLines[0] ?? ''
}

function parseInlineStringArray(rawValue: string): string[] {
    const trimmed = rawValue.trim()
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
        return []
    }

    return trimmed
        .slice(1, -1)
        .split(',')
        .map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
}

function deriveDependsOn(frontmatter?: Record<string, unknown>, rawFrontmatter?: string): string[] {
    const candidate = frontmatter?.depends_on ?? frontmatter?.dependsOn
    if (!Array.isArray(candidate)) {
        const line = rawFrontmatter
            ?.split('\n')
            .map((item) => item.trim())
            .find((item) => item.startsWith('depends_on:') || item.startsWith('dependsOn:'))

        if (!line) {
            return []
        }

        const rawValue = line.slice(line.indexOf(':') + 1)
        return parseInlineStringArray(rawValue)
    }

    return candidate
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean)
}

function buildRefs(planningRoot: string, phaseDir: string): OmcPlanDetailResponse['plan']['refs'] {
    const phasePrefix = basename(phaseDir).split('-')[0] ?? ''
    const workspaceRoot = dirname(planningRoot)
    const contextPath = join(phaseDir, `${phasePrefix}-CONTEXT.md`)
    const researchPath = join(phaseDir, `${phasePrefix}-RESEARCH.md`)

    return {
        projectPath: relative(workspaceRoot, join(planningRoot, 'PROJECT.md')),
        roadmapPath: relative(workspaceRoot, join(planningRoot, 'ROADMAP.md')),
        ...(existsSync(contextPath)
            ? { contextPath: relative(workspaceRoot, contextPath) }
            : {}),
        ...(existsSync(researchPath)
            ? { researchPath: relative(workspaceRoot, researchPath) }
            : {})
    }
}

function parsePlanFile(planningRoot: string, absolutePath: string): ParsedPlanRecord {
    const content = readFileSync(absolutePath, 'utf8')
    const { frontmatter, rawFrontmatter, body } = parseFrontmatter(content)
    const phaseDir = dirname(absolutePath)
    const phaseKey = basename(phaseDir)
    const workspaceRoot = dirname(planningRoot)
    const summaryExists = existsSync(absolutePath.replace(/-PLAN\.md$/, '-SUMMARY.md'))
    const checklist = buildChecklist(body, summaryExists)
    const stats = statSync(absolutePath)

    return {
        absolutePath,
        planKey: basename(absolutePath).replace(/-PLAN\.md$/, ''),
        planPath: relative(workspaceRoot, absolutePath),
        phaseKey,
        phaseLabel: formatPhaseLabel(phaseKey),
        dependsOn: deriveDependsOn(frontmatter, rawFrontmatter),
        planTitle: derivePlanTitle(body, frontmatter),
        summary: deriveSummary(body),
        checklist,
        lastModifiedAt: Math.floor(stats.mtimeMs),
        refs: buildRefs(planningRoot, phaseDir),
        summaryExists
    }
}

function listParsedPlans(planningRoot: string): ParsedPlanRecord[] {
    return collectPlanFiles(join(planningRoot, 'phases')).map((absolutePath) => parsePlanFile(planningRoot, absolutePath))
}

export function buildPlanningIndex(program: OmcProgram): OmcPlanningIndexResponse {
    const phaseMap = new Map<string, { phaseKey: string; phaseLabel: string; plans: OmcPlanSummary[] }>()

    for (const plan of listParsedPlans(program.planningRoot)) {
        if (!phaseMap.has(plan.phaseKey)) {
            phaseMap.set(plan.phaseKey, {
                phaseKey: plan.phaseKey,
                phaseLabel: plan.phaseLabel,
                plans: []
            })
        }

        phaseMap.get(plan.phaseKey)?.plans.push({
            planKey: plan.planKey,
            planPath: plan.planPath,
            phaseKey: plan.phaseKey,
            phaseLabel: plan.phaseLabel,
            dependsOn: plan.dependsOn,
            planTitle: plan.planTitle,
            summary: plan.summary,
            checklistTotal: plan.checklist.length,
            checklistDone: plan.checklist.filter((item) => item.checked).length,
            checklistOpen: plan.checklist.filter((item) => !item.checked).length,
            firstOpenItem: plan.checklist.find((item) => !item.checked)?.text ?? null,
            lastModifiedAt: plan.lastModifiedAt
        })
    }

    return {
        program: {
            id: program.id,
            name: program.name,
            repoRoot: program.repoRoot
        },
        phases: Array.from(phaseMap.values())
            .sort((left, right) => left.phaseKey.localeCompare(right.phaseKey))
            .map((phase) => ({
                ...phase,
                plans: phase.plans.sort((left, right) => left.planKey.localeCompare(right.planKey))
            }))
    }
}

export function getPlanRecord(program: OmcProgram, planKey: string): ParsedPlanRecord | null {
    return listParsedPlans(program.planningRoot).find((plan) => plan.planKey === planKey) ?? null
}

export function buildPlanDetail(program: OmcProgram, planKey: string): OmcPlanDetailResponse['plan'] | null {
    const plan = getPlanRecord(program, planKey)
    if (!plan) {
        return null
    }

    return {
        planKey: plan.planKey,
        planPath: plan.planPath,
        phaseKey: plan.phaseKey,
        phaseLabel: plan.phaseLabel,
        planTitle: plan.planTitle,
        summary: plan.summary,
        checklist: plan.checklist,
        refs: plan.refs,
        lastModifiedAt: plan.lastModifiedAt
    }
}
