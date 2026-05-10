import { describe, expect, it } from 'bun:test'
import { parseGoalTodoMarkdown, updateGoalTodoMarkdown } from './goalTodo'

describe('parseGoalTodoMarkdown', () => {
    it('matches goal-scoped todo sections by goalKey', () => {
        const parsed = parseGoalTodoMarkdown([
            '# HOPI Todo',
            '',
            '## Goal mobile-remote-control',
            '',
            '### Ready',
            '',
            '- Add reconnect indicator',
            '',
            '### Candidate',
            '',
            '- Improve resume affordance',
            '',
            '## Goal another-goal',
            '',
            '### Ready',
            '',
            '- Ignore this item'
        ].join('\n'), {
            goalId: 'local-db-id',
            goalKey: 'mobile-remote-control'
        })

        expect(parsed.sections.map((section) => section.title)).toEqual([
            'Add reconnect indicator',
            'Improve resume affordance'
        ])
        expect(parsed.sections.map((section) => section.kind)).toEqual(['ready', 'candidate'])
    })

    it('falls back to legacy goal id headings', () => {
        const parsed = parseGoalTodoMarkdown([
            '# HOPI Todo',
            '',
            '## Goal `legacy-goal-id` - Legacy Goal',
            '',
            '### Ready',
            '',
            '- Preserve legacy matching'
        ].join('\n'), {
            goalId: 'legacy-goal-id',
            goalKey: 'new-key'
        })

        expect(parsed.sections).toHaveLength(1)
        expect(parsed.sections[0]?.title).toBe('Preserve legacy matching')
    })

    it('marks a goal-scoped todo item as promoted or done without touching other goals', () => {
        const markdown = [
            '# HOPI Todo',
            '',
            '## Goal other-goal',
            '',
            '### Ready',
            '',
            '- [ready] Restore archive docs through storage adapter',
            '',
            '## Goal card-game',
            '',
            '### Ready',
            '',
            '- [ready] Restore archive docs through storage adapter',
            '- [candidate] Keep runtime parser configurable',
            ''
        ].join('\n')

        const promoted = updateGoalTodoMarkdown(markdown, {
            goalId: 'goal-card-game',
            goalKey: 'card-game',
            todoRef: 'Restore archive docs through storage adapter',
            taskId: 'task-restore-docs',
            kind: 'promoted'
        })
        const done = updateGoalTodoMarkdown(promoted, {
            goalId: 'goal-card-game',
            goalKey: 'card-game',
            todoRef: 'Restore archive docs through storage adapter',
            taskId: 'task-restore-docs',
            kind: 'done'
        })

        expect(done).toContain([
            '## Goal other-goal',
            '',
            '### Ready',
            '',
            '- [ready] Restore archive docs through storage adapter'
        ].join('\n'))
        expect(done).toContain('- [done] Restore archive docs through storage adapter -> task `task-restore-docs`')
        expect(done).toContain('- [candidate] Keep runtime parser configurable')
    })
})
