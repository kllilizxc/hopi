import { TASK_STATUS_ORDER } from '@hopi/protocol/tasks'
import type { TaskStatus } from '@/types/api'

export const TASK_STATUS_TITLE_KEY_BY_STATUS = {
    planned: 'projects.columns.planned',
    in_progress: 'projects.columns.inProgress',
    in_review: 'projects.columns.inReview',
    finished: 'projects.columns.finished',
    blocked: 'projects.columns.blocked',
} as const satisfies Record<TaskStatus, string>

export type KanbanColumnDef = {
    status: TaskStatus
    titleKey: string
}

export const KANBAN_COLUMNS: KanbanColumnDef[] = TASK_STATUS_ORDER.map((status) => ({
    status,
    titleKey: TASK_STATUS_TITLE_KEY_BY_STATUS[status],
}))
