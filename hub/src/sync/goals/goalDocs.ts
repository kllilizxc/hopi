import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StoredGoal, StoredProject, StoredWorkspace } from '../../store'

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
    if (!input.defaultWorkspace?.path) return { docsRoot: null }

    const docsRoot = join(input.defaultWorkspace.path, '.hopi', 'docs')
    const goalsRoot = join(docsRoot, 'goals')
    mkdirSync(goalsRoot, { recursive: true })

    ensureFile(join(docsRoot, 'index.md'), [
        '# HOPI Project Context', '',
        `Project: ${input.project.name}`, '',
        '## Working Rules', '',
        '- Repo docs are long-term memory.',
        '- Ask one blocking question when product intent is unclear.',
        '- Keep kanban tasks small and verifiable.',
        ''
    ].join('\n'))

    ensureFile(join(docsRoot, 'todo.md'), [
        '# HOPI Todo', '',
        'This file is the planning reservoir. The kanban is the active execution queue.',
        ''
    ].join('\n'))

    ensureFile(join(docsRoot, 'decisions.md'), [
        '# HOPI Decisions', '',
        '- Code changes may be automated inside a Goal; deploy/release requires explicit human approval.',
        ''
    ].join('\n'))

    ensureFile(join(docsRoot, 'tech-debt.md'), [
        '# HOPI Tech Debt', '',
        'Curated debt worth tracking goes here.',
        ''
    ].join('\n'))

    const goalFile = join(goalsRoot, `${input.goal.goalKey}.md`)
    if (!existsSync(goalFile)) {
        writeFileSync(goalFile, buildGoalDoc(input.goal), 'utf8')
    } else {
        const existing = readFileSync(goalFile, 'utf8')
        if (!existing.startsWith('---')) {
            writeFileSync(goalFile, `${buildGoalDoc(input.goal).trim()}\n\n## Imported Legacy Notes\n\n${existing.trim()}\n`, 'utf8')
        }
    }

    return { docsRoot }
}
