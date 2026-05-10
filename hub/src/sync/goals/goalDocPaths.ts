import { join } from 'node:path'
import type { StoredWorkspace } from '../../store'

export const GOAL_DOC_FILENAME = 'goal.md'
export const GOAL_TODO_FILENAME = 'todo.yml'
export const GOAL_DECISIONS_FILENAME = 'decisions.md'
export const LEGACY_TODO_YAML_FILENAME = 'todo.yml'
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

export function getLegacyGoalDocPath(docsRoot: string, goalKey: string): string {
    return join(getGoalsRoot(docsRoot), `${goalKey}.md`)
}

export function getGoalTodoPath(docsRoot: string, goalKey: string): string {
    return join(getGoalDocsDir(docsRoot, goalKey), GOAL_TODO_FILENAME)
}

export function getGoalDecisionsPath(docsRoot: string, goalKey: string): string {
    return join(getGoalDocsDir(docsRoot, goalKey), GOAL_DECISIONS_FILENAME)
}

export function getLegacyTodoYamlPath(docsRoot: string): string {
    return join(docsRoot, LEGACY_TODO_YAML_FILENAME)
}

export function getLegacyTodoMarkdownPath(docsRoot: string): string {
    return join(docsRoot, LEGACY_TODO_MARKDOWN_FILENAME)
}
