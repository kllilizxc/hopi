import { describe, expect, it } from 'bun:test'
import { Hono } from 'hono'
import type { Machine, SyncEngine } from '../../sync/syncEngine'
import { createMachinesRoutes } from './machines'

function createTestApp(engine: Partial<SyncEngine> | null): Hono {
    const app = new Hono()
    app.use('*', async (c, next) => {
        const setContext = c.set as unknown as (key: string, value: unknown) => void
        setContext('userId', 1)
        setContext('namespace', 'default')
        await next()
    })
    app.route('/api', createMachinesRoutes(() => engine as SyncEngine | null))
    return app
}

function createMachine(overrides: Partial<Machine> = {}): Machine {
    return {
        id: overrides.id ?? 'machine-1',
        namespace: overrides.namespace ?? 'default',
        seq: overrides.seq ?? 1,
        createdAt: overrides.createdAt ?? 1,
        updatedAt: overrides.updatedAt ?? 1,
        active: overrides.active ?? true,
        activeAt: overrides.activeAt ?? 1,
        metadata: overrides.metadata ?? null,
        metadataVersion: overrides.metadataVersion ?? 1,
        runnerState: overrides.runnerState ?? null,
        runnerStateVersion: overrides.runnerStateVersion ?? 1,
    }
}

describe('machine directory route', () => {
    it('returns 404 when the machine is offline or missing', async () => {
        const app = createTestApp({
            getMachine: () => undefined,
        })

        const response = await app.request('/api/machines/machine-offline/directory')

        expect(response.status).toBe(404)
        expect(await response.json()).toEqual({ error: 'Machine not found' })
    })

    it('keeps the shared listDirectory error contract when listing fails', async () => {
        const app = createTestApp({
            getMachine: () => createMachine(),
            listMachineDirectory: async () => {
                throw new Error('rpc exploded')
            },
        })

        const response = await app.request('/api/machines/machine-1/directory?path=%2Ftmp')

        expect(response.status).toBe(200)
        expect(await response.json()).toEqual({
            success: false,
            error: 'rpc exploded',
        })
    })
})
