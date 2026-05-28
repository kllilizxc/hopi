import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { StoredGoal, StoredProject, StoredWorkspace } from '../../store'
import { appendGoalEvent } from './goalEvents'

const tempDirs: string[] = []

function createWorkspace(): StoredWorkspace {
    const path = mkdtempSync(join(tmpdir(), 'hopi-goal-events-'))
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
        name: 'Goal Events Project',
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
        description: null,
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

afterEach(() => {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
})

describe('goal events', () => {
    it('appends server events with the canonical timestamp field', () => {
        const workspace = createWorkspace()
        const project = createProject()
        const goal = createGoal()
        const now = Date.UTC(2026, 0, 2, 3, 4, 5)

        appendGoalEvent({
            project,
            goal,
            defaultWorkspace: workspace,
            action: 'task_created',
            entity: {
                type: 'task',
                id: 'task-1'
            },
            now
        })

        const eventsPath = join(workspace.path, '.hopi', 'docs', 'goals', goal.goalKey, 'events.jsonl')
        const event = JSON.parse(readFileSync(eventsPath, 'utf8').trim()) as {
            timestamp?: string
            createdAt?: number
        }
        expect(event.timestamp).toBe(new Date(now).toISOString())
        expect(event.createdAt).toBe(now)
    })
})
