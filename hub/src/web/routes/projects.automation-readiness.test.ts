import { describe, expect, it } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { Store } from '../../store'
import { createProjectsRoutes } from './projects'
import type { SyncEngine } from '../../sync/syncEngine'

function encodeBase64(value: string): string {
    return Buffer.from(value, 'utf8').toString('base64')
}

function createTestApp(store: Store, engine: SyncEngine): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('userId', 1)
        setContext('namespace', 'default')
        await next()
    })
    app.route('/api', createProjectsRoutes({ store, getSyncEngine: () => engine }))
    return app
}

function seedProject(store: Store, path = '/tmp/hopi-ready'): { projectId: string } {
    const projectId = randomUUID()
    const workspaceId = randomUUID()
    store.projects.createProject({
        id: projectId,
        namespace: 'default',
        machineId: 'machine-1',
        name: 'Project Ready'
    })
    store.workspaces.createWorkspace({
        id: workspaceId,
        projectId,
        path,
        label: 'Main'
    })
    store.projects.updateProject(projectId, 'default', { defaultWorkspaceId: workspaceId })
    store.tasks.createTask({
        id: randomUUID(),
        projectId,
        title: 'Initialize project scripts',
        status: 'planned',
        source: 'project_init',
        workflowProfile: 'default'
    })
    return { projectId }
}

describe('project automation readiness verification', () => {
    it('marks project ready when actions manifest exists and parses', async () => {
        const store = new Store(':memory:')
        const { projectId } = seedProject(store, '/tmp/project-ready')
        const engine = {
            getMachine() {
                return { id: 'machine-1', namespace: 'default', active: true }
            },
            checkPathsExist(_machineId: string, paths: string[]) {
                return Promise.resolve(Object.fromEntries(paths.map((path) => [path, true])))
            },
            readFileOnMachine() {
                return Promise.resolve({
                    success: true,
                    content: encodeBase64([
                        'version: 1',
                        'setup:',
                        '  steps:',
                        '    - id: deps',
                        '      type: run',
                        '      cwd: .',
                        '      run: ["bun", "install"]',
                        'preview:',
                        '  services:',
                        '    - id: web',
                        '      type: run',
                        '      cwd: .',
                        '      run: ["bun", "run", "dev"]',
                        '      ready:',
                        '        type: process_alive',
                        '      expose: primary',
                        'merge:',
                        '  targetBranch: main',
                        '  strategy: squash'
                    ].join('\n'))
                })
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/projects/${projectId}/verify-automation`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            project: { automationReadinessStatus?: string; automationReadinessSummary?: string | null }
        }
        expect(body.project.automationReadinessStatus).toBe('ready')
        expect(body.project.automationReadinessSummary).toContain('OK .hopi/actions.yaml')
        expect(body.project.automationReadinessSummary).toContain('OK setup workflow')
        expect(body.project.automationReadinessSummary).toContain('OK preview stack')
        expect(body.project.automationReadinessSummary).toContain('OK merge workflow')

        const stored = store.projects.getProjectByNamespace(projectId, 'default')
        expect(stored?.automationReadinessStatus).toBe('ready')
    })

    it('marks project blocked when actions manifest is missing', async () => {
        const store = new Store(':memory:')
        const { projectId } = seedProject(store, '/tmp/project-degraded')
        const engine = {
            getMachine() {
                return { id: 'machine-1', namespace: 'default', active: true }
            },
            checkPathsExist(_machineId: string, paths: string[]) {
                return Promise.resolve(Object.fromEntries(paths.map((path) => [path, !path.endsWith('actions.yaml')])))
            },
            readFileOnMachine() {
                return Promise.resolve({ success: false, error: 'missing' })
            },
            handleRealtimeEvent() {
            }
        } as unknown as SyncEngine

        const app = createTestApp(store, engine)
        const response = await app.request(`/api/projects/${projectId}/verify-automation`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({})
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            project: { automationReadinessStatus?: string; automationReadinessSummary?: string | null }
        }
        expect(body.project.automationReadinessStatus).toBe('blocked')
        expect(body.project.automationReadinessSummary).toContain('Issue .hopi/actions.yaml')
        expect(body.project.automationReadinessSummary).toContain('Issue preview stack')

        const stored = store.projects.getProjectByNamespace(projectId, 'default')
        expect(stored?.automationReadinessStatus).toBe('blocked')
    })
})
