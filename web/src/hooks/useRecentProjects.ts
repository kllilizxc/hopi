import { useCallback, useMemo, useState } from 'react'

const STORAGE_KEY = 'hapi-recent-projects.v1'
const MAX_RECENT_PROJECTS = 200

type RecentProjectsMap = Record<string, number>

function safeParseJson(value: string): unknown {
    try {
        return JSON.parse(value) as unknown
    } catch {
        return null
    }
}

function loadRecentProjects(): RecentProjectsMap {
    if (typeof window === 'undefined') return {}
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (!raw) return {}
        const parsed = safeParseJson(raw)
        if (!parsed || typeof parsed !== 'object') return {}

        const record = parsed as Record<string, unknown>
        const result: RecentProjectsMap = {}
        for (const [key, value] of Object.entries(record)) {
            if (typeof key !== 'string' || key.trim().length === 0) continue
            if (typeof value !== 'number' || !Number.isFinite(value)) continue
            result[key] = value
        }
        return result
    } catch {
        return {}
    }
}

function saveRecentProjects(data: RecentProjectsMap): void {
    if (typeof window === 'undefined') return
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    } catch {
        // Ignore storage errors
    }
}

export function useRecentProjects(): {
    recentProjectIds: string[]
    markProjectUsed: (projectId: string) => void
} {
    const [data, setData] = useState<RecentProjectsMap>(loadRecentProjects)

    const recentProjectIds = useMemo(() => {
        return Object.entries(data)
            .sort((a, b) => b[1] - a[1])
            .map(([id]) => id)
    }, [data])

    const markProjectUsed = useCallback((projectId: string): void => {
        const id = projectId.trim()
        if (!id) return

        setData((prev) => {
            const next: RecentProjectsMap = {
                ...prev,
                [id]: Date.now()
            }

            const capped = Object.entries(next)
                .sort((a, b) => b[1] - a[1])
                .slice(0, MAX_RECENT_PROJECTS)

            const cappedMap: RecentProjectsMap = Object.fromEntries(capped)
            saveRecentProjects(cappedMap)
            return cappedMap
        })
    }, [])

    return useMemo(() => ({
        recentProjectIds,
        markProjectUsed,
    }), [recentProjectIds, markProjectUsed])
}

