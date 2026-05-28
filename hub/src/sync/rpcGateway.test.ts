import { describe, expect, it } from 'bun:test'
import type { Server, Socket } from 'socket.io'
import { RpcRegistry } from '../socket/rpcRegistry'
import { RpcGateway } from './rpcGateway'

class FakeCliSocket {
    readonly id: string
    readonly timeoutCalls: number[] = []

    constructor(id: string) {
        this.id = id
    }

    timeout(ms: number): { emitWithAck: (event: string, payload: unknown) => Promise<string> } {
        this.timeoutCalls.push(ms)
        return {
            emitWithAck: async () => JSON.stringify({ success: true, path: '/tmp', entries: [] })
        }
    }
}

class FakeNamespace {
    readonly sockets = new Map<string, FakeCliSocket>()
}

class FakeServer {
    readonly cliNamespace = new FakeNamespace()

    of(name: string): FakeNamespace {
        if (name !== '/cli') {
            throw new Error(`Unknown namespace: ${name}`)
        }
        return this.cliNamespace
    }
}

describe('RpcGateway RPC timeout settings', () => {
    it('uses an extended timeout for git-merge-worktree and keeps default timeout for other RPC methods', async () => {
        const io = new FakeServer()
        const registry = new RpcRegistry()
        const gateway = new RpcGateway(io as unknown as Server, registry)
        const socket = new FakeCliSocket('cli-1')

        io.cliNamespace.sockets.set(socket.id, socket)
        registry.register(socket as unknown as Socket, 'session-1:git-merge-worktree')
        registry.register(socket as unknown as Socket, 'session-1:git-status')

        await gateway.gitMergeWorktree('session-1', { targetBranch: 'main', commitMessage: 'merge' })
        await gateway.getGitStatus('session-1')

        expect(socket.timeoutCalls[0]).toBe(90_000)
        expect(socket.timeoutCalls[1]).toBe(30_000)
    })

    it('supports machine-scoped RPC wrappers', async () => {
        const io = new FakeServer()
        const registry = new RpcRegistry()
        const gateway = new RpcGateway(io as unknown as Server, registry)
        const socket = new FakeCliSocket('cli-1')

        io.cliNamespace.sockets.set(socket.id, socket)
        registry.register(socket as unknown as Socket, 'machine-1:listDirectory')

        const result = await gateway.listDirectoryOnMachine('machine-1', '')
        expect(result.success).toBe(true)
        expect(socket.timeoutCalls[0]).toBe(30_000)
    })
})
