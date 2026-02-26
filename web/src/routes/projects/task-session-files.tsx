import { useMemo, useState } from 'react'
import type { ApiClient } from '@/api/client'
import { LoadingState } from '@/components/LoadingState'
import { DirectoryTree } from '@/components/SessionFiles/DirectoryTree'
import { useSession } from '@/hooks/queries/useSession'
import { useTranslation } from '@/lib/use-translation'
import { SessionFileViewer } from '@/routes/projects/session-file-viewer'

function getRootLabel(path: string | null | undefined, fallback: string): string {
    if (!path) return fallback
    const parts = path.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? fallback
}

export function TaskSessionFiles(props: { api: ApiClient | null; sessionId: string }) {
    const { t } = useTranslation()
    const { session, isLoading, error } = useSession(props.api, props.sessionId)
    const [openPath, setOpenPath] = useState<string | null>(null)

    const rootLabel = useMemo(() => {
        return getRootLabel(session?.metadata?.path, t('projects.files.title'))
    }, [session?.metadata?.path, t])

    if (openPath) {
        return (
            <SessionFileViewer
                api={props.api}
                sessionId={props.sessionId}
                filePath={openPath}
                onBack={() => setOpenPath(null)}
            />
        )
    }

    if (isLoading) {
        return (
            <div className="h-full flex items-center justify-center p-4">
                <LoadingState label={t('loading.files')} className="text-sm" />
            </div>
        )
    }

    if (error) {
        return (
            <div className="p-4 text-sm text-red-600">
                {error}
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col">
            <div className="px-3 py-2 border-b border-[var(--app-divider)]">
                <div className="text-sm font-semibold">{t('projects.files.title')}</div>
                <div className="text-xs text-[var(--app-hint)] truncate">
                    {session?.metadata?.path ?? props.sessionId}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                <div className="mx-auto w-full max-w-content">
                    <DirectoryTree
                        api={props.api}
                        sessionId={props.sessionId}
                        rootLabel={rootLabel}
                        onOpenFile={(path) => setOpenPath(path)}
                    />
                </div>
            </div>
        </div>
    )
}

