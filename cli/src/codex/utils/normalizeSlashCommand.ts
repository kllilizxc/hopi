type NormalizeCodexSlashCommandOptions = {
    diffBaseRef?: string
};

function normalizeDiffBaseRef(value: string | undefined): string | null {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^[0-9a-f]{7,64}$/i.test(trimmed)) {
        return null;
    }
    return trimmed;
}

export function normalizeCodexSlashCommand(message: string, options?: NormalizeCodexSlashCommandOptions): string {
    if (message.trim() === '/diff') {
        const diffBaseRef = normalizeDiffBaseRef(options?.diffBaseRef);
        // Bare /diff in Codex omits staged changes; pass an explicit base.
        // In worktree sessions, compare current state against session-start commit.
        return `/diff ${diffBaseRef ?? 'HEAD'}`;
    }

    return message;
}
