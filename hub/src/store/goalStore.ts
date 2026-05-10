import type { Database } from 'bun:sqlite'

import type { StoredGoal } from './types'
import {
    createGoal,
    getGoalByGoalKeyAndNamespace,
    getGoalByNamespace,
    listGoalsByProjectAndNamespace,
    updateGoalByNamespace
} from './goals'

export class GoalStore {
    constructor(private readonly db: Database) {
    }

    listGoalsByProjectAndNamespace(projectId: string, namespace: string, options?: { includeArchived?: boolean }): StoredGoal[] {
        return listGoalsByProjectAndNamespace(this.db, projectId, namespace, options)
    }

    getGoalByNamespace(goalId: string, namespace: string): StoredGoal | null {
        return getGoalByNamespace(this.db, goalId, namespace)
    }

    getGoalByGoalKeyAndNamespace(projectId: string, namespace: string, goalKey: string): StoredGoal | null {
        return getGoalByGoalKeyAndNamespace(this.db, projectId, namespace, goalKey)
    }

    createGoal(goal: {
        id: string
        projectId: string
        namespace: string
        goalKey?: string
        title: string
        description?: string | null
        status?: StoredGoal['status']
        successCriteria?: string | null
        autopilotEnabled?: boolean
        automationPausedAt?: number | null
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
            'goalKey' | 'title' | 'description' | 'status' | 'successCriteria' | 'autopilotEnabled' | 'automationPausedAt' | 'deployRequiresApproval' | 'currentFocus' | 'archivedAt'
        >>
    ): StoredGoal | null {
        return updateGoalByNamespace(this.db, goalId, namespace, patch)
    }
}
