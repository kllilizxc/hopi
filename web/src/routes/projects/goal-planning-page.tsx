import { useMemo } from 'react'
import { Tag } from '@/components/ui/tag'
import { LoadingState } from '@/components/LoadingState'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useGoalTodo } from '@/hooks/queries/useGoalTodo'
import type { GoalTodoResponse, GoalTodoSection, GoalTodoSectionKind } from '@/types/api'

type GoalPlanningPageProps = {
    projectId: string
    goalId: string | null
    isGoalsLoading?: boolean
}

type GoalPlanningDocumentProps = {
    projectId: string
    todo: GoalTodoResponse | null
    isLoading: boolean
    error: string | null
}

const SECTION_ORDER: GoalTodoSectionKind[] = ['ready', 'candidate', 'deferred', 'promoted', 'done', 'unknown']

const TAG_VARIANTS: Record<GoalTodoSectionKind, 'default' | 'warning' | 'success' | 'secondary'> = {
    ready: 'success',
    candidate: 'default',
    deferred: 'warning',
    promoted: 'secondary',
    done: 'secondary',
    unknown: 'secondary'
}

function getTaskUrl(projectId: string, taskId: string): string {
    return `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}`
}

function groupSections(sections: GoalTodoSection[]): Array<{ kind: GoalTodoSectionKind; items: GoalTodoSection[] }> {
    return SECTION_ORDER
        .map((kind) => ({
            kind,
            items: sections.filter((section) => section.kind === kind)
        }))
        .filter((group) => group.items.length > 0)
}

function formatUpdatedAt(updatedAt: number | null): string | null {
    if (!updatedAt) return null
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
    }).format(new Date(updatedAt))
}

function RawMarkdownPanel(props: {
    title: string
    rawMarkdown: string
}) {
    return (
        <section className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-4">
            <h2 className="text-sm font-semibold text-[var(--app-fg)]">
                {props.title}
            </h2>
            <pre
                data-testid="planning-raw-markdown"
                className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-3 font-mono text-[11px] leading-relaxed text-[var(--app-hint)]"
            >
                {props.rawMarkdown}
            </pre>
        </section>
    )
}

export function GoalPlanningDocument(props: GoalPlanningDocumentProps) {
    const { t } = useTranslation()
    const groupedSections = useMemo(() => groupSections(props.todo?.sections ?? []), [props.todo?.sections])
    const updatedAt = formatUpdatedAt(props.todo?.updatedAt ?? null)
    const totalSections = props.todo?.sections.length ?? 0
    const rawMarkdown = props.todo?.rawMarkdown ?? null

    return (
        <div className="h-full min-h-0 overflow-y-auto bg-[var(--app-bg)]">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 lg:px-4">
                <header className="flex flex-col gap-3 border-b border-[var(--app-divider)] pb-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                        <h1 className="text-lg font-semibold leading-tight text-[var(--app-fg)]">
                            {t('projects.planning.title')}
                        </h1>
                        <div className="mt-1 text-sm text-[var(--app-hint)]">
                            {t('projects.planning.subtitle')}
                        </div>
                        {props.todo?.path ? (
                            <div className="mt-3 break-all font-mono text-xs text-[var(--app-hint)]">
                                {props.todo.path}
                            </div>
                        ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        {props.todo?.exists ? (
                            <Tag size="sm" variant="secondary">
                                {t('projects.todo.count', { n: totalSections })}
                            </Tag>
                        ) : null}
                        {updatedAt ? (
                            <Tag size="sm" variant="secondary">
                                {t('projects.planning.updatedAt', { value: updatedAt })}
                            </Tag>
                        ) : null}
                        {props.todo && !props.todo.exists ? (
                            <Tag size="sm" variant="warning">
                                {t('projects.todo.missing')}
                            </Tag>
                        ) : null}
                    </div>
                </header>

                {props.isLoading ? (
                    <div className="flex min-h-48 items-center justify-center">
                        <LoadingState label={t('projects.todo.loading')} className="text-sm" />
                    </div>
                ) : props.error ? (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600">
                        {props.error}
                    </div>
                ) : !props.todo ? (
                    <div className="py-10 text-sm text-[var(--app-hint)]">
                        {t('projects.todo.empty')}
                    </div>
                ) : !props.todo.exists ? (
                    <div className="flex min-h-64 flex-col justify-center gap-3 rounded-lg border border-dashed border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-6">
                        <div className="text-sm font-medium text-[var(--app-fg)]">
                            {t('projects.todo.missingDocs')}
                        </div>
                        {props.todo.path ? (
                            <div className="break-all font-mono text-xs text-[var(--app-hint)]">
                                {props.todo.path}
                            </div>
                        ) : null}
                    </div>
                ) : groupedSections.length === 0 ? (
                    <div className="space-y-4">
                        <div className="py-10 text-sm text-[var(--app-hint)]">
                            {t('projects.todo.empty')}
                        </div>
                        {rawMarkdown ? (
                            <RawMarkdownPanel title={t('projects.todo.rawMarkdown')} rawMarkdown={rawMarkdown} />
                        ) : null}
                    </div>
                ) : (
                    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                        <aside className="lg:sticky lg:top-3 lg:self-start">
                            <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-3">
                                <div className="text-xs font-semibold text-[var(--app-hint)]">
                                    {t('projects.planning.sectionIndex')}
                                </div>
                                <div className="mt-3 flex flex-col gap-2">
                                    {groupedSections.map((group) => (
                                        <a
                                            key={group.kind}
                                            href={`#planning-${group.kind}`}
                                            className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)]"
                                        >
                                            <span>{t(`projects.todo.kind.${group.kind}`)}</span>
                                            <Tag size="xs" variant={TAG_VARIANTS[group.kind]}>
                                                {group.items.length}
                                            </Tag>
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </aside>

                        <main className="min-w-0 space-y-5">
                            {groupedSections.map((group) => (
                                <section key={group.kind} id={`planning-${group.kind}`} className="scroll-mt-3">
                                    <div className="mb-2 flex flex-wrap items-center gap-2">
                                        <Tag size="sm" variant={TAG_VARIANTS[group.kind]}>
                                            {t(`projects.todo.kind.${group.kind}`)}
                                        </Tag>
                                        <span className="text-xs text-[var(--app-hint)]">
                                            {t('projects.todo.count', { n: group.items.length })}
                                        </span>
                                    </div>
                                    <div className="space-y-3">
                                        {group.items.map((section, index) => (
                                            <article
                                                key={`${group.kind}-${section.taskId ?? section.title}-${index}`}
                                                className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-4"
                                            >
                                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                                    <h2 className="min-w-0 text-base font-semibold leading-snug text-[var(--app-fg)]">
                                                        {section.title}
                                                    </h2>
                                                    {section.taskId ? (
                                                        <a
                                                            href={getTaskUrl(props.projectId, section.taskId)}
                                                            className="shrink-0 text-xs font-medium text-[var(--app-link)] hover:underline"
                                                        >
                                                            {t('projects.todo.linkedTask', { id: section.taskId })}
                                                        </a>
                                                    ) : null}
                                                </div>
                                                {section.body ? (
                                                    <div className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--app-hint)]">
                                                        {section.body}
                                                    </div>
                                                ) : null}
                                            </article>
                                        ))}
                                    </div>
                                </section>
                            ))}

                            {rawMarkdown ? (
                                <RawMarkdownPanel title={t('projects.todo.rawMarkdown')} rawMarkdown={rawMarkdown} />
                            ) : null}
                        </main>
                    </div>
                )}
            </div>
        </div>
    )
}

export function GoalPlanningPage(props: GoalPlanningPageProps) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { todo, isLoading, error } = useGoalTodo(api, props.projectId, props.goalId)

    if (!props.goalId) {
        if (props.isGoalsLoading) {
            return (
                <div className="h-full min-h-0 overflow-y-auto bg-[var(--app-bg)]">
                    <div className="mx-auto flex min-h-48 w-full max-w-7xl items-center justify-center px-3 py-10 lg:px-4">
                        <LoadingState label={t('loading')} className="text-sm" />
                    </div>
                </div>
            )
        }

        return (
            <div className="h-full min-h-0 overflow-y-auto bg-[var(--app-bg)]">
                <div className="mx-auto w-full max-w-7xl px-3 py-10 text-sm text-[var(--app-hint)] lg:px-4">
                    {t('projects.planning.noGoal')}
                </div>
            </div>
        )
    }

    return (
        <GoalPlanningDocument
            projectId={props.projectId}
            todo={todo}
            isLoading={isLoading}
            error={error}
        />
    )
}
