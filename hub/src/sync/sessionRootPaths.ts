type SessionRootPathLike = {
    metadata?: {
        path?: unknown
        worktree?: {
            worktreePath?: unknown
            basePath?: unknown
        } | null
    } | null
}

function trimPath(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null
    }
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
}

export function resolveSessionWorktreePath(session: SessionRootPathLike): string | null {
    return trimPath(session.metadata?.worktree?.worktreePath)
}

export function resolveSessionBasePath(session: SessionRootPathLike): string | null {
    return trimPath(session.metadata?.worktree?.basePath)
}

export function resolveSessionMetadataPath(session: SessionRootPathLike): string | null {
    return trimPath(session.metadata?.path)
}

export function resolveSessionLocalPath(session: SessionRootPathLike): string | null {
    return resolveSessionBasePath(session) || resolveSessionMetadataPath(session)
}

export function resolveSessionPreferredRootPath(session: SessionRootPathLike): string | null {
    return resolveSessionWorktreePath(session)
        || resolveSessionMetadataPath(session)
        || resolveSessionBasePath(session)
}

export function resolveSessionRootPathCandidates(options: {
    session: SessionRootPathLike
    workspacePath?: string | null
}): string[] {
    const workspacePath = trimPath(options.workspacePath)

    return Array.from(new Set([
        resolveSessionWorktreePath(options.session),
        resolveSessionMetadataPath(options.session),
        workspacePath,
        resolveSessionBasePath(options.session)
    ].filter((value): value is string => Boolean(value))))
}

export type { SessionRootPathLike }
