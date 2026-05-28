import { useMemo } from 'react'
import { useParams, useSearch } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useAppGoBack } from '@/hooks/useAppGoBack'
import { decodeBase64 } from '@/lib/utils'
import { SessionFileViewer } from '@/routes/projects/session-file-viewer'

function decodePath(value: string): string {
    if (!value) return ''
    const decoded = decodeBase64(value)
    return decoded.ok ? decoded.text : value
}

export default function FilePage() {
    const { api } = useAppContext()
    const goBack = useAppGoBack()
    const { sessionId } = useParams({ from: '/sessions/$sessionId/file' })
    const search = useSearch({ from: '/sessions/$sessionId/file' })

    const encodedPath = typeof search.path === 'string' ? search.path : ''
    const staged = search.staged
    const filePath = useMemo(() => decodePath(encodedPath), [encodedPath])

    return (
        <SessionFileViewer
            api={api}
            sessionId={sessionId}
            filePath={filePath}
            staged={staged}
            onBack={goBack}
            showSafeAreaTop
            constrainHeaderWidth
            contentCopyVariant="icon"
            showStagedStatus={false}
            fileErrorClassName="text-sm text-[var(--app-hint)]"
        />
    )
}
