import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convertGoalTodoMarkdownToYaml, parseGoalTodoMarkdown, parseGoalTodoYaml, readGoalTodo, updateGoalTodoTaskState, updateGoalTodoYaml } from './goalTodo'

describe('goal todo yaml', () => {
    it('parses goal-scoped yaml items by goalKey', () => {
        const parsed = parseGoalTodoYaml([
            'version: 1',
            'goals:',
            '  - goalKey: mobile-remote-control',
            '    goalId: goal-mobile',
            '    title: Mobile remote control',
            '    items:',
            '      - ref: reconnect-indicator',
            '        status: ready',
            '        title: Add reconnect indicator',
            '      - ref: resume-affordance',
            '        status: candidate',
            '        title: Improve resume affordance',
            '  - goalKey: another-goal',
            '    items:',
            '      - ref: ignore',
            '        status: ready',
            '        title: Ignore this item'
        ].join('\n'), {
            goalId: 'local-db-id',
            goalKey: 'mobile-remote-control'
        })

        expect(parsed.sections.map((section) => section.title)).toEqual([
            'Add reconnect indicator',
            'Improve resume affordance'
        ])
        expect(parsed.sections.map((section) => section.kind)).toEqual(['ready', 'candidate'])
        expect(parsed.sections.map((section) => section.todoRef)).toEqual(['reconnect-indicator', 'resume-affordance'])
    })

    it('moves yaml items through promoted and done states', () => {
        const yaml = [
            'version: 1',
            'goals:',
            '  - goalKey: ts',
            '    goalId: goal-ts',
            '    title: Fix TS',
            '    items:',
            '      - ref: ts-ready-1',
            '        status: ready',
            '        title: Fix battle legacy types'
        ].join('\n')

        const promoted = updateGoalTodoYaml(yaml, {
            goalId: 'goal-ts',
            goalKey: 'ts',
            todoRef: 'ts-ready-1',
            taskId: 'task-battle',
            title: 'Fix battle legacy types',
            kind: 'promoted'
        })
        expect(promoted).toContain('status: promoted')
        expect(promoted).toContain('taskId: task-battle')

        const done = updateGoalTodoYaml(promoted, {
            goalId: 'goal-ts',
            goalKey: 'ts',
            todoRef: 'ts-ready-1',
            taskId: 'task-battle',
            title: 'Fix battle legacy types',
            kind: 'done'
        })
        const parsed = parseGoalTodoYaml(done, { goalId: 'goal-ts', goalKey: 'ts' })
        expect(parsed.sections[0]).toMatchObject({
            kind: 'done',
            title: 'Fix battle legacy types',
            taskId: 'task-battle',
            todoRef: 'ts-ready-1'
        })
    })

    it('inserts a yaml item when no existing todo item matches', () => {
        const updated = updateGoalTodoYaml('version: 1\ngoals: []\n', {
            goalId: 'goal-ts',
            goalKey: 'ts',
            goalTitle: 'Fix TS',
            todoRef: 'ts-ready-7',
            taskId: 'task-battle',
            title: 'Fix battle type contract',
            kind: 'promoted'
        })

        const parsed = parseGoalTodoYaml(updated, { goalId: 'goal-ts', goalKey: 'ts' })
        expect(parsed.sections[0]).toMatchObject({
            kind: 'promoted',
            title: 'Fix battle type contract',
            taskId: 'task-battle',
            todoRef: 'ts-ready-7'
        })
    })

    it('converts legacy markdown into yaml', () => {
        const markdown = [
            '# HOPI Todo',
            '',
            '## Goal ts — 修复ts问题',
            '',
            '### Active / promoted kanban',
            '',
            '- [active][todoRef:ts-ready-1] Fix battle legacy types -> task `task-battle`',
            '',
            '### Ready next batch',
            '',
            '- [ready][todoRef:ts-ready-2] Fix expedition fixtures',
            '  - Scope: test fixtures',
            '',
            '### Done',
            '',
            '- [done] Clarify goal intent -> task `task-plan`'
        ].join('\n')

        const yaml = convertGoalTodoMarkdownToYaml(markdown)
        const parsed = parseGoalTodoYaml(yaml, { goalId: 'ts', goalKey: 'ts' })

        expect(parsed.sections.map((section) => section.kind)).toEqual(['promoted', 'ready', 'done'])
        expect(parsed.sections[0]).toMatchObject({
            todoRef: 'ts-ready-1',
            taskId: 'task-battle'
        })
        expect(parsed.sections[1]).toMatchObject({
            todoRef: 'ts-ready-2',
            body: '- Scope: test fixtures'
        })
        expect(parsed.sections[2]).toMatchObject({
            todoRef: 'Clarify goal intent',
            taskId: 'task-plan'
        })
    })

    it('still parses legacy markdown for preview fallback', () => {
        const parsed = parseGoalTodoMarkdown([
            '# HOPI Todo',
            '',
            '## Goal `legacy-goal-id` - Legacy Goal',
            '',
            '### Ready',
            '',
            '- [ready][todoRef:restore-docs] Restore archive docs through storage adapter'
        ].join('\n'), {
            goalId: 'legacy-goal-id',
            goalKey: 'new-key'
        })

        expect(parsed.sections[0]).toMatchObject({
            kind: 'ready',
            title: 'Restore archive docs through storage adapter',
            todoRef: 'restore-docs'
        })
    })

    it('reads legacy todo.md as a fallback when no goal-local todo exists', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(docsRoot, { recursive: true })
        writeFileSync(join(docsRoot, 'todo.md'), [
            '# HOPI Todo',
            '',
            '## Goal legacy-goal - Legacy Goal',
            '',
            '### Ready',
            '',
            '- [ready][todoRef:restore-docs] Restore archive docs through storage adapter'
        ].join('\n'), 'utf8')

        const result = readGoalTodo({
            project: {} as never,
            goal: {
                id: 'goal-local-id',
                goalKey: 'legacy-goal',
                title: 'Legacy Goal'
            } as never,
            defaultWorkspace: {
                path: workspacePath
            } as never
        })

        expect(result.exists).toBe(true)
        expect(result.path).toBe(join(docsRoot, 'todo.md'))
        expect(existsSync(join(docsRoot, 'todo.md'))).toBe(true)
        expect(result.sections[0]).toMatchObject({
            kind: 'ready',
            title: 'Restore archive docs through storage adapter',
            todoRef: 'restore-docs'
        })
    })

    it('writes task state updates to the goal-local todo path', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goal = {
            id: 'goal-local-id',
            goalKey: 'legacy-goal',
            title: 'Legacy Goal'
        } as never

        const updated = updateGoalTodoTaskState({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never,
            todoRef: 'restore-docs',
            taskId: 'task-restore',
            title: 'Restore archive docs through storage adapter',
            kind: 'promoted'
        })

        const todoPath = join(workspacePath, '.hopi', 'docs', 'goals', 'legacy-goal', 'todo.yml')
        expect(updated).toBe(true)
        expect(existsSync(todoPath)).toBe(true)
        expect(readFileSync(todoPath, 'utf8')).toContain('taskId: task-restore')
    })
})
