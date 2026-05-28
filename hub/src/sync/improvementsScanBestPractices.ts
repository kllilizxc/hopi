import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import type { StoredWorkspace } from '../store'

const PROJECT_GUIDANCE_CANDIDATE_PATHS = [
    '.hopi/improvements-scan.md'
] as const

const MAX_GUIDANCE_FILES = 2
const MAX_GUIDANCE_CHARS = 6_000

export const DEFAULT_IMPROVEMENTS_SCAN_REVIEW_CHECKLIST = [
    'Boundaries + ownership: prefer thin HTTP route handlers; keep reusable business logic in sync/store/service modules.',
    'Shared contracts: shared types/schemas/parsers should stay centralized instead of drifting across cli/hub/web codepaths.',
    'State + concurrency: look for stale-version handling, race-prone async flows, retries/timeouts, and inconsistent task/session state transitions.',
    'Duplication + complexity: flag repeated prompt builders, repeated parsing/normalization, giant files, or abstractions that hide simple control flow.',
    'Reliability + observability: prefer actionable errors, explicit fallbacks, and instrumentation around failure-prone automation paths.',
    'Quality guardrails: missing regression tests for parse failures, inactive sessions, SSE/socket sync, workflow automation, or other critical paths count as architecture improvements.',
    'Performance: call out unnecessary rescans, repeated expensive reads, hot-path database work, or avoidable re-renders when concrete.'
] as const

export type ImprovementsScanGuidanceEntry = {
    workspacePath: string
    workspaceLabel?: string
    relativePath: string
    content: string
}

function normalizeGuidanceContent(raw: string): string {
    return raw
        .replace(/\r\n/g, '\n')
        .trim()
}

function truncateGuidanceContent(content: string, remainingChars: number): string | null {
    if (remainingChars <= 0) return null
    if (content.length <= remainingChars) return content
    if (remainingChars <= 32) return null
    return `${content.slice(0, Math.max(0, remainingChars - 16)).trimEnd()}\n...[truncated]`
}

export async function loadImprovementsScanProjectGuidance(
    workspaces: StoredWorkspace[]
): Promise<ImprovementsScanGuidanceEntry[]> {
    const entries: ImprovementsScanGuidanceEntry[] = []
    const seenFilePaths: Set<string> = new Set()
    let remainingChars = MAX_GUIDANCE_CHARS

    for (const workspace of workspaces) {
        if (entries.length >= MAX_GUIDANCE_FILES || remainingChars <= 0) {
            break
        }

        for (const relativePath of PROJECT_GUIDANCE_CANDIDATE_PATHS) {
            const absolutePath = join(workspace.path, relativePath)
            if (seenFilePaths.has(absolutePath)) {
                continue
            }

            let content: string
            try {
                content = normalizeGuidanceContent(await readFile(absolutePath, 'utf8'))
            } catch {
                continue
            }

            if (!content) {
                continue
            }

            const truncated = truncateGuidanceContent(content, remainingChars)
            if (!truncated) {
                break
            }

            entries.push({
                workspacePath: workspace.path,
                workspaceLabel: workspace.label ?? undefined,
                relativePath,
                content: truncated
            })
            seenFilePaths.add(absolutePath)
            remainingChars -= truncated.length
            break
        }
    }

    return entries
}
