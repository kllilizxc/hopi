import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { StoredGoal, StoredProject, StoredWorkspace } from '../../store'

export type GoalTodoSectionKind = 'ready' | 'candidate' | 'deferred' | 'promoted' | 'done' | 'unknown'

export type GoalTodoSection = {
    kind: GoalTodoSectionKind
    title: string
    body: string
    taskId: string | null
}

export type GoalTodoResponse = {
    exists: boolean
    path: string | null
    rawMarkdown: string | null
    sections: GoalTodoSection[]
    updatedAt: number | null
}

function normalizeMarkdown(markdown: string): string {
    return markdown.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function headingLevel(line: string): number | null {
    const match = /^(#{1,6})\s+\S/.exec(line)
    return match ? match[1]!.length : null
}

function classifyKind(text: string): GoalTodoSectionKind {
    const normalized = text.toLowerCase()
    if (/\bpromoted\b/.test(normalized)) return 'promoted'
    if (/\bdone\b|\bcompleted\b/.test(normalized)) return 'done'
    if (/\bdeferred\b|not ready|later\b/.test(normalized)) return 'deferred'
    if (/\bready\b/.test(normalized)) return 'ready'
    if (/\bcandidate\b|\breservoir\b|\bbacklog\b/.test(normalized)) return 'candidate'
    return 'unknown'
}

function extractBracketKind(text: string): GoalTodoSectionKind | null {
    const match = /^\[([^\]]+)]\s*/.exec(text.trim())
    if (!match) return null
    const kind = classifyKind(match[1]!)
    return kind === 'unknown' ? null : kind
}

function stripBracketKind(text: string): string {
    return text.trim().replace(/^\[[^\]]+]\s*/, '').trim()
}

function stripTaskReference(text: string): string {
    return text
        .replace(/\s*(?:->|→)\s*task\s+`?[^`\s]+`?.*$/iu, '')
        .replace(/\s*\(task\s+`?[^`\s)]+`?\).*$/iu, '')
        .trim()
}

function cleanTitle(text: string): string {
    return stripTaskReference(stripBracketKind(text))
        .replace(/^\d+[.)]\s+/, '')
        .replace(/^#+\s+/, '')
        .replace(/\*\*/g, '')
        .trim()
}

function extractTaskId(text: string): string | null {
    const backtickMatch = /\btask\s+`([^`]+)`/iu.exec(text)
    if (backtickMatch?.[1]) {
        return backtickMatch[1].trim()
    }
    const plainMatch = /\btask\s+([A-Za-z0-9_-]+)/iu.exec(text)
    return plainMatch?.[1]?.trim() ?? null
}

function findGoalScopedMarkdown(markdown: string, goalId: string): string {
    const lines = markdown.split('\n')
    const goalHeadingIndexes: number[] = []
    for (let index = 0; index < lines.length; index += 1) {
        if (/^##\s+Goal\b/i.test(lines[index] ?? '')) {
            goalHeadingIndexes.push(index)
        }
    }

    if (goalHeadingIndexes.length === 0) {
        return markdown.trim()
    }

    const startHeading = goalHeadingIndexes.find((index) => (lines[index] ?? '').includes(goalId))
    if (startHeading === undefined) {
        return ''
    }

    const endHeading = goalHeadingIndexes.find((index) => index > startHeading) ?? lines.length
    return lines.slice(startHeading, endHeading).join('\n').trim()
}

function collectBlock(lines: string[], start: number, stop: (line: string) => boolean): { body: string; nextIndex: number } {
    const bodyLines: string[] = []
    let index = start
    while (index < lines.length) {
        const line = lines[index] ?? ''
        if (stop(line)) {
            break
        }
        bodyLines.push(line)
        index += 1
    }
    return {
        body: bodyLines.join('\n').trim(),
        nextIndex: index
    }
}

export function parseGoalTodoMarkdown(markdown: string, goalId: string): Pick<GoalTodoResponse, 'rawMarkdown' | 'sections'> {
    const rawMarkdown = findGoalScopedMarkdown(normalizeMarkdown(markdown), goalId)
    const lines = rawMarkdown.split('\n')
    const sections: GoalTodoSection[] = []
    let currentKind: GoalTodoSectionKind = 'unknown'

    let index = 0
    while (index < lines.length) {
        const line = lines[index] ?? ''
        const headingMatch = /^(#{1,6})\s+(.+?)\s*$/.exec(line)
        if (headingMatch) {
            const level = headingMatch[1]!.length
            const headingText = headingMatch[2]!
            if (level <= 3) {
                currentKind = classifyKind(headingText)
                index += 1
                continue
            }

            const kindFromHeading = classifyKind(headingText)
            const kind = kindFromHeading === 'unknown' ? currentKind : kindFromHeading
            const collected = collectBlock(lines, index + 1, (candidate) => {
                const candidateLevel = headingLevel(candidate)
                return candidateLevel !== null && candidateLevel <= level
            })
            const title = cleanTitle(headingText)
            if (title) {
                const joined = `${headingText}\n${collected.body}`
                sections.push({
                    kind,
                    title,
                    body: collected.body,
                    taskId: extractTaskId(joined)
                })
            }
            index = collected.nextIndex
            continue
        }

        const bulletMatch = /^(\s*)[-*]\s+(.+?)\s*$/.exec(line)
        if (bulletMatch) {
            const indent = bulletMatch[1]!.length
            const text = bulletMatch[2]!
            const explicitKind = extractBracketKind(text)
            const kind = explicitKind ?? currentKind
            const collected = collectBlock(lines, index + 1, (candidate) => {
                const candidateHeadingLevel = headingLevel(candidate)
                if (candidateHeadingLevel !== null) return true
                const candidateBullet = /^(\s*)[-*]\s+\S/.exec(candidate)
                return Boolean(candidateBullet && candidateBullet[1]!.length <= indent)
            })
            const title = cleanTitle(text)
            if (title) {
                const joined = `${text}\n${collected.body}`
                sections.push({
                    kind,
                    title,
                    body: collected.body,
                    taskId: extractTaskId(joined)
                })
            }
            index = collected.nextIndex
            continue
        }

        index += 1
    }

    return { rawMarkdown, sections }
}

export function readGoalTodo(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
}): GoalTodoResponse {
    const path = input.defaultWorkspace?.path
        ? join(input.defaultWorkspace.path, '.hopi', 'docs', 'todo.md')
        : null
    if (!path || !existsSync(path)) {
        return {
            exists: false,
            path,
            rawMarkdown: null,
            sections: [],
            updatedAt: null
        }
    }

    const markdown = readFileSync(path, 'utf8')
    const parsed = parseGoalTodoMarkdown(markdown, input.goal.id)
    return {
        exists: true,
        path,
        rawMarkdown: parsed.rawMarkdown,
        sections: parsed.sections,
        updatedAt: Math.round(statSync(path).mtimeMs)
    }
}
