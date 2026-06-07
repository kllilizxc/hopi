import { join } from 'node:path'
import type { StoredWorkspace } from '../../store'

export const GOAL_DOC_FILENAME = 'goal.md'
export const GOAL_DESIGN_FILENAME = 'design.md'
export const GOAL_TODO_FILENAME = 'todo.yml'
export const GOAL_DECISIONS_FILENAME = 'decisions.yml'
export const GOAL_PLANNING_REQUESTS_FILENAME = 'planning-requests.yml'
export const GOAL_EVENTS_FILENAME = 'events.jsonl'
export const GOAL_WRITE_TRACE_FILENAME = 'write-trace.jsonl'
export const GLOBAL_PREFERENCE_FILENAME = 'preference.md'
export const LEGACY_GOAL_DECISIONS_FILENAME = 'decisions.md'
export const LEGACY_GOAL_OPERATOR_DIRNAME = 'operator'
export const LEGACY_GOAL_PLANNER_MAIL_FILENAME = 'planner-mail.yml'
export const LEGACY_TODO_MARKDOWN_FILENAME = 'todo.md'

export function getDocsRoot(defaultWorkspace: StoredWorkspace | null): string | null {
    return defaultWorkspace?.path ? join(defaultWorkspace.path, '.hopi', 'docs') : null
}

export function getGoalsRoot(docsRoot: string): string {
    return join(docsRoot, 'goals')
}

export function getGoalDocsDir(docsRoot: string, goalKey: string): string {
    return join(getGoalsRoot(docsRoot), goalKey)
}

export function getGoalDocPath(docsRoot: string, goalKey: string): string {
    return join(getGoalDocsDir(docsRoot, goalKey), GOAL_DOC_FILENAME)
}

export function getGoalDesignPath(docsRoot: string, goalKey: string): string {
    return join(getGoalDocsDir(docsRoot, goalKey), GOAL_DESIGN_FILENAME)
}

export function getLegacyGoalDocPath(docsRoot: string, goalKey: string): string {
    return join(getGoalsRoot(docsRoot), `${goalKey}.md`)
}

export function getGoalTodoPath(docsRoot: string, goalKey: string): string {
    return join(getGoalDocsDir(docsRoot, goalKey), GOAL_TODO_FILENAME)
}

export function getGoalDecisionsPath(docsRoot: string, goalKey: string): string {
    return join(getGoalDocsDir(docsRoot, goalKey), GOAL_DECISIONS_FILENAME)
}

export function getGoalPlanningRequestsPath(docsRoot: string, goalKey: string): string {
    return join(getGoalDocsDir(docsRoot, goalKey), GOAL_PLANNING_REQUESTS_FILENAME)
}

export function getGoalEventsPath(docsRoot: string, goalKey: string): string {
    return join(getGoalDocsDir(docsRoot, goalKey), GOAL_EVENTS_FILENAME)
}

export function getGoalWriteTracePath(docsRoot: string, goalKey: string): string {
    return join(getGoalDocsDir(docsRoot, goalKey), GOAL_WRITE_TRACE_FILENAME)
}

export function getLegacyGoalDecisionsPath(docsRoot: string, goalKey: string): string {
    return join(getGoalDocsDir(docsRoot, goalKey), LEGACY_GOAL_DECISIONS_FILENAME)
}

export function getGoalOperatorDir(docsRoot: string, goalKey: string): string {
    return join(getGoalDocsDir(docsRoot, goalKey), LEGACY_GOAL_OPERATOR_DIRNAME)
}

export function getGoalPlannerMailPath(docsRoot: string, goalKey: string): string {
    return join(getGoalOperatorDir(docsRoot, goalKey), LEGACY_GOAL_PLANNER_MAIL_FILENAME)
}

export function getPreferencePath(docsRoot: string): string {
    return join(docsRoot, '..', GLOBAL_PREFERENCE_FILENAME)
}

export function getLegacyPreferencePath(docsRoot: string): string {
    return join(docsRoot, GLOBAL_PREFERENCE_FILENAME)
}

export function getLegacyTodoMarkdownPath(docsRoot: string): string {
    return join(docsRoot, LEGACY_TODO_MARKDOWN_FILENAME)
}
