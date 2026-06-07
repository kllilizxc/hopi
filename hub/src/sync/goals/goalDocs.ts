import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import YAML from 'yaml'
import type { StoredGoal, StoredProject, StoredWorkspace } from '../../store'
import {
    getDocsRoot,
    getGoalDecisionsPath,
    getGoalDesignPath,
    getGoalDocPath,
    getGoalDocsDir,
    getGoalEventsPath,
    getGoalPlanningRequestsPath,
    getGoalTodoPath,
    getGoalWriteTracePath,
    getLegacyGoalDecisionsPath,
    getLegacyPreferencePath,
    getPreferencePath,
    getLegacyGoalDocPath
} from './goalDocPaths'
import { ensureCanonicalGoalTodoYamlAtPath, syncGoalTodoMetadata } from './goalTodo'

function ensureFile(path: string, content: string): void {
    if (existsSync(path)) return
    writeFileSync(path, content, 'utf8')
}

function yamlString(value: string): string {
    return JSON.stringify(value)
}

function indentBlock(value: string): string {
    return value
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n')
}

function buildGoalDoc(goal: StoredGoal): string {
    return [
        '---',
        `goalKey: ${goal.goalKey}`,
        `title: ${yamlString(goal.title)}`,
        `status: ${goal.status}`,
        `autopilotEnabled: ${goal.autopilotEnabled ? 'true' : 'false'}`,
        `deployRequiresApproval: ${goal.deployRequiresApproval ? 'true' : 'false'}`,
        '---',
        '',
        `# ${goal.title}`,
        '',
        '## Objective',
        '',
        goal.description?.trim() || goal.title,
        '',
        '## Success Criteria',
        '',
        goal.successCriteria?.trim() || '- Clarify success criteria during Planning.',
        '',
        '## Current Strategy',
        '',
        '- Planner starts by clarifying this Goal before implementation.',
        '',
        '## Current Focus',
        '',
        goal.currentFocus?.trim() || '- None recorded yet.',
        '',
        '## Open Questions',
        '',
        '- None recorded yet.',
        ''
    ].join('\n')
}

function buildGoalDesignDoc(goal: StoredGoal): string {
    return [
        `# ${goal.title} Design`,
        '',
        '## Current Architecture',
        '',
        '- No design notes recorded yet.',
        '',
        '## Constraints',
        '',
        '- Capture constraints here before planner reshapes major work.',
        '',
        '## Open Design Questions',
        '',
        '- None recorded yet.',
        ''
    ].join('\n')
}

function normalizeNewlines(value: string): string {
    return value.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

const GOAL_DOC_STATUSES = new Set<StoredGoal['status']>(['planning', 'active', 'blocked', 'paused'])

function splitFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
    const normalized = normalizeNewlines(markdown)
    if (!normalized.startsWith('---\n')) {
        return { frontmatter: {}, body: normalized }
    }
    const end = normalized.indexOf('\n---', 4)
    if (end === -1) {
        return { frontmatter: {}, body: normalized }
    }
    const raw = normalized.slice(4, end)
    const parsed = YAML.parse(raw)
    return {
        frontmatter: parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {},
        body: normalized.slice(end + '\n---'.length).trimStart()
    }
}

function readSection(body: string, heading: string): string | null {
    const lines = normalizeNewlines(body).split('\n')
    const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading}`.toLowerCase())
    if (start === -1) return null
    const collected: string[] = []
    for (let index = start + 1; index < lines.length; index += 1) {
        const line = lines[index] ?? ''
        if (/^##\s+/.test(line)) break
        collected.push(line)
    }
    const value = collected.join('\n').trim()
    return value || null
}

function readTitle(body: string): string | null {
    const h1 = /^#\s+(.+?)\s*$/m.exec(normalizeNewlines(body))
    const value = h1?.[1]?.trim() ?? ''
    return value || null
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceOrInsertTitle(body: string, title: string): string {
    const normalized = normalizeNewlines(body).trim()
    const nextTitle = `# ${title}`
    if (!normalized) {
        return `${nextTitle}\n`
    }
    if (/^#\s+.+$/m.test(normalized)) {
        return normalized.replace(/^#\s+.+$/m, nextTitle)
    }
    return `${nextTitle}\n\n${normalized}`
}

function replaceOrAppendSection(body: string, heading: string, content: string): string {
    const normalized = normalizeNewlines(body).trim()
    const replacement = `## ${heading}\n\n${content.trim()}`
    const matcher = new RegExp(`^##\\s+${escapeRegExp(heading)}\\s*$[\\s\\S]*?(?=^##\\s+|\\Z)`, 'im')
    if (!normalized) {
        return replacement
    }
    if (matcher.test(normalized)) {
        return normalized.replace(matcher, replacement).trim()
    }
    return `${normalized}\n\n${replacement}`
}

function stringifyGoalDoc(frontmatter: Record<string, unknown>, body: string): string {
    return [
        '---',
        YAML.stringify(frontmatter, { lineWidth: 0 }).trimEnd(),
        '---',
        '',
        body.trim(),
        ''
    ].join('\n')
}

export function readCanonicalGoalDocMetadata(input: {
    goal: Pick<StoredGoal, 'goalKey' | 'title' | 'status' | 'autopilotEnabled' | 'deployRequiresApproval' | 'description' | 'successCriteria' | 'currentFocus'>
    defaultWorkspace: StoredWorkspace | null
}): Pick<StoredGoal, 'goalKey' | 'title' | 'status' | 'autopilotEnabled' | 'deployRequiresApproval' | 'description' | 'successCriteria' | 'currentFocus'> | null {
    const docsRoot = getDocsRoot(input.defaultWorkspace)
    if (!docsRoot) return null

    const goalDocPath = getGoalDocPath(docsRoot, input.goal.goalKey)
    if (!existsSync(goalDocPath)) {
        return null
    }

    try {
        const { frontmatter, body } = splitFrontmatter(readFileSync(goalDocPath, 'utf8'))
        const rawStatus = readString(frontmatter.status)
        return {
            goalKey: input.goal.goalKey,
            title: readString(frontmatter.title) ?? readTitle(body) ?? input.goal.title,
            status: rawStatus && GOAL_DOC_STATUSES.has(rawStatus as StoredGoal['status'])
                ? rawStatus as StoredGoal['status']
                : input.goal.status,
            autopilotEnabled: typeof frontmatter.autopilotEnabled === 'boolean'
                ? frontmatter.autopilotEnabled
                : input.goal.autopilotEnabled,
            deployRequiresApproval: typeof frontmatter.deployRequiresApproval === 'boolean'
                ? frontmatter.deployRequiresApproval
                : input.goal.deployRequiresApproval,
            description: readSection(body, 'Objective') ?? input.goal.description,
            successCriteria: readSection(body, 'Success Criteria') ?? input.goal.successCriteria,
            currentFocus: readSection(body, 'Current Focus') ?? input.goal.currentFocus
        }
    } catch {
        return null
    }
}

export function overlayGoalWithCanonicalDoc<T extends StoredGoal>(input: {
    goal: T
    defaultWorkspace: StoredWorkspace | null
}): T {
    const metadata = readCanonicalGoalDocMetadata(input)
    return metadata ? { ...input.goal, ...metadata } : input.goal
}

export function bootstrapGoalDocs(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): { docsRoot: string | null } {
    const docsRoot = getDocsRoot(input.defaultWorkspace)
    if (!docsRoot) return { docsRoot: null }

    const goalDir = getGoalDocsDir(docsRoot, input.goal.goalKey)
    mkdirSync(goalDir, { recursive: true })

    ensureFile(join(docsRoot, 'index.md'), [
        '# HOPI Project Context', '',
        `Project: ${input.project.name}`, '',
        '## Layout', '',
        'Root docs are shared across Goals. Goal-owned planning state lives under `.hopi/docs/goals/<goal-key>/`. Repo-level durable preferences live in `.hopi/preference.md`.', '',
        '- `decisions.md`: decisions that affect more than one Goal.',
        '- `tech-debt.md`: curated cross-Goal technical debt and radar findings.',
        '- `goals/<goal-key>/goal.md`: the Goal brief, strategy, focus, and planning history.',
        '- `goals/<goal-key>/design.md`: the Goal architecture notes and design constraints.',
        '- `goals/<goal-key>/todo.yml`: the Goal todo reservoir.',
        '- `goals/<goal-key>/decisions.yml`: Goal-local durable decision topics.',
        '- `goals/<goal-key>/planning-requests.yml`: durable planner follow-through requests.',
        '- `goals/<goal-key>/events.jsonl`: append-only workflow event trace.',
        '- `goals/<goal-key>/write-trace.jsonl`: append-only file write trace.',
        '',
        '## Working Rules', '',
        '- Repo docs are long-term memory.',
        '- Ask one blocking question when product intent is unclear.',
        '- Keep kanban tasks small and verifiable.',
        '- Keep goal-specific todo, planning history, and local decisions inside that Goal directory.',
        ''
    ].join('\n'))

    ensureFile(getGoalTodoPath(docsRoot, input.goal.goalKey), [
        'version: 1',
        'goal:',
        `  goalKey: ${input.goal.goalKey}`,
        `  title: ${yamlString(input.goal.title)}`,
        'items: []',
        ''
    ].join('\n'))
    const goalTodoPath = getGoalTodoPath(docsRoot, input.goal.goalKey)
    ensureCanonicalGoalTodoYamlAtPath({
        path: goalTodoPath,
        scope: {
            goalId: input.goal.id,
            goalKey: input.goal.goalKey
        },
        goalTitle: input.goal.title
    })

    ensureFile(join(docsRoot, 'decisions.md'), [
        '# HOPI Shared Decisions', '',
        '- Code changes may be automated inside a Goal; deploy/release requires explicit human approval.',
        '- Keep decisions here only when they affect more than one Goal.',
        ''
    ].join('\n'))

    const legacyGoalDecisionsPath = getLegacyGoalDecisionsPath(docsRoot, input.goal.goalKey)
    const legacyGoalDecisions = existsSync(legacyGoalDecisionsPath)
        ? readFileSync(legacyGoalDecisionsPath, 'utf8').trim()
        : ''
    ensureFile(getGoalDecisionsPath(docsRoot, input.goal.goalKey), [
        'version: 1',
        'decisions: []',
        ...(legacyGoalDecisions
            ? [
                'legacyImportedMarkdown: |',
                indentBlock(legacyGoalDecisions)
            ]
            : []),
        ''
    ].join('\n'))

    ensureFile(getGoalDesignPath(docsRoot, input.goal.goalKey), buildGoalDesignDoc(input.goal))

    ensureFile(getGoalPlanningRequestsPath(docsRoot, input.goal.goalKey), [
        'version: 1',
        'requests: []',
        ''
    ].join('\n'))

    ensureFile(getGoalEventsPath(docsRoot, input.goal.goalKey), '')
    ensureFile(getGoalWriteTracePath(docsRoot, input.goal.goalKey), '')

    ensureFile(join(docsRoot, 'tech-debt.md'), [
        '# HOPI Tech Debt', '',
        'Curated debt worth tracking goes here.',
        ''
    ].join('\n'))

    const legacyPreferencePath = getLegacyPreferencePath(docsRoot)
    const legacyPreference = existsSync(legacyPreferencePath)
        ? readFileSync(legacyPreferencePath, 'utf8')
        : null
    ensureFile(getPreferencePath(docsRoot), legacyPreference ?? [
        '# HOPI Preferences', '',
        '- No saved preferences yet.',
        ''
    ].join('\n'))
    const goalFile = getGoalDocPath(docsRoot, input.goal.goalKey)
    const legacyGoalFile = getLegacyGoalDocPath(docsRoot, input.goal.goalKey)
    if (!existsSync(goalFile)) {
        const legacy = existsSync(legacyGoalFile) ? readFileSync(legacyGoalFile, 'utf8') : null
        const content = legacy?.startsWith('---')
            ? legacy
            : legacy?.trim()
                ? `${buildGoalDoc(input.goal).trim()}\n\n## Imported Legacy Notes\n\n${legacy.trim()}\n`
                : buildGoalDoc(input.goal)
        writeFileSync(goalFile, content, 'utf8')
    } else {
        const existing = readFileSync(goalFile, 'utf8')
        if (!existing.startsWith('---')) {
            writeFileSync(goalFile, `${buildGoalDoc(input.goal).trim()}\n\n## Imported Legacy Notes\n\n${existing.trim()}\n`, 'utf8')
        }
    }

    return { docsRoot }
}

export function syncGoalOwnedDocs(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): { docsRoot: string | null; goalDocPath: string | null; goalDocChanged: boolean; todoChanged: boolean } {
    const { docsRoot } = bootstrapGoalDocs(input)
    if (!docsRoot) {
        return {
            docsRoot: null,
            goalDocPath: null,
            goalDocChanged: false,
            todoChanged: false
        }
    }

    const goalDocPath = getGoalDocPath(docsRoot, input.goal.goalKey)
    const existing = existsSync(goalDocPath)
        ? readFileSync(goalDocPath, 'utf8')
        : buildGoalDoc(input.goal)
    const { frontmatter, body } = splitFrontmatter(existing)

    const nextFrontmatter = {
        ...frontmatter,
        goalKey: input.goal.goalKey,
        title: input.goal.title,
        status: input.goal.status,
        autopilotEnabled: input.goal.autopilotEnabled !== false,
        deployRequiresApproval: input.goal.deployRequiresApproval !== false
    }
    let nextBody = replaceOrInsertTitle(body, input.goal.title)
    nextBody = replaceOrAppendSection(nextBody, 'Objective', input.goal.description?.trim() || input.goal.title)
    nextBody = replaceOrAppendSection(nextBody, 'Success Criteria', input.goal.successCriteria?.trim() || '- Clarify success criteria during Planning.')
    nextBody = replaceOrAppendSection(nextBody, 'Current Focus', input.goal.currentFocus?.trim() || '- None recorded yet.')
    const nextDoc = stringifyGoalDoc(nextFrontmatter, nextBody)
    const goalDocChanged = normalizeNewlines(existing) !== nextDoc
    if (goalDocChanged) {
        writeFileSync(goalDocPath, nextDoc, 'utf8')
    }

    return {
        docsRoot,
        goalDocPath,
        goalDocChanged,
        todoChanged: syncGoalTodoMetadata({
            goal: input.goal,
            defaultWorkspace: input.defaultWorkspace
        })
    }
}
