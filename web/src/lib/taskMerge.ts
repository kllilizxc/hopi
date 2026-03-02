export type TaskMergeableChangesInput = {
    canMergeTaskWorktree: boolean
    hasWorkingTreeChanges: boolean
    worktreeBaseCommit: string
    committedChangedCount: number | null
    gitStatusError: string | null
    isGitStatusLoading: boolean
    isCommittedDiffLoading: boolean
}

export function hasTaskMergeableChanges(input: TaskMergeableChangesInput): boolean {
    if (!input.canMergeTaskWorktree) {
        return false
    }

    if (input.hasWorkingTreeChanges) {
        return true
    }

    if (!input.worktreeBaseCommit) {
        return true
    }

    if (typeof input.committedChangedCount === 'number') {
        if (input.committedChangedCount === 0 && input.gitStatusError) {
            return true
        }
        return input.committedChangedCount > 0
    }

    if (input.isGitStatusLoading || input.isCommittedDiffLoading) {
        return false
    }

    return true
}
