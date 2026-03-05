import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import {
    PRODUCT_CLI_COMMAND,
    PRODUCT_DB_FILENAME,
    PRODUCT_DEFAULT_OFFICIAL_WEB_URL,
    PRODUCT_DEFAULT_RELAY_API_DOMAIN,
    PRODUCT_DEFAULT_SITE_URL,
    PRODUCT_DEFAULT_VAPID_SUBJECT,
    PRODUCT_HOME_DIRNAME,
    PRODUCT_NAME,
    PRODUCT_SLUG
} from '../shared/src/brand'

export type BrandSnapshot = {
    name: string
    slug: string
}

export type BrandState = {
    current: BrandSnapshot
    history: BrandSnapshot[]
}

export type BrandRule = {
    description: string
    match: RegExp
    replacement: string
}

const STATE_FILE = '.brand-sync-state.json'
const DOC_EXTENSIONS = new Set(['.md', '.mdx', '.txt'])
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css'])
const IGNORED_DIRECTORIES = new Set([
    '.git',
    '.idea',
    '.vscode',
    'node_modules',
    'dist',
    'build',
    '.next',
    '.turbo',
    '.cache',
    '.bun-cache',
    '.tmp',
    '.hopi',
    'coverage'
])

export const CURRENT_BRAND: BrandSnapshot = {
    name: PRODUCT_NAME,
    slug: PRODUCT_SLUG
}

export function statePath(rootDir: string): string {
    return join(rootDir, STATE_FILE)
}

export function snapshotsEqual(left: BrandSnapshot, right: BrandSnapshot): boolean {
    return left.name === right.name && left.slug === right.slug
}

export function snapshotKey(snapshot: BrandSnapshot): string {
    return `${snapshot.name}::${snapshot.slug}`
}

export function dedupeSnapshots(snapshots: BrandSnapshot[]): BrandSnapshot[] {
    const seen = new Set<string>()
    const result: BrandSnapshot[] = []
    for (const snapshot of snapshots) {
        if (!snapshot.name || !snapshot.slug) {
            continue
        }
        const key = snapshotKey(snapshot)
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        result.push(snapshot)
    }
    return result
}

export function loadBrandState(rootDir: string): { state: BrandState; initialized: boolean } {
    const filePath = statePath(rootDir)
    if (!existsSync(filePath)) {
        const initialState: BrandState = {
            current: { ...CURRENT_BRAND },
            history: []
        }
        writeFileSync(filePath, JSON.stringify(initialState, null, 4) + '\n', 'utf8')
        return { state: initialState, initialized: true }
    }

    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<BrandState>
    const current = parsed.current
    const history = Array.isArray(parsed.history) ? parsed.history : []
    if (!current || typeof current.name !== 'string' || typeof current.slug !== 'string') {
        throw new Error(`Invalid ${STATE_FILE}: missing valid "current" snapshot`)
    }

    return {
        state: {
            current: { name: current.name, slug: current.slug },
            history: dedupeSnapshots(
                history
                    .filter((item): item is BrandSnapshot => typeof item?.name === 'string' && typeof item?.slug === 'string')
                    .map((item) => ({ name: item.name, slug: item.slug }))
            )
        },
        initialized: false
    }
}

export function writeBrandState(rootDir: string, state: BrandState): void {
    const filePath = statePath(rootDir)
    writeFileSync(filePath, JSON.stringify(state, null, 4) + '\n', 'utf8')
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function literalRule(description: string, from: string, to: string): BrandRule[] {
    if (!from || from === to) {
        return []
    }
    return [{
        description,
        match: new RegExp(escapeRegExp(from), 'g'),
        replacement: to
    }]
}

export function buildRules(from: BrandSnapshot, to: BrandSnapshot): BrandRule[] {
    const rules: BrandRule[] = []

    rules.push(...literalRule('mcp tool (prefixed)', `mcp__${from.slug}__change_title`, `mcp__${to.slug}__change_title`))
    rules.push(...literalRule('mcp tool (plain)', `${from.slug}__change_title`, `${to.slug}__change_title`))
    rules.push(...literalRule('opencode tool', `${from.slug}_change_title`, `${to.slug}_change_title`))
    rules.push(...literalRule('mcp server key', `mcp_servers.${from.slug}`, `mcp_servers.${to.slug}`))
    rules.push(...literalRule('header prefix', `x-${from.slug}-`, `x-${to.slug}-`))
    rules.push(...literalRule('home dir', `~/.${from.slug}`, `~/.${to.slug}`))
    rules.push(...literalRule('home dir dot-prefix', `.${from.slug}`, `.${to.slug}`))
    rules.push(...literalRule('db file', `${from.slug}.db`, PRODUCT_DB_FILENAME))
    rules.push(...literalRule('site url', `https://${from.slug}.run`, PRODUCT_DEFAULT_SITE_URL))
    rules.push(...literalRule('official web url', `https://app.${from.slug}.run`, PRODUCT_DEFAULT_OFFICIAL_WEB_URL))
    rules.push(...literalRule('relay domain', `relay.${from.slug}.run`, PRODUCT_DEFAULT_RELAY_API_DOMAIN))
    rules.push(...literalRule('vapid subject', `mailto:admin@${from.slug}.run`, PRODUCT_DEFAULT_VAPID_SUBJECT))
    rules.push(...literalRule('env prefix', `${from.name}_`, `${to.name}_`))
    rules.push(...literalRule('brand name', from.name, to.name))
    rules.push(...literalRule('cli command', from.slug, PRODUCT_CLI_COMMAND))

    const deduped: BrandRule[] = []
    const seen = new Set<string>()
    for (const rule of rules) {
        const key = `${rule.match.source}=>${rule.replacement}`
        if (seen.has(key)) {
            continue
        }
        seen.add(key)
        deduped.push(rule)
    }

    return deduped
}

export function applyRules(content: string, rules: BrandRule[]): string {
    let next = content
    for (const rule of rules) {
        next = next.replace(rule.match, rule.replacement)
    }
    return next
}

function isDocFile(filePath: string): boolean {
    return DOC_EXTENSIONS.has(extname(filePath))
}

function isCodeFile(filePath: string): boolean {
    return CODE_EXTENSIONS.has(extname(filePath))
}

export function shouldProcessFile(filePath: string): boolean {
    return isDocFile(filePath) || isCodeFile(filePath)
}

function replaceCodeComments(content: string, rules: BrandRule[]): string {
    let next = content.replace(/\/\*[\s\S]*?\*\//g, (segment) => applyRules(segment, rules))
    next = next.replace(/^\s*\/\/.*$/gm, (segment) => applyRules(segment, rules))
    return next
}

export function transformFileContent(filePath: string, content: string, rules: BrandRule[]): string {
    if (isDocFile(filePath)) {
        return applyRules(content, rules)
    }
    if (isCodeFile(filePath)) {
        return replaceCodeComments(content, rules)
    }
    return content
}

export function extractCheckScope(filePath: string, content: string): string {
    if (isDocFile(filePath)) {
        return content
    }
    if (isCodeFile(filePath)) {
        const blockComments = content.match(/\/\*[\s\S]*?\*\//g) ?? []
        const lineComments = content.match(/^\s*\/\/.*$/gm) ?? []
        return [...blockComments, ...lineComments].join('\n')
    }
    return ''
}

function walkDirectory(rootDir: string, currentDir: string, output: string[]): void {
    const entries = readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
        const absolutePath = join(currentDir, entry.name)
        const repoRelativePath = relative(rootDir, absolutePath)
        if (entry.isDirectory()) {
            if (IGNORED_DIRECTORIES.has(entry.name)) {
                continue
            }
            walkDirectory(rootDir, absolutePath, output)
            continue
        }
        if (!shouldProcessFile(repoRelativePath)) {
            continue
        }
        output.push(repoRelativePath)
    }
}

export function collectTargetFiles(rootDir: string): string[] {
    const result: string[] = []
    walkDirectory(rootDir, rootDir, result)
    return result.sort()
}

export function readRepoFile(rootDir: string, repoRelativePath: string): string {
    return readFileSync(join(rootDir, repoRelativePath), 'utf8')
}

export function writeRepoFile(rootDir: string, repoRelativePath: string, content: string): void {
    writeFileSync(join(rootDir, repoRelativePath), content, 'utf8')
}

