import {
    PRODUCT_ENV,
    PRODUCT_INIT_SCRIPT_RELATIVE_PATH,
    PRODUCT_MERGE_SCRIPT_RELATIVE_PATH
} from '@hopi/protocol/brand'
import type { SyncEngine } from './syncEngine'

const MISSING_SCRIPT_MARKER_PREFIX = '__HOPI_SCRIPT_MISSING__:'

type ScriptExecutionSuccess = {
    ok: true
    executed: boolean
    stdout: string
    stderr: string
}

type ScriptExecutionFailure = {
    ok: false
    error: string
    stdout: string
    stderr: string
}

export type ScriptExecutionResult = ScriptExecutionSuccess | ScriptExecutionFailure

function quoteForShell(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
}

function buildEnvPrefix(env: Record<string, string | undefined>): string {
    const entries = Object.entries(env)
        .filter(([, value]) => typeof value === 'string' && value.length > 0)
        .map(([key, value]) => `${key}=${quoteForShell(value as string)}`)
    if (entries.length === 0) {
        return ''
    }
    return `${entries.join(' ')} `
}

function pickScriptErrorMessage(result: {
    error?: string
    stderr?: string
    stdout?: string
}): string {
    const explicit = result.error?.trim()
    if (explicit) {
        return explicit
    }

    const stderr = result.stderr?.trim()
    if (stderr) {
        const first = stderr.split('\n').find((line) => line.trim().length > 0)?.trim()
        if (first) {
            return first
        }
    }

    const stdout = result.stdout?.trim()
    if (stdout) {
        const first = stdout.split('\n').find((line) => line.trim().length > 0)?.trim()
        if (first) {
            return first
        }
    }

    return 'Script execution failed'
}

async function runScriptIfPresent(options: {
    engine: SyncEngine
    sessionId: string
    cwd: string
    scriptRelativePath: string
    timeoutMs: number
    env: Record<string, string | undefined>
}): Promise<ScriptExecutionResult> {
    const engineWithRunBash = options.engine as unknown as {
        runBash?: (sessionId: string, params: { command: string; cwd?: string; timeout?: number }) => Promise<{
            success: boolean
            stdout?: string
            stderr?: string
            error?: string
        }>
    }
    const runBash = engineWithRunBash.runBash

    if (typeof runBash !== 'function') {
        return {
            ok: true,
            executed: false,
            stdout: '',
            stderr: ''
        }
    }

    const marker = `${MISSING_SCRIPT_MARKER_PREFIX}${options.scriptRelativePath}:${Date.now()}`
    const envPrefix = buildEnvPrefix(options.env)
    const scriptPath = quoteForShell(options.scriptRelativePath)
    const markerToken = quoteForShell(marker)
    const command = `if [ -f ${scriptPath} ]; then chmod +x ${scriptPath} && ${envPrefix}bash ${scriptPath}; else echo ${markerToken}; fi`

    let result: {
        success: boolean
        stdout?: string
        stderr?: string
        error?: string
    }

    try {
        result = await runBash.call(options.engine, options.sessionId, {
            command,
            cwd: options.cwd,
            timeout: options.timeoutMs
        })
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.startsWith('RPC handler not registered:') && message.includes(':bash')) {
            return {
                ok: true,
                executed: false,
                stdout: '',
                stderr: ''
            }
        }
        return {
            ok: false,
            error: message,
            stdout: '',
            stderr: ''
        }
    }

    const stdout = result.stdout ?? ''
    const stderr = result.stderr ?? ''

    if (!result.success) {
        return {
            ok: false,
            error: pickScriptErrorMessage(result),
            stdout,
            stderr
        }
    }

    if (stdout.includes(marker)) {
        return {
            ok: true,
            executed: false,
            stdout,
            stderr
        }
    }

    return {
        ok: true,
        executed: true,
        stdout,
        stderr
    }
}

export async function runInitScriptIfPresent(options: {
    engine: SyncEngine
    sessionId: string
    cwd: string
    taskId: string
    projectId: string
    timeoutMs?: number
}): Promise<ScriptExecutionResult> {
    return await runScriptIfPresent({
        engine: options.engine,
        sessionId: options.sessionId,
        cwd: options.cwd,
        scriptRelativePath: PRODUCT_INIT_SCRIPT_RELATIVE_PATH,
        timeoutMs: options.timeoutMs ?? 300_000,
        env: {
            [PRODUCT_ENV.PROJECT_ROOT]: options.cwd,
            [PRODUCT_ENV.TASK_ID]: options.taskId,
            [PRODUCT_ENV.TASK_PROJECT_ID]: options.projectId
        }
    })
}

export async function runMergeScriptIfPresent(options: {
    engine: SyncEngine
    sessionId: string
    cwd: string
    taskId: string
    projectId: string
    targetBranch: string
    sourceBranch: string | null
    timeoutMs?: number
}): Promise<ScriptExecutionResult> {
    return await runScriptIfPresent({
        engine: options.engine,
        sessionId: options.sessionId,
        cwd: options.cwd,
        scriptRelativePath: PRODUCT_MERGE_SCRIPT_RELATIVE_PATH,
        timeoutMs: options.timeoutMs ?? 300_000,
        env: {
            [PRODUCT_ENV.PROJECT_ROOT]: options.cwd,
            [PRODUCT_ENV.TASK_ID]: options.taskId,
            [PRODUCT_ENV.TASK_PROJECT_ID]: options.projectId,
            [PRODUCT_ENV.MERGE_TARGET_BRANCH]: options.targetBranch,
            [PRODUCT_ENV.MERGE_SOURCE_BRANCH]: options.sourceBranch ?? ''
        }
    })
}
