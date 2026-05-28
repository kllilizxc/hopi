export function normalizeGoalKey(input: string): string {
    const normalized = input
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-')

    return normalized || 'goal'
}

export function buildUniqueGoalKey(base: string, exists: (candidate: string) => boolean): string {
    const root = normalizeGoalKey(base)
    if (!exists(root)) {
        return root
    }

    let suffix = 2
    while (exists(`${root}-${suffix}`)) {
        suffix += 1
    }
    return `${root}-${suffix}`
}
