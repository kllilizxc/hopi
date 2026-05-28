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
    const recentResolvedTopics = useMemo(() => {
        return topics
            .filter((topic) => topic.status === 'resolved' && Boolean(topic.resolution?.trim()))
            .slice(0, 3)
    }, [topics])

    if (!props.goalId) {
        return null
    }

    if (isLoading) {
        return (
            <div className="app-shadow-divider-b bg-[var(--app-bg)] px-3 py-2 text-xs text-[var(--app-hint)]">
                {t('projects.decisions.loading')}
            </div>
        )
    }

    if (error) {
        return (
            <div className="app-shadow-divider-b bg-[var(--app-bg)] px-3 py-2 text-xs text-red-600">
                {error}
            </div>
        )
    }

    if (waitingTopics.length === 0 && recentResolvedTopics.length === 0) {
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
        <section
            data-testid="goal-decision-tray"
            className="app-shadow-divider-b bg-[var(--app-bg)] px-3 py-3"
        >
            <div
                data-testid="goal-decision-panel"
                className="mx-auto flex w-full max-w-7xl flex-col gap-3 lg:px-4"
            >
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold text-[var(--app-fg)]">
                            {t('projects.decisions.title')}
                        </div>
                        {waitingTopics.length > 0 ? (
                            <Tag size="xs" variant="warning">
                                {t('projects.decisions.waitingCount', { n: waitingTopics.length })}
                            </Tag>
                        ) : null}
                    </div>
                </div>
                {waitingTopics.length > 0 ? (
                    <div
                        data-testid="goal-decision-grid"
                        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,360px),1fr))] gap-3"
                    >
                        {waitingTopics.map((topic) => {
                            const draftKey = getTopicDraftKey(topic)
                            const draft = drafts[draftKey] ?? ''
                            const isTopicPending = pendingTopicId === topic.id
                            return (
                                <form
                                    key={topic.id}
                                    data-testid={`goal-decision-topic-${topic.id}`}
                                    className="grid min-w-0 gap-3 rounded-lg app-shadow-border bg-[var(--app-secondary-bg)] p-3 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]"
                                    onSubmit={handleSubmit(topic)}
                                >
                                    <div className="min-w-0">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <h2 className="text-sm font-semibold leading-snug break-words text-[var(--app-fg)]">
                                                    {topic.title}
                                                </h2>
                                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
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
                                        <div className="mt-3 whitespace-pre-wrap pr-1 text-sm leading-relaxed text-[var(--app-hint)] break-words">
                                            {topic.body}
                                        </div>
                                    </div>
                                    <div className="flex min-w-0 flex-col gap-2 shadow-[0_-1px_0_var(--app-divider)] pt-3 xl:shadow-[-1px_0_0_var(--app-divider)] xl:pl-3 xl:pt-0">
                                        <textarea
                                            id={`decision-resolution-${topic.id}`}
                                            name={`decision-resolution-${topic.id}`}
                                            value={draft}
                                            onChange={(event) => {
                                                setDrafts((current) => ({
                                                    ...current,
                                                    [draftKey]: event.target.value
                                                }))
                                            }}
                                            disabled={isTopicPending}
                                            rows={3}
                                            placeholder={t('projects.decisions.answerPlaceholder')}
                                            className="min-h-24 w-full resize-none rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                        />
                                        <Button
                                            type="submit"
                                            size="sm"
                                            disabled={!draft.trim() || isTopicPending}
                                            className="w-full gap-2"
                                        >
                                            <CheckIcon className="h-4 w-4" />
                                            {isTopicPending ? t('projects.decisions.resolving') : t('projects.decisions.resolve')}
                                        </Button>
                                    </div>
                                </form>
                            )
                        })}
                    </div>
                ) : null}
                {recentResolvedTopics.length > 0 ? (
                    <div data-testid="goal-decision-resolved-list" className="flex flex-col gap-2 pr-1">
                        <div className="text-xs font-semibold uppercase tracking-normal text-[var(--app-hint)]">
                            {t('projects.decisions.recentResolved')}
                        </div>
                        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-2">
                            {recentResolvedTopics.map((topic) => (
                                <article
                                    key={topic.id}
                                    className="min-w-0 rounded-lg app-shadow-border bg-[var(--app-secondary-bg)] p-3"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <h2 className="min-w-0 text-sm font-semibold leading-snug break-words text-[var(--app-fg)]">
                                            {topic.title}
                                        </h2>
                                        <Tag size="xs" variant="success">
                                            {t('projects.decisions.resolved')}
                                        </Tag>
                                    </div>
                                    <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-[var(--app-hint)] break-words">
                                        {topic.body}
                                    </div>
                                    <div className="mt-3 rounded-md app-shadow-border bg-[var(--app-bg)] p-2">
                                        <div className="text-[11px] font-semibold uppercase tracking-normal text-[var(--app-hint)]">
                                            {t('projects.decisions.answerLabel')}
                                        </div>
                                        <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-[var(--app-fg)] break-words">
                                            {topic.resolution}
                                        </div>
                                    </div>
                                </article>
                            ))}
                        </div>
                    </div>
                ) : null}
            </div>
        </section>
    )
}
