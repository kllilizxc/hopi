import { TASK_STATUS_ORDER } from '@hopi/protocol/tasks'
import type { TaskStatus } from '@/types/api'

export const TASK_STATUS_TITLE_KEY_BY_STATUS = {
    planning: 'projects.columns.planning',
    running: 'projects.columns.running',
    review: 'projects.columns.review',
    blocked: 'projects.columns.blocked',
    done: 'projects.columns.done',
} as const satisfies Partial<Record<TaskStatus, string>>

export type KanbanColumnDef = {
    status: TaskStatus
    titleKey: string
}

export const KANBAN_COLUMNS: KanbanColumnDef[] = TASK_STATUS_ORDER.map((status) => ({
    status,
    titleKey: TASK_STATUS_TITLE_KEY_BY_STATUS[status] ?? `projects.columns.${status}`,
}))
