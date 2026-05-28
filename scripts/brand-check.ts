import { relative } from 'node:path'
import {
    CURRENT_BRAND,
    collectTargetFiles,
    dedupeSnapshots,
    extractCheckScope,
    loadBrandState,
    readRepoFile,
    snapshotsEqual,
    statePath
} from './brand-utils'

type Violation = {
    file: string
    token: string
}

function buildTokenMatchers(name: string, slug: string): RegExp[] {
    return [
        new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        new RegExp(slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        new RegExp(`\\.${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
        new RegExp(`x-${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-`),
        new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_`),
        new RegExp(`mcp__${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}__change_title`),
        new RegExp(`mcp_servers\\.${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    ]
}

function run(): void {
    const rootDir = process.cwd()
    const { state } = loadBrandState(rootDir)
    const staleSnapshots = dedupeSnapshots([
        ...state.history,
        ...(snapshotsEqual(state.current, CURRENT_BRAND) ? [] : [state.current])
    ]).filter((snapshot) => !snapshotsEqual(snapshot, CURRENT_BRAND))

    if (staleSnapshots.length === 0) {
        console.log('[brand-check] no stale brand aliases in state history; nothing to check')
        return
    }

    const matchersBySnapshot = staleSnapshots.map((snapshot) => ({
        snapshot,
        patterns: buildTokenMatchers(snapshot.name, snapshot.slug)
    }))

    const targetFiles = collectTargetFiles(rootDir)
    const violations: Violation[] = []

    for (const repoRelativePath of targetFiles) {
        const content = readRepoFile(rootDir, repoRelativePath)
        const scope = extractCheckScope(repoRelativePath, content)
        if (!scope) {
            continue
        }

        for (const entry of matchersBySnapshot) {
            for (const pattern of entry.patterns) {
                if (!pattern.test(scope)) {
                    continue
                }
                violations.push({
                    file: repoRelativePath,
                    token: `${entry.snapshot.name}/${entry.snapshot.slug}`
                })
                break
            }
        }
    }

    if (violations.length === 0) {
        console.log(`[brand-check] passed (${targetFiles.length} files scanned)`)
        return
    }

    console.error(`[brand-check] found stale brand literals in ${violations.length} files`)
    for (const violation of violations.slice(0, 100)) {
        console.error(`- ${violation.file} (stale alias: ${violation.token})`)
    }
    if (violations.length > 100) {
        console.error(`... and ${violations.length - 100} more`)
    }
    console.error(`[brand-check] run: bun run scripts/brand-sync.ts`)
    console.error(`[brand-check] state file: ${relative(rootDir, statePath(rootDir))}`)
    process.exit(1)
}

try {
    run()
} catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[brand-check] ${message}`)
    process.exit(1)
}
