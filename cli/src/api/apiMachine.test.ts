import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Machine } from './types'

const harness = vi.hoisted(() => {
    type Handler = (...args: any[]) => void

    class MockSocket {
        handlers = new Map<string, Handler[]>()
        calls: Array<{
            kind: 'emit' | 'emitWithAck'
            event: string
            data: unknown
        }> = []
        ackResponses: unknown[] = []

        on(event: string, handler: Handler): this {
            const existing = this.handlers.get(event) ?? []
            existing.push(handler)
            this.handlers.set(event, existing)
            return this
        }

        emit(event: string, data: unknown): void {
            this.calls.push({ kind: 'emit', event, data })
        }

        emitWithAck(event: string, data: unknown): Promise<unknown> {
            this.calls.push({ kind: 'emitWithAck', event, data })
            const response = this.ackResponses.shift()
            return Promise.resolve(response ?? { result: 'success', version: 1, runnerState: null })
        }

        trigger(event: string): void {
            for (const handler of this.handlers.get(event) ?? []) {
                handler()
            }
        }

        close(): void {}
    }

    return {
        MockSocket,
        socket: null as MockSocket | null,
        ioCalls: [] as Array<{ url: string; options: unknown }>,
        post: vi.fn()
    }
})

vi.mock('socket.io-client', () => ({
    io: vi.fn((url: string, options: unknown) => {
        const socket = new harness.MockSocket()
        harness.socket = socket
        harness.ioCalls.push({ url, options })
        return socket
    })
}))

vi.mock('axios', () => ({
    default: {
        post: harness.post
    }
}))

import { ApiMachineClient } from './apiMachine'

function createMachine(overrides: Partial<Machine> = {}): Machine {
    return {
        id: 'machine-1',
        seq: 1,
        createdAt: 10,
        updatedAt: 20,
        active: true,
        activeAt: 20,
        metadata: {
            host: 'host-1',
            platform: 'darwin',
            happyCliVersion: '0.15.3',
            displayName: 'Laptop',
            homeDir: '/Users/test',
            happyHomeDir: '/Users/test/.hopi',
            happyLibDir: '/Users/test/.hopi/lib'
        },
        metadataVersion: 2,
        runnerState: {
            status: 'running',
            pid: 123,
            httpPort: 4567,
            startedAt: 1000
        },
        runnerStateVersion: 3,
        ...overrides
    }
}

describe('ApiMachineClient', () => {
    afterEach(() => {
        harness.post.mockReset()
        harness.ioCalls.length = 0
        harness.socket = null
    })

    it('re-registers the machine before publishing runner state on socket reconnect', async () => {
        const serverMachine = createMachine({
            seq: 9,
            metadataVersion: 5,
            runnerStateVersion: 7,
            runnerState: {
                status: 'running',
                pid: 321,
                httpPort: 4567,
                startedAt: 2000
            }
        })
        harness.post.mockResolvedValueOnce({ data: { machine: serverMachine } })

        const client = new ApiMachineClient('token-1', createMachine())
        client.setRPCHandlers({
            spawnSession: async () => ({ type: 'error', errorMessage: 'not used' }),
            stopSession: () => false,
            requestShutdown: () => {},
            startPreview: async () => ({ active: false, status: 'idle', updatedAt: 1, logTail: [] }),
            getPreviewStatus: () => ({ active: false, status: 'idle', updatedAt: 1, logTail: [] }),
            stopPreview: async () => ({ active: false, status: 'idle', updatedAt: 1, logTail: [] })
        })
        client.connect()

        harness.socket?.ackResponses.push({
            result: 'success',
            version: 8,
            runnerState: {
                status: 'running',
                pid: 999,
                httpPort: 4567,
                startedAt: 3000
            }
        })
        harness.socket?.trigger('connect')

        await vi.waitFor(() => {
            expect(harness.post).toHaveBeenCalledTimes(1)
            expect(harness.socket?.calls.some((call) => call.kind === 'emitWithAck' && call.event === 'machine-update-state')).toBe(true)
        })

        const rpcRegisterCallIndex = harness.socket!.calls.findIndex((call) => call.kind === 'emit' && call.event === 'rpc-register')
        const stateCallIndex = harness.socket!.calls.findIndex((call) => call.kind === 'emitWithAck' && call.event === 'machine-update-state')

        expect(rpcRegisterCallIndex).toBeGreaterThanOrEqual(0)
        expect(stateCallIndex).toBeGreaterThan(rpcRegisterCallIndex)
        expect(harness.post).toHaveBeenCalledWith(
            expect.stringContaining('/cli/machines'),
            expect.objectContaining({
                id: 'machine-1',
                metadata: expect.objectContaining({ host: 'host-1' }),
                runnerState: expect.objectContaining({ status: 'running' })
            }),
            expect.objectContaining({
                headers: expect.objectContaining({ Authorization: 'Bearer token-1' })
            })
        )
        expect(harness.socket!.calls[stateCallIndex].data).toMatchObject({
            machineId: 'machine-1',
            expectedVersion: 7
        })

        client.shutdown()
    })
})
