import { useCallback, useMemo, useState } from 'react'
import { productStorageKey } from '@hopi/protocol/brand'

export const SELECTED_GOAL_STORAGE_KEY = productStorageKey('selected-goals-by-project-v1')

type GoalLike = {
    id: string
}

type SelectedGoalByProject = Record<string, string>

function readStoredSelection(): SelectedGoalByProject {
    if (typeof localStorage === 'undefined') return {}

    try {
        const raw = localStorage.getItem(SELECTED_GOAL_STORAGE_KEY)
        if (!raw) return {}
        const parsed = JSON.parse(raw) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

        const result: SelectedGoalByProject = {}
        for (const [projectId, goalId] of Object.entries(parsed)) {
            if (typeof projectId !== 'string' || projectId.trim().length === 0) continue
            if (typeof goalId !== 'string' || goalId.trim().length === 0) continue
            result[projectId] = goalId
        }
        return result
    } catch {
        return {}
    }
}

function writeStoredSelection(selection: SelectedGoalByProject): void {
    if (typeof localStorage === 'undefined') return

    try {
        localStorage.setItem(SELECTED_GOAL_STORAGE_KEY, JSON.stringify(selection))
    } catch {
        // Ignore browser storage errors; in-memory selection still updates.
    }
}

export function useSelectedProjectGoal<TGoal extends GoalLike>(
    projectId: string | null,
    goals: readonly TGoal[]
): {
    selectedGoalId: string | null
    selectGoal: (goalId: string) => void
} {
    const [selectedGoalByProject, setSelectedGoalByProject] = useState<SelectedGoalByProject>(readStoredSelection)

    const selectedGoalId = useMemo(() => {
        if (!projectId) return null
        const storedGoalId = selectedGoalByProject[projectId] ?? null
        if (storedGoalId && goals.some((goal) => goal.id === storedGoalId)) {
            return storedGoalId
        }
        return goals[0]?.id ?? null
    }, [goals, projectId, selectedGoalByProject])

    const selectGoal = useCallback((goalId: string) => {
        if (!projectId || !goalId.trim()) return

        setSelectedGoalByProject((current) => {
            if (current[projectId] === goalId) return current

            const next = {
                ...current,
                [projectId]: goalId
            }
            writeStoredSelection(next)
            return next
        })
    }, [projectId])

    return { selectedGoalId, selectGoal }
}
