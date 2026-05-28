import { useParams } from '@tanstack/react-router'
import { TaskWorkbench } from '@/routes/projects/task-workbench'

export function TaskPanelPage() {
    const { projectId, taskId } = useParams({ from: '/projects/$projectId/tasks/$taskId/task' })
    return <TaskWorkbench projectId={projectId} taskId={taskId} tab="task" forceTask />
}

