import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
    Goal,
    ProjectAssistantInterventionKind,
    ProjectAssistantSessionSummary
} from '@/types/api'
import { PlusIcon, SessionIcon } from '@/assets/icons'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { Pressable } from '@/components/ui/pressable'
import { Tag } from '@/components/ui/tag'
import { LoadingState } from '@/components/LoadingState'
import { useAppContext } from '@/lib/app-context'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import { useProjectAssistantActions } from '@/hooks/mutations/useProjectAssistantActions'
import { useProjectAssistantSessions } from '@/hooks/queries/useProjectAssistantSessions'
import type { I18nContextValue } from '@/lib/use-translation'
import { ProjectAssistantSessionChat } from './project-assistant-session-chat'

type TFunction = I18nContextValue['t']

const SESSION_KIND_LABEL_KEY: Record<ProjectAssistantSessionSummary['kind'], string> = {
    normal: 'projects.assistant.kind.normal',
    intervention: 'projects.assistant.kind.intervention'
}

const INTERVENTION_KIND_LABEL_KEY: Record<ProjectAssistantInterventionKind, string> = {
    decision_needed: 'projects.assistant.interventionKind.decisionNeeded',
    task_blocked: 'projects.assistant.interventionKind.taskBlocked',
    merge_blocked: 'projects.assistant.interventionKind.mergeBlocked',
    permission_required: 'projects.assistant.interventionKind.permissionRequired',
    milestone_review: 'projects.assistant.interventionKind.milestoneReview',
    clarification_needed: 'projects.assistant.interventionKind.clarificationNeeded'
}

function getSessionTitle(session: ProjectAssistantSessionSummary, t: TFunction): string {
    if (session.title?.trim()) return session.title.trim()
    if (session.kind === 'intervention') return t('projects.assistant.defaultTitle.intervention')
    return t('projects.assistant.defaultTitle.normal')
}

function getCompactSessionTitle(session: ProjectAssistantSessionSummary, t: TFunction): string {
    return getSessionTitle(session, t).replace(/^Project Assistant:\s*/i, '').trim()
}

function getSessionKindLabel(session: ProjectAssistantSessionSummary, t: TFunction): string {
    if (session.interventionKind) return t(INTERVENTION_KIND_LABEL_KEY[session.interventionKind])
    return t(SESSION_KIND_LABEL_KEY[session.kind])
}

function getGoalTitle(goals: Goal[], goalId: string | null): string | null {
    if (!goalId) return null
    return goals.find((goal) => goal.id === goalId)?.title ?? goalId.slice(0, 8)
}

function SessionRow(props: {
    session: ProjectAssistantSessionSummary
    selected: boolean
    goals: Goal[]
    onSelect: (sessionId: string) => void
}) {
    const { t } = useTranslation()
    const goalTitle = getGoalTitle(props.goals, props.session.goalId)
    const title = getCompactSessionTitle(props.session, t)
    const kindLabel = props.session.kind === 'normal' ? null : getSessionKindLabel(props.session, t)
    const subtitleGoal = goalTitle && goalTitle !== title ? goalTitle : null
    return (
        <Pressable
            onClick={() => props.onSelect(props.session.id)}
            className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-all cursor-pointer ${
                props.selected
                    ? 'bg-[var(--app-subtle-bg)] text-[var(--app-text)] shadow-sm ring-1 ring-black/5 dark:ring-white/10'
                    : 'text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)]/50 hover:text-[var(--app-text)]'
            }`}
        >
            <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                    props.selected
                        ? 'bg-[var(--app-bg)] text-[var(--app-text)] shadow-sm'
                        : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] group-hover:bg-[var(--app-bg)] group-hover:text-[var(--app-text)] group-hover:shadow-sm'
                }`}
                aria-hidden="true"
            >
                <SessionIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
                <div className={`truncate text-sm ${props.selected ? 'font-semibold' : 'font-medium'}`}>{title}</div>
                {kindLabel || subtitleGoal ? (
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-[var(--app-hint)]">
                        {kindLabel ? <span className="shrink-0">{kindLabel}</span> : null}
                        {subtitleGoal ? <span className="truncate">{subtitleGoal}</span> : null}
                    </div>
                ) : null}
                {props.session.pending ? (
                    <Tag variant="warning" size="xs" shape="pill" className="mt-1.5">
                        {t('projects.assistant.status.pending')}
                    </Tag>
                ) : null}
            </div>
            {props.selected ? (
                <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--app-text)] opacity-80" aria-hidden="true" />
            ) : null}
        </Pressable>
    )
}

function AssistantEmptyState(props: {
    label: string
    onCreate: () => void
    disabled: boolean
}) {
    const { t } = useTranslation()
    return (
        <div className="flex h-full min-h-0 flex-1 items-center justify-center p-6">
            <div className="flex max-w-sm flex-col items-center text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--app-secondary-bg)] text-[var(--app-hint)] app-shadow-border">
                    <SessionIcon className="h-6 w-6" />
                </div>
                <div className="mt-3 text-sm font-medium">{props.label}</div>
                <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={props.onCreate}
                    disabled={props.disabled}
                    className="mt-4 gap-2"
                >
                    <PlusIcon className="h-4 w-4" />
                    {t('projects.assistant.newConversation')}
                </Button>
            </div>
        </div>
    )
}

export function ProjectAssistantPage(props: {
    projectId: string
    selectedGoalId: string | null
    goals: Goal[]
}) {
    const { api } = useAppContext()
    const { t } = useTranslation()
    const { addToast } = useToast()
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
    const {
        sessions,
        pendingCount,
        isLoading,
        error
    } = useProjectAssistantSessions(api, props.projectId)
    const actions = useProjectAssistantActions(api, props.projectId)

    const selectedSession = useMemo(() => (
        sessions.find((session) => session.id === selectedSessionId) ?? sessions[0] ?? null
    ), [selectedSessionId, sessions])

    useEffect(() => {
        if (sessions.length === 0) {
            if (selectedSessionId !== null) {
                setSelectedSessionId(null)
            }
            return
        }
        if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
            setSelectedSessionId(sessions[0].id)
        }
    }, [selectedSessionId, sessions])

    const createSession = useCallback(() => {
        void actions.ensureSession({ kind: 'normal', goalId: props.selectedGoalId }).then((session) => {
            setSelectedSessionId(session.id)
        }).catch((err) => {
            addToast({
                title: t('projects.assistant.toast.sessionFailed'),
                body: err instanceof Error ? err.message : t('projects.assistant.error.sessionFailed'),
                sessionId: '',
                url: ''
            })
        })
    }, [actions, addToast, props.selectedGoalId, t])

    return (
        <div className="flex h-full min-h-0 flex-col lg:flex-row bg-[var(--app-bg)]">
            <div className="flex shrink-0 w-full lg:w-[20rem] xl:w-[22rem] lg:p-3 lg:pr-0">
                <aside className="flex-1 min-h-0 max-h-56 bg-[var(--app-subtle-bg)] lg:max-h-none lg:rounded-2xl lg:shadow-[0_2px_12px_rgba(0,0,0,0.04)] dark:lg:shadow-[0_2px_12px_rgba(0,0,0,0.2)] overflow-hidden">
                    <div className="flex h-full min-h-0 flex-col">
                        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3.5">
                            <div className="min-w-0">
                                <div className="truncate text-[15px] font-semibold tracking-tight">{t('projects.tabs.assistant')}</div>
                                {pendingCount > 0 ? (
                                    <div className="mt-1">
                                        <Tag variant="warning" size="xs" shape="pill">
                                            {t('projects.assistant.pendingCount', { n: pendingCount })}
                                        </Tag>
                                    </div>
                                ) : null}
                            </div>
                            <IconButton
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={createSession}
                                disabled={actions.isPending}
                                title={t('projects.assistant.newConversation')}
                                aria-label={t('projects.assistant.newConversation')}
                                className="shrink-0 bg-[var(--app-bg)] shadow-sm"
                            >
                                <PlusIcon className="h-4 w-4" />
                            </IconButton>
                        </div>
                        {error || actions.error ? (
                            <div className="mx-4 mt-3 rounded-md bg-[var(--app-badge-error-bg)] px-2.5 py-2 text-xs text-[var(--app-badge-error-text)]">
                                {error ?? actions.error}
                            </div>
                        ) : null}

                        <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
                            {isLoading ? (
                                <div className="p-4">
                                    <LoadingState label={t('loading')} className="text-sm" />
                                </div>
                            ) : null}
                            {!isLoading && sessions.length === 0 ? (
                                <div className="p-4 text-sm text-[var(--app-hint)]">
                                    {t('projects.assistant.empty')}
                                </div>
                            ) : null}
                            <div className="grid gap-1">
                                {sessions.map((session) => (
                                    <SessionRow
                                        key={session.id}
                                        session={session}
                                        selected={session.id === selectedSession?.id}
                                        goals={props.goals}
                                        onSelect={setSelectedSessionId}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </aside>
            </div>

            <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--app-bg)]">
                {selectedSession ? (
                    <ProjectAssistantSessionChat
                        api={api}
                        projectId={props.projectId}
                        sessionId={selectedSession.id}
                        onBack={() => undefined}
                        onSessionResolved={setSelectedSessionId}
                    />
                ) : (
                    <AssistantEmptyState
                        label={t('projects.assistant.empty')}
                        onCreate={createSession}
                        disabled={actions.isPending}
                    />
                )}
            </main>
        </div>
    )
}
