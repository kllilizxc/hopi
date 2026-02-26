import { useParams } from '@tanstack/react-router'
import { TaskWorkbench } from '@/routes/projects/task-workbench'

export function TaskChatPage() {
    const { projectId, taskId } = useParams({ from: '/projects/$projectId/tasks/$taskId/chat' })
    return <TaskWorkbench projectId={projectId} taskId={taskId} tab="chat" />
}
