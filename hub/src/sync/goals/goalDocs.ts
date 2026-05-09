import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StoredGoal, StoredProject, StoredWorkspace } from '../../store'

function ensureFile(path: string, content: string): void {
    if (existsSync(path)) return
    writeFileSync(path, content, 'utf8')
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

    const goalFile = join(goalsRoot, `${input.goal.id}.md`)
    if (!existsSync(goalFile)) {
        writeFileSync(goalFile, [
            `# ${input.goal.title}`, '',
            '## Objective', '',
            input.goal.description?.trim() || input.goal.title, '',
            '## Success Criteria', '',
            input.goal.successCriteria?.trim() || '- Clarify success criteria during Planning.', '',
            '## Current Strategy', '',
            '- Planner starts by clarifying this Goal before implementation.', '',
            '## Open Questions', '',
            '- None recorded yet.',
            ''
        ].join('\n'), 'utf8')
    } else {
        const existing = readFileSync(goalFile, 'utf8')
        if (!existing.includes(input.goal.title)) {
            writeFileSync(goalFile, `${existing.trim()}\n\n## Linked Goal\n\n${input.goal.title}\n`, 'utf8')
        }
    }

    return { docsRoot }
}
