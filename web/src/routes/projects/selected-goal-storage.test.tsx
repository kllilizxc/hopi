import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { readSelectedProjectGoalId, SELECTED_GOAL_STORAGE_KEY, useSelectedProjectGoal } from './selected-goal-storage'

type TestGoal = {
    id: string
}

function goals(ids: string[]): TestGoal[] {
    return ids.map((id) => ({ id }))
}

describe('useSelectedProjectGoal', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('restores and persists the selected goal per project', () => {
        localStorage.setItem(SELECTED_GOAL_STORAGE_KEY, JSON.stringify({
            'project-1': 'goal-2',
            'project-2': 'goal-3'
        }))

        const { result } = renderHook(() => useSelectedProjectGoal('project-1', goals(['goal-1', 'goal-2'])))

        expect(result.current.selectedGoalId).toBe('goal-2')

        act(() => {
            result.current.selectGoal('goal-1')
        })

        expect(result.current.selectedGoalId).toBe('goal-1')
        expect(JSON.parse(localStorage.getItem(SELECTED_GOAL_STORAGE_KEY) ?? '{}')).toEqual({
            'project-1': 'goal-1',
            'project-2': 'goal-3'
        })
    })

    it('falls back to the first available goal when the stored goal no longer exists', () => {
        localStorage.setItem(SELECTED_GOAL_STORAGE_KEY, JSON.stringify({
            'project-1': 'deleted-goal'
        }))

        const { result } = renderHook(() => useSelectedProjectGoal('project-1', goals(['goal-1', 'goal-2'])))

        expect(result.current.selectedGoalId).toBe('goal-1')
    })

    it('reads the raw selected goal id for background controller briefing', () => {
        localStorage.setItem(SELECTED_GOAL_STORAGE_KEY, JSON.stringify({
            'project-1': 'goal-2'
        }))

        expect(readSelectedProjectGoalId('project-1')).toBe('goal-2')
        expect(readSelectedProjectGoalId('project-2')).toBeNull()
        expect(readSelectedProjectGoalId(null)).toBeNull()
    })
})
