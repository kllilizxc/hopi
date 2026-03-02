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
    if (text.includes('already checked out at')) {
        return 409
    }
    if (
        text.includes('you have not concluded your merge')
        || text.includes('merge_head exists')
        || text.includes('resolve your current index first')
        || text.includes('another git process seems to be running')
        || text.includes('index.lock')
        || text.includes('please commit your changes or stash them')
        || text.includes('working tree contains unstaged changes')
        || text.includes('would be overwritten by checkout')
        || text.includes('would be overwritten by merge')
        || text.includes('cannot switch branch')
    ) {
        return 409
    }
    if (
        text.includes('rebase in progress')
        || text.includes('while rebasing')
        || text.includes('cherry-pick')
        || text.includes('revert in progress')
    ) {
        return 409
    }

    if (text.includes('target branch') && text.includes('not found')) {
        return 400
    }
    if (text.includes('worktree branch') && text.includes('not found')) {
        return 400
    }

    if (text.includes('not a worktree session')) {
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
