import { relative } from 'node:path'
import {
    BrandSnapshot,
    CURRENT_BRAND,
    buildRules,
    collectTargetFiles,
    dedupeSnapshots,
    loadBrandState,
    readRepoFile,
    snapshotsEqual,
    statePath,
    transformFileContent,
    writeBrandState,
    writeRepoFile
} from './brand-utils'

type CliOptions = {
    dryRun: boolean
    fromSnapshot: BrandSnapshot | null
}

function parseOptions(argv: string[]): CliOptions {
    let dryRun = false
    let fromName: string | null = null
    let fromSlug: string | null = null

    for (const arg of argv) {
        if (arg === '--dry-run') {
            dryRun = true
            continue
        }
        if (arg.startsWith('--from-name=')) {
            fromName = arg.slice('--from-name='.length).trim() || null
            continue
        }
        if (arg.startsWith('--from-slug=')) {
            fromSlug = arg.slice('--from-slug='.length).trim() || null
            continue
        }
        throw new Error(`Unknown argument: ${arg}`)
    }

    if ((fromName && !fromSlug) || (!fromName && fromSlug)) {
        throw new Error('Use both --from-name and --from-slug together.')
    }

    return {
        dryRun,
        fromSnapshot: fromName && fromSlug ? { name: fromName, slug: fromSlug } : null
    }
}

function formatSnapshot(snapshot: BrandSnapshot): string {
    return `${snapshot.name}/${snapshot.slug}`
}

function run(): void {
    const rootDir = process.cwd()
    const options = parseOptions(process.argv.slice(2))
    const { state, initialized } = loadBrandState(rootDir)

    const rewriteSources = dedupeSnapshots([
        ...(options.fromSnapshot ? [options.fromSnapshot] : []),
        ...(snapshotsEqual(state.current, CURRENT_BRAND) ? [] : [state.current]),
        ...state.history
    ]).filter((snapshot) => !snapshotsEqual(snapshot, CURRENT_BRAND))

    const targetFiles = collectTargetFiles(rootDir)
    let changedFiles = 0

    for (const repoRelativePath of targetFiles) {
        const original = readRepoFile(rootDir, repoRelativePath)
        let next = original
        for (const sourceSnapshot of rewriteSources) {
            const rules = buildRules(sourceSnapshot, CURRENT_BRAND)
            if (rules.length === 0) {
                continue
            }
            next = transformFileContent(repoRelativePath, next, rules)
        }
        if (next === original) {
            continue
        }
        changedFiles += 1
        if (!options.dryRun) {
            writeRepoFile(rootDir, repoRelativePath, next)
        }
    }

    const nextHistory = dedupeSnapshots([
        ...state.history,
        ...(options.fromSnapshot ? [options.fromSnapshot] : []),
        ...(snapshotsEqual(state.current, CURRENT_BRAND) ? [] : [state.current])
    ]).filter((snapshot) => !snapshotsEqual(snapshot, CURRENT_BRAND))

    const nextState = {
        current: { ...CURRENT_BRAND },
        history: nextHistory
    }

    if (!options.dryRun) {
        writeBrandState(rootDir, nextState)
    }

    const modeLabel = options.dryRun ? '[dry-run]' : '[write]'
    console.log(`${modeLabel} brand current: ${formatSnapshot(CURRENT_BRAND)}`)
    const stateFilePath = relative(rootDir, statePath(rootDir))
    if (initialized) {
        console.log(`${modeLabel} initialized state file: ${stateFilePath}`)
    }
    if (rewriteSources.length > 0) {
        console.log(`${modeLabel} rewrite sources: ${rewriteSources.map(formatSnapshot).join(', ')}`)
    } else {
        console.log(`${modeLabel} rewrite sources: none`)
    }
    console.log(`${modeLabel} changed files: ${changedFiles}`)
}

try {
    run()
} catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[brand-sync] ${message}`)
    process.exit(1)
}
