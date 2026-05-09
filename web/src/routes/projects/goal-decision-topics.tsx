import { useMemo, useState, type FormEvent } from 'react'
import { CheckIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Tag } from '@/components/ui/tag'
import { useResolveGoalDecisionTopic } from '@/hooks/mutations/useResolveGoalDecisionTopic'
import { useGoalDecisionTopics } from '@/hooks/queries/useGoalDecisionTopics'
import { useAppContext } from '@/lib/app-context'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import type { GoalDecisionTopic } from '@/types/api'

type GoalDecisionTopicsPanelProps = {
    projectId: string
    goalId: string | null
}

function getTopicDraftKey(topic: GoalDecisionTopic): string {
    return `${topic.goalId}:${topic.id}`
}

export function GoalDecisionTopicsPanel(props: GoalDecisionTopicsPanelProps) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { topics, isLoading, error } = useGoalDecisionTopics(api, props.goalId)
    const { resolveTopic, isPending } = useResolveGoalDecisionTopic(api)
    const [drafts, setDrafts] = useState<Record<string, string>>({})
    const [pendingTopicId, setPendingTopicId] = useState<string | null>(null)

    const waitingTopics = useMemo(() => {
        return topics.filter((topic) => topic.status === 'waiting')
    }, [topics])

    if (!props.goalId) {
        return null
    }

    if (isLoading) {
        return (
            <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs text-[var(--app-hint)]">
                {t('projects.decisions.loading')}
            </div>
        )
    }

    if (error) {
        return (
            <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs text-red-600">
                {error}
            </div>
        )
    }

    if (waitingTopics.length === 0) {
        return null
    }

    const handleSubmit = (topic: GoalDecisionTopic) => async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const draftKey = getTopicDraftKey(topic)
        const resolution = (drafts[draftKey] ?? '').trim()
        if (!resolution || isPending) {
            return
        }

        setPendingTopicId(topic.id)
        try {
            await resolveTopic({
                topicId: topic.id,
                projectId: props.projectId,
                goalId: topic.goalId,
                resolution
            })
            setDrafts((current) => {
                const next = { ...current }
                delete next[draftKey]
                return next
            })
        } catch (resolveError) {
            addToast({
                title: t('projects.decisions.resolveFailed'),
                body: resolveError instanceof Error ? resolveError.message : 'Failed to resolve decision topic',
                sessionId: '',
                url: ''
            })
        } finally {
            setPendingTopicId((current) => current === topic.id ? null : current)
        }
    }

    return (
        <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2">
            <div className="mx-auto flex w-full max-w-content flex-col gap-2">
                <div className="flex items-center gap-2">
                    <div className="text-xs font-semibold text-[var(--app-fg)]">
                        {t('projects.decisions.title')}
                    </div>
                    <Tag size="xs" variant="warning">
                        {t('projects.decisions.waitingCount', { n: waitingTopics.length })}
                    </Tag>
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                    {waitingTopics.map((topic) => {
                        const draftKey = getTopicDraftKey(topic)
                        const draft = drafts[draftKey] ?? ''
                        const isTopicPending = pendingTopicId === topic.id
                        return (
                            <form
                                key={topic.id}
                                className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-2"
                                onSubmit={handleSubmit(topic)}
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="text-sm font-medium leading-snug break-words">
                                            {topic.title}
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                            {topic.blocking ? (
                                                <Tag size="xs" variant="error">
                                                    {t('projects.decisions.blocking')}
                                                </Tag>
                                            ) : null}
                                            {topic.taskId ? (
                                                <Tag size="xs" variant="secondary">
                                                    {t('projects.decisions.linkedTask', {
                                                        id: topic.taskId.slice(0, 8)
                                                    })}
                                                </Tag>
                                            ) : null}
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[var(--app-hint)] break-words">
                                    {topic.body}
                                </div>
                                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
                                    <textarea
                                        value={draft}
                                        onChange={(event) => {
                                            setDrafts((current) => ({
                                                ...current,
                                                [draftKey]: event.target.value
                                            }))
                                        }}
                                        disabled={isTopicPending}
                                        rows={2}
                                        placeholder={t('projects.decisions.answerPlaceholder')}
                                        className="min-h-16 flex-1 resize-none rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                    />
                                    <Button
                                        type="submit"
                                        size="sm"
                                        disabled={!draft.trim() || isTopicPending}
                                        className="gap-2 sm:mt-0"
                                    >
                                        <CheckIcon className="h-4 w-4" />
                                        {isTopicPending ? t('projects.decisions.resolving') : t('projects.decisions.resolve')}
                                    </Button>
                                </div>
                            </form>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
