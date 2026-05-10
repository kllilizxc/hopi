import { useMemo } from 'react'
import { Tag } from '@/components/ui/tag'
import { LoadingState } from '@/components/LoadingState'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useGoalTodo } from '@/hooks/queries/useGoalTodo'
import { GoalDecisionTopicsPanel } from '@/routes/projects/goal-decision-topics'
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

const PLANNING_PANEL_CLASS = 'rounded-lg bg-[var(--app-secondary-bg)] app-shadow-surface'
const PLANNING_ITEM_CLASS = 'rounded-lg bg-[var(--app-bg)]'

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

function PlanningSectionIndex(props: {
    groups: Array<{ kind: GoalTodoSectionKind; items: GoalTodoSection[] }>
}) {
    const { t } = useTranslation()

    return (
        <aside
            data-testid="planning-section-index"
            className={`min-w-0 p-3 xl:sticky xl:top-3 ${PLANNING_PANEL_CLASS}`}
        >
            <div className="text-xs font-semibold uppercase tracking-normal text-[var(--app-hint)]">
                {t('projects.planning.sectionIndex')}
            </div>
            <nav className="mt-3 flex flex-wrap gap-2 xl:flex-col">
                {props.groups.map((group) => (
                    <a
                        key={group.kind}
                        href={`#planning-${group.kind}`}
                        className="flex min-w-36 flex-1 items-center justify-between gap-3 rounded-md bg-[var(--app-bg)] px-3 py-2 text-sm text-[var(--app-fg)] transition-colors duration-200 hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-link)] focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] xl:min-w-0 xl:flex-none"
                    >
                        <span className="font-medium">
                            {t(`projects.todo.kind.${group.kind}`)}
                        </span>
                        <span className="text-xs text-[var(--app-hint)]">
                            {t('projects.todo.count', { n: group.items.length })}
                        </span>
                    </a>
                ))}
            </nav>
        </aside>
    )
}

function RawMarkdownPanel(props: {
    title: string
    rawMarkdown: string
}) {
    return (
        <section className={`p-4 ${PLANNING_PANEL_CLASS}`}>
            <h2 className="text-sm font-semibold text-[var(--app-fg)]">
                {props.title}
            </h2>
            <pre
                data-testid="planning-raw-markdown"
                className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-[var(--app-bg)] p-3 font-mono text-[11px] leading-relaxed text-[var(--app-hint)]"
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
        <section data-testid="planning-document" className="bg-[var(--app-bg)]">
            <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 lg:px-4">
                <header className="flex flex-col gap-3 pb-2 lg:flex-row lg:items-start lg:justify-between">
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
                    <div className="rounded-lg app-shadow-border-error bg-red-500/10 p-4 text-sm text-red-600">
                        {props.error}
                    </div>
                ) : !props.todo ? (
                    <div className="py-10 text-sm text-[var(--app-hint)]">
                        {t('projects.todo.empty')}
                    </div>
                ) : !props.todo.exists ? (
                    <div className={`flex min-h-64 flex-col justify-center gap-3 p-6 ${PLANNING_PANEL_CLASS}`}>
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
                    <div
                        data-testid="planning-workspace"
                        className="grid min-w-0 gap-4 xl:grid-cols-[16rem_minmax(0,1fr)] xl:items-start"
                    >
                        <PlanningSectionIndex groups={groupedSections} />
                        <div className="min-w-0 space-y-4">
                            <div
                                data-testid="planning-section-grid"
                                className="grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] gap-3"
                            >
                                {groupedSections.map((group) => (
                                    <section
                                        key={group.kind}
                                        id={`planning-${group.kind}`}
                                        data-testid={`planning-section-${group.kind}`}
                                        className={`flex min-w-0 scroll-mt-3 flex-col overflow-hidden ${PLANNING_PANEL_CLASS}`}
                                    >
                                        <div className="flex items-center justify-between gap-3 bg-[var(--app-secondary-bg)] px-3 pb-1 pt-3">
                                            <Tag size="sm" variant={TAG_VARIANTS[group.kind]}>
                                                {t(`projects.todo.kind.${group.kind}`)}
                                            </Tag>
                                            <span className="text-xs text-[var(--app-hint)]">
                                                {t('projects.todo.count', { n: group.items.length })}
                                            </span>
                                        </div>
                                        <div className="space-y-2 p-2">
                                            {group.items.map((section, index) => (
                                                <article
                                                    key={`${group.kind}-${section.taskId ?? section.title}-${index}`}
                                                    className={`${PLANNING_ITEM_CLASS} p-3 transition-colors duration-200 hover:bg-[var(--app-subtle-bg)]`}
                                                >
                                                    <div className="flex flex-col gap-1.5">
                                                        <h2 className="min-w-0 text-sm font-semibold leading-snug text-[var(--app-fg)]">
                                                            {section.title}
                                                        </h2>
                                                        {section.taskId ? (
                                                            <a
                                                                href={getTaskUrl(props.projectId, section.taskId)}
                                                                className="w-fit text-xs font-medium text-[var(--app-link)] hover:underline"
                                                            >
                                                                {t('projects.todo.linkedTask', { id: section.taskId })}
                                                            </a>
                                                        ) : null}
                                                    </div>
                                                    {section.body ? (
                                                        <div className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-[var(--app-hint)]">
                                                            {section.body}
                                                        </div>
                                                    ) : null}
                                                </article>
                                            ))}
                                        </div>
                                    </section>
                                ))}
                            </div>

                            {rawMarkdown ? (
                                <RawMarkdownPanel title={t('projects.todo.rawMarkdown')} rawMarkdown={rawMarkdown} />
                            ) : null}
                        </div>
                    </div>
                )}
            </div>
        </section>
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
        <div data-testid="planning-page-scroll" className="h-full min-h-0 overflow-y-auto bg-[var(--app-bg)]">
            <div data-testid="planning-page-content" className="space-y-4">
                <GoalDecisionTopicsPanel projectId={props.projectId} goalId={props.goalId} />
                <GoalPlanningDocument
                    projectId={props.projectId}
                    todo={todo}
                    isLoading={isLoading}
                    error={error}
                />
            </div>
        </div>
    )
}
