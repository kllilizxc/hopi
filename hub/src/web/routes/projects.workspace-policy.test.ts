import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import { Store } from '../../store'
import { createProjectsRoutes } from './projects'
import { createWorkspacesRoutes } from './workspaces'

function createTestApp(store: Store): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        c.set('userId', 1)
        c.set('namespace', 'default')
        await next()
    })
    app.route('/api', createProjectsRoutes({ store, getSyncEngine: () => null }))
    app.route('/api', createWorkspacesRoutes({ store, getSyncEngine: () => null }))
    return app
}

describe('project workspace policy', () => {
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
        expect(listBody.workspaces[0]?.id).toBe(body.project.defaultWorkspaceId)
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
})
