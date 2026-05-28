import { useParams } from '@tanstack/react-router'
import { TaskWorkbench } from '@/routes/projects/task-workbench'

export function TaskDiffsPage() {
    const { projectId, taskId } = useParams({ from: '/projects/$projectId/tasks/$taskId' })
    return <TaskWorkbench projectId={projectId} taskId={taskId} tab="diffs" />
}

