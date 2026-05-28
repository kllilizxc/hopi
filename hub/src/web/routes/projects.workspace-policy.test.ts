import { describe, expect, it } from 'bun:test'
import { PRODUCT_ENV } from '@hopi/protocol/brand'
import { Hono } from 'hono'
import { Store } from '../../store'
import type { SyncEngine } from '../../sync/syncEngine'
import { createProjectsRoutes } from './projects'
import { createWorkspacesRoutes } from './workspaces'

function createTestApp(store: Store, engine: SyncEngine | null = null): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('userId', 1)
        setContext('namespace', 'default')
        await next()
    })
    app.route('/api', createProjectsRoutes({ store, getSyncEngine: () => engine }))
    app.route('/api', createWorkspacesRoutes({ store, getSyncEngine: () => engine }))
    return app
}

describe('project workspace policy', () => {
    it('auto-creates project init task and keeps worktree settings unlocked before task runs', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)

        const createResponse = await app.request('/api/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                machineId: 'machine-1',
                name: 'Project Init',
                workspaces: [{ path: '/tmp/workspace-init' }]
            })
        })
        expect(createResponse.status).toBe(200)

        const createBody = await createResponse.json() as {
            project: {
                id: string
                defaultWorkspaceId: string | null
                worktreeLocked?: boolean
            }
        }

        const tasks = store.tasks.listTasksByProjectAndNamespace(createBody.project.id, 'default')
        expect(tasks.length).toBe(1)
        expect(tasks[0]?.source).toBe('project_init')
        expect(tasks[0]?.title).toBe('Initialize project scripts')
        expect(tasks[0]?.workspaceId).toBe(createBody.project.defaultWorkspaceId)
        expect(createBody.project.worktreeLocked).toBe(false)
    })


    it('seeds worktree projects with worktree-safe merge script guidance', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)

        const createResponse = await app.request('/api/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                machineId: 'machine-1',
                name: 'Project Worktree Guidance',
                workspaces: [{ path: '/tmp/workspace-guidance' }],
                defaultSessionType: 'worktree',
                worktreeTargetBranch: 'main'
            })
        })
        expect(createResponse.status).toBe(200)

        const createBody = await createResponse.json() as {
            project: {
                id: string
            }
        }

        const tasks = store.tasks.listTasksByProjectAndNamespace(createBody.project.id, 'default')
        expect(tasks).toHaveLength(1)
        expect(tasks[0]?.description).toContain('Do not blindly `git checkout` the target branch inside that worktree')
        expect(tasks[0]?.description).toContain(PRODUCT_ENV.WORKTREE_BASE_PATH)
        expect(tasks[0]?.description).toContain(PRODUCT_ENV.MERGE_TARGET_BRANCH)
    })

    it('creates project workspaces during project creation and sets default workspace', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)

        const response = await app.request('/api/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                machineId: 'machine-1',
                name: 'Project Alpha',
                workspaces: [
                    { path: '/tmp/workspace-a', label: 'A' },
                    { path: '/tmp/workspace-b', label: 'B' }
                ]
            })
        })

        expect(response.status).toBe(200)
        const body = await response.json() as {
            project: {
                id: string
                defaultWorkspaceId: string | null
            }
        }
        expect(body.project.defaultWorkspaceId).not.toBeNull()

        const listResponse = await app.request(`/api/projects/${body.project.id}/workspaces`)
        expect(listResponse.status).toBe(200)
        const listBody = await listResponse.json() as {
            workspaces: Array<{ id: string }>
        }
        expect(listBody.workspaces.length).toBe(2)
        expect(listBody.workspaces[0]?.id).toBe(body.project.defaultWorkspaceId as string)
    })

    it('persists project agent output language through create and update', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)

        const createResponse = await app.request('/api/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                machineId: 'machine-1',
                name: 'Project Language',
                workspaces: [{ path: '/tmp/workspace-language' }],
                agentOutputLanguage: 'zh-CN'
            })
        })
        expect(createResponse.status).toBe(200)
        const createBody = await createResponse.json() as {
            project: {
                id: string
                agentOutputLanguage: string
            }
        }
        expect(createBody.project.agentOutputLanguage).toBe('zh-CN')

        const updateResponse = await app.request(`/api/projects/${createBody.project.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                agentOutputLanguage: 'en'
            })
        })
        expect(updateResponse.status).toBe(200)
        const updateBody = await updateResponse.json() as {
            project: {
                agentOutputLanguage: string
            }
        }
        expect(updateBody.project.agentOutputLanguage).toBe('en')
    })

    it('rejects Codex-style permission modes when creating a Claude project', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)

        const response = await app.request('/api/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                machineId: 'machine-1',
                name: 'Claude Project',
                workspaces: [{ path: '/tmp/workspace-claude-project' }],
                defaultAgentFlavor: 'claude',
                defaultPermissionMode: 'yolo'
            })
        })

        expect(response.status).toBe(400)
    })

    it('maps a stored Codex-style permission mode to the closest Claude option when switching agents', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)

        const createResponse = await app.request('/api/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                machineId: 'machine-1',
                name: 'Project Switch',
                workspaces: [{ path: '/tmp/workspace-switch' }],
                defaultAgentFlavor: 'codex',
                defaultPermissionMode: 'yolo'
            })
        })
        expect(createResponse.status).toBe(200)
        const createBody = await createResponse.json() as {
            project: {
                id: string
            }
        }

        const updateResponse = await app.request(`/api/projects/${createBody.project.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                defaultAgentFlavor: 'claude'
            })
        })
        expect(updateResponse.status).toBe(200)
        const updateBody = await updateResponse.json() as {
            project: {
                defaultAgentFlavor: string | null
                defaultPermissionMode: string | null
            }
        }

        expect(updateBody.project.defaultAgentFlavor).toBe('claude')
        expect(updateBody.project.defaultPermissionMode).toBe('bypassPermissions')
    })

    it('rejects workspace changes after project creation', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)

        const createResponse = await app.request('/api/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                machineId: 'machine-1',
                name: 'Project Beta',
                workspaces: [{ path: '/tmp/workspace-main' }]
            })
        })
        const createBody = await createResponse.json() as {
            project: {
                id: string
                defaultWorkspaceId: string | null
            }
        }

        const listResponse = await app.request(`/api/projects/${createBody.project.id}/workspaces`)
        const listBody = await listResponse.json() as {
            workspaces: Array<{ id: string }>
        }
        const workspaceId = listBody.workspaces[0]?.id
        expect(workspaceId).toBeTruthy()

        const patchProjectResponse = await app.request(`/api/projects/${createBody.project.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                defaultWorkspaceId: 'some-other-workspace'
            })
        })
        expect(patchProjectResponse.status).toBe(400)

        const addWorkspaceResponse = await app.request(`/api/projects/${createBody.project.id}/workspaces`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                workspaces: [{ path: '/tmp/extra' }]
            })
        })
        expect(addWorkspaceResponse.status).toBe(400)

        const updateWorkspaceResponse = await app.request(`/api/workspaces/${workspaceId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                label: 'new-label'
            })
        })
        expect(updateWorkspaceResponse.status).toBe(400)

        const deleteWorkspaceResponse = await app.request(`/api/workspaces/${workspaceId}`, {
            method: 'DELETE'
        })
        expect(deleteWorkspaceResponse.status).toBe(400)
    })

    it('allows one-way worktree mode switch before first task/session only', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)

        const createResponse = await app.request('/api/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                machineId: 'machine-1',
                name: 'Project Gamma',
                workspaces: [{ path: '/tmp/workspace-main' }],
                defaultSessionType: 'simple'
            })
        })
        const createBody = await createResponse.json() as {
            project: {
                id: string
                defaultSessionType: 'simple' | 'worktree'
                worktreeLocked?: boolean
            }
        }
        expect(createBody.project.worktreeLocked).toBe(false)

        const upgradeResponse = await app.request(`/api/projects/${createBody.project.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                defaultSessionType: 'worktree',
                worktreeTargetBranch: 'main'
            })
        })
        expect(upgradeResponse.status).toBe(200)

        const downgradeResponse = await app.request(`/api/projects/${createBody.project.id}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                defaultSessionType: 'simple'
            })
        })
        expect(downgradeResponse.status).toBe(400)
    })

    it('locks worktree mode and target branch after first task/session but keeps strategy editable', async () => {
        const store = new Store(':memory:')
        const app = createTestApp(store)

        const createResponse = await app.request('/api/projects', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                machineId: 'machine-1',
                name: 'Project Delta',
                workspaces: [{ path: '/tmp/workspace-main' }],
                defaultSessionType: 'worktree',
                worktreeTargetBranch: 'main'
            })
        })
        const createBody = await createResponse.json() as {
            project: {
                id: string
            }
        }
        const projectId = createBody.project.id

        store.tasks.createTask({
            id: 'task-1',
            projectId,
            title: 'seed',
            status: 'planned',
            workflowProfile: 'default'
        })

        const getResponse = await app.request(`/api/projects/${projectId}`)
        expect(getResponse.status).toBe(200)
        const getBody = await getResponse.json() as {
            project: {
                worktreeLocked?: boolean
            }
        }
        expect(getBody.project.worktreeLocked).toBe(true)

        const changeModeResponse = await app.request(`/api/projects/${projectId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                defaultSessionType: 'simple'
            })
        })
        expect(changeModeResponse.status).toBe(400)

        const changeTargetResponse = await app.request(`/api/projects/${projectId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                worktreeTargetBranch: 'develop'
            })
        })
        expect(changeTargetResponse.status).toBe(400)

        const strategyResponse = await app.request(`/api/projects/${projectId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                worktreeAutoCommitMode: 'per_conversation',
                worktreeCleanupAfterMerge: true
            })
        })
        expect(strategyResponse.status).toBe(200)
    })
})
