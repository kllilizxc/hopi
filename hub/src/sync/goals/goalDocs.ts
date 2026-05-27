import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { StoredGoal, StoredProject, StoredWorkspace } from '../../store'
import {
    getDocsRoot,
    getGoalDecisionsPath,
    getGoalDesignPath,
    getGoalDocPath,
    getGoalDocsDir,
    getGoalEventsPath,
    getGoalTodoPath,
    getLegacyGoalDocPath,
    getPreferencePath
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

function buildGoalDesignDoc(goal: StoredGoal): string {
    return [
        `# Design: ${goal.title}`,
        '',
        '## Problem',
        '',
        goal.description?.trim() || 'Clarify the problem during Planning before decomposing engineering work.',
        '',
        '## Goals',
        '',
        goal.successCriteria?.trim() || '- Clarify concrete success criteria during Planning.',
        '',
        '## Non-Goals',
        '',
        '- To be clarified by Planner.',
        '',
        '## User / Workflow',
        '',
        '- To be clarified by Planner.',
        '',
        '## Architecture',
        '',
        '- To be clarified by Planner before substantial task graph changes.',
        '',
        '## Data Model',
        '',
        '- To be clarified by Planner when relevant.',
        '',
        '## Edge Cases',
        '',
        '- To be clarified by Planner.',
        '',
        '## Testing / Acceptance',
        '',
        '- To be clarified by Planner.',
        '',
        '## Open Questions',
        '',
        '- None recorded yet.',
        '',
        '## Revision Notes',
        '',
        '- Initial design scaffold created by HOPI.',
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

    const preferencePath = getPreferencePath(input.defaultWorkspace)
    if (preferencePath) {
        ensureFile(preferencePath, [
            '# HOPI Preferences',
            '',
            'Durable user preferences that should apply across Goals and agents.',
            ''
        ].join('\n'))
    }

    ensureFile(join(docsRoot, 'index.md'), [
        '# HOPI Project Context', '',
        `Project: ${input.project.name}`, '',
        '## Layout', '',
        'Root docs are shared across Goals. Goal-owned planning state lives under `.hopi/docs/goals/<goal-key>/`.', '',
        '- `.hopi/preference.md`: global durable user preferences.',
        '- `goals/<goal-key>/goal.md`: the Goal brief, strategy, focus, and planning history.',
        '- `goals/<goal-key>/design.md`: durable product and technical design rationale.',
        '- `goals/<goal-key>/todo.yml`: the Goal todo reservoir.',
        '- `goals/<goal-key>/decisions.yml`: structured decisions local to that Goal.',
        '- `goals/<goal-key>/events.jsonl`: server-authored workflow event log.',
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
        `  goalId: ${input.goal.id}`,
        `  title: ${yamlString(input.goal.title)}`,
        'items: []',
        ''
    ].join('\n'))

    ensureFile(getGoalDecisionsPath(docsRoot, input.goal.goalKey), [
        'version: 1',
        'topics: []',
        ''
    ].join('\n'))

    ensureFile(getGoalEventsPath(docsRoot, input.goal.goalKey), '')
    ensureFile(getGoalDesignPath(docsRoot, input.goal.goalKey), buildGoalDesignDoc(input.goal))

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
