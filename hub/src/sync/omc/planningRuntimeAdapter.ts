import type { Session } from '@hopi/protocol/types'
import type { OmcProgram } from '@hopi/protocol/types'
import type { SyncEngine } from '../syncEngine'
import { resolveSessionPreferredRootPath } from '../sessionRootPaths'

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

function resolveSessionWorkspacePath(session: Session | undefined, fallbackPath: string): string {
    return resolveSessionPreferredRootPath(session ?? {}) ?? fallbackPath
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

export type OmcPlanningRuntimeLaunchResult = {
    adapterId: string
    machineId: string
    sessionId: string
    workspacePath: string
    sessionConfigError: string | null
}

export interface OmcPlanningRuntimeAdapter {
    readonly id: string

    startPlanningSession(options: {
        engine: SyncEngine
        namespace: string
        program: OmcProgram
    }): Promise<OmcPlanningRuntimeLaunchResult>

    dispatchPrompt(options: {
        engine: SyncEngine
        sessionId: string
        promptText: string
    }): Promise<void>
}

export class CodexPlanningRuntimeAdapter implements OmcPlanningRuntimeAdapter {
    readonly id = 'codex'

    async startPlanningSession(options: {
        engine: SyncEngine
        namespace: string
        program: OmcProgram
    }): Promise<OmcPlanningRuntimeLaunchResult> {
        const machineId = resolveMachineId(options.engine, options.program, options.namespace)
        const spawnResult = await options.engine.spawnSession(
            machineId,
            options.program.repoRoot,
            'codex',
            undefined,
            true,
            'simple'
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
            workspacePath: resolveSessionWorkspacePath(session, options.program.repoRoot),
            sessionConfigError
        }
    }

    async dispatchPrompt(options: {
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

export function createDefaultOmcPlanningRuntimeAdapter(): OmcPlanningRuntimeAdapter {
    return new CodexPlanningRuntimeAdapter()
}
