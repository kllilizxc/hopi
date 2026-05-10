function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

const CHANGE_PATH_KEYS = ['path', 'file', 'filePath', 'file_path']

function getChangeEntryPath(entry: unknown): string | null {
    const direct = asNonEmptyString(entry)
    if (direct) return direct
    if (!isRecord(entry)) return null

    for (const key of CHANGE_PATH_KEYS) {
        const path = asNonEmptyString(entry[key])
        if (path) return path
    }

    return null
}

function isArrayIndexKey(key: string): boolean {
    return /^(0|[1-9]\d*)$/.test(key)
}

function addPath(paths: string[], seen: Set<string>, path: string | null) {
    if (!path || seen.has(path)) return
    seen.add(path)
    paths.push(path)
}

function getCodexChangePaths(changes: unknown): string[] {
    const paths: string[] = []
    const seen = new Set<string>()

    if (Array.isArray(changes)) {
        for (const entry of changes) {
            addPath(paths, seen, getChangeEntryPath(entry))
        }
        return paths
    }

    if (!isRecord(changes)) return paths

    for (const [key, entry] of Object.entries(changes)) {
        if (!isArrayIndexKey(key)) {
            addPath(paths, seen, asNonEmptyString(key))
            continue
        }

        addPath(paths, seen, getChangeEntryPath(entry))
    }

    return paths
}

export function getCodexPatchInputPaths(input: unknown): string[] {
    if (!isRecord(input)) return []
    return getCodexChangePaths(input.changes)
}

export function getCodexPatchResultPaths(result: unknown): string[] {
    if (!isRecord(result) || typeof result.stdout !== 'string') return []

    const paths: string[] = []
    const seen = new Set<string>()
    for (const match of result.stdout.matchAll(/^[MAD]\s+(.+)$/gm)) {
        addPath(paths, seen, asNonEmptyString(match[1]))
    }

    return paths
}

export function getCodexPatchPaths(input: unknown, result: unknown): string[] {
    const inputPaths = getCodexPatchInputPaths(input)
    return inputPaths.length > 0 ? inputPaths : getCodexPatchResultPaths(result)
}
