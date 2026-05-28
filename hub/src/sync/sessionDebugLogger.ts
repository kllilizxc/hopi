import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { getSessionDebugId } from '@hopi/protocol'

export type SessionDebugDirection = 'cli-to-hub' | 'hub-to-cli' | 'hub'

export type SessionDebugLogRecordInput = {
    sessionId: string
    namespace?: string | null
    event: string
    direction: SessionDebugDirection
    seq?: number | null
    localId?: string | null
    payload?: unknown
}

export type SessionDebugLogRecord = SessionDebugLogRecordInput & {
    ts: string
    time: number
    debugId: string
}

export type SessionDebugLogger = {
    append(record: SessionDebugLogRecordInput): void
}

type SessionDebugLoggerOptions = {
    rootDir: string
    enabled: boolean
    maxBytes: number
    maxFiles: number
    cleanupIntervalMs?: number
    now?: () => number
    warn?: (message: string, error?: unknown) => void
}

type LogFileInfo = {
    path: string
    size: number
    mtimeMs: number
}

const DEFAULT_CLEANUP_INTERVAL_MS = 2_000

function sanitizeFilenamePart(value: string): string {
    return value.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'session'
}

export function getSessionDebugLogFilePath(rootDir: string, sessionId: string): string {
    const debugId = getSessionDebugId(sessionId)
    const sessionPrefix = sanitizeFilenamePart(sessionId).slice(0, 8)
    return join(rootDir, `${debugId}-${sessionPrefix}.jsonl`)
}

function listLogFiles(rootDir: string): LogFileInfo[] {
    if (!existsSync(rootDir)) {
        return []
    }

    return readdirSync(rootDir)
        .filter((name) => name.endsWith('.jsonl'))
        .map((name) => {
            const path = join(rootDir, name)
            const stat = statSync(path)
            return { path, size: stat.size, mtimeMs: stat.mtimeMs }
        })
        .sort((a, b) => a.mtimeMs - b.mtimeMs)
}

function cleanupLogFiles(rootDir: string, maxBytes: number, maxFiles: number): void {
    const files = listLogFiles(rootDir)
    let totalBytes = files.reduce((sum, file) => sum + file.size, 0)

    while (files.length > maxFiles) {
        const oldest = files.shift()
        if (!oldest) break
        rmSync(oldest.path, { force: true })
        totalBytes -= oldest.size
    }

    while (totalBytes > maxBytes && files.length > 0) {
        const oldest = files.shift()
        if (!oldest) break
        rmSync(oldest.path, { force: true })
        totalBytes -= oldest.size
    }
}

export function createSessionDebugLogger(options: SessionDebugLoggerOptions): SessionDebugLogger {
    const now = options.now ?? Date.now
    const warn = options.warn ?? ((message, error) => console.warn(`[SessionDebugLogger] ${message}`, error))
    const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS
    let lastCleanupAt = 0

    return {
        append(input) {
            if (!options.enabled) {
                return
            }

            try {
                mkdirSync(options.rootDir, { recursive: true, mode: 0o700 })
                const time = now()
                const record: SessionDebugLogRecord = {
                    ...input,
                    namespace: input.namespace ?? null,
                    seq: input.seq ?? null,
                    localId: input.localId ?? null,
                    payload: input.payload,
                    time,
                    ts: new Date(time).toISOString(),
                    debugId: getSessionDebugId(input.sessionId)
                }

                appendFileSync(
                    getSessionDebugLogFilePath(options.rootDir, input.sessionId),
                    `${JSON.stringify(record)}\n`,
                    'utf8'
                )

                if (time - lastCleanupAt >= cleanupIntervalMs) {
                    lastCleanupAt = time
                    cleanupLogFiles(options.rootDir, options.maxBytes, options.maxFiles)
                }
            } catch (error) {
                warn('session debug log append failed', error)
            }
        }
    }
}
