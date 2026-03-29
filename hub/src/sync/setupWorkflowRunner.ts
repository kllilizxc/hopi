import { resolve } from 'node:path'
import type { SetupWorkflowStep } from '@hopi/protocol/actions'
import { PRODUCT_ENV } from '@hopi/protocol/brand'
import type { SyncEngine } from './syncEngine'

export type SetupWorkflowStepResult = {
    id: string
    type: SetupWorkflowStep['type']
    status: 'succeeded' | 'failed'
    cwd: string
    command: string
    stdout: string
    stderr: string
    durationMs: number
    summary: string
}

export type SetupWorkflowRunResult =
    | {
        ok: true
        manifestPath: string
        rootPath: string
        steps: SetupWorkflowStepResult[]
    }
    | {
        ok: false
        manifestPath: string
        rootPath: string
        steps: SetupWorkflowStepResult[]
        stepId: string | null
        error: string
    }

function quoteForShell(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`
}

function buildEnvPrefix(env: Record<string, string | undefined>): string {
    const entries = Object.entries(env)
        .filter(([, value]) => typeof value === 'string' && value.length > 0)
        .map(([key, value]) => `${key}=${quoteForShell(value as string)}`)
    return entries.length > 0 ? `${entries.join(' ')} ` : ''
}

function buildRunCommand(args: string[], env: Record<string, string | undefined>): string {
    const command = args.map((arg) => quoteForShell(arg)).join(' ')
    return `${buildEnvPrefix(env)}${command}`
}

function buildStepCommand(step: SetupWorkflowStep, env: Record<string, string | undefined>): string {
    if (step.type === 'run') {
        return buildRunCommand(step.run, env)
    }

    const args = ['git', 'submodule', 'update']
    if (step.init !== false) {
        args.push('--init')
    }
    if (step.recursive) {
        args.push('--recursive')
    }

    return buildRunCommand(args, env)
}

function summarizeStepOutput(options: {
    command: string
    stdout?: string
    stderr?: string
    error?: string
}): string {
    const explicit = options.error?.trim()
    if (explicit) {
        return explicit
    }

    const stderr = options.stderr?.trim()
    if (stderr) {
        const first = stderr.split('\n').find((line) => line.trim().length > 0)?.trim()
        if (first) return first
    }

    const stdout = options.stdout?.trim()
    if (stdout) {
        const first = stdout.split('\n').find((line) => line.trim().length > 0)?.trim()
        if (first) return first
    }

    return `Command failed: ${options.command}`
}

function resolveStepCwd(rootPath: string, cwd?: string): string {
    if (!cwd || cwd.trim().length === 0 || cwd.trim() === '.') {
        return rootPath
    }
    return resolve(rootPath, cwd)
}

export async function runSetupWorkflow(options: {
    engine: SyncEngine
    sessionId: string
    rootPath: string
    manifestPath: string
    taskId: string
    projectId: string
    steps: SetupWorkflowStep[]
}): Promise<SetupWorkflowRunResult> {
    const completed = new Set<string>()
    const results: SetupWorkflowStepResult[] = []

    for (const step of options.steps) {
        const unmetDependency = (step.dependsOn ?? []).find((dependency) => !completed.has(dependency))
        if (unmetDependency) {
            return {
                ok: false,
                manifestPath: options.manifestPath,
                rootPath: options.rootPath,
                steps: results,
                stepId: step.id,
                error: `Step "${step.id}" depends on "${unmetDependency}" before it has completed`
            }
        }

        const cwd = resolveStepCwd(options.rootPath, step.cwd)
        const command = buildStepCommand(step, {
            ...step.env,
            [PRODUCT_ENV.PROJECT_ROOT]: options.rootPath,
            [PRODUCT_ENV.TASK_ID]: options.taskId,
            [PRODUCT_ENV.TASK_PROJECT_ID]: options.projectId
        })

        const startedAt = Date.now()
        let response: Awaited<ReturnType<SyncEngine['runBash']>>
        try {
            response = await options.engine.runBash(options.sessionId, {
                command,
                cwd,
                timeout: (step.timeoutSec ?? 300) * 1000
            })
        } catch (error) {
            const summary = error instanceof Error ? error.message : String(error)
            const stepResult: SetupWorkflowStepResult = {
                id: step.id,
                type: step.type,
                status: 'failed',
                cwd,
                command,
                stdout: '',
                stderr: '',
                durationMs: Date.now() - startedAt,
                summary
            }
            results.push(stepResult)
            return {
                ok: false,
                manifestPath: options.manifestPath,
                rootPath: options.rootPath,
                steps: results,
                stepId: step.id,
                error: summary
            }
        }

        const stdout = response.stdout ?? ''
        const stderr = response.stderr ?? ''
        const summary = summarizeStepOutput({
            command,
            stdout,
            stderr,
            error: response.success ? undefined : response.error
        })
        const stepResult: SetupWorkflowStepResult = {
            id: step.id,
            type: step.type,
            status: response.success ? 'succeeded' : 'failed',
            cwd,
            command,
            stdout,
            stderr,
            durationMs: Date.now() - startedAt,
            summary
        }
        results.push(stepResult)

        if (!response.success) {
            return {
                ok: false,
                manifestPath: options.manifestPath,
                rootPath: options.rootPath,
                steps: results,
                stepId: step.id,
                error: summary
            }
        }

        completed.add(step.id)
    }

    return {
        ok: true,
        manifestPath: options.manifestPath,
        rootPath: options.rootPath,
        steps: results
    }
}
