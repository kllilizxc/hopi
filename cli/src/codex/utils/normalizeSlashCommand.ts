export function normalizeCodexSlashCommand(message: string): string {
    if (message.trim() === '/diff') {
        // Bare /diff in Codex omits staged changes; compare against HEAD to include both staged and unstaged.
        return '/diff HEAD';
    }

    return message;
}
