import type { StoredGoalDecisionTopic, StoredTask } from '../../store'

const DEFAULT_DECISION_HANDOFF_MAX_CHARS = 20_000

export function buildResolvedDecisionHandoffSection(topic: StoredGoalDecisionTopic): string {
    return [
        `Resolved DecisionTopic: ${topic.title}`,
        `Topic ID: ${topic.id}`,
        '',
        'Question / Context:',
        topic.body.trim() || '(empty)',
        '',
        'Human answer:',
        (topic.resolution ?? '').trim() || '(empty)'
    ].join('\n')
}

export function buildResolvedDecisionHandoff(
    topics: StoredGoalDecisionTopic[],
    options?: {
        limit?: number
        maxChars?: number
    }
): string | null {
    const limit = options?.limit ?? 5
    const maxChars = options?.maxChars ?? DEFAULT_DECISION_HANDOFF_MAX_CHARS
    const resolved = topics
        .filter((topic) => topic.status === 'resolved' && (topic.resolution ?? '').trim())
        .slice(0, limit)
    if (resolved.length === 0) {
        return null
    }

    return [
        'Recently resolved DecisionTopics (newest first):',
        '',
        resolved.map(buildResolvedDecisionHandoffSection).join('\n\n---\n\n')
    ].join('\n').slice(0, maxChars)
}

export function prependTaskHandoffDecisionContext(
    task: StoredTask,
    topic: StoredGoalDecisionTopic,
    maxChars = DEFAULT_DECISION_HANDOFF_MAX_CHARS
): string {
    const existing = (task.handoff ?? '').trim()
    const section = buildResolvedDecisionHandoffSection(topic).slice(0, maxChars)
    if (!existing) {
        return section
    }
    if (existing.includes(`Topic ID: ${topic.id}`)) {
        return existing
    }

    const separator = '\n\nPrevious Handoff:\n'
    const remaining = maxChars - section.length - separator.length
    if (remaining <= 0) {
        return section
    }
    return `${section}${separator}${existing.slice(0, remaining)}`
}
