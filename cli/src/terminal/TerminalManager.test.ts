import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalManager } from './TerminalManager'

type FakeTerminal = {
    resize: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
}

type FakeSubprocess = {
    terminal: FakeTerminal
    killed: boolean
    exitCode: number | null
    signalCode: NodeJS.Signals | null
    kill: ReturnType<typeof vi.fn>
}

function createFakeSubprocess(): FakeSubprocess {
    const terminal: FakeTerminal = {
        resize: vi.fn(),
        write: vi.fn(),
        close: vi.fn()
    }

    const subprocess: FakeSubprocess = {
        terminal,
        killed: false,
        exitCode: null,
        signalCode: null,
        kill: vi.fn()
    }

    subprocess.kill.mockImplementation(() => {
        subprocess.killed = true
        subprocess.signalCode = 'SIGTERM'
    })

    return subprocess
}

describe('TerminalManager', () => {
    const originalBun = (globalThis as { Bun?: unknown }).Bun

    beforeEach(() => {
        vi.restoreAllMocks()
    })

    afterEach(() => {
        const target = globalThis as { Bun?: unknown }
        if (originalBun === undefined) {
            delete target.Bun
            return
        }
        target.Bun = originalBun
    })

    it('ignores stale onExit events from a previously closed terminal with the same terminalId', () => {
        const first = createFakeSubprocess()
        const second = createFakeSubprocess()
        const onExitHandlers: Array<(subprocess: FakeSubprocess, code: number | null) => void> = []

        const bunMock = {
            version: '1.3.11',
            spawn: vi.fn((_cmd: string[], options: { onExit?: (subprocess: FakeSubprocess, code: number | null) => void }) => {
                const subprocess = onExitHandlers.length === 0 ? first : second
                if (!options.onExit) {
                    throw new Error('missing onExit handler')
                }
                onExitHandlers.push(options.onExit)
                return subprocess
            })
        }

        ;(globalThis as { Bun?: unknown }).Bun = bunMock

        const onReady = vi.fn()
        const onOutput = vi.fn()
        const onExit = vi.fn()
        const onError = vi.fn()

        const manager = new TerminalManager({
            sessionId: 'session-1',
            getSessionPath: () => process.cwd(),
            onReady,
            onOutput,
            onExit,
            onError
        })

        manager.create('terminal-1', 80, 24)
        manager.close('terminal-1')
        manager.create('terminal-1', 80, 24)

        onExitHandlers[0](first, null)

        expect(onExit).not.toHaveBeenCalled()
        expect(second.terminal.close).not.toHaveBeenCalled()

        manager.write('terminal-1', 'echo ok\n')
        expect(second.terminal.write).toHaveBeenCalledWith('echo ok\n')
        expect(onError).not.toHaveBeenCalled()

        onExitHandlers[1](second, 0)
        expect(onExit).toHaveBeenCalledTimes(1)
        expect(onExit).toHaveBeenCalledWith({
            sessionId: 'session-1',
            terminalId: 'terminal-1',
            code: 0,
            signal: null
        })

        expect(onReady).toHaveBeenCalledTimes(2)
        expect(onOutput).not.toHaveBeenCalled()
    })
})
