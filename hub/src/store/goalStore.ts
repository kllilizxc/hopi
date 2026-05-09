import type { Database } from 'bun:sqlite'

import type { StoredGoal } from './types'
import { createGoal, getGoalByNamespace, listGoalsByProjectAndNamespace, updateGoalByNamespace } from './goals'

export class GoalStore {
    constructor(private readonly db: Database) {
    }

    listGoalsByProjectAndNamespace(projectId: string, namespace: string, options?: { includeArchived?: boolean }): StoredGoal[] {
        return listGoalsByProjectAndNamespace(this.db, projectId, namespace, options)
    }

    getGoalByNamespace(goalId: string, namespace: string): StoredGoal | null {
        return getGoalByNamespace(this.db, goalId, namespace)
    }

    createGoal(goal: {
        id: string
        projectId: string
        namespace: string
        title: string
        description?: string | null
        status?: StoredGoal['status']
        successCriteria?: string | null
        autopilotEnabled?: boolean
        deployRequiresApproval?: boolean
        currentFocus?: string | null
    }): StoredGoal {
        return createGoal(this.db, goal)
    }

    updateGoalByNamespace(
        goalId: string,
        namespace: string,
        patch: Partial<Pick<
            StoredGoal,
            'title' | 'description' | 'status' | 'successCriteria' | 'autopilotEnabled' | 'deployRequiresApproval' | 'currentFocus' | 'archivedAt'
        >>
    ): StoredGoal | null {
        return updateGoalByNamespace(this.db, goalId, namespace, patch)
    }
}
