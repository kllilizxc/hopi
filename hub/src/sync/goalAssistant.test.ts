import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../store'
import {
    appendGoalAssistantPlanningRequest,
    buildGoalAssistantSnapshot,
    writeGoalAssistantPreference
} from './goalAssistant'
import type { SyncEngine } from './syncEngine'
import { getDocsRoot, getGoalEventsPath, getGoalPlannerMailPath, getGoalPlanningRequestsPath, getLegacyPreferencePath, getPreferencePath } from './goals/goalDocPaths'

function encodeBase64(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64')
}

const tempDirs: string[] = []

function seedGoalStore(): {
    store: Store
    namespace: string
    machineId: string
    projectId: string
    goalId: string
    goalKey: string
    docsRoot: string
    workspacePath: string
} {
    const store = new Store(':memory:')
    const namespace = 'default'
    const machineId = 'machine-1'
    const projectId = 'project-1'
    const workspaceId = 'workspace-1'
    const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-assistant-'))
    tempDirs.push(workspacePath)
    const goalId = 'goal-1'
    const goalKey = 'goal-one'

    store.projects.createProject({
        id: projectId,
        namespace,
        machineId,
        name: 'Project'
    })
    store.workspaces.createWorkspace({
        id: workspaceId,
        projectId,
        path: workspacePath
    })
    store.projects.updateProject(projectId, namespace, { defaultWorkspaceId: workspaceId })
    store.goals.createGoal({
        id: goalId,
        projectId,
        namespace,
        goalKey,
        title: 'Goal One',
        status: 'active'
    })
    store.tasks.createTask({
        id: 'task-1',
        projectId,
        goalId,
        title: 'Existing Task',
        status: 'planning'
    })

    const workspace = store.workspaces.getWorkspace(workspaceId)
    const docsRoot = getDocsRoot(workspace)
    if (!docsRoot) {
        throw new Error('docsRoot unavailable in test seed')
    }

    const goalDir = join(docsRoot, 'goals', goalKey)
    mkdirSync(goalDir, { recursive: true })
    writeFileSync(join(goalDir, 'goal.md'), [
        '---',
        `goalKey: ${goalKey}`,
        'title: "Goal One"',
        'status: active',
        'autopilotEnabled: true',
        'deployRequiresApproval: true',
        '---',
        '',
        '# Goal One',
        '',
        '## Objective',
        '',
        'Keep Goal Assistant tests docs-backed by default.',
        ''
    ].join('\n'))

    return { store, namespace, machineId, projectId, goalId, goalKey, docsRoot, workspacePath }
}

function createEngine(overrides?: {
    readFileOnMachine?: SyncEngine['readFileOnMachine']
    writeFileOnMachine?: SyncEngine['writeFileOnMachine']
}): Pick<SyncEngine, 'getSessionsByNamespace' | 'readFileOnMachine' | 'writeFileOnMachine'> {
    return {
        getSessionsByNamespace() {
            return []
        },
        async readFileOnMachine(...args: Parameters<SyncEngine['readFileOnMachine']>) {
            if (overrides?.readFileOnMachine) {
                return await overrides.readFileOnMachine(...args)
            }
            return { success: false, error: 'missing' }
        },
        async writeFileOnMachine(...args: Parameters<SyncEngine['writeFileOnMachine']>) {
            if (overrides?.writeFileOnMachine) {
                return await overrides.writeFileOnMachine(...args)
            }
            return { success: true, hash: 'hash' }
        }
    }
}

afterEach(() => {
    for (const path of tempDirs.splice(0)) {
        rmSync(path, { recursive: true, force: true })
    }
})

describe('goalAssistant machine file helpers', () => {
    it('rejects stale DB-only goals with no canonical docs when building snapshots', async () => {
        const { store, namespace, projectId, goalId, goalKey, docsRoot } = seedGoalStore()
        rmSync(join(docsRoot, 'goals', goalKey), { recursive: true, force: true })

        await expect(buildGoalAssistantSnapshot({
            store,
            engine: createEngine(),
            namespace,
            projectId,
            goalId,
            machineFileTimeoutMs: 25
        })).rejects.toThrow('Goal not found')
    })

    it('decodes base64 planning requests and preference content in snapshots', async () => {
        const { store, namespace, machineId, projectId, goalId, goalKey, docsRoot } = seedGoalStore()
        const planningRequestsPath = getGoalPlanningRequestsPath(docsRoot, goalKey)
        const preferencePath = getPreferencePath(docsRoot)

        const engine = createEngine({
            async readFileOnMachine(_machineId, path) {
                if (path === planningRequestsPath) {
                    return {
                        success: true,
                        content: encodeBase64([
                            'version: 1',
                            'requests:',
                            '    - id: mail-1',
                            '      body: Investigate expedition loadout compile failure',
                            '      relatedTaskIds: ["task-1"]',
                            '      createdAt: 123',
                            '      status: pending'
                        ].join('\n'))
                    }
                }
                if (path === preferencePath) {
                    return {
                        success: true,
                        content: encodeBase64('# Preferences\n\n- Prefer concise summaries.\n')
                    }
                }
                return { success: false, error: 'not found' }
            }
        })

        const snapshot = await buildGoalAssistantSnapshot({
            store,
            engine,
            namespace,
            projectId,
            goalId,
            machineFileTimeoutMs: 25
        })

        expect(snapshot.planningRequests).toHaveLength(1)
        expect(snapshot.planningRequests[0]).toMatchObject({
            id: 'mail-1',
            body: 'Investigate expedition loadout compile failure'
        })
        expect(snapshot.preferenceMarkdown).toContain('Prefer concise summaries.')
    })

    it('ignores the legacy planner mail path when planning-requests.yml is missing', async () => {
        const { store, namespace, projectId, goalId, goalKey, docsRoot } = seedGoalStore()
        const legacyPlannerMailPath = getGoalPlannerMailPath(docsRoot, goalKey)

        const engine = createEngine({
            async readFileOnMachine(_machineId, path) {
                if (path === legacyPlannerMailPath) {
                    return {
                        success: true,
                        content: encodeBase64([
                            'version: 1',
                            'mail:',
                            '    - id: mail-legacy-1',
                            '      body: Legacy planner follow-through still pending',
                            '      relatedTaskIds: []',
                            '      createdAt: 456',
                            '      status: pending'
                        ].join('\n'))
                    }
                }
                return { success: false, error: 'not found' }
            }
        })

        const snapshot = await buildGoalAssistantSnapshot({
            store,
            engine,
            namespace,
            projectId,
            goalId,
            machineFileTimeoutMs: 25
        })

        expect(snapshot.planningRequests).toEqual([])
    })

    it('degrades snapshot reads when machine file RPC hangs', async () => {
        const { store, namespace, projectId, goalId } = seedGoalStore()
        store.goals.updateGoalByNamespace(goalId, namespace, {
            automationPausedAt: Date.now()
        })
        const engine = createEngine({
            readFileOnMachine() {
                return new Promise(() => {}) as ReturnType<SyncEngine['readFileOnMachine']>
            }
        })

        const startedAt = Date.now()
        const snapshot = await buildGoalAssistantSnapshot({
            store,
            engine,
            namespace,
            projectId,
            goalId,
            machineFileTimeoutMs: 10
        })
        const elapsedMs = Date.now() - startedAt

        expect(elapsedMs).toBeLessThan(250)
        expect(snapshot.goalAutomationPaused).toBe(true)
        expect(snapshot.planningRequests).toEqual([])
        expect(snapshot.preferenceMarkdown).toContain('No saved preferences yet.')
    })

    it('ignores the legacy docs preference path when the canonical file is missing', async () => {
        const { store, namespace, projectId, goalId, docsRoot } = seedGoalStore()
        const legacyPreferencePath = getLegacyPreferencePath(docsRoot)

        const engine = createEngine({
            async readFileOnMachine(_machineId, path) {
                if (path === legacyPreferencePath) {
                    return {
                        success: true,
                        content: encodeBase64('# Preferences\n\n- Prefer the legacy repo note until migration finishes.\n')
                    }
                }
                return { success: false, error: 'not found' }
            }
        })

        const snapshot = await buildGoalAssistantSnapshot({
            store,
            engine,
            namespace,
            projectId,
            goalId,
            machineFileTimeoutMs: 25
        })

        expect(snapshot.preferenceMarkdown).toContain('No saved preferences yet.')
    })

    it('prefers canonical goal.md metadata over stale DB goal fields in the snapshot', async () => {
        const { store, namespace, projectId, goalId, goalKey, docsRoot } = seedGoalStore()
        const goalDir = join(docsRoot, 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'goal.md'), [
            '---',
            `goalKey: ${goalKey}`,
            'title: "Goal Doc Title"',
            'status: blocked',
            'autopilotEnabled: false',
            'deployRequiresApproval: false',
            '---',
            '',
            '# Goal Doc Title',
            '',
            '## Objective',
            '',
            'Goal doc objective should drive the snapshot.',
            '',
            '## Success Criteria',
            '',
            '- Goal doc criteria should drive the snapshot.',
            '',
            '## Current Focus',
            '',
            'Goal doc focus should drive the snapshot.',
            ''
        ].join('\n'))
        store.goals.updateGoalByNamespace(goalId, namespace, {
            title: 'DB Goal Title',
            status: 'active',
            description: 'DB description should stay stale.',
            successCriteria: 'DB criteria should stay stale.',
            currentFocus: 'DB focus should stay stale.',
            autopilotEnabled: true,
            deployRequiresApproval: true
        })

        const snapshot = await buildGoalAssistantSnapshot({
            store,
            engine: createEngine(),
            namespace,
            projectId,
            goalId,
            machineFileTimeoutMs: 25
        })

        expect(snapshot.goalTitle).toBe('Goal Doc Title')
        expect(snapshot.goalStatus).toBe('blocked')
        expect(snapshot.goalDescription).toBe('Goal doc objective should drive the snapshot.')
        expect(snapshot.successCriteria).toBe('- Goal doc criteria should drive the snapshot.')
        expect(snapshot.currentFocus).toBe('Goal doc focus should drive the snapshot.')
        expect(snapshot.goalAutomationPaused).toBe(false)
        expect(store.goals.getGoalByNamespace(goalId, namespace)).toMatchObject({
            title: 'DB Goal Title',
            status: 'active',
            description: 'DB description should stay stale.',
            successCriteria: 'DB criteria should stay stale.',
            currentFocus: 'DB focus should stay stale.',
            autopilotEnabled: true,
            deployRequiresApproval: true
        })
    })

    it('does not expose succeeded runtime notes as blockers', async () => {
        const { store, namespace, projectId, goalId, goalKey, docsRoot } = seedGoalStore()
        const goalDir = join(docsRoot, 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Goal One',
            'items:',
            '  - ref: task-succeeded-runtime-note',
            '    taskId: task-succeeded-runtime-note',
            '    kind: engineering',
            '    status: in_progress',
            '    title: Running task with old runtime note',
            '    description: Keep runtime notes out of durable blockers.',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'), 'utf8')
        store.tasks.createTask({
            id: 'task-succeeded-runtime-note',
            projectId,
            goalId,
            goalTodoRef: 'task-succeeded-runtime-note',
            title: 'Running task with old runtime note',
            status: 'running',
            activeSessionId: 'session-1',
            initRuntime: {
                status: 'succeeded',
                sessionId: 'session-1',
                updatedAt: Date.now(),
                latestNote: 'Goal role continued in the linked session.'
            }
        })

        const snapshot = await buildGoalAssistantSnapshot({
            store,
            engine: createEngine(),
            namespace,
            projectId,
            goalId,
            machineFileTimeoutMs: 25
        })
        const task = snapshot.tasks.find((candidate) => candidate.id === 'task-succeeded-runtime-note')

        expect(task?.lane).toBe('in_progress')
        expect(task?.status).toBe('in_progress')
        expect(task?.blockers).toEqual([])
    })

    it('emits canonical task status in snapshots for legacy blocked overlays', async () => {
        const { store, namespace, projectId, goalId, goalKey, docsRoot } = seedGoalStore()
        const goalDir = join(docsRoot, 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Goal One',
            'items:',
            '  - ref: task-legacy-blocked-status',
            '    taskId: task-legacy-blocked-status',
            '    kind: engineering',
            '    status: planned',
            '    title: Scheduler blocked task',
            '    description: Preserve the canonical lane in snapshots.',
            '    acceptanceCriteria: []',
            '    dependencyTaskList: []'
        ].join('\n'), 'utf8')
        store.tasks.createTask({
            id: 'task-legacy-blocked-status',
            projectId,
            goalId,
            goalTodoRef: 'task-legacy-blocked-status',
            title: 'Scheduler blocked task',
            status: 'blocked',
            blockedReason: 'Runner offline or not connected. Start it on the machine and try again: hopi runner start',
            blockedSource: 'scheduler'
        })

        const snapshot = await buildGoalAssistantSnapshot({
            store,
            engine: createEngine(),
            namespace,
            projectId,
            goalId,
            machineFileTimeoutMs: 25
        })
        const task = snapshot.tasks.find((candidate) => candidate.id === 'task-legacy-blocked-status')

        expect(task).toMatchObject({
            status: 'planned',
            lane: 'planned'
        })
        expect(task?.blockers).toContain('Runner offline or not connected. Start it on the machine and try again: hopi runner start')
    })

    it('matches active runtime sessions whose metadata stores a canonical goal todo ref', async () => {
        const { store, namespace, projectId, goalId, goalKey, docsRoot, workspacePath } = seedGoalStore()
        const goalDir = join(docsRoot, 'goals', goalKey)
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            `  goalKey: ${goalKey}`,
            `  goalId: ${goalId}`,
            '  title: Goal One',
            'items:',
            '  - ref: canonical-runtime-ref',
            '    taskId: legacy-overlay-task-id',
            '    kind: engineering',
            '    status: in_progress',
            '    title: Canonical runtime linked task',
            '    description: Match active runtime sessions through canonical refs.',
            '    acceptanceCriteria: []',
            '    blockedBy: []'
        ].join('\n'), 'utf8')
        store.tasks.createTask({
            id: 'legacy-overlay-task-id',
            projectId,
            goalId,
            goalTodoRef: 'canonical-runtime-ref',
            title: 'Stale overlay runtime linked task',
            status: 'running',
            activeSessionId: 'session-canonical-runtime-ref'
        })

        const engine = createEngine()
        engine.getSessionsByNamespace = () => [{
            id: 'session-canonical-runtime-ref',
            namespace,
            seq: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            active: true,
            activeAt: Date.now(),
            metadata: {
                path: workspacePath,
                host: 'localhost',
                projectId,
                taskId: 'canonical-runtime-ref'
            },
            metadataVersion: 1,
            agentState: null,
            agentStateVersion: 1,
            thinking: true,
            thinkingAt: Date.now()
        }]

        const snapshot = await buildGoalAssistantSnapshot({
            store,
            engine,
            namespace,
            projectId,
            goalId,
            machineFileTimeoutMs: 25
        })

        expect(snapshot.activeRuntimes).toContainEqual({
            taskId: 'legacy-overlay-task-id',
            taskTitle: 'Canonical runtime linked task',
            lane: 'in_progress',
            sessionId: 'session-canonical-runtime-ref',
            thinking: true
        })
    })

    it('base64-encodes preference writes before machine RPC', async () => {
        const { machineId, docsRoot } = seedGoalStore()
        let capturedContent = ''
        const engine = createEngine({
            async writeFileOnMachine(_machineId, _path, options) {
                capturedContent = options.content
                return { success: true, hash: 'hash' }
            }
        })

        await writeGoalAssistantPreference({
            engine,
            machineId,
            docsRoot,
            markdown: '# Prefs\n\n- Keep Kanban answers short.\n',
            timeoutMs: 25
        })

        expect(Buffer.from(capturedContent, 'base64').toString('utf8')).toContain('Keep Kanban answers short.')
    })

    it('base64-encodes planning request writes before machine RPC', async () => {
        const { machineId, goalKey, docsRoot } = seedGoalStore()
        const planningRequestsPath = getGoalPlanningRequestsPath(docsRoot, goalKey)
        const eventsPath = getGoalEventsPath(docsRoot, goalKey)
        const capturedContentByPath = new Map<string, string>()
        const engine = createEngine({
            async readFileOnMachine(_machineId, path) {
                if (path === planningRequestsPath) {
                    return {
                        success: true,
                        content: encodeBase64('version: 1\nrequests: []\n')
                    }
                }
                return { success: false, error: 'not found' }
            },
            async writeFileOnMachine(_machineId, path, options) {
                capturedContentByPath.set(path, options.content)
                return { success: true, hash: 'hash' }
            }
        })

        const item = await appendGoalAssistantPlanningRequest({
            engine,
            machineId,
            docsRoot,
            goalKey,
            body: 'Please create a task for the expedition loadout duplicate export bug.',
            timeoutMs: 25
        })

        const decoded = Buffer.from(capturedContentByPath.get(planningRequestsPath) ?? '', 'base64').toString('utf8')
        const eventLog = Buffer.from(capturedContentByPath.get(eventsPath) ?? '', 'base64').toString('utf8')
        expect(item.body).toContain('duplicate export bug')
        expect(decoded).toContain('Please create a task for the expedition loadout duplicate export bug.')
        expect(decoded).toContain('version: 1')
        expect(decoded).toContain('requests:')
        expect(eventLog).toContain('planning_request_appended')
    })
})
