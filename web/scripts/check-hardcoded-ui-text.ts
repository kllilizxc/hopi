import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type ViolationKind = 'jsx-text' | 'jsx-attr' | 'object-prop'

type Violation = {
    filePath: string
    line: number
    kind: ViolationKind
    field: string
    text: string
}

const USER_VISIBLE_TEXT_PATTERN = /[A-Za-z\u4E00-\u9FFF]/
const I18N_IGNORE_MARKER = 'i18n-check-ignore'

const JSX_ATTRIBUTE_FIELDS = ['aria-label', 'title', 'placeholder', 'alt', 'label', 'confirmLabel', 'confirmingLabel', 'description'] as const
const OBJECT_UI_FIELDS = [
    'title',
    'body',
    'description',
    'label',
    'placeholder',
    'confirmLabel',
    'confirmingLabel',
    'loading',
    'noPath',
    'binary',
    'fileEmpty',
    'noChanges',
    'diffTab',
    'fileTab',
    'diffUnavailablePrefix',
    'copyContent',
    'copiedContent',
    'staged',
    'unstaged',
] as const

const JSX_ATTRIBUTE_PATTERN = new RegExp(
    `\\b(${JSX_ATTRIBUTE_FIELDS.join('|')})\\s*=\\s*(\"([^\"\\n]*)\"|'([^'\\n]*)')`,
    'g'
)
const OBJECT_PROPERTY_PATTERN = new RegExp(
    `\\b(${OBJECT_UI_FIELDS.join('|')})\\s*:\\s*(\"([^\"\\n]*)\"|'([^'\\n]*)')`,
    'g'
)
const JSX_TEXT_PATTERN = /(?<![=])>([^<{]*[A-Za-z\u4E00-\u9FFF][^<{]*)</g

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const webRoot = path.resolve(__dirname, '..')

const targetDirectories = [
    path.join(webRoot, 'src', 'routes', 'sessions'),
    path.join(webRoot, 'src', 'routes', 'projects'),
]

function collectTargetFiles(directory: string): string[] {
    const entries = readdirSync(directory, { withFileTypes: true })
    const files: string[] = []

    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
            files.push(...collectTargetFiles(fullPath))
            continue
        }

        if (!entry.isFile()) continue
        if (!fullPath.endsWith('.tsx')) continue
        if (fullPath.endsWith('.test.tsx')) continue
        files.push(fullPath)
    }

    return files
}

function buildLineStarts(source: string): number[] {
    const starts = [0]
    for (let i = 0; i < source.length; i += 1) {
        if (source[i] === '\n') {
            starts.push(i + 1)
        }
    }
    return starts
}

function getLineNumber(starts: number[], index: number): number {
    let low = 0
    let high = starts.length - 1

    while (low <= high) {
        const mid = Math.floor((low + high) / 2)
        if (starts[mid] <= index) {
            low = mid + 1
        } else {
            high = mid - 1
        }
    }

    return high + 1
}

function getLineText(source: string, starts: number[], line: number): string {
    const start = starts[line - 1] ?? 0
    const nextStart = starts[line] ?? source.length
    return source.slice(start, nextStart).trim()
}

function isLikelyIdentifier(value: string): boolean {
    if (!/^[A-Za-z0-9_.:/-]+$/.test(value)) {
        return false
    }

    if (value === value.toLowerCase()) {
        return true
    }

    return value.includes('.') || value.includes('/') || value.includes(':') || value.includes('_') || value.includes('-')
}

function isLikelyCodeFragment(value: string): boolean {
    if (/=>|&&|\|\|/.test(value)) return true
    if (/[{}()=;]/.test(value)) return true
    const normalized = value.trim().toLowerCase()
    return (
        normalized.startsWith('return ') ||
        normalized.startsWith('if ') ||
        normalized.startsWith('for ') ||
        normalized.startsWith('while ') ||
        normalized.startsWith('const ') ||
        normalized.startsWith('let ') ||
        normalized.startsWith('switch ') ||
        normalized.startsWith('case ')
    )
}

function isLikelyTypeArgumentClose(source: string, index: number): boolean {
    const lineStart = source.lastIndexOf('\n', index) + 1
    const linePrefix = source.slice(lineStart, index)
    const openIndex = linePrefix.lastIndexOf('<')
    if (openIndex === -1) return false

    const beforeOpen = linePrefix.slice(0, openIndex).trimEnd()
    const owner = beforeOpen.match(/([A-Za-z_$][\w$]*)$/)?.[1] ?? ''
    if (!owner) return false

    return owner === 'Array'
        || owner === 'ReadonlyArray'
        || owner === 'Record'
        || /^[A-Z]/.test(owner)
}

function shouldReportText(value: string): boolean {
    const normalized = value.trim()
    if (!normalized) return false
    if (!USER_VISIBLE_TEXT_PATTERN.test(normalized)) return false
    if (isLikelyIdentifier(normalized)) return false
    return true
}

function addViolation(
    violations: Violation[],
    source: string,
    starts: number[],
    filePath: string,
    kind: ViolationKind,
    field: string,
    rawText: string,
    index: number,
): void {
    const text = rawText.trim()
    if (!shouldReportText(text)) {
        return
    }

    if (kind === 'jsx-text' && isLikelyCodeFragment(text)) {
        return
    }

    const line = getLineNumber(starts, index)
    const lineText = getLineText(source, starts, line)
    if (lineText.includes(I18N_IGNORE_MARKER)) {
        return
    }

    violations.push({
        filePath,
        line,
        kind,
        field,
        text,
    })
}

function findViolations(filePath: string): Violation[] {
    const source = readFileSync(filePath, 'utf8')
    const starts = buildLineStarts(source)
    const violations: Violation[] = []

    for (const match of source.matchAll(JSX_ATTRIBUTE_PATTERN)) {
        const field = match[1]
        const rawText = match[3] ?? match[4] ?? ''
        if (!field || !rawText) continue
        addViolation(violations, source, starts, filePath, 'jsx-attr', field, rawText, match.index ?? 0)
    }

    for (const match of source.matchAll(OBJECT_PROPERTY_PATTERN)) {
        const field = match[1]
        const rawText = match[3] ?? match[4] ?? ''
        if (!field || !rawText) continue
        addViolation(violations, source, starts, filePath, 'object-prop', field, rawText, match.index ?? 0)
    }

    for (const match of source.matchAll(JSX_TEXT_PATTERN)) {
        const rawText = match[1] ?? ''
        if (!rawText) continue
        const index = match.index ?? 0
        if (isLikelyTypeArgumentClose(source, index)) continue
        addViolation(violations, source, starts, filePath, 'jsx-text', 'text', rawText, index)
    }

    const deduped = new Map<string, Violation>()
    for (const violation of violations) {
        const key = `${violation.filePath}:${violation.line}:${violation.kind}:${violation.field}:${violation.text}`
        if (!deduped.has(key)) {
            deduped.set(key, violation)
        }
    }

    return Array.from(deduped.values())
}

function main(): void {
    const files = targetDirectories.flatMap((directory) => collectTargetFiles(directory))
    const violations = files.flatMap((filePath) => findViolations(filePath))

    if (violations.length === 0) {
        console.log('i18n check passed: no hardcoded user-visible text in routes/sessions + routes/projects.')
        return
    }

    console.error('i18n check failed: hardcoded user-visible text found. Please use t(...) keys instead.')
    for (const violation of violations) {
        const relativePath = path.relative(webRoot, violation.filePath)
        console.error(`- ${relativePath}:${violation.line} [${violation.kind}:${violation.field}] "${violation.text}"`)
    }

    process.exit(1)
}

main()
