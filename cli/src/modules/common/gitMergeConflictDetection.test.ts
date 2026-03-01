import { describe, expect, it } from 'vitest'
import { formatMergeFailureMessage, isLikelyMergeConflict, MERGE_CONFLICT_ERROR_MESSAGE } from './gitMergeConflictDetection'

describe('git merge conflict detection', () => {
    it('detects merge conflicts from stderr when conflict files are missing', () => {
        const result = {
            conflictFiles: [],
            error: 'Command failed: git merge --squash task-branch',
            stderr: 'Automatic merge failed; fix conflicts and then commit the result.'
        }

        expect(isLikelyMergeConflict(result)).toBe(true)
        expect(formatMergeFailureMessage(result)).toBe(MERGE_CONFLICT_ERROR_MESSAGE)
    })

    it('detects merge conflicts when conflict files are present', () => {
        const result = {
            conflictFiles: ['src/main.ts'],
            error: 'Merge failed'
        }

        expect(isLikelyMergeConflict(result)).toBe(true)
        expect(formatMergeFailureMessage(result)).toBe(MERGE_CONFLICT_ERROR_MESSAGE)
    })

    it('keeps non-conflict failures readable', () => {
        const result = {
            error: 'fatal: not a git repository'
        }

        expect(isLikelyMergeConflict(result)).toBe(false)
        expect(formatMergeFailureMessage(result)).toBe('fatal: not a git repository')
    })
})
