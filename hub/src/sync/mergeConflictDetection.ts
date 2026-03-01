export type MergeFailureResult = {
    error?: string
    conflictFiles?: string[]
    stdout?: string
    stderr?: string
}

function buildMergeFailureText(result: MergeFailureResult): string {
    const chunks = [result.error, result.stderr, result.stdout]
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)

    if (chunks.length === 0) {
        return ''
    }

    return chunks.join('\n').toLowerCase()
}

export function isLikelyMergeConflict(result: MergeFailureResult): boolean {
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

export function getMergeWorktreeErrorStatus(result: MergeFailureResult): 400 | 409 | 500 | 504 {
    if (isLikelyMergeConflict(result)) {
        return 409
    }

    const text = buildMergeFailureText(result)
    if (!text) {
        return 500
    }

    if (text.includes('uncommitted changes')) {
        return 409
    }

    if (text.includes('target branch') && text.includes('not found')) {
        return 400
    }
    if (text.includes('worktree branch') && text.includes('not found')) {
        return 400
    }

    if (text.includes('required')) {
        return 400
    }

    if (text.includes('timed out')) {
        return 504
    }

    return 500
}
