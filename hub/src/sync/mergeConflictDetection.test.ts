import { describe, expect, it } from 'bun:test'
import { getMergeWorktreeErrorStatus, isLikelyMergeConflict } from './mergeConflictDetection'

describe('merge conflict detection', () => {
    it('detects conflict from git stderr when conflict file list is empty', () => {
        const result = {
            error: 'Command failed: git merge --squash task-branch',
            stderr: 'Automatic merge failed; fix conflicts and then commit the result.',
            conflictFiles: []
        }

        expect(isLikelyMergeConflict(result)).toBe(true)
        expect(getMergeWorktreeErrorStatus(result)).toBe(409)
    })

    it('treats explicit conflict files as conflict regardless of error wording', () => {
        const result = {
            error: 'Merge failed',
            conflictFiles: ['src/app.ts']
        }

        expect(isLikelyMergeConflict(result)).toBe(true)
        expect(getMergeWorktreeErrorStatus(result)).toBe(409)
    })

    it('keeps non-conflict failures mapped to original statuses', () => {
        const timeoutResult = {
            error: 'Command timed out'
        }
        const unknownResult = {
            error: 'fatal: not a git repository'
        }

        expect(isLikelyMergeConflict(timeoutResult)).toBe(false)
        expect(getMergeWorktreeErrorStatus(timeoutResult)).toBe(504)
        expect(getMergeWorktreeErrorStatus(unknownResult)).toBe(500)
    })
})
