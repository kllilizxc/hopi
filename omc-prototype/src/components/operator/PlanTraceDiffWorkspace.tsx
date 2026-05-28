import { useCallback, useEffect, useMemo, useState } from 'react'
import {
    usePrototypeRemoteApi,
    type PrototypeGitCommandResponse,
} from '@/prototype/remoteApi'

type DiffFileEntry = {
    fileName: string
    filePath: string
    fullPath: string
    linesAdded: number
    linesRemoved: number
    binary: boolean
}

type DiffSource = 'working-tree' | 'cumulative'

const NUMSTAT_REGEX = /^(\d+|-)\t(\d+|-)\t(.*)$/

function normalizeNumstatPath(rawPath: string): string {
    const trimmed = rawPath.trim()
    if (!trimmed) {
        return ''
    }

    if (trimmed.includes('{') && trimmed.includes('=>') && trimmed.includes('}')) {
        return trimmed.replace(/\{([^{}]+?)\s*=>\s*([^{}]+?)\}/g, (_, __oldPart: string, newPart: string) => newPart.trim())
    }

    if (trimmed.includes('=>')) {
        const parts = trimmed.split(/\s*=>\s*/)
        return parts[parts.length - 1]?.trim() ?? trimmed
    }

    return trimmed
}

function parseNumstatOutput(output: string): DiffFileEntry[] {
    return output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line): DiffFileEntry | null => {
            const match = NUMSTAT_REGEX.exec(line)
            if (!match) {
                return null
            }

            const fullPath = normalizeNumstatPath(match[3] ?? '')
            if (!fullPath) {
                return null
            }

            const parts = fullPath.split('/')
            const fileName = parts[parts.length - 1] || fullPath
            const filePath = parts.slice(0, -1).join('/')
            const binary = match[1] === '-' || match[2] === '-'

            return {
                fileName,
                filePath,
                fullPath,
                linesAdded: binary ? 0 : Number.parseInt(match[1] ?? '0', 10),
                linesRemoved: binary ? 0 : Number.parseInt(match[2] ?? '0', 10),
                binary,
            }
        })
        .filter((entry): entry is DiffFileEntry => entry !== null)
}

function extractCommandError(result: PrototypeGitCommandResponse | null): string | null {
    if (!result) {
        return null
    }
    if (result.success) {
        return null
    }
    return result.error ?? result.stderr ?? '读取改动失败'
}

function DiffLineStats(props: { added: number; removed: number; binary: boolean }) {
    if (props.binary) {
        return <span className="text-[11px] font-mono text-zinc-500">binary</span>
    }

    if (!props.added && !props.removed) {
        return null
    }

    return (
        <span className="flex items-center gap-2 text-[11px] font-mono">
            {props.added ? <span className="text-emerald-700">+{props.added}</span> : null}
            {props.removed ? <span className="text-red-700">-{props.removed}</span> : null}
        </span>
    )
}

function DiffDisplay(props: { diffContent: string }) {
    const lines = props.diffContent.split('\n')

    return (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
            {lines.map((line, index) => {
                const isAdd = line.startsWith('+') && !line.startsWith('+++')
                const isRemove = line.startsWith('-') && !line.startsWith('---')
                const isHunk = line.startsWith('@@')
                const isHeader = line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git')

                const className = [
                    'whitespace-pre-wrap break-words px-4 py-1 text-xs font-mono',
                    isAdd ? 'bg-emerald-50 text-emerald-800 border-l-2 border-emerald-500' : '',
                    isRemove ? 'bg-red-50 text-red-800 border-l-2 border-red-500' : '',
                    isHunk ? 'bg-zinc-100 text-zinc-600 font-semibold' : '',
                    isHeader ? 'bg-zinc-50 text-zinc-500 font-semibold' : '',
                ].filter(Boolean).join(' ')

                return (
                    <div key={`${index}-${line}`} className={className}>
                        {line || ' '}
                    </div>
                )
            })}
        </div>
    )
}

export default function PlanTraceDiffWorkspace(props: {
    sessionId?: string | null
    planTitle: string
}) {
    const api = usePrototypeRemoteApi()
    const [files, setFiles] = useState<DiffFileEntry[]>([])
    const [selectedPath, setSelectedPath] = useState<string | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [diffContent, setDiffContent] = useState('')
    const [diffLoading, setDiffLoading] = useState(false)
    const [diffError, setDiffError] = useState<string | null>(null)
    const [diffSource, setDiffSource] = useState<DiffSource>('working-tree')
    const [diffBaseRef, setDiffBaseRef] = useState<string | null>(null)

    const selectedFile = useMemo(
        () => files.find((file) => file.fullPath === selectedPath) ?? null,
        [files, selectedPath],
    )

    const loadSelectedDiff = useCallback(async (path: string, options?: { baseRef?: string | null }) => {
        if (!props.sessionId) {
            return
        }

        setDiffLoading(true)
        setDiffError(null)

        try {
            const response = options?.baseRef
                ? await api.getGitDiffFile(props.sessionId, path, { baseRef: options.baseRef })
                : await api.getGitDiffFile(props.sessionId, path)
            const commandError = extractCommandError(response)
            if (commandError) {
                setDiffContent('')
                setDiffError(commandError)
                return
            }
            setDiffContent(response.stdout ?? '')
        } catch (error) {
            setDiffContent('')
            setDiffError(error instanceof Error ? error.message : String(error))
        } finally {
            setDiffLoading(false)
        }
    }, [api, props.sessionId])

    const loadFileIndex = useCallback(async () => {
        if (!props.sessionId) {
            setFiles([])
            setSelectedPath(null)
            setError(null)
            setDiffContent('')
            setDiffError(null)
            setDiffSource('working-tree')
            setDiffBaseRef(null)
            return
        }

        setLoading(true)
        setError(null)

        try {
            const response = await api.getGitDiffNumstat(props.sessionId)
            const commandError = extractCommandError(response)
            if (commandError) {
                setFiles([])
                setSelectedPath(null)
                setDiffContent('')
                setDiffError(null)
                setDiffSource('working-tree')
                setDiffBaseRef(null)
                setError(commandError)
                return
            }

            let nextSource: DiffSource = 'working-tree'
            let nextBaseRef: string | null = null
            let nextFiles = parseNumstatOutput(response.stdout ?? '')

            if (!nextFiles.length) {
                try {
                    const sessionResponse = await api.getSession(props.sessionId)
                    const fallbackBaseRef = sessionResponse.session.metadata?.worktree?.baseCommit?.trim() ?? ''

                    if (fallbackBaseRef) {
                        const cumulativeResponse = await api.getGitDiffNumstat(props.sessionId, { baseRef: fallbackBaseRef })
                        const cumulativeError = extractCommandError(cumulativeResponse)

                        if (!cumulativeError) {
                            const cumulativeFiles = parseNumstatOutput(cumulativeResponse.stdout ?? '')
                            if (cumulativeFiles.length) {
                                nextFiles = cumulativeFiles
                                nextSource = 'cumulative'
                                nextBaseRef = fallbackBaseRef
                            }
                        }
                    }
                } catch {
                }
            }

            setFiles(nextFiles)
            setDiffSource(nextSource)
            setDiffBaseRef(nextBaseRef)
            setSelectedPath((current) => {
                if (current && nextFiles.some((file) => file.fullPath === current)) {
                    return current
                }
                return nextFiles[0]?.fullPath ?? null
            })
        } catch (error) {
            setFiles([])
            setSelectedPath(null)
            setDiffContent('')
            setDiffError(null)
            setDiffSource('working-tree')
            setDiffBaseRef(null)
            setError(error instanceof Error ? error.message : String(error))
        } finally {
            setLoading(false)
        }
    }, [api, props.sessionId])

    useEffect(() => {
        setFiles([])
        setSelectedPath(null)
        setDiffContent('')
        setDiffError(null)
        setDiffSource('working-tree')
        setDiffBaseRef(null)
        void loadFileIndex()
    }, [loadFileIndex, props.sessionId])

    useEffect(() => {
        if (!props.sessionId || !selectedPath) {
            if (!selectedPath) {
                setDiffContent('')
                setDiffError(null)
            }
            return
        }
        void loadSelectedDiff(selectedPath, { baseRef: diffBaseRef })
    }, [diffBaseRef, loadSelectedDiff, props.sessionId, selectedPath])

    if (!props.sessionId) {
        return (
            <section className="flex flex-col gap-4">
                <section className="flex flex-col items-center justify-center p-8 text-center text-zinc-500 bg-white border border-zinc-200 rounded-xl">
                    <h3 className="text-sm font-semibold text-zinc-900 mb-2">还没有可查看的改动</h3>
                    <p className="text-sm">这张 plan 还没创建 runtime session，所以还看不到当前改动。</p>
                </section>
            </section>
        )
    }

    return (
        <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3 px-1">
                <div className="flex flex-col min-w-0">
                    <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">当前改动</p>
                    <p className="text-sm text-zinc-500 truncate" title={props.planTitle}>
                        {props.planTitle}
                    </p>
                </div>
                <button
                    type="button"
                    className="px-3 py-1.5 text-xs font-medium text-zinc-700 bg-white border border-zinc-300 rounded hover:bg-zinc-50 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 cursor-pointer whitespace-nowrap"
                    onClick={() => {
                        void loadFileIndex()
                    }}
                >
                    刷新 Diff
                </button>
            </div>

            {diffSource === 'cumulative' ? (
                <section className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-900">
                    当前工作树为空，以下展示相对起点已经累计出的改动。
                </section>
            ) : null}

            {error ? (
                <section className="p-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl">
                    读取当前改动失败：{error}
                </section>
            ) : null}

            {loading ? (
                <section className="flex flex-col gap-3 p-4 bg-white border border-zinc-200 rounded-xl">
                    <div className="h-4 w-32 rounded bg-zinc-200 animate-pulse" />
                    <div className="h-12 w-full rounded bg-zinc-100 animate-pulse" />
                    <div className="h-12 w-full rounded bg-zinc-100 animate-pulse" />
                </section>
            ) : null}

            {!loading && !error && !files.length ? (
                <section className="flex flex-col items-center justify-center p-8 text-center text-zinc-500 bg-white border border-zinc-200 rounded-xl">
                    <h3 className="text-sm font-semibold text-zinc-900 mb-2">当前没有检测到工作树改动</h3>
                    <p className="text-sm">如果底层 Agent 还在运行，稍后刷新这里就能看到新的文件变更。</p>
                </section>
            ) : null}

            {files.length ? (
                <section className="flex flex-col gap-4">
                    <div className="flex flex-col bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
                        <div className="px-4 py-3 border-b border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-500">
                            Changed Files ({files.length})
                        </div>
                        <div className="flex flex-col">
                            {files.map((file, index) => {
                                const selected = file.fullPath === selectedPath
                                return (
                                    <button
                                        key={file.fullPath}
                                        type="button"
                                        className={`flex items-center gap-3 px-4 py-3 text-left transition-colors cursor-pointer ${selected ? 'bg-indigo-50' : 'bg-white hover:bg-zinc-50'} ${index < files.length - 1 ? 'border-b border-zinc-100' : ''}`}
                                        onClick={() => {
                                            setSelectedPath(file.fullPath)
                                        }}
                                        aria-pressed={selected}
                                        aria-label={file.fullPath}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className={`text-sm font-medium break-all ${selected ? 'text-indigo-900' : 'text-zinc-900'}`}>
                                                {file.fullPath}
                                            </div>
                                            {file.filePath ? (
                                                <div className="text-xs text-zinc-500 truncate">{file.filePath}</div>
                                            ) : null}
                                        </div>
                                        <DiffLineStats
                                            added={file.linesAdded}
                                            removed={file.linesRemoved}
                                            binary={file.binary}
                                        />
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    <div className="flex flex-col gap-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col min-w-0">
                                <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Unified Diff</p>
                                <p className="text-sm font-medium text-zinc-900 break-all">
                                    {selectedFile?.fullPath ?? '选择一个文件查看差异'}
                                </p>
                                {diffSource === 'cumulative' ? (
                                    <p className="text-xs text-zinc-500">显示相对 worktree 起点提交的累计 diff</p>
                                ) : null}
                            </div>
                        </div>

                        {diffLoading ? (
                            <div className="rounded-xl border border-zinc-200 bg-white p-4">
                                <div className="h-3 w-40 rounded bg-zinc-200 animate-pulse mb-3" />
                                <div className="h-3 w-full rounded bg-zinc-100 animate-pulse mb-2" />
                                <div className="h-3 w-11/12 rounded bg-zinc-100 animate-pulse mb-2" />
                                <div className="h-3 w-10/12 rounded bg-zinc-100 animate-pulse" />
                            </div>
                        ) : diffError ? (
                            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                                读取文件 diff 失败：{diffError}
                            </div>
                        ) : diffContent ? (
                            <DiffDisplay diffContent={diffContent} />
                        ) : (
                            <div className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500">
                                {selectedFile ? '当前文件还没有可显示的文本 diff。' : '先从上面选择一个文件。'}
                            </div>
                        )}
                    </div>
                </section>
            ) : null}
        </section>
    )
}
