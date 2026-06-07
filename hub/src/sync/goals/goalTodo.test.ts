import { describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    canonicalizeGoalTodoYaml,
    ensureCanonicalGoalTodoYamlFile,
    parseGoalTodoYaml,
    readGoalTodo,
    upsertGoalTodoTaskState
} from './goalTodo'

describe('goal todo yaml', () => {
    it('ignores legacy goal-scoped yaml items when parsing todo.yml directly', () => {
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
        expect(parsed.board.items).toEqual([])
    })

    it('parses the canonical goal-local todo.yml shape', () => {
        const parsed = parseGoalTodoYaml([
            'version: 1',
            'goal:',
            '  goalKey: tutorial',
            '  title: Tutorial Goal',
            'items:',
            '  - ref: teaching-matrix',
            '    kind: planning',
            '    status: planned',
            '    title: Build teaching matrix',
            '    description: Produce the stable tutorial matrix.',
            '    acceptanceCriteria:',
            '      - Matrix is approved.',
            '    dependencyTaskList: []',
            '  - ref: tutorial-story-content',
            '    kind: engineering',
            '    status: blocked',
            '    title: Implement tutorial story content',
            '    description: Fill story content and first tutorial battle flow.',
            '    dependencyTaskList:',
            '      - ref: teaching-matrix',
            '    blockedBy:',
            '      - kind: decision',
            '        ref: choose-tone',
            '        summary: Waiting for user to choose tutorial narrative tone.'
        ].join('\n'), {
            goalId: 'tutorial',
            goalKey: 'tutorial'
        })

        expect(parsed.board.items[0]).toMatchObject({
            ref: 'teaching-matrix',
            kind: 'planning',
            status: 'planned',
            description: 'Produce the stable tutorial matrix.'
        })
        expect(parsed.board.items[1]).toMatchObject({
            ref: 'tutorial-story-content',
            kind: 'engineering',
            status: 'planned',
            blockedBy: [{
                kind: 'decision',
                ref: 'choose-tone',
                summary: 'Waiting for user to choose tutorial narrative tone.'
            }]
        })
    })

    it('normalizes legacy blocker kinds into the canonical blocker vocabulary', () => {
        const parsed = parseGoalTodoYaml([
            'version: 1',
            'goal:',
            '  goalKey: tutorial',
            '  title: Tutorial Goal',
            'items:',
            '  - ref: tutorial-story-content',
            '    kind: engineering',
            '    status: blocked',
            '    title: Implement tutorial story content',
            '    blockedBy:',
            '      - kind: preview',
            '        summary: Waiting for preview to become healthy.'
        ].join('\n'), {
            goalId: 'tutorial',
            goalKey: 'tutorial'
        })

        expect(parsed.board.items[0]?.blockedBy).toEqual([
            {
                kind: 'intervention',
                ref: null,
                summary: 'Waiting for preview to become healthy.'
            }
        ])
        expect(parsed.board.items[0]?.status).toBe('planned')
    })

    it('canonicalizes blocked canonical items back to a durable lane plus blockers', () => {
        const canonicalized = canonicalizeGoalTodoYaml([
            'version: 1',
            'goal:',
            '  goalKey: tutorial',
            '  title: Tutorial Goal',
            'items:',
            '  - ref: tutorial-story-content',
            '    kind: engineering',
            '    status: blocked',
            '    title: Implement tutorial story content',
            '    blockedBy:',
            '      - kind: preview',
            '        summary: Waiting for preview to become healthy.'
        ].join('\n'), {
            goalId: 'tutorial',
            goalKey: 'tutorial'
        })

        expect(canonicalized).toContain('status: planned')
        expect(canonicalized).not.toContain('status: blocked')
        expect(canonicalized).toContain('kind: intervention')
        expect(canonicalized).not.toContain('kind: preview')
    })

    it('moves yaml items through promoted and done states', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goal = {
            id: 'goal-ts',
            goalKey: 'ts',
            title: 'Fix TS'
        } as never
        const todoPath = join(workspacePath, '.hopi', 'docs', 'goals', 'ts', 'todo.yml')
        mkdirSync(join(workspacePath, '.hopi', 'docs', 'goals', 'ts'), { recursive: true })
        writeFileSync(todoPath, [
            'version: 1',
            'goals:',
            '  - goalKey: ts',
            '    goalId: goal-ts',
            '    title: Fix TS',
            '    items:',
            '      - ref: ts-ready-1',
            '        status: ready',
            '        title: Fix battle legacy types'
        ].join('\n'), 'utf8')

        const promoted = upsertGoalTodoTaskState({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never,
            taskId: 'ts-ready-1',
            status: 'running',
            taskKind: 'engineering',
            title: 'Fix battle legacy types',
            body: null
        })
        expect(promoted).toBe(true)

        const promotedYaml = readFileSync(todoPath, 'utf8')
        expect(promotedYaml).toContain('goal:')
        expect(promotedYaml).toContain('items:')
        expect(promotedYaml).toContain('status: in_progress')
        expect(promotedYaml).not.toContain('goals:')
        expect(promotedYaml).not.toContain('tag: promoted')
        expect(promotedYaml).not.toContain('taskId:')

        const done = upsertGoalTodoTaskState({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never,
            taskId: 'ts-ready-1',
            status: 'done',
            tag: 'accepted',
            taskKind: 'engineering',
            title: 'Fix battle legacy types',
            body: null
        })
        expect(done).toBe(true)

        const parsed = parseGoalTodoYaml(readFileSync(todoPath, 'utf8'), { goalId: 'goal-ts', goalKey: 'ts' })
        expect(parsed.board.items[0]).toMatchObject({
            ref: 'ts-ready-1',
            kind: 'engineering',
            status: 'done',
            title: 'Fix battle legacy types'
        })
    })

    it('inserts a yaml item when no existing todo item matches', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goal = {
            id: 'goal-ts',
            goalKey: 'ts',
            title: 'Fix TS'
        } as never
        const todoPath = join(workspacePath, '.hopi', 'docs', 'goals', 'ts', 'todo.yml')
        mkdirSync(join(workspacePath, '.hopi', 'docs', 'goals', 'ts'), { recursive: true })
        writeFileSync(todoPath, 'version: 1\ngoals: []\n', 'utf8')

        const updated = upsertGoalTodoTaskState({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never,
            taskId: 'ts-ready-7',
            status: 'running',
            taskKind: 'engineering',
            title: 'Fix battle type contract',
            body: null
        })

        expect(updated).toBe(true)
        const yaml = readFileSync(todoPath, 'utf8')
        const parsed = parseGoalTodoYaml(yaml, { goalId: 'goal-ts', goalKey: 'ts' })
        expect(parsed.board.items[0]).toMatchObject({
            ref: 'ts-ready-7',
            kind: 'engineering',
            status: 'in_progress',
            title: 'Fix battle type contract'
        })
        expect(yaml).toContain('goal:')
        expect(yaml).not.toContain('goals:')
    })

    it('updates canonical yaml without falling back to the legacy shape', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goal = {
            id: 'goal-ts',
            goalKey: 'ts',
            title: 'Fix TS'
        } as never
        const todoPath = join(workspacePath, '.hopi', 'docs', 'goals', 'ts', 'todo.yml')
        mkdirSync(join(workspacePath, '.hopi', 'docs', 'goals', 'ts'), { recursive: true })
        writeFileSync(todoPath, [
            'version: 1',
            'goal:',
            '  goalKey: ts',
            '  title: Fix TS',
            'items:',
            '  - ref: ts-ready-1',
            '    kind: engineering',
            '    status: planned',
            '    title: Fix battle legacy types',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'), 'utf8')

        const updated = upsertGoalTodoTaskState({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never,
            taskId: 'ts-ready-1',
            status: 'running',
            taskKind: 'engineering',
            title: 'Fix battle legacy types',
            body: null
        })

        expect(updated).toBe(true)
        const yaml = readFileSync(todoPath, 'utf8')
        expect(yaml).toContain('goal:')
        expect(yaml).toContain('ref: ts-ready-1')
        expect(yaml).toContain('kind: engineering')
        expect(yaml).toContain('status: in_progress')
        expect(yaml).not.toContain('goals:')
        expect(yaml).not.toContain('tag: promoted')
    })

    it('writes blocker metadata for in-progress canonical items without collapsing the lane', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goal = {
            id: 'goal-ts',
            goalKey: 'ts',
            title: 'Fix TS'
        } as never
        const todoPath = join(workspacePath, '.hopi', 'docs', 'goals', 'ts', 'todo.yml')
        mkdirSync(join(workspacePath, '.hopi', 'docs', 'goals', 'ts'), { recursive: true })
        writeFileSync(todoPath, [
            'version: 1',
            'goal:',
            '  goalKey: ts',
            '  title: Fix TS',
            'items:',
            '  - ref: ts-ready-1',
            '    kind: engineering',
            '    status: planned',
            '    title: Fix battle legacy types',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'), 'utf8')

        const updated = upsertGoalTodoTaskState({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never,
            taskId: 'ts-ready-1',
            status: 'running',
            taskKind: 'engineering',
            title: 'Fix battle legacy types',
            body: null,
            blocked: {
                kind: 'init',
                summary: 'setup.steps must not be empty',
                updatedAt: Date.now()
            }
        })

        expect(updated).toBe(true)
        const yaml = readFileSync(todoPath, 'utf8')
        expect(yaml).toContain('status: in_progress')
        expect(yaml).toContain('blockedBy:')
        expect(yaml).toContain('kind: intervention')
        expect(yaml).toContain('summary: setup.steps must not be empty')
    })

    it('does not read legacy todo.md as an implicit fallback when no goal-local todo exists', () => {
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

        expect(existsSync(join(docsRoot, 'todo.md'))).toBe(true)
        expect(existsSync(join(docsRoot, 'goals', 'legacy-goal', 'todo.yml'))).toBe(false)
        expect(result.board.items).toEqual([])
    })

    it('does not read legacy root todo.yml as an implicit fallback when no goal-local todo exists', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(docsRoot, { recursive: true })
        writeFileSync(join(docsRoot, 'todo.yml'), [
            'version: 1',
            'goals:',
            '  - goalKey: legacy-goal',
            '    items:',
            '      - ref: restore-docs',
            '        status: ready',
            '        title: Restore archive docs through storage adapter'
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

        expect(existsSync(join(docsRoot, 'todo.yml'))).toBe(true)
        expect(existsSync(join(docsRoot, 'goals', 'legacy-goal', 'todo.yml'))).toBe(false)
        expect(result.board.items).toEqual([])
    })

    it('does not canonicalize an existing legacy goal-local todo.yml through the ensure helper', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'helper-goal')
        mkdirSync(goalDir, { recursive: true })
        const todoPath = join(goalDir, 'todo.yml')
        writeFileSync(todoPath, [
            'version: 1',
            'goals:',
            '  - goalKey: helper-goal',
            '    goalId: helper-goal-id',
            '    title: Helper Goal',
            '    items:',
            '      - ref: helper-ready',
            '        status: ready',
            '        title: Canonicalize me'
        ].join('\n'), 'utf8')

        const ensured = ensureCanonicalGoalTodoYamlFile({
            defaultWorkspace: {
                path: workspacePath
            } as never,
            scope: {
                goalId: 'helper-goal-id',
                goalKey: 'helper-goal'
            },
            goalTitle: 'Helper Goal'
        })

        expect(ensured?.migrated).toBe(false)
        expect(ensured?.rawYaml).toContain('goals:')
        expect(ensured?.rawYaml).not.toContain('goal:')
        expect(readFileSync(todoPath, 'utf8')).toContain('status: ready')
    })

    it('canonicalizes an existing blocked canonical goal-local todo.yml through the ensure helper', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'blocked-goal')
        mkdirSync(goalDir, { recursive: true })
        const todoPath = join(goalDir, 'todo.yml')
        writeFileSync(todoPath, [
            'version: 1',
            'goal:',
            '  goalKey: blocked-goal',
            '  goalId: blocked-goal-id',
            '  title: Blocked Goal',
            'items:',
            '  - ref: blocked-item',
            '    kind: engineering',
            '    status: blocked',
            '    title: Canonicalize blocked canonical item',
            '    blockedBy:',
            '      - kind: preview',
            '        summary: Waiting for preview to become healthy.'
        ].join('\n'), 'utf8')

        const ensured = ensureCanonicalGoalTodoYamlFile({
            defaultWorkspace: {
                path: workspacePath
            } as never,
            scope: {
                goalId: 'blocked-goal-id',
                goalKey: 'blocked-goal'
            },
            goalTitle: 'Blocked Goal'
        })

        expect(ensured?.migrated).toBe(true)
        expect(ensured?.rawYaml).toContain('status: planned')
        expect(ensured?.rawYaml).not.toContain('status: blocked')
        expect(ensured?.rawYaml).toContain('kind: intervention')
        const rewritten = readFileSync(todoPath, 'utf8')
        expect(rewritten).toContain('status: planned')
        expect(rewritten).not.toContain('status: blocked')
    })

    it('does not read or rewrite an existing legacy goal-local todo.yml on the main read path', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'read-goal')
        mkdirSync(goalDir, { recursive: true })
        const todoPath = join(goalDir, 'todo.yml')
        writeFileSync(todoPath, [
            'version: 1',
            'goals:',
            '  - goalKey: read-goal',
            '    goalId: read-goal-id',
            '    title: Read Goal',
            '    items:',
            '      - ref: read-ready',
            '        status: ready',
            '        title: Canonicalize on read'
        ].join('\n'), 'utf8')

        const result = readGoalTodo({
            project: {} as never,
            goal: {
                id: 'read-goal-id',
                goalKey: 'read-goal',
                title: 'Read Goal'
            } as never,
            defaultWorkspace: {
                path: workspacePath
            } as never
        })

        expect(result.board.items).toEqual([])
        const rewritten = readFileSync(todoPath, 'utf8')
        expect(rewritten).toContain('goals:')
        expect(rewritten).not.toContain('goal:')
        expect(rewritten).toContain('status: ready')
    })

    it('writes task state updates to the goal-local todo path', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goal = {
            id: 'goal-local-id',
            goalKey: 'legacy-goal',
            title: 'Legacy Goal'
        } as never

        const updated = upsertGoalTodoTaskState({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never,
            taskId: 'restore-docs',
            status: 'running',
            taskKind: 'engineering',
            title: 'Restore archive docs through storage adapter',
            body: null
        })

        const todoPath = join(workspacePath, '.hopi', 'docs', 'goals', 'legacy-goal', 'todo.yml')
        expect(updated).toBe(true)
        expect(existsSync(todoPath)).toBe(true)
        const todo = readFileSync(todoPath, 'utf8')
        expect(todo).toContain('ref: restore-docs')
        expect(todo).toContain('kind: engineering')
        expect(todo).toContain('status: in_progress')
        expect(todo).toContain('goal:')
        expect(todo).not.toContain('goals:')
        expect(todo).not.toContain('taskId:')
    })

    it('defaults plain planning writes to planned instead of candidate', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goal = {
            id: 'goal-local-id',
            goalKey: 'legacy-goal',
            title: 'Legacy Goal'
        } as never

        const updated = upsertGoalTodoTaskState({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never,
            taskId: 'plan-follow-up',
            status: 'planning',
            taskKind: 'engineering',
            title: 'Plan the next follow-up',
            body: null
        })

        expect(updated).toBe(true)
        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', 'legacy-goal', 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: plan-follow-up')
        expect(todo).toContain('status: planned')
        expect(todo).not.toContain('status: candidate')
    })

    it('canonicalizes an existing legacy goal-local todo.yml on write', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goal = {
            id: 'goal-local-id',
            goalKey: 'legacy-goal',
            title: 'Legacy Goal'
        } as never
        const todoPath = join(workspacePath, '.hopi', 'docs', 'goals', 'legacy-goal', 'todo.yml')
        mkdirSync(join(workspacePath, '.hopi', 'docs', 'goals', 'legacy-goal'), { recursive: true })
        writeFileSync(todoPath, [
            'version: 1',
            'goals:',
            '  - goalKey: legacy-goal',
            '    goalId: goal-local-id',
            '    title: Legacy Goal',
            '    items:',
            '      - ref: restore-docs',
            '        status: ready',
            '        title: Restore archive docs through storage adapter'
        ].join('\n'), 'utf8')

        const updated = upsertGoalTodoTaskState({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never,
            taskId: 'restore-docs',
            status: 'running',
            taskKind: 'engineering',
            title: 'Restore archive docs through storage adapter',
            body: null
        })

        expect(updated).toBe(true)
        const todo = readFileSync(todoPath, 'utf8')
        expect(todo).toContain('goal:')
        expect(todo).toContain('items:')
        expect(todo).toContain('status: in_progress')
        expect(todo).not.toContain('goals:')
        expect(todo).not.toContain('status: ready')
    })

    it('normalizes blocked todo writes into canonical blocker kinds', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-todo-'))
        const goal = {
            id: 'goal-local-id',
            goalKey: 'legacy-goal',
            title: 'Legacy Goal'
        } as never

        const updated = upsertGoalTodoTaskState({
            project: {} as never,
            goal,
            defaultWorkspace: {
                path: workspacePath
            } as never,
            taskId: 'task-restore',
            status: 'blocked',
            blocked: {
                kind: 'preview',
                summary: 'Waiting for preview to become healthy.',
                updatedAt: null
            },
            taskKind: 'engineering',
            title: 'Restore archive docs through storage adapter',
            body: null
        })

        expect(updated).toBe(true)
        const todo = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', 'legacy-goal', 'todo.yml'), 'utf8')
        expect(todo).toContain('kind: intervention')
        expect(todo).not.toContain('kind: preview')
    })
})
