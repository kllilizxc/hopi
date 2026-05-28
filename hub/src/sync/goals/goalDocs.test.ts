import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { bootstrapGoalDocs } from './goalDocs'
import type { StoredGoal, StoredProject, StoredWorkspace } from '../../store'

const tempDirs: string[] = []

function createWorkspace(): StoredWorkspace {
    const path = mkdtempSync(join(tmpdir(), 'hopi-goal-docs-'))
    tempDirs.push(path)
    return {
        id: 'workspace-1',
        projectId: 'project-1',
        label: null,
        path,
        sort: null,
        createdAt: 1,
        updatedAt: 1
    } as StoredWorkspace
}

function createProject(): StoredProject {
    return {
        id: 'project-1',
        namespace: 'default',
        machineId: 'machine-1',
        name: 'Goal Docs Project',
        defaultWorkspaceId: 'workspace-1',
        defaultAgentFlavor: 'codex',
        defaultPermissionMode: null,
        defaultModel: null,
        defaultModelMode: null,
        defaultSessionType: 'worktree',
        worktreeTargetBranch: null,
        worktreeCleanupAfterMerge: false,
        worktreeAutoCommitMode: 'off',
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null
    } as StoredProject
}

function createGoal(): StoredGoal {
    return {
        id: 'goal-1',
        projectId: 'project-1',
        namespace: 'default',
        goalKey: 'goal-a',
        title: 'Goal A',
        description: 'Goal docs test',
        status: 'active',
        successCriteria: null,
        autopilotEnabled: true,
        automationPausedAt: null,
        deployRequiresApproval: false,
        currentFocus: null,
        createdAt: 1,
        updatedAt: 1,
        archivedAt: null
    } as StoredGoal
}

function runKanban(workspacePath: string, args: string[]): { status: number | null; stdout: string; stderr: string } {
    const result = spawnSync('node', ['.hopi/skills/kanban/todo.mjs', ...args], {
        cwd: workspacePath,
        encoding: 'utf8'
    })
    return {
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr
    }
}

afterEach(() => {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
})

describe('bootstrapGoalDocs', () => {
    it('installs a self-contained project-local kanban skill that writes todo.yml and events.jsonl', () => {
        const workspace = createWorkspace()
        const project = createProject()
        const goal = createGoal()

        bootstrapGoalDocs({ project, goal, defaultWorkspace: workspace })

        const skillPath = join(workspace.path, '.hopi', 'skills', 'kanban', 'SKILL.md')
        const todoScriptPath = join(workspace.path, '.hopi', 'skills', 'kanban', 'todo.mjs')
        const yamlScriptPath = join(workspace.path, '.hopi', 'skills', 'kanban', 'yaml.mjs')
        expect(existsSync(skillPath)).toBe(true)
        expect(existsSync(todoScriptPath)).toBe(true)
        expect(existsSync(yamlScriptPath)).toBe(true)
        expect(readFileSync(todoScriptPath, 'utf8')).not.toContain("from 'yaml'")
        expect(readFileSync(todoScriptPath, 'utf8')).not.toContain('bun')

        const addFirst = runKanban(workspace.path, [
            'add',
            '--goal',
            goal.goalKey,
            '--ref',
            'first',
            '--title',
            'First task',
            '--status',
            'planned'
        ])
        expect(addFirst.status).toBe(0)

        const addSecond = runKanban(workspace.path, [
            'add',
            '--goal',
            goal.goalKey,
            '--ref',
            'second',
            '--title',
            'Second task',
            '--status',
            'planned'
        ])
        expect(addSecond.status).toBe(0)

        const link = runKanban(workspace.path, [
            'link-dependency',
            '--goal',
            goal.goalKey,
            '--ref',
            'second',
            '--depends-on',
            'first'
        ])
        expect(link.status).toBe(0)

        const cycle = runKanban(workspace.path, [
            'link-dependency',
            '--goal',
            goal.goalKey,
            '--ref',
            'first',
            '--depends-on',
            'second'
        ])
        expect(cycle.status).not.toBe(0)
        expect(cycle.stderr).toContain('dependency cycle')

        const list = runKanban(workspace.path, ['list', '--goal', goal.goalKey])
        expect(list.status).toBe(0)
        const listed = JSON.parse(list.stdout) as {
            ok: true
            items: Array<{ ref: string; status: string; dependencyTaskList?: Array<{ ref: string }> }>
        }
        expect(listed.items.map((item) => item.ref)).toEqual(['first', 'second'])
        expect(listed.items[1]?.dependencyTaskList).toEqual([{ ref: 'first' }])

        const todoYaml = readFileSync(join(workspace.path, '.hopi', 'docs', 'goals', goal.goalKey, 'todo.yml'), 'utf8')
        expect(todoYaml).toContain('ref: first')
        expect(todoYaml).toContain('ref: second')
        expect(todoYaml).toContain('dependencyTaskList:')

        const events = readFileSync(join(workspace.path, '.hopi', 'docs', 'goals', goal.goalKey, 'events.jsonl'), 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as { action: string; writer: string })
        expect(events.map((event) => event.action)).toEqual([
            'item_added',
            'item_added',
            'dependency_linked'
        ])
        expect(events.every((event) => event.writer === 'kanban_skill')).toBe(true)
    })
})
