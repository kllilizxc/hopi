import { join } from 'node:path'
import { normalizeGoalKey } from '@hopi/protocol'

export const OPERATOR_DIRNAME = 'operator'
export const GOAL_PREFERENCES_FILENAME = 'preferences.yml'
export const GOAL_PLANNER_MAIL_FILENAME = 'planner-mail.yml'
export const GLOBAL_PREFERENCE_FILENAME = 'preference.md'

export function getGlobalPreferencePath(workspacePath: string): string {
    return join(workspacePath, '.hopi', GLOBAL_PREFERENCE_FILENAME)
}

export function getGoalOperatorDir(workspacePath: string, goalKey: string): string {
    return join(workspacePath, '.hopi', 'docs', 'goals', normalizeGoalKey(goalKey), OPERATOR_DIRNAME)
}

export function getGoalPreferencesPath(workspacePath: string, goalKey: string): string {
    return join(getGoalOperatorDir(workspacePath, goalKey), GOAL_PREFERENCES_FILENAME)
}

export function getGoalPlannerMailPath(workspacePath: string, goalKey: string): string {
    return join(getGoalOperatorDir(workspacePath, goalKey), GOAL_PLANNER_MAIL_FILENAME)
}
