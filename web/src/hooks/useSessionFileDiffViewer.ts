import { useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'
import type { GitCommandResponse } from '@/types/api'
import { queryKeys } from '@/lib/query-keys'
import { langAlias, useShikiHighlighter } from '@/lib/shiki'
import { decodeBase64 } from '@/lib/utils'

const MAX_COPYABLE_FILE_BYTES = 1_000_000

export type FileViewerDisplayMode = 'diff' | 'file'

export type UseSessionFileDiffViewerResult = {
    fileName: string
    displayMode: FileViewerDisplayMode
    setDisplayMode: Dispatch<SetStateAction<FileViewerDisplayMode>>
    loading: boolean
    missingPath: boolean
    hasDiffContent: boolean
    diffContent: string
    diffError: string | null
    fileError: string | null
    decodedContent: string
    highlightedContent: ReactNode | null
    binaryFile: boolean
    canCopyContent: boolean
}

function resolveLanguage(path: string): string | undefined {
    const parts = path.split('.')
    if (parts.length <= 1) return undefined
    const ext = parts[parts.length - 1]?.toLowerCase()
    if (!ext) return undefined
    return langAlias[ext] ?? ext
}

function getUtf8ByteLength(value: string): number {
    return new TextEncoder().encode(value).length
}

function isBinaryContent(content: string): boolean {
    if (!content) return false
    if (content.includes('\0')) return true

    const nonPrintable = content.split('').filter((char) => {
        const code = char.charCodeAt(0)
        return code < 32 && code !== 9 && code !== 10 && code !== 13
    }).length

    return nonPrintable / content.length > 0.1
}

function extractCommandError(result: GitCommandResponse | undefined): string | null {
    if (!result) return null
    if (result.success) return null
    return result.error ?? result.stderr ?? 'Failed to load diff'
}

function getQueryErrorMessage(value: unknown, fallback: string): string | null {
    if (value instanceof Error) {
        return value.message
    }
    return value ? fallback : null
}

function isRpcUnavailableError(message: string | null): boolean {
    if (!message) return false
    const lowered = message.toLowerCase()
    return lowered.includes('rpc handler not registered') || lowered.includes('rpc socket disconnected')
}

export function useSessionFileDiffViewer(params: {
    api: ApiClient | null
    sessionId: string
    filePath: string
    staged?: boolean
    baseRef?: string
}): UseSessionFileDiffViewerResult {
    const missingPath = !params.filePath
    const [displayMode, setDisplayMode] = useState<FileViewerDisplayMode>('diff')
    const shouldAutoFallbackToFile = params.staged === undefined && !params.baseRef

    const diffQuery = useQuery({
        queryKey: queryKeys.gitFileDiff(params.sessionId, params.filePath, {
            staged: params.staged,
            baseRef: params.baseRef,
        }),
        queryFn: async () => {
            if (!params.api || !params.sessionId || !params.filePath) {
                throw new Error('Missing session or path')
            }
            return await params.api.getGitDiffFile(params.sessionId, params.filePath, {
                staged: params.staged,
                baseRef: params.baseRef,
            })
        },
        enabled: Boolean(params.api && params.sessionId && params.filePath)
    })

    const fileQuery = useQuery({
        queryKey: queryKeys.sessionFile(params.sessionId, params.filePath),
        queryFn: async () => {
            if (!params.api || !params.sessionId || !params.filePath) {
                throw new Error('Missing session or path')
            }
            return await params.api.readSessionFile(params.sessionId, params.filePath)
        },
        enabled: Boolean(params.api && params.sessionId && params.filePath && displayMode === 'file')
    })

    const diffContent = diffQuery.data?.success ? (diffQuery.data.stdout ?? '') : ''
    const diffCommandError = extractCommandError(diffQuery.data)
    const diffQueryError = getQueryErrorMessage(diffQuery.error, 'Failed to load diff')
    const diffError = diffCommandError ?? diffQueryError

    const fileContentResult = fileQuery.data
    const decodedContentResult = fileContentResult?.success && fileContentResult.content
        ? decodeBase64(fileContentResult.content)
        : { text: '', ok: true }
    const decodedContent = decodedContentResult.text

    const binaryFile = fileContentResult?.success
        ? !decodedContentResult.ok || isBinaryContent(decodedContent)
        : false

    const language = useMemo(() => resolveLanguage(params.filePath), [params.filePath])
    const highlightedContent = useShikiHighlighter(decodedContent, language)

    const contentSizeBytes = useMemo(
        () => (decodedContent ? getUtf8ByteLength(decodedContent) : 0),
        [decodedContent]
    )

    const canCopyContent = fileContentResult?.success === true
        && !binaryFile
        && decodedContent.length > 0
        && contentSizeBytes <= MAX_COPYABLE_FILE_BYTES

    const fileReadError = fileContentResult && !fileContentResult.success
        ? (fileContentResult.error ?? 'Failed to read file')
        : null
    const fileQueryError = getQueryErrorMessage(fileQuery.error, 'Failed to read file')
    const fileError = fileReadError ?? fileQueryError

    const diffSuccess = diffQuery.data?.success === true

    useEffect(() => {
        setDisplayMode('diff')
    }, [params.filePath, params.sessionId, params.staged, params.baseRef])

    useEffect(() => {
        if (diffContent) {
            return
        }

        if (!shouldAutoFallbackToFile) {
            return
        }

        if (diffSuccess || (diffError && !isRpcUnavailableError(diffError))) {
            setDisplayMode('file')
        }
    }, [diffContent, diffSuccess, diffError, shouldAutoFallbackToFile])

    const fileName = useMemo(
        () => params.filePath.split('/').pop() || params.filePath || 'File',
        [params.filePath]
    )

    return {
        fileName,
        displayMode,
        setDisplayMode,
        loading: diffQuery.isLoading || (displayMode === 'file' && fileQuery.isLoading),
        missingPath,
        hasDiffContent: Boolean(diffContent),
        diffContent,
        diffError,
        fileError,
        decodedContent,
        highlightedContent,
        binaryFile,
        canCopyContent,
    }
}
