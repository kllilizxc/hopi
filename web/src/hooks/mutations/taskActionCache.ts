import type { QueryClient } from '@tanstack/react-query'

import type { Task, TasksResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'

export function updateTaskCaches(options: {
    queryClient: QueryClient
    taskId: string
    updateTask: (task: Task) => Task
}): void {
    const { queryClient, taskId, updateTask } = options

    queryClient.setQueryData<{ task: Task } | undefined>(queryKeys.task(taskId), (current) => {
        if (!current?.task) {
            return current
        }

        const nextTask = updateTask(current.task)
        if (nextTask === current.task) {
            return current
        }

        return {
            ...current,
            task: nextTask
        }
    })

    queryClient.setQueriesData<TasksResponse>({ queryKey: ['tasks'] }, (current) => {
        if (!current?.tasks || current.tasks.length === 0) {
            return current
        }

        let changed = false
        const nextTasks = current.tasks.map((task) => {
            if (task.id !== taskId) {
                return task
            }

            const nextTask = updateTask(task)
            if (nextTask !== task) {
                changed = true
            }
            return nextTask
        })

        if (!changed) {
            return current
        }

        return {
            ...current,
            tasks: nextTasks
        }
    })
}

export function replaceTaskInCaches(options: {
    queryClient: QueryClient
    taskId: string
    task: Task
}): void {
    updateTaskCaches({
        queryClient: options.queryClient,
        taskId: options.taskId,
        updateTask: (current) => current === options.task ? current : options.task
    })

    options.queryClient.setQueryData<{ task: Task } | undefined>(queryKeys.task(options.taskId), (current) => {
        if (current?.task === options.task) {
            return current
        }
        return { task: options.task }
    })
}

export function invalidateTaskCaches(queryClient: QueryClient, taskId: string, extraQueryKeys: Array<readonly unknown[]> = []): void {
    void queryClient.invalidateQueries({ queryKey: queryKeys.task(taskId) })
    void queryClient.invalidateQueries({ queryKey: ['tasks'] })

    for (const queryKey of extraQueryKeys) {
        void queryClient.invalidateQueries({ queryKey })
    }
}

export function invalidateSessionCaches(queryClient: QueryClient, sessionIds: Array<string | null | undefined>): void {
    const seen = new Set<string>()
    for (const sessionId of sessionIds) {
        if (!sessionId || seen.has(sessionId)) {
            continue
        }

        seen.add(sessionId)
        void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages(sessionId) })
    }
}
