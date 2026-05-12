import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
    Goal,
    ProjectAssistantInterventionKind,
    ProjectAssistantSessionSummary
} from '@/types/api'
import { CheckIcon, CloseIcon, PlusIcon } from '@/assets/icons'
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
    return (
        <Pressable
            onClick={() => props.onSelect(props.session.id)}
            className={`w-full rounded-lg px-3 py-2 text-left transition-colors cursor-pointer ${
                props.selected
                    ? 'bg-[var(--app-secondary-bg)] app-shadow-border'
                    : 'hover:bg-[var(--app-subtle-bg)]'
            }`}
        >
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{getSessionTitle(props.session, t)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--app-hint)]">
                        <span>{getSessionKindLabel(props.session, t)}</span>
                        {goalTitle ? <span>{goalTitle}</span> : null}
                    </div>
                </div>
                {props.session.pending ? (
                    <Tag variant="warning" size="xs" shape="rounded">
                        {t('projects.assistant.status.pending')}
                    </Tag>
                ) : null}
            </div>
        </Pressable>
    )
}

function InterventionActions(props: {
    session: ProjectAssistantSessionSummary
    disabled: boolean
    onResolve: (actionId: string | null, status: 'resolved' | 'dismissed') => void
}) {
    const { t } = useTranslation()
    if (!props.session.pending) return null
    return (
        <div className="flex flex-wrap gap-2 rounded-md bg-[var(--app-subtle-bg)] p-2">
            {props.session.suggestedActions.map((action) => (
                <Button
                    key={action.id}
                    type="button"
                    size="sm"
                    variant={action.recommended ? 'default' : 'secondary'}
                    onClick={() => props.onResolve(action.id, action.id === 'dismiss' ? 'dismissed' : 'resolved')}
                    disabled={props.disabled}
                    title={action.description}
                    className="gap-2"
                >
                    <CheckIcon className="h-4 w-4" />
                    {action.label}
                </Button>
            ))}
            <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => props.onResolve(null, 'dismissed')}
                disabled={props.disabled}
                className="gap-2"
            >
                <CloseIcon className="h-4 w-4" />
                {t('projects.assistant.actions.dismiss')}
            </Button>
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

    const resolveIntervention = useCallback((actionId: string | null, status: 'resolved' | 'dismissed') => {
        if (!selectedSession) return
        void actions.resolveIntervention({
            sessionId: selectedSession.id,
            status,
            actionId,
            note: actionId ? `Selected ${actionId}` : null
        }).catch((err) => {
            addToast({
                title: t('projects.assistant.toast.resolveFailed'),
                body: err instanceof Error ? err.message : t('projects.assistant.error.resolveFailed'),
                sessionId: selectedSession.id,
                url: ''
            })
        })
    }, [actions, addToast, selectedSession, t])

    const headerExtra = selectedSession ? (
        <InterventionActions
            session={selectedSession}
            disabled={actions.isPending}
            onResolve={resolveIntervention}
        />
    ) : null

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--app-bg)]">
            <div className="app-shadow-divider-b px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-sm font-semibold">{t('projects.assistant.title')}</div>
                        <div className="mt-0.5 text-xs text-[var(--app-hint)]">
                            {t('projects.assistant.pendingCount', { n: pendingCount })}
                        </div>
                    </div>
                    <IconButton
                        type="button"
                        size="xs"
                        variant="subtle"
                        onClick={createSession}
                        disabled={actions.isPending}
                        title={t('projects.assistant.newConversation')}
                        aria-label={t('projects.assistant.newConversation')}
                    >
                        <PlusIcon className="h-4 w-4" />
                    </IconButton>
                </div>
                {error || actions.error ? (
                    <div className="mt-2 text-xs text-red-600">{error ?? actions.error}</div>
                ) : null}
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[20rem_minmax(0,1fr)]">
                <aside className="min-h-0 border-b border-[var(--app-divider)] lg:border-b-0 lg:border-r">
                    <div className="flex h-full min-h-0 flex-col">
                        <div className="min-h-0 flex-1 overflow-y-auto p-2">
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

                <main className="flex min-h-0 flex-col">
                    {selectedSession ? (
                        <ProjectAssistantSessionChat
                            api={api}
                            projectId={props.projectId}
                            sessionId={selectedSession.id}
                            onBack={() => undefined}
                            onSessionResolved={setSelectedSessionId}
                            headerExtra={headerExtra}
                        />
                    ) : (
                        <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-[var(--app-hint)]">
                            {t('projects.assistant.empty')}
                        </div>
                    )}
                </main>
            </div>
        </div>
    )
}
