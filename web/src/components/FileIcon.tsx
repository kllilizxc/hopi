import { useMemo } from 'react'
import { FileDocumentIcon } from '@/assets/icons'

const EXTENSION_COLORS: Record<string, string> = {
    ts: '#3178c6',
    tsx: '#3178c6',
    js: '#f7df1e',
    jsx: '#f7df1e',
    json: '#f59e0b',
    md: '#64748b',
    mdx: '#64748b',
    css: '#2563eb',
    scss: '#db2777',
    html: '#f97316',
    yml: '#ef4444',
    yaml: '#ef4444',
    sh: '#10b981',
    bash: '#10b981',
    py: '#3776ab',
    go: '#0ea5e9',
    rs: '#f97316',
}

function getFileExtension(fileName: string): string {
    const trimmed = fileName.trim()
    if (trimmed.startsWith('.') && trimmed.indexOf('.', 1) === -1) {
        return trimmed.slice(1).toLowerCase()
    }
    const parts = trimmed.split('.')
    if (parts.length <= 1) return ''
    return parts[parts.length - 1]?.toLowerCase() ?? ''
}

export function FileIcon(props: { fileName: string; size?: number }) {
    const size = props.size ?? 20
    const color = useMemo(() => {
        const ext = getFileExtension(props.fileName)
        return EXTENSION_COLORS[ext] ?? 'var(--app-hint)'
    }, [props.fileName])

    return <FileDocumentIcon size={size} style={{ color }} />
}
