import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { Session, SessionSummary } from '@/types/api'
import { Toast as ToastCard } from '@/components/ui/Toast'
import { useAppContext } from '@/lib/app-context'
import { queryKeys } from '@/lib/query-keys'
import { useToast, type Toast as ToastEntry } from '@/lib/toast-context'

type TaskChatTarget = {
    projectId: string
    taskId: string
}

function getTaskChatTarget(session: { metadata?: { projectId?: string; taskId?: string } | null } | null | undefined): TaskChatTarget | null {
    const projectId = session?.metadata?.projectId
    const taskId = session?.metadata?.taskId
    if (!projectId || !taskId) {
        return null
    }
    return { projectId, taskId }
}

export function ToastContainer() {
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const { api } = useAppContext()
    const { toasts, removeToast } = useToast()

    const resolveTaskChatTarget = async (sessionId: string): Promise<TaskChatTarget | null> => {
        const sessions = queryClient.getQueryData<{ sessions: SessionSummary[] }>(queryKeys.sessions)?.sessions ?? []
        const fromList = getTaskChatTarget(sessions.find((session) => session.id === sessionId))
        if (fromList) {
            return fromList
        }

        const fromSession = getTaskChatTarget(
            queryClient.getQueryData<{ session: Session }>(queryKeys.session(sessionId))?.session
        )
        if (fromSession) {
            return fromSession
        }

        if (!api) {
            return null
        }

        try {
            const fetched = await api.getSession(sessionId)
            return getTaskChatTarget(fetched.session)
        } catch {
            return null
        }
    }

    const handleToastClick = (toast: ToastEntry) => {
        removeToast(toast.id)

        void (async () => {
            if (toast.sessionId) {
                const taskTarget = await resolveTaskChatTarget(toast.sessionId)
                if (taskTarget) {
                    void navigate({
                        to: '/projects/$projectId/tasks/$taskId/chat',
                        params: taskTarget
                    })
                    return
                }
            }

            if (toast.url) {
                void navigate({ to: toast.url })
                return
            }

            if (toast.sessionId) {
                void navigate({
                    to: '/sessions/$sessionId',
                    params: { sessionId: toast.sessionId },
                })
            }
        })()
    }

    if (toasts.length === 0) {
        return null
    }

    return (
        <div
            className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+1rem)] z-50 flex flex-col items-center gap-2 px-3"
            aria-live="polite"
        >
            {toasts.map((toast) => (
                <ToastCard
                    key={toast.id}
                    title={toast.title}
                    body={toast.body}
                    className="cursor-pointer"
                    onClick={() => handleToastClick(toast)}
                    onClose={() => removeToast(toast.id)}
                />
            ))}
        </div>
    )
}
