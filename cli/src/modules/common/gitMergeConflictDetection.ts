export const MERGE_CONFLICT_ERROR_MESSAGE = 'Merge conflicts detected; manual resolution required'

type MergeFailureOutput = {
    conflictFiles?: string[]
    error?: string
    stdout?: string
    stderr?: string
}

function buildMergeFailureText(result: MergeFailureOutput): string {
    const chunks = [result.error, result.stderr, result.stdout]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

    if (chunks.length === 0) {
        return ''
    }

    return chunks.join('\n').toLowerCase()
}

export function isLikelyMergeConflict(result: MergeFailureOutput): boolean {
    const conflictFiles = result.conflictFiles ?? []
    if (conflictFiles.length > 0) {
        return true
    }

    const text = buildMergeFailureText(result)
    if (!text) {
        return false
    }

    return text.includes('merge conflict')
        || text.includes('automatic merge failed')
        || text.includes('fix conflicts')
        || text.includes('conflict (')
        || text.includes('unmerged file')
        || text.includes('unmerged path')
        || text.includes('冲突')
}

export function formatMergeFailureMessage(result: MergeFailureOutput): string {
    if (isLikelyMergeConflict(result)) {
        return MERGE_CONFLICT_ERROR_MESSAGE
    }

    const error = result.error?.trim()
    if (error) {
        return error
    }

    const stderr = result.stderr?.trim()
    if (stderr) {
        return stderr
    }

    const stdout = result.stdout?.trim()
    if (stdout) {
        return stdout
    }

    return 'Merge failed'
}
