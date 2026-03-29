import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH } from '@hopi/protocol/brand'
import {
    ProjectActionContractSchema,
    type ProjectActionContract
} from '@hopi/protocol/actions'
import type { SyncEngine } from './syncEngine'

export type LoadProjectActionContractResult =
    | {
        kind: 'missing'
        manifestPath: string
    }
    | {
        kind: 'invalid'
        manifestPath: string
        error: string
    }
    | {
        kind: 'valid'
        manifestPath: string
        contract: ProjectActionContract
    }

function normalizeErrorParts(parts: Array<string | undefined>): string {
    return parts
        .map((part) => part?.trim() ?? '')
        .filter((part) => part.length > 0)
        .join('\n')
        .toLowerCase()
}

function isMissingManifestError(parts: Array<string | undefined>): boolean {
    const combined = normalizeErrorParts(parts)
    if (!combined) {
        return false
    }

    return combined.includes('enoent') || combined.includes('no such file')
}

function isOutsideWorkingDirectoryError(parts: Array<string | undefined>): boolean {
    const combined = normalizeErrorParts(parts)
    if (!combined) {
        return false
    }

    return combined.includes('outside the working directory')
        || (combined.includes('access denied') && combined.includes('working directory'))
}

function formatSchemaIssues(error: z.ZodError): string {
    return error.issues
        .map((issue) => {
            const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
            return `${path}: ${issue.message}`
        })
        .join('; ')
}

export function parseProjectActionContract(options: {
    manifestPath: string
    raw: string
}): LoadProjectActionContractResult {
    let parsedYaml: unknown
    try {
        parsedYaml = parseYaml(options.raw)
    } catch (error) {
        return {
            kind: 'invalid',
            manifestPath: options.manifestPath,
            error: `YAML parse error: ${error instanceof Error ? error.message : String(error)}`
        }
    }

    const parsed = ProjectActionContractSchema.safeParse(parsedYaml)
    if (!parsed.success) {
        return {
            kind: 'invalid',
            manifestPath: options.manifestPath,
            error: formatSchemaIssues(parsed.error)
        }
    }

    return {
        kind: 'valid',
        manifestPath: options.manifestPath,
        contract: parsed.data
    }
}

export async function loadProjectActionContract(rootPath: string): Promise<LoadProjectActionContractResult> {
    const manifestPath = join(rootPath, PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH)

    let raw: string
    try {
        raw = await readFile(manifestPath, 'utf8')
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (isMissingManifestError([message])) {
            return {
                kind: 'missing',
                manifestPath
            }
        }
        return {
            kind: 'invalid',
            manifestPath,
            error: `Failed to read manifest: ${message}`
        }
    }

    return parseProjectActionContract({ manifestPath, raw })
}

export async function loadProjectActionContractFromSession(options: {
    engine: SyncEngine
    sessionId: string
    rootPaths: string[]
}): Promise<(LoadProjectActionContractResult & { rootPath?: string })> {
    if (typeof options.engine.readSessionFile !== 'function') {
        return {
            kind: 'missing',
            manifestPath: PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH
        }
    }

    const candidates = Array.from(new Set(options.rootPaths.map((path) => path.trim()).filter((path) => path.length > 0)))
    let lastMissingManifest: { rootPath: string; manifestPath: string } | undefined
    let lastAccessDeniedCandidate: { rootPath: string; manifestPath: string; error: string } | undefined

    for (const rootPath of candidates) {
        const manifestPath = join(rootPath, PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH)
        let response: Awaited<ReturnType<SyncEngine['readSessionFile']>>
        try {
            response = await options.engine.readSessionFile(options.sessionId, PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH, rootPath)
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (isMissingManifestError([message])) {
                lastMissingManifest = { rootPath, manifestPath }
                continue
            }
            if (isOutsideWorkingDirectoryError([message])) {
                lastAccessDeniedCandidate = { rootPath, manifestPath, error: message }
                continue
            }
            return {
                kind: 'invalid',
                rootPath,
                manifestPath,
                error: message
            }
        }

        if (!response.success) {
            if (isMissingManifestError([response.error])) {
                lastMissingManifest = { rootPath, manifestPath }
                continue
            }
            if (isOutsideWorkingDirectoryError([response.error])) {
                lastAccessDeniedCandidate = {
                    rootPath,
                    manifestPath,
                    error: response.error ?? 'Failed to read actions manifest'
                }
                continue
            }

            return {
                kind: 'invalid',
                rootPath,
                manifestPath,
                error: response.error ?? 'Failed to read actions manifest'
            }
        }

        const encoded = response.content ?? ''
        const raw = Buffer.from(encoded, 'base64').toString('utf8')
        const parsed = parseProjectActionContract({ manifestPath, raw })
        return parsed.kind === 'valid'
            ? { ...parsed, rootPath }
            : { ...parsed, rootPath }
    }

    if (lastMissingManifest) {
        return {
            kind: 'missing',
            rootPath: lastMissingManifest.rootPath,
            manifestPath: lastMissingManifest.manifestPath
        }
    }

    if (lastAccessDeniedCandidate) {
        return {
            kind: 'invalid',
            rootPath: lastAccessDeniedCandidate.rootPath,
            manifestPath: lastAccessDeniedCandidate.manifestPath,
            error: lastAccessDeniedCandidate.error
        }
    }

    return {
        kind: 'missing',
        manifestPath: candidates[0] ? join(candidates[0], PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH) : PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH
    }
}
