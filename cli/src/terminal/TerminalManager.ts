import { logger } from '@/ui/logger'
import { isBunCompiled } from '@/projectPath'
import type {
    TerminalErrorPayload,
    TerminalExitPayload,
    TerminalOutputPayload,
    TerminalReadyPayload
} from '@hapi/protocol'
import type { TerminalSession } from './types'
import { maybeWrapSpawnSpecForStrictWorkspaceWrites } from '@/sandbox/strictWorkspaceWrites'

type TerminalRuntime = TerminalSession & {
    proc: Bun.Subprocess
    terminal: Bun.Terminal
    idleTimer: ReturnType<typeof setTimeout> | null
}

type TerminalManagerOptions = {
    sessionId: string
    getSessionPath: () => string | null
    onReady: (payload: TerminalReadyPayload) => void
    onOutput: (payload: TerminalOutputPayload) => void
    onExit: (payload: TerminalExitPayload) => void
    onError: (payload: TerminalErrorPayload) => void
    idleTimeoutMs?: number
    maxTerminals?: number
}

const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000
const DEFAULT_MAX_TERMINALS = 4
const MIN_BUN_VERSION_FOR_PTY = [1, 3, 5] as const
const SENSITIVE_ENV_KEYS = new Set([
    'CLI_API_TOKEN',
    'HAPI_API_URL',
    'HAPI_HTTP_MCP_URL',
    'TELEGRAM_BOT_TOKEN',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'GOOGLE_API_KEY'
])

function resolveEnvNumber(name: string, fallback: number): number {
    const raw = process.env[name]
    if (!raw) {
        return fallback
    }
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function resolveShell(): string {
    if (process.env.SHELL) {
        return process.env.SHELL
    }
    if (process.platform === 'darwin') {
        return '/bin/zsh'
    }
    return '/bin/bash'
}

function parseVersionParts(version: string): [number, number, number] | null {
    const [major, minor, patch] = version.split('.')
    const majorNum = Number.parseInt(major, 10)
    const minorNum = Number.parseInt(minor, 10)
    const patchNum = Number.parseInt(patch, 10)
    if (!Number.isFinite(majorNum) || !Number.isFinite(minorNum) || !Number.isFinite(patchNum)) {
        return null
    }
    return [majorNum, minorNum, patchNum]
}

function isPtySupportedByBun(): boolean {
    if (typeof Bun === 'undefined' || typeof Bun.version !== 'string') {
        return false
    }
    const current = parseVersionParts(Bun.version)
    if (!current) {
        return false
    }
    for (let index = 0; index < MIN_BUN_VERSION_FOR_PTY.length; index += 1) {
        const currentPart = current[index]
        const minimumPart = MIN_BUN_VERSION_FOR_PTY[index]
        if (currentPart > minimumPart) {
            return true
        }
        if (currentPart < minimumPart) {
            return false
        }
    }
    return true
}

function buildFilteredEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(process.env)) {
        if (!value) {
            continue
        }
        if (SENSITIVE_ENV_KEYS.has(key)) {
            continue
        }
        env[key] = value
    }
    return env
}

export class TerminalManager {
    private readonly sessionId: string
    private readonly getSessionPath: () => string | null
    private readonly onReady: (payload: TerminalReadyPayload) => void
    private readonly onOutput: (payload: TerminalOutputPayload) => void
    private readonly onExit: (payload: TerminalExitPayload) => void
    private readonly onError: (payload: TerminalErrorPayload) => void
    private readonly idleTimeoutMs: number
    private readonly maxTerminals: number
    private readonly terminals: Map<string, TerminalRuntime> = new Map()
    private readonly filteredEnv: NodeJS.ProcessEnv

    constructor(options: TerminalManagerOptions) {
        this.sessionId = options.sessionId
        this.getSessionPath = options.getSessionPath
        this.onReady = options.onReady
        this.onOutput = options.onOutput
        this.onExit = options.onExit
        this.onError = options.onError
        this.idleTimeoutMs = options.idleTimeoutMs ?? resolveEnvNumber('HAPI_TERMINAL_IDLE_TIMEOUT_MS', DEFAULT_IDLE_TIMEOUT_MS)
        this.maxTerminals = options.maxTerminals ?? resolveEnvNumber('HAPI_TERMINAL_MAX_TERMINALS', DEFAULT_MAX_TERMINALS)
        this.filteredEnv = buildFilteredEnv()
    }

    create(terminalId: string, cols: number, rows: number): void {
        if (process.platform === 'win32') {
            this.emitError(terminalId, 'Terminal is not supported on Windows.')
            return
        }

        const existing = this.terminals.get(terminalId)
        if (existing) {
            existing.cols = cols
            existing.rows = rows
            existing.terminal.resize(cols, rows)
            this.markActivity(existing)
            this.onReady({ sessionId: this.sessionId, terminalId })
            return
        }

        if (this.terminals.size >= this.maxTerminals) {
            this.emitError(terminalId, `Too many terminals open (max ${this.maxTerminals}).`)
            return
        }

        if (typeof Bun === 'undefined' || typeof Bun.spawn !== 'function') {
            this.emitError(terminalId, 'Terminal is unavailable in this runtime.')
            return
        }
        if (!isPtySupportedByBun()) {
            const bunVersion = typeof Bun !== 'undefined' ? Bun.version : 'unknown'
            this.emitError(terminalId, `Terminal requires Bun >= 1.3.5 (current: ${bunVersion}).`)
            return
        }

        const sessionPath = this.getSessionPath() ?? process.cwd()
        const shell = resolveShell()
        const decoder = new TextDecoder()

        try {
            const wrapped = maybeWrapSpawnSpecForStrictWorkspaceWrites({
                workspaceRoot: sessionPath,
                command: shell,
                args: [],
                cwd: sessionPath,
                env: this.filteredEnv
            })

            const proc = Bun.spawn([wrapped.command, ...wrapped.args], {
                cwd: wrapped.cwd,
                env: wrapped.env,
                terminal: {
                    cols,
                    rows,
                    data: (terminal, data) => {
                        const text = decoder.decode(data, { stream: true })
                        if (text) {
                            this.onOutput({ sessionId: this.sessionId, terminalId, data: text })
                        }
                        const active = this.terminals.get(terminalId)
                        if (active) {
                            this.markActivity(active)
                        }
                    },
                    exit: (terminal, exitCode) => {
                        if (exitCode === 1) {
                            this.emitError(terminalId, 'Terminal stream closed unexpectedly.')
                        }
                    }
                },
                onExit: (subprocess, exitCode) => {
                    const active = this.terminals.get(terminalId)
                    if (!active || active.proc !== subprocess) {
                        return
                    }
                    const signal = subprocess.signalCode ?? null
                    this.onExit({
                        sessionId: this.sessionId,
                        terminalId,
                        code: exitCode ?? null,
                        signal
                    })
                    this.cleanupRuntime(active, false)
                }
            })

            const terminal = proc.terminal
            if (!terminal) {
                try {
                    proc.kill()
                } catch (error) {
                    logger.debug('[TERMINAL] Failed to kill process after missing terminal', { error })
                }
                const bunVersion = typeof Bun !== 'undefined' ? Bun.version : 'unknown'
                logger.debug('[TERMINAL] Failed to attach terminal', {
                    bunVersion,
                    isBunCompiled: isBunCompiled(),
                    execPath: process.execPath,
                    shell,
                    sessionPath,
                    term: process.env.TERM,
                    shellEnv: process.env.SHELL
                })
                this.emitError(
                    terminalId,
                    `Failed to attach terminal. Bun=${bunVersion} compiled=${isBunCompiled() ? 'yes' : 'no'}.`
                )
                return
            }

            const runtime: TerminalRuntime = {
                terminalId,
                cols,
                rows,
                proc,
                terminal,
                idleTimer: null
            }

            this.terminals.set(terminalId, runtime)
            this.markActivity(runtime)
            this.onReady({ sessionId: this.sessionId, terminalId })
        } catch (error) {
            logger.debug('[TERMINAL] Failed to spawn terminal', { error })
            this.emitError(terminalId, 'Failed to spawn terminal.')
        }
    }

    write(terminalId: string, data: string): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            this.emitError(terminalId, 'Terminal not found.')
            return
        }
        runtime.terminal.write(data)
        this.markActivity(runtime)
    }

    resize(terminalId: string, cols: number, rows: number): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            return
        }
        runtime.cols = cols
        runtime.rows = rows
        runtime.terminal.resize(cols, rows)
        this.markActivity(runtime)
    }

    close(terminalId: string): void {
        this.cleanup(terminalId)
    }

    closeAll(): void {
        for (const terminalId of this.terminals.keys()) {
            this.cleanup(terminalId)
        }
    }

    private markActivity(runtime: TerminalRuntime): void {
        this.scheduleIdleTimer(runtime)
    }

    private scheduleIdleTimer(runtime: TerminalRuntime): void {
        if (this.idleTimeoutMs <= 0) {
            return
        }

        if (runtime.idleTimer) {
            clearTimeout(runtime.idleTimer)
        }

        runtime.idleTimer = setTimeout(() => {
            this.emitError(runtime.terminalId, 'Terminal closed due to inactivity.')
            this.cleanup(runtime.terminalId)
        }, this.idleTimeoutMs)
    }

    private cleanup(terminalId: string): void {
        const runtime = this.terminals.get(terminalId)
        if (!runtime) {
            return
        }
        this.cleanupRuntime(runtime, true)
    }

    private cleanupRuntime(runtime: TerminalRuntime, killProcess: boolean): void {
        const active = this.terminals.get(runtime.terminalId)
        if (active !== runtime) {
            return
        }

        this.terminals.delete(runtime.terminalId)
        if (runtime.idleTimer) {
            clearTimeout(runtime.idleTimer)
        }

        if (killProcess && !runtime.proc.killed && runtime.proc.exitCode === null) {
            try {
                runtime.proc.kill()
            } catch (error) {
                logger.debug('[TERMINAL] Failed to kill process', { error })
            }
        }

        try {
            runtime.terminal.close()
        } catch (error) {
            logger.debug('[TERMINAL] Failed to close terminal', { error })
        }
    }

    private emitError(terminalId: string, message: string): void {
        this.onError({ sessionId: this.sessionId, terminalId, message })
    }
}
