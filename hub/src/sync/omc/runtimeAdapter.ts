import type { Session } from '@hopi/protocol/types'
import type { SyncEngine } from '../syncEngine'
import { resolveSessionPreferredRootPath, resolveSessionWorktreePath } from '../sessionRootPaths'
import type { OmcPlanDetailResponse, OmcPlanRuntime, OmcProgram } from '@hopi/protocol/types'

function buildWorktreeName(plan: OmcPlanDetailResponse['plan']): string {
    const slug = `${plan.planKey}-${plan.planTitle}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64)

    return slug || `omc-${plan.planKey}`
}

function resolveMachineId(engine: SyncEngine, program: OmcProgram, namespace: string): string {
    if (program.machineId) {
        const machine = engine.getMachineByNamespace(program.machineId, namespace)
        if (machine?.active) {
            return machine.id
        }
    }

    const onlineMachine = engine.getOnlineMachinesByNamespace(namespace)[0]
    if (!onlineMachine) {
        throw new Error('No machine online. Start the runner and try again: hopi runner start')
    }

    return onlineMachine.id
}

function resolveSessionBranch(session: Session | undefined): string | null {
    return session?.metadata?.worktree?.branch?.trim() || null
}

function resolveSessionWorkspacePath(session: Session | undefined, fallbackPath: string): string {
    return resolveSessionWorktreePath(session ?? {})
        ?? resolveSessionPreferredRootPath(session ?? {})
        ?? fallbackPath
}

async function waitForUsableSession(engine: SyncEngine, sessionId: string, timeoutMs: number = 20_000): Promise<void> {
    const becameActive = await engine.waitForSessionActive(sessionId, timeoutMs)
    if (!becameActive) {
        throw new Error('Session failed to become active')
    }
}

async function applyDefaultSessionConfig(engine: SyncEngine, sessionId: string): Promise<string | null> {
    try {
        await engine.applySessionConfig(sessionId, {
            permissionMode: 'safe-yolo'
        })
        return null
    } catch (error) {
        return error instanceof Error ? error.message : String(error)
    }
}

export type OmcRuntimeLaunchResult = {
    adapterId: string
    machineId: string
    sessionId: string
    worktreePath: string
    currentBranch: string | null
    targetBranch: string | null
    sessionConfigError: string | null
}

export interface OmcAttemptRuntimeAdapter {
    readonly id: string

    startAttemptSession(options: {
        engine: SyncEngine
        namespace: string
        program: OmcProgram
        plan: OmcPlanDetailResponse['plan']
        runtime: OmcPlanRuntime
    }): Promise<OmcRuntimeLaunchResult>

    ensureTakeoverSession(options: {
        engine: SyncEngine
        namespace: string
        program: OmcProgram
        plan: OmcPlanDetailResponse['plan']
        runtime: OmcPlanRuntime
        preferredSessionId?: string | null
    }): Promise<OmcRuntimeLaunchResult>

    dispatchContextPack(options: {
        engine: SyncEngine
        sessionId: string
        promptText: string
    }): Promise<void>
}

export class CodexAttemptRuntimeAdapter implements OmcAttemptRuntimeAdapter {
    readonly id = 'codex'

    async startAttemptSession(options: {
        engine: SyncEngine
        namespace: string
        program: OmcProgram
        plan: OmcPlanDetailResponse['plan']
        runtime: OmcPlanRuntime
    }): Promise<OmcRuntimeLaunchResult> {
        const machineId = resolveMachineId(options.engine, options.program, options.namespace)
        const targetBranch = options.program.targetBranch ?? options.program.primaryBranch ?? null
        const spawnDirectory = options.runtime.currentWorktreePath ?? options.program.repoRoot
        const useExistingWorktree = Boolean(options.runtime.currentWorktreePath)

        const spawnResult = await options.engine.spawnSession(
            machineId,
            spawnDirectory,
            'codex',
            undefined,
            true,
            useExistingWorktree ? 'simple' : 'worktree',
            useExistingWorktree ? undefined : buildWorktreeName(options.plan),
            undefined,
            undefined,
            targetBranch ?? undefined
        )

        if (spawnResult.type !== 'success') {
            throw new Error(spawnResult.message)
        }

        await waitForUsableSession(options.engine, spawnResult.sessionId)
        const sessionConfigError = await applyDefaultSessionConfig(options.engine, spawnResult.sessionId)
        const session = options.engine.getSessionByNamespace(spawnResult.sessionId, options.namespace)

        return {
            adapterId: this.id,
            machineId,
            sessionId: spawnResult.sessionId,
            worktreePath: resolveSessionWorkspacePath(session, options.runtime.currentWorktreePath ?? spawnDirectory),
            currentBranch: resolveSessionBranch(session) ?? options.runtime.currentBranch ?? null,
            targetBranch,
            sessionConfigError
        }
    }

    async ensureTakeoverSession(options: {
        engine: SyncEngine
        namespace: string
        program: OmcProgram
        plan: OmcPlanDetailResponse['plan']
        runtime: OmcPlanRuntime
        preferredSessionId?: string | null
    }): Promise<OmcRuntimeLaunchResult> {
        const preferredSessionId = options.preferredSessionId ?? null
        const fallbackMachineId = resolveMachineId(options.engine, options.program, options.namespace)

        if (preferredSessionId) {
            const existingSession = options.engine.getSessionByNamespace(preferredSessionId, options.namespace)
            if (existingSession?.active) {
                return {
                    adapterId: this.id,
                    machineId: existingSession.metadata?.machineId ?? options.program.machineId ?? fallbackMachineId,
                    sessionId: preferredSessionId,
                    worktreePath: resolveSessionWorkspacePath(existingSession, options.runtime.currentWorktreePath ?? options.program.repoRoot),
                    currentBranch: resolveSessionBranch(existingSession) ?? options.runtime.currentBranch ?? null,
                    targetBranch: options.runtime.targetBranch ?? options.program.targetBranch ?? options.program.primaryBranch ?? null,
                    sessionConfigError: null
                }
            }

            const resumed = await options.engine.resumeSession(preferredSessionId, options.namespace)
            if (resumed.type === 'success') {
                const resumedSession = options.engine.getSessionByNamespace(resumed.sessionId, options.namespace)
                return {
                    adapterId: this.id,
                    machineId: resumedSession?.metadata?.machineId ?? options.program.machineId ?? fallbackMachineId,
                    sessionId: resumed.sessionId,
                    worktreePath: resolveSessionWorkspacePath(resumedSession, options.runtime.currentWorktreePath ?? options.program.repoRoot),
                    currentBranch: resolveSessionBranch(resumedSession) ?? options.runtime.currentBranch ?? null,
                    targetBranch: options.runtime.targetBranch ?? options.program.targetBranch ?? options.program.primaryBranch ?? null,
                    sessionConfigError: null
                }
            }
        }

        const machineId = fallbackMachineId
        const spawnDirectory = options.runtime.currentWorktreePath ?? options.program.repoRoot
        const reuseExistingWorktree = Boolean(options.runtime.currentWorktreePath)
        const targetBranch = options.runtime.targetBranch ?? options.program.targetBranch ?? options.program.primaryBranch ?? null
        const spawnResult = await options.engine.spawnSession(
            machineId,
            spawnDirectory,
            'codex',
            undefined,
            true,
            reuseExistingWorktree ? 'simple' : 'worktree',
            reuseExistingWorktree ? undefined : buildWorktreeName(options.plan),
            undefined,
            undefined,
            targetBranch ?? undefined
        )

        if (spawnResult.type !== 'success') {
            throw new Error(spawnResult.message)
        }

        await waitForUsableSession(options.engine, spawnResult.sessionId)
        const sessionConfigError = await applyDefaultSessionConfig(options.engine, spawnResult.sessionId)
        const session = options.engine.getSessionByNamespace(spawnResult.sessionId, options.namespace)

        return {
            adapterId: this.id,
            machineId,
            sessionId: spawnResult.sessionId,
            worktreePath: resolveSessionWorkspacePath(session, spawnDirectory),
            currentBranch: resolveSessionBranch(session) ?? options.runtime.currentBranch ?? null,
            targetBranch,
            sessionConfigError
        }
    }

    async dispatchContextPack(options: {
        engine: SyncEngine
        sessionId: string
        promptText: string
    }): Promise<void> {
        await options.engine.sendMessage(options.sessionId, {
            text: options.promptText,
            sentFrom: 'webapp'
        })
    }
}

export function createDefaultOmcAttemptRuntimeAdapter(): OmcAttemptRuntimeAdapter {
    return new CodexAttemptRuntimeAdapter()
}
