import { describe, expect, it } from 'vitest'
import { hasTaskMergeableChanges } from '@/lib/taskMerge'

describe('hasTaskMergeableChanges', () => {
    it('returns false when merge action is not allowed', () => {
        expect(hasTaskMergeableChanges({
            canMergeTaskWorktree: false,
            hasWorkingTreeChanges: true,
            worktreeBaseCommit: 'abc1234',
            committedChangedCount: 3,
            gitStatusError: null,
            isGitStatusLoading: false,
            isCommittedDiffLoading: false
        })).toBe(false)
    })

    it('returns true when working tree has changes', () => {
        expect(hasTaskMergeableChanges({
            canMergeTaskWorktree: true,
            hasWorkingTreeChanges: true,
            worktreeBaseCommit: 'abc1234',
            committedChangedCount: 0,
            gitStatusError: null,
            isGitStatusLoading: false,
            isCommittedDiffLoading: false
        })).toBe(true)
    })

    it('returns true when base commit is missing', () => {
        expect(hasTaskMergeableChanges({
            canMergeTaskWorktree: true,
            hasWorkingTreeChanges: false,
            worktreeBaseCommit: '',
            committedChangedCount: null,
            gitStatusError: null,
            isGitStatusLoading: false,
            isCommittedDiffLoading: false
        })).toBe(true)
    })

    it('uses committed change count when available', () => {
        expect(hasTaskMergeableChanges({
            canMergeTaskWorktree: true,
            hasWorkingTreeChanges: false,
            worktreeBaseCommit: 'abc1234',
            committedChangedCount: 2,
            gitStatusError: null,
            isGitStatusLoading: false,
            isCommittedDiffLoading: false
        })).toBe(true)

        expect(hasTaskMergeableChanges({
            canMergeTaskWorktree: true,
            hasWorkingTreeChanges: false,
            worktreeBaseCommit: 'abc1234',
            committedChangedCount: 0,
            gitStatusError: null,
            isGitStatusLoading: false,
            isCommittedDiffLoading: false
        })).toBe(false)
    })

    it('keeps merge button visible when committed diff is clean but git status errored', () => {
        expect(hasTaskMergeableChanges({
            canMergeTaskWorktree: true,
            hasWorkingTreeChanges: false,
            worktreeBaseCommit: 'abc1234',
            committedChangedCount: 0,
            gitStatusError: 'Git status unavailable',
            isGitStatusLoading: false,
            isCommittedDiffLoading: false
        })).toBe(true)
    })

    it('hides button while still loading without a committed diff result', () => {
        expect(hasTaskMergeableChanges({
            canMergeTaskWorktree: true,
            hasWorkingTreeChanges: false,
            worktreeBaseCommit: 'abc1234',
            committedChangedCount: null,
            gitStatusError: null,
            isGitStatusLoading: true,
            isCommittedDiffLoading: false
        })).toBe(false)
    })
})
