import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StoredGoal, StoredProject, StoredWorkspace } from '../../store'
import {
    getDocsRoot,
    getGoalDecisionsPath,
    getGoalDocPath,
    getGoalDocsDir,
    getGoalTodoPath,
    getLegacyGoalDocPath
} from './goalDocPaths'

function ensureFile(path: string, content: string): void {
    if (existsSync(path)) return
    writeFileSync(path, content, 'utf8')
}

function yamlString(value: string): string {
    return JSON.stringify(value)
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
        'Root docs are shared across Goals. Goal-owned planning state lives under `.hopi/docs/goals/<goal-key>/`.', '',
        '- `decisions.md`: decisions that affect more than one Goal.',
        '- `tech-debt.md`: curated cross-Goal technical debt and radar findings.',
        '- `goals/<goal-key>/goal.md`: the Goal brief, strategy, focus, and planning history.',
        '- `goals/<goal-key>/todo.yml`: the Goal todo reservoir; use stable item `ref` values and `dependencyTaskList` for normal prerequisites.',
        '- `goals/<goal-key>/decisions.md`: decisions local to that Goal.',
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
        'goals:',
        `  - goalKey: ${input.goal.goalKey}`,
        `    goalId: ${input.goal.id}`,
        `    title: ${yamlString(input.goal.title)}`,
        '    items: []',
        ''
    ].join('\n'))

    ensureFile(join(docsRoot, 'decisions.md'), [
        '# HOPI Shared Decisions', '',
        '- Code changes may be automated inside a Goal; deploy/release requires explicit human approval.',
        '- Keep decisions here only when they affect more than one Goal.',
        ''
    ].join('\n'))

    ensureFile(getGoalDecisionsPath(docsRoot, input.goal.goalKey), [
        `# ${input.goal.title} Decisions`, '',
        '- None recorded yet.',
        ''
    ].join('\n'))

    ensureFile(join(docsRoot, 'tech-debt.md'), [
        '# HOPI Tech Debt', '',
        'Curated debt worth tracking goes here.',
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
