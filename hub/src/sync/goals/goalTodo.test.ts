import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { convertGoalTodoMarkdownToYaml, parseGoalTodoMarkdown, parseGoalTodoYaml, readGoalTodo, updateGoalTodoTaskState, updateGoalTodoYaml } from './goalTodo'

describe('goal todo yaml', () => {
    it('parses goal-scoped yaml items by goalKey', () => {
        const parsed = parseGoalTodoYaml([
            'version: 1',
            'goal:',
            '  goalKey: mobile-remote-control',
            '  title: Mobile remote control',
            'items:',
            '  - ref: reconnect-indicator',
            '    status: planned',
            '    title: Add reconnect indicator',
            '  - ref: resume-affordance',
            '    status: candidate',
            '    title: Improve resume affordance'
        ].join('\n'), {
            goalId: 'local-db-id',
            goalKey: 'mobile-remote-control'
        })

        expect(parsed.rawYaml).toContain('goal:')
        expect(parsed.rawYaml).not.toContain('goals:')
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
            'goal:',
            '  goalKey: ts',
            '  title: Fix TS',
            'items:',
            '  - ref: ts-ready-1',
            '    status: planned',
            '    title: Fix battle legacy types'
        ].join('\n')

        const promoted = updateGoalTodoYaml(yaml, {
            goalId: 'goal-ts',
            goalKey: 'ts',
            todoRef: 'ts-ready-1',
            taskId: 'task-battle',
            title: 'Fix battle legacy types',
            kind: 'promoted'
        })
        expect(promoted).toContain('goal:')
        expect(promoted).not.toContain('goals:')
        expect(promoted).toContain('ref: ts-ready-1')
        expect(promoted).not.toContain('id: ts-ready-1')
        expect(promoted).toContain('status: in_progress')
        expect(promoted).not.toContain('tag:')
        expect(promoted).not.toContain('taskId:')

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
            status: 'done',
            tag: 'accepted',
            title: 'Fix battle legacy types',
            taskId: 'ts-ready-1',
            todoRef: 'ts-ready-1'
        })
    })

    it('inserts a yaml item when no existing todo item matches', () => {
        const updated = updateGoalTodoYaml('version: 1\ngoal:\n  goalKey: ts\n  title: Fix TS\nitems: []\n', {
            goalId: 'goal-ts',
            goalKey: 'ts',
            goalTitle: 'Fix TS',
            todoRef: 'ts-ready-7',
            taskId: 'task-battle',
            title: 'Fix battle type contract',
            kind: 'promoted'
        })

        expect(updated).toContain('goal:')
        expect(updated).not.toContain('goals:')
        expect(updated).toContain('ref: ts-ready-7')
        expect(updated).not.toContain('id: ts-ready-7')
        expect(updated).toContain('status: in_progress')
        const parsed = parseGoalTodoYaml(updated, { goalId: 'goal-ts', goalKey: 'ts' })
        expect(parsed.sections[0]).toMatchObject({
            kind: 'promoted',
            status: 'running',
            tag: 'promoted',
            title: 'Fix battle type contract',
            taskId: 'ts-ready-7',
            todoRef: 'ts-ready-7'
        })
    })

    it('refreshes goal metadata when writing an existing goal todo file', () => {
        const updated = updateGoalTodoYaml([
            'version: 1',
            'goal:',
            '  goalKey: deck-manager',
            '  goalId: old-imported-goal-id',
            '  title: Old title',
            'items:',
            '  - ref: deck-model',
            '    status: candidate',
            '    title: Define deck model'
        ].join('\n'), {
            goalId: 'current-db-goal-id',
            goalKey: 'deck-manager',
            goalTitle: 'Deck Manager',
            todoRef: 'deck-model',
            taskId: 'deck-model',
            title: 'Define deck model',
            kind: 'planning'
        })

        expect(updated).toContain('goalId: current-db-goal-id')
        expect(updated).toContain('title: Deck Manager')
        expect(updated).not.toContain('old-imported-goal-id')
        expect(updated).not.toContain('Old title')
    })

    it('normalizes legacy deferred todo items into candidate reservoir items', () => {
        const parsed = parseGoalTodoYaml([
            'version: 1',
            'goal:',
            '  goalKey: deck-manager',
            'items:',
            '  - ref: later-pass',
            '    status: deferred',
            '    title: Parked follow-up',
            '  - ref: tagged-deferred',
            '    status: planned',
            '    tag: deferred',
            '    title: Legacy tagged follow-up'
        ].join('\n'), {
            goalId: 'goal-deck',
            goalKey: 'deck-manager'
        })

        expect(parsed.sections.map((section) => section.kind)).toEqual(['candidate', 'candidate'])
        expect(parsed.sections.map((section) => section.status)).toEqual(['planning', 'planning'])
        expect(parsed.sections.map((section) => section.tag)).toEqual(['candidate', 'candidate'])
        expect(parsed.rawYaml).toContain('status: candidate')
        expect(parsed.rawYaml).not.toContain('status: deferred')
        expect(parsed.rawYaml).not.toContain('tag: deferred')
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
            taskId: 'ts-ready-1'
        })
        expect(parsed.sections[1]).toMatchObject({
            todoRef: 'ts-ready-2',
            body: '- Scope: test fixtures'
        })
        expect(parsed.sections[2]).toMatchObject({
            todoRef: 'task-plan',
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
        const todo = readFileSync(todoPath, 'utf8')
        expect(todo).toContain('goal:')
        expect(todo).not.toContain('goals:')
        expect(todo).toContain('ref: restore-docs')
        expect(todo).not.toContain('id: restore-docs')
        expect(todo).toContain('status: in_progress')
        expect(todo).not.toContain('tag:')
        expect(todo).not.toContain('taskId:')
    })

    it('keeps the last valid projection and does not overwrite corrupt todo yaml', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goal = {
            id: 'goal-local-id',
            goalKey: 'parse-error-goal',
            title: 'Parse Error Goal'
        } as never
        const todoPath = join(workspacePath, '.hopi', 'docs', 'goals', 'parse-error-goal', 'todo.yml')
        mkdirSync(join(workspacePath, '.hopi', 'docs', 'goals', 'parse-error-goal'), { recursive: true })
        writeFileSync(todoPath, [
            'version: 1',
            'goal:',
            '  goalKey: parse-error-goal',
            '  goalId: goal-local-id',
            '  title: Parse Error Goal',
            'items:',
            '  - ref: keep-me',
            '    status: planned',
            '    title: Keep the valid task',
            ''
        ].join('\n'), 'utf8')

        const valid = readGoalTodo({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never
        })
        expect(valid.sections.map((section) => section.id)).toEqual(['keep-me'])

        const corruptYaml = [
            'version: 1',
            'goal:',
            '  goalKey: parse-error-goal',
            'items:',
            '  - ref: broken',
            '    status: planned',
            '    title: Broken task',
            '    broken: [',
            ''
        ].join('\n')
        writeFileSync(todoPath, corruptYaml, 'utf8')

        const corrupt = readGoalTodo({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never
        }) as ReturnType<typeof readGoalTodo> & { parseError?: string | null }
        expect(corrupt.parseError).toContain('todo.yml parse error')
        expect(corrupt.sections.map((section) => section.id)).toEqual(['keep-me'])

        const updated = updateGoalTodoTaskState({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never,
            todoRef: 'keep-me',
            taskId: 'keep-me',
            title: 'Keep the valid task',
            kind: 'done'
        })

        expect(updated).toBe(false)
        expect(readFileSync(todoPath, 'utf8')).toBe(corruptYaml)
    })
})
