import type { OmcProgramBootstrapResponse } from '@hopi/protocol/types'

export type BootstrapNewProjectInput = {
    repoRoot: string
    name?: string
}

export type BootstrapNewProjectResult =
    | {
          kind: 'success'
          programId: string
          seedCreated: boolean
          bootstrap: OmcProgramBootstrapResponse
      }
    | {
          kind: 'seed-error'
          programId: string
          seedCreated: false
          attach: OmcProgramBootstrapResponse
          error: string
      }

type BootstrapNewProjectApi = {
    attachLocalRepo(input: BootstrapNewProjectInput): Promise<OmcProgramBootstrapResponse>
    createPlanningSeed(programId: string): Promise<OmcProgramBootstrapResponse>
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
}

function normalizeSeedErrorMessage(error: unknown): string {
    const message = asError(error).message.trim()
    const prefix = 'Seed creation failed'

    try {
        const parsed = JSON.parse(message) as unknown
        if (typeof parsed === 'string' && parsed.trim()) {
            return `${prefix}: ${parsed.trim()}`
        }

        if (parsed && typeof parsed === 'object') {
            const detail =
                typeof (parsed as { error?: unknown }).error === 'string'
                    ? (parsed as { error: string }).error
                    : typeof (parsed as { message?: unknown }).message === 'string'
                      ? (parsed as { message: string }).message
                      : null

            if (detail && detail.trim()) {
                return `${prefix}: ${detail.trim()}`
            }
        }
    } catch {
    }

    if (message) {
        return `${prefix}: ${message}`
    }

    return prefix
}

export async function bootstrapNewProject(
    api: BootstrapNewProjectApi,
    input: BootstrapNewProjectInput,
): Promise<BootstrapNewProjectResult> {
    const name = input.name?.trim()
    const attach = await api.attachLocalRepo({
        repoRoot: input.repoRoot,
        ...(name ? { name } : {}),
    })
    const programId = attach.program.id

    if (attach.planning.status !== 'missing') {
        return {
            kind: 'success',
            programId,
            seedCreated: false,
            bootstrap: attach,
        }
    }

    try {
        const seed = await api.createPlanningSeed(attach.program.id)
        return {
            kind: 'success',
            programId,
            seedCreated: true,
            bootstrap: seed,
        }
    } catch (error) {
        return {
            kind: 'seed-error',
            programId,
            seedCreated: false,
            attach,
            error: normalizeSeedErrorMessage(error),
        }
    }
}
