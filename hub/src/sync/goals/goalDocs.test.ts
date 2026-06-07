import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrapGoalDocs } from './goalDocs'

describe('goal docs bootstrap', () => {
    it('leaves an existing legacy goal-local todo.yml untouched during bootstrap', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-docs-'))
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'legacy-goal')
        mkdirSync(goalDir, { recursive: true })
        const todoPath = join(goalDir, 'todo.yml')
        writeFileSync(todoPath, [
            'version: 1',
            'goals:',
            '  - goalKey: legacy-goal',
            '    goalId: goal-legacy',
            '    title: Legacy Goal',
            '    items:',
            '      - ref: restore-docs',
            '        status: ready',
            '        title: Restore archive docs'
        ].join('\n'), 'utf8')

        bootstrapGoalDocs({
            project: {
                id: 'project-legacy',
                name: 'Legacy Project'
            } as never,
            goal: {
                id: 'goal-legacy',
                goalKey: 'legacy-goal',
                title: 'Legacy Goal',
                status: 'planning',
                autopilotEnabled: true,
                deployRequiresApproval: true
            } as never,
            defaultWorkspace: {
                path: workspacePath
            } as never
        })

        const todo = readFileSync(todoPath, 'utf8')
        expect(todo).toContain('goals:')
        expect(todo).toContain('ref: restore-docs')
        expect(todo).toContain('status: ready')
        expect(todo).not.toContain('goal:')
    })
})
