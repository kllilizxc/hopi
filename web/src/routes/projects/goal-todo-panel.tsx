import { useMemo } from 'react'
import { Tag } from '@/components/ui/tag'
import { useGoalTodo } from '@/hooks/queries/useGoalTodo'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import type { GoalTodoSection, GoalTodoSectionKind } from '@/types/api'

type GoalTodoPanelProps = {
    projectId: string
    goalId: string | null
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

export function GoalTodoPanel(props: GoalTodoPanelProps) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { todo, isLoading, error } = useGoalTodo(api, props.projectId, props.goalId)

    const groupedSections = useMemo(() => groupSections(todo?.sections ?? []), [todo?.sections])

    if (!props.goalId) {
        return null
    }

    if (isLoading) {
        return (
            <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2 text-xs text-[var(--app-hint)]">
                {t('projects.todo.loading')}
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

    if (!todo) {
        return null
    }

    return (
        <div className="border-b border-[var(--app-divider)] bg-[var(--app-bg)] px-3 py-2">
            <div className="mx-auto flex w-full max-w-content flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="text-xs font-semibold text-[var(--app-fg)]">
                        {t('projects.todo.title')}
                    </div>
                    {todo.exists ? (
                        <Tag size="xs" variant="secondary">
                            {t('projects.todo.count', { n: todo.sections.length })}
                        </Tag>
                    ) : (
                        <Tag size="xs" variant="warning">
                            {t('projects.todo.missing')}
                        </Tag>
                    )}
                </div>

                {!todo.exists ? (
                    <div className="text-xs text-[var(--app-hint)]">
                        {t('projects.todo.missingDocs')}
                    </div>
                ) : groupedSections.length === 0 ? (
                    <div className="text-xs text-[var(--app-hint)]">
                        {t('projects.todo.empty')}
                    </div>
                ) : (
                    <div className="max-h-72 overflow-y-auto pr-1">
                        <div className="grid gap-2 lg:grid-cols-2">
                            {groupedSections.map((group) => (
                                <div key={group.kind} className="rounded-lg border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-2">
                                    <div className="mb-2 flex items-center gap-2">
                                        <Tag size="xs" variant={TAG_VARIANTS[group.kind]}>
                                            {t(`projects.todo.kind.${group.kind}`)}
                                        </Tag>
                                        <span className="text-[11px] text-[var(--app-hint)]">
                                            {t('projects.todo.count', { n: group.items.length })}
                                        </span>
                                    </div>
                                    <div className="space-y-2">
                                        {group.items.map((section, index) => (
                                            <div key={`${group.kind}-${section.taskId ?? section.title}-${index}`} className="border-t border-[var(--app-divider)] pt-2 first:border-t-0 first:pt-0">
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="min-w-0 text-sm font-medium leading-snug break-words">
                                                        {section.title}
                                                    </div>
                                                    {section.taskId ? (
                                                        <a
                                                            href={getTaskUrl(props.projectId, section.taskId)}
                                                            className="shrink-0 text-[11px] font-medium text-[var(--app-link)] hover:underline"
                                                        >
                                                            {t('projects.todo.linkedTask', { id: section.taskId.slice(0, 8) })}
                                                        </a>
                                                    ) : null}
                                                </div>
                                                {section.body ? (
                                                    <div className="mt-1 max-h-28 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-[var(--app-hint)] break-words">
                                                        {section.body}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {todo.rawMarkdown ? (
                    <details className="text-xs text-[var(--app-hint)]">
                        <summary className="cursor-pointer select-none font-medium text-[var(--app-fg)]">
                            {t('projects.todo.rawMarkdown')}
                        </summary>
                        <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--app-border)] bg-[var(--app-secondary-bg)] p-2 font-mono text-[11px] leading-relaxed">
                            {todo.rawMarkdown}
                        </pre>
                    </details>
                ) : null}
            </div>
        </div>
    )
}
