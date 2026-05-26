import { afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSessionDebugLogger, getSessionDebugLogFilePath } from './sessionDebugLogger'

const roots: string[] = []

function createRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'hopi-session-debug-logs-'))
    roots.push(root)
    return root
}

afterEach(() => {
    for (const root of roots.splice(0)) {
        rmSync(root, { recursive: true, force: true })
    }
})

describe('SessionDebugLogger', () => {
    it('writes JSONL records to the stable session file', () => {
        const rootDir = createRoot()
        const logger = createSessionDebugLogger({
            rootDir,
            enabled: true,
            maxBytes: 1024 * 1024,
            maxFiles: 20,
            cleanupIntervalMs: 0,
            now: () => 1000
        })

        logger.append({
            sessionId: 'session-alpha',
            namespace: 'default',
            event: 'message.received',
            direction: 'cli-to-hub',
            seq: 3,
            localId: 'local-1',
            payload: { role: 'assistant', content: 'hello' }
        })

        const filePath = getSessionDebugLogFilePath(rootDir, 'session-alpha')
        expect(existsSync(filePath)).toBe(true)

        const [line] = readFileSync(filePath, 'utf8').trim().split('\n')
        expect(JSON.parse(line!)).toMatchObject({
            time: 1000,
            ts: '1970-01-01T00:00:01.000Z',
            sessionId: 'session-alpha',
            namespace: 'default',
            event: 'message.received',
            direction: 'cli-to-hub',
            seq: 3,
            localId: 'local-1',
            payload: { role: 'assistant', content: 'hello' }
        })
        expect(JSON.parse(line!).debugId).toMatch(/^S-[0-9a-f]{8}$/)
    })

    it('does not write when disabled', () => {
        const rootDir = createRoot()
        const logger = createSessionDebugLogger({
            rootDir,
            enabled: false,
            maxBytes: 1024,
            maxFiles: 20,
            cleanupIntervalMs: 0
        })

        logger.append({
            sessionId: 'session-disabled',
            event: 'message.injected',
            direction: 'hub-to-cli',
            payload: { text: 'hidden' }
        })

        expect(existsSync(getSessionDebugLogFilePath(rootDir, 'session-disabled'))).toBe(false)
    })

    it('removes oldest files when file count exceeds maxFiles', () => {
        const rootDir = createRoot()
        const logger = createSessionDebugLogger({
            rootDir,
            enabled: true,
            maxBytes: 1024 * 1024,
            maxFiles: 2,
            cleanupIntervalMs: 0,
            now: () => 5000
        })

        for (const sessionId of ['oldest', 'middle', 'newest']) {
            logger.append({
                sessionId,
                event: 'message.received',
                direction: 'cli-to-hub',
                payload: { sessionId }
            })
        }

        expect(existsSync(getSessionDebugLogFilePath(rootDir, 'oldest'))).toBe(false)
        expect(existsSync(getSessionDebugLogFilePath(rootDir, 'middle'))).toBe(true)
        expect(existsSync(getSessionDebugLogFilePath(rootDir, 'newest'))).toBe(true)
    })

    it('removes oldest files when total size exceeds maxBytes', () => {
        const rootDir = createRoot()
        const logger = createSessionDebugLogger({
            rootDir,
            enabled: true,
            maxBytes: 700,
            maxFiles: 20,
            cleanupIntervalMs: 0,
            now: () => 7000
        })

        for (const sessionId of ['first', 'second', 'third']) {
            logger.append({
                sessionId,
                event: 'message.received',
                direction: 'cli-to-hub',
                payload: { text: 'x'.repeat(300) }
            })
        }

        const total = ['first', 'second', 'third']
            .map((sessionId) => getSessionDebugLogFilePath(rootDir, sessionId))
            .filter((path) => existsSync(path))
            .reduce((sum, path) => sum + statSync(path).size, 0)

        expect(total).toBeLessThanOrEqual(700)
        expect(existsSync(getSessionDebugLogFilePath(rootDir, 'first'))).toBe(false)
    })

    it('swallows filesystem failures and warns once per append failure', () => {
        const rootDir = createRoot()
        const blockingFile = join(rootDir, 'not-a-directory')
        writeFileSync(blockingFile, 'block', 'utf8')
        const warnings: string[] = []
        const logger = createSessionDebugLogger({
            rootDir: blockingFile,
            enabled: true,
            maxBytes: 1024,
            maxFiles: 20,
            cleanupIntervalMs: 0,
            warn: (message) => warnings.push(message)
        })

        expect(() => logger.append({
            sessionId: 'session-failure',
            event: 'message.received',
            direction: 'cli-to-hub',
            payload: { ok: true }
        })).not.toThrow()
        expect(warnings.length).toBe(1)
        expect(warnings[0]).toContain('session debug log append failed')
    })
})
