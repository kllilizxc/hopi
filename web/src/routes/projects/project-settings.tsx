import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { DEFAULT_AGENT_FLAVOR, DEFAULT_AUTOMATION_BACKSTOP_POLICY, DEFAULT_AUTOMATION_LANE_LIMITS, DEFAULT_TASK_MODEL, getPermissionModeOptionsForFlavor, isPermissionModeAllowedForFlavor, normalizeAutomationBackstopPolicy, normalizeAutomationLaneLimits, normalizeModelName, resolveClaudeModelMode, resolveStoredModel, shouldResetModelForFlavor } from '@hopi/protocol'
import type { AgentFlavor, AgentOutputLanguage, AutomationBackstopPolicy, PermissionMode, Workspace } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { getAgentOutputLanguageOptions, normalizeProjectAgentOutputLanguage } from '@/lib/agent-output-language'
import { useToast } from '@/lib/toast-context'
import { LoadingState } from '@/components/LoadingState'
import { PageHeader } from '@/components/PageHeader'
import { ModelWithEffort } from '@/components/NewSession/ModelSelector'
import { Tag } from '@/components/ui/tag'
import { Button } from '@/components/ui/button'
import { AdaptiveSelectField } from '@/components/ui/AdaptiveSelectField'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useProject } from '@/hooks/queries/useProject'
import { useWorkspaces } from '@/hooks/queries/useWorkspaces'
import { useArchiveProject } from '@/hooks/mutations/useArchiveProject'
import { useUpdateProject } from '@/hooks/mutations/useUpdateProject'
import { useVerifyProjectAutomation } from '@/hooks/mutations/useVerifyProjectAutomation'

type AutomationReadinessStatus = 'unknown' | 'checking' | 'ready' | 'degraded' | 'blocked'
type AutomationLaneKey = 'planner' | 'generator' | 'evaluator' | 'radar'
type AutomationBackstopPolicyKey = keyof Required<AutomationBackstopPolicy>

const AUTOMATION_LANE_FIELDS: AutomationLaneKey[] = ['planner', 'generator', 'evaluator', 'radar']
const AUTOMATION_BACKSTOP_FIELDS: Array<{ key: AutomationBackstopPolicyKey; max: number }> = [
    { key: 'maxHoursWithoutMilestone', max: 720 },
    { key: 'maxGeneratorTasksWithoutMilestone', max: 200 },
    { key: 'maxPlannerRefillsWithoutMilestone', max: 100 }
]

function clampLaneLimit(value: number): number {
    if (!Number.isFinite(value)) {
        return 0
    }
    return Math.max(0, Math.min(50, Math.trunc(value)))
}

function clampBackstopLimit(value: number, max: number): number {
    if (!Number.isFinite(value)) {
        return 0
    }
    return Math.max(0, Math.min(max, Math.trunc(value)))
}

function getAutomationReadinessVariant(status: AutomationReadinessStatus): 'default' | 'secondary' | 'success' | 'warning' | 'error' {
    switch (status) {
        case 'ready':
            return 'success'
        case 'degraded':
            return 'warning'
        case 'blocked':
            return 'error'
        case 'checking':
            return 'secondary'
        case 'unknown':
        default:
            return 'default'
    }
}

function getAutomationReadinessLabelKey(status: AutomationReadinessStatus): string {
    switch (status) {
        case 'ready':
            return 'projects.automation.readinessReady'
        case 'degraded':
            return 'projects.automation.readinessDegraded'
        case 'blocked':
            return 'projects.automation.readinessBlocked'
        case 'checking':
            return 'projects.automation.readinessChecking'
        case 'unknown':
        default:
            return 'projects.automation.readinessUnknown'
    }
}

function WorkspacesBadge(props: { ok: boolean; label: string }) {
    return (
        <Tag variant={props.ok ? 'success' : 'warning'}>
            {props.label}
        </Tag>
    )
}

function WorkspaceRow(props: {
    workspace: Workspace
    isDefault: boolean
    exists: boolean | null
}) {
    const { t } = useTranslation()

    return (
        <div className="rounded-xl bg-[var(--app-bg)] p-3">
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                        {props.isDefault ? <Tag variant="default">{t('projects.workspaces.default')}</Tag> : null}
                        {props.exists === null ? (
                            <Tag variant="default">{t('projects.workspaces.pathUnknown')}</Tag>
                        ) : (
                            <WorkspacesBadge ok={props.exists} label={props.exists ? t('projects.workspaces.pathOk') : t('projects.workspaces.pathMissing')} />
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <div className="text-xs font-medium text-[var(--app-hint)]">{t('projects.workspaces.fields.label')}</div>
                        <div className="text-sm">
                            {props.workspace.label ?? t('projects.workspaces.unnamed')}
                        </div>
                    </div>

                    <div className="space-y-1.5">
                        <div className="text-xs font-medium text-[var(--app-hint)]">{t('projects.workspaces.fields.path')}</div>
                        <div className="text-sm break-all">{props.workspace.path}</div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export function ProjectSettingsPage() {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { addToast } = useToast()
    const { api } = useAppContext()
    const { projectId } = useParams({ from: '/projects/$projectId/settings' })

    const { project, isLoading: projectLoading, error: projectError, refetch: refetchProject } = useProject(api, projectId)
    const { workspaces, isLoading: workspacesLoading, error: workspacesError } = useWorkspaces(api, projectId)
    const { updateProject, isPending: isSavingProject } = useUpdateProject(api)
    const { archiveProject, isPending: isArchivingProject } = useArchiveProject(api)
    const { verifyProjectAutomation, isPending: isVerifyingAutomation } = useVerifyProjectAutomation(api)

    const isPending = isSavingProject || isArchivingProject
    const isWorktreeLocked = Boolean(project?.worktreeLocked)

    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [defaultAgentFlavor, setDefaultAgentFlavor] = useState<AgentFlavor>(DEFAULT_AGENT_FLAVOR)
    const [defaultPermissionMode, setDefaultPermissionMode] = useState<PermissionMode>('default')
    const [defaultModel, setDefaultModel] = useState(DEFAULT_TASK_MODEL)
    const [defaultSessionType, setDefaultSessionType] = useState<'simple' | 'worktree'>('simple')
    const [worktreeTargetBranch, setWorktreeTargetBranch] = useState('')
    const [worktreeAutoCommitMode, setWorktreeAutoCommitMode] = useState<'off' | 'per_conversation'>('off')
    const [worktreeCleanupAfterMerge, setWorktreeCleanupAfterMerge] = useState(false)
    const [agentOutputLanguage, setAgentOutputLanguage] = useState<AgentOutputLanguage>('system')
    const [autoRunEnabled, setAutoRunEnabled] = useState(false)
    const [automationLaneLimits, setAutomationLaneLimits] = useState<Record<AutomationLaneKey, number>>({
        ...DEFAULT_AUTOMATION_LANE_LIMITS
    })
    const [automationBackstopPolicy, setAutomationBackstopPolicy] = useState<Required<AutomationBackstopPolicy>>({
        ...DEFAULT_AUTOMATION_BACKSTOP_POLICY
    })
    const [improvementsEnabled, setImprovementsEnabled] = useState(false)
    const [improvementsMaxPendingTasks, setImprovementsMaxPendingTasks] = useState(5)

    const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
    const [automationVerifyError, setAutomationVerifyError] = useState<string | null>(null)

    const [pathExistence, setPathExistence] = useState<Record<string, boolean>>({})

    useEffect(() => {
        if (!project) return
        const resolvedDefaultAgent = (project.defaultAgentFlavor as AgentFlavor | null) ?? DEFAULT_AGENT_FLAVOR
        setName(project.name ?? '')
        setDescription(project.description ?? '')
        setDefaultAgentFlavor(resolvedDefaultAgent)
        setDefaultPermissionMode((project.defaultPermissionMode as PermissionMode | null) ?? 'default')
        setDefaultModel(resolveStoredModel(project.defaultModel, project.defaultModelMode) ?? (
            resolvedDefaultAgent === DEFAULT_AGENT_FLAVOR ? DEFAULT_TASK_MODEL : 'auto'
        ))
        setDefaultSessionType(project.defaultSessionType === 'worktree' ? 'worktree' : 'simple')
        setWorktreeTargetBranch(project.worktreeTargetBranch ?? '')
        setWorktreeAutoCommitMode(project.worktreeAutoCommitMode === 'per_conversation' ? 'per_conversation' : 'off')
        setWorktreeCleanupAfterMerge(Boolean(project.worktreeCleanupAfterMerge))
        setAgentOutputLanguage(normalizeProjectAgentOutputLanguage(project.agentOutputLanguage))
        setAutoRunEnabled(Boolean(project.autoRunEnabled))
        setAutomationLaneLimits(normalizeAutomationLaneLimits(project.automationLaneLimits))
        setAutomationBackstopPolicy(normalizeAutomationBackstopPolicy(project.automationBackstopPolicy))
        setImprovementsEnabled(Boolean(project.improvementsEnabled))
        setImprovementsMaxPendingTasks(project.improvementsMaxPendingTasks ?? 5)
    }, [project])

    const permissionOptions = useMemo(() => {
        return getPermissionModeOptionsForFlavor(defaultAgentFlavor)
    }, [defaultAgentFlavor])

    const agentFlavorOptions = useMemo(() => ([
        { value: 'claude' as const, label: t('agent.claude') },
        { value: 'codex' as const, label: t('agent.codex') },
        { value: 'gemini' as const, label: t('agent.gemini') },
        { value: 'opencode' as const, label: t('agent.opencode') },
    ]), [t])

    const agentOutputLanguageOptions = useMemo(() => getAgentOutputLanguageOptions(t), [t])

    useEffect(() => {
        if (!isPermissionModeAllowedForFlavor(defaultPermissionMode, defaultAgentFlavor)) {
            setDefaultPermissionMode('default')
        }
        if (defaultAgentFlavor === 'opencode' && defaultModel !== 'auto') {
            setDefaultModel('auto')
            return
        }
        if (shouldResetModelForFlavor(defaultModel, defaultAgentFlavor)) {
            setDefaultModel('auto')
        }
    }, [defaultAgentFlavor, defaultPermissionMode, defaultModel])

    useEffect(() => {
        let cancelled = false

        if (!api || !project?.machineId) {
            setPathExistence({})
            return () => { cancelled = true }
        }

        const paths = workspaces.map((w) => w.path).filter((p) => Boolean(p)).slice(0, 1000)
        if (paths.length === 0) {
            setPathExistence({})
            return () => { cancelled = true }
        }

        void api.checkMachinePathsExists(project.machineId, paths)
            .then((result) => {
                if (cancelled) return
                setPathExistence(result.exists ?? {})
            })
            .catch(() => {
                if (cancelled) return
                setPathExistence({})
            })

        return () => {
            cancelled = true
        }
    }, [api, project?.machineId, workspaces])

    const setAutomationLaneLimit = useCallback((lane: AutomationLaneKey, value: number) => {
        setAutomationLaneLimits((previous) => ({
            ...previous,
            [lane]: clampLaneLimit(value)
        }))
    }, [])

    const setAutomationBackstopLimit = useCallback((key: AutomationBackstopPolicyKey, value: number) => {
        const field = AUTOMATION_BACKSTOP_FIELDS.find((item) => item.key === key)
        setAutomationBackstopPolicy((previous) => ({
            ...previous,
            [key]: clampBackstopLimit(value, field?.max ?? 100)
        }))
    }, [])

    const handleSaveBasics = useCallback(async () => {
        if (!project) return

        const normalizedDefaultModel = defaultAgentFlavor === 'opencode'
            ? null
            : normalizeModelName(defaultModel)

        await updateProject({
            projectId: project.id,
            patch: {
                name: name.trim() || project.name,
                description: description.trim() ? description.trim() : null,
                defaultAgentFlavor,
                defaultPermissionMode,
                defaultModel: normalizedDefaultModel,
                defaultModelMode: defaultAgentFlavor === 'claude' ? resolveClaudeModelMode(normalizedDefaultModel) : null,
                defaultSessionType,
                worktreeTargetBranch: worktreeTargetBranch.trim() ? worktreeTargetBranch.trim() : null,
                worktreeAutoCommitMode: defaultSessionType === 'worktree' ? worktreeAutoCommitMode : 'off',
                worktreeCleanupAfterMerge,
                agentOutputLanguage,
                autoRunEnabled,
                automationLaneLimits,
                automationBackstopPolicy,
                improvementsEnabled,
                improvementsMaxPendingTasks
            }
        })
        addToast({ title: t('projects.toast.saved'), body: '', sessionId: '', url: '' })
    }, [
        project,
        updateProject,
        addToast,
        t,
        name,
        description,
        defaultAgentFlavor,
        defaultPermissionMode,
        defaultModel,
        defaultSessionType,
        worktreeTargetBranch,
        worktreeAutoCommitMode,
        worktreeCleanupAfterMerge,
        agentOutputLanguage,
        autoRunEnabled,
        automationLaneLimits,
        automationBackstopPolicy,
        improvementsEnabled,
        improvementsMaxPendingTasks
    ])

    const handleArchiveProject = useCallback(async () => {
        if (!project) return
        await archiveProject(project.id)
        addToast({ title: t('projects.toast.archived'), body: project.name, sessionId: '', url: '' })
        void navigate({ to: '/projects' })
    }, [project, archiveProject, addToast, t, navigate])

    const handleVerifyAutomation = useCallback(async () => {
        if (!project) return
        setAutomationVerifyError(null)
        try {
            const result = await verifyProjectAutomation(project.id)
            await refetchProject()
            addToast({
                title: t('projects.automation.verifySuccess'),
                body: t(getAutomationReadinessLabelKey(result.verification.status)),
                sessionId: '',
                url: ''
            })
        } catch (error) {
            const message = error instanceof Error ? error.message : t('projects.automation.verifyFailed')
            setAutomationVerifyError(message)
            addToast({
                title: t('projects.automation.verifyFailed'),
                body: message,
                sessionId: '',
                url: ''
            })
        }
    }, [project, verifyProjectAutomation, refetchProject, addToast, t])

    const header = (
        <PageHeader
            title={t('projects.settings.title')}
            subtitle={project?.name ?? projectId}
            onBack={() => navigate({ to: '/projects/$projectId', params: { projectId } })}
            backLabel={t('projects.actions.back')}
            subtitleClassName="text-[10px] text-[var(--app-hint)] truncate"
        />
    )

    if (projectLoading || workspacesLoading) {
        return (
            <div className="h-full flex flex-col">
                {header}
                <div className="flex-1 flex items-center justify-center p-4">
                    <LoadingState label={t('loading')} className="text-sm" />
                </div>
            </div>
        )
    }

    if (projectError || workspacesError || !project) {
        return (
            <div className="h-full flex flex-col">
                {header}
                <div className="p-4 text-sm text-red-600">
                    {projectError ?? workspacesError ?? t('projects.settings.loadError')}
                </div>
            </div>
        )
    }

    const automationReadinessStatus = (project.automationReadinessStatus ?? 'unknown') as AutomationReadinessStatus
    const automationReadinessSummary = project.automationReadinessSummary?.trim() || t('projects.automation.readinessSummaryEmpty')
    const automationReadinessCheckedAt = project.automationReadinessCheckedAt
        ? new Date(project.automationReadinessCheckedAt).toLocaleString()
        : t('projects.automation.readinessNotChecked')

    return (
        <div className="h-full flex flex-col">
            {header}

            <div className="flex-1 min-h-0 overflow-y-auto">
                <div className="mx-auto w-full max-w-content p-4 space-y-6">
                    <section className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-sm font-semibold">{t('projects.settings.basics')}</div>
                                <div className="text-xs text-[var(--app-hint)]">{t('projects.settings.basicsHint')}</div>
                            </div>
                            <Button type="button" variant="secondary" onClick={handleSaveBasics} disabled={isPending || !name.trim()}>
                                {isPending ? t('projects.settings.saving') : t('projects.settings.save')}
                            </Button>
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.fields.name')}</label>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                disabled={isPending}
                                className="min-h-24 w-full resize-none rounded-lg bg-[var(--app-bg)] p-2 text-sm leading-relaxed focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.fields.description')}</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                disabled={isPending}
                                rows={4}
                                className="w-full resize-none rounded-lg bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                        </div>

                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.defaults.agent')}</label>
                                <AdaptiveSelectField
                                    title={t('projects.defaults.agent')}
                                    value={defaultAgentFlavor}
                                    options={agentFlavorOptions}
                                    onValueChange={(value) => setDefaultAgentFlavor(value as AgentFlavor)}
                                    disabled={isPending}
                                    align="start"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">{t('misc.permissionMode')}</label>
                                <AdaptiveSelectField
                                    title={t('misc.permissionMode')}
                                    value={defaultPermissionMode}
                                    options={permissionOptions.map((opt) => ({
                                        value: opt.mode as PermissionMode,
                                        label: opt.label,
                                    }))}
                                    onValueChange={(value) => setDefaultPermissionMode(value as PermissionMode)}
                                    disabled={isPending}
                                    align="start"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <ModelWithEffort
                                    agent={defaultAgentFlavor}
                                    model={defaultModel}
                                    isDisabled={isPending}
                                    onModelChange={setDefaultModel}
                                    compact
                                />
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.agentOutputLanguage.title')}</label>
                                <AdaptiveSelectField
                                    title={t('projects.agentOutputLanguage.title')}
                                    value={agentOutputLanguage}
                                    options={agentOutputLanguageOptions}
                                    onValueChange={(value) => setAgentOutputLanguage(value as AgentOutputLanguage)}
                                    disabled={isPending}
                                    align="start"
                                />
                                <div className="text-xs text-[var(--app-hint)]">{t('projects.agentOutputLanguage.hint')}</div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-sm font-semibold">{t('projects.automation.title')}</div>
                            <div className="rounded-xl bg-[var(--app-bg)] p-3 space-y-3">
                                <div className="flex items-start justify-between gap-3">
                                    <div className="space-y-1">
                                        <div className="text-xs font-medium text-[var(--app-hint)]">{t('projects.automation.readiness')}</div>
                                        <Tag variant={getAutomationReadinessVariant(automationReadinessStatus)}>
                                            {t(getAutomationReadinessLabelKey(automationReadinessStatus))}
                                        </Tag>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={handleVerifyAutomation}
                                        disabled={isVerifyingAutomation}
                                    >
                                        {isVerifyingAutomation ? t('projects.automation.verifying') : t('projects.automation.verify')}
                                    </Button>
                                </div>
                                <div className="text-xs text-[var(--app-hint)]">{t('projects.automation.readinessHint')}</div>
                                <div className="text-xs text-[var(--app-hint)]">
                                    {t('projects.automation.lastChecked')}: {automationReadinessCheckedAt}
                                </div>
                                <div className="rounded-md bg-[var(--app-subtle-bg)] p-3 text-xs whitespace-pre-wrap break-words">
                                    {automationReadinessSummary}
                                </div>
                                {automationVerifyError ? (
                                    <div className="text-xs text-red-600">{automationVerifyError}</div>
                                ) : null}
                            </div>

                            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                                <Checkbox checked={autoRunEnabled} onCheckedChange={setAutoRunEnabled} disabled={isPending} />
                                {t('projects.automation.autoRun')}
                            </label>
                            <div className="space-y-1.5">
                                <div className="text-xs font-medium text-[var(--app-hint)]">{t('projects.automation.laneLimits')}</div>
                                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                    {AUTOMATION_LANE_FIELDS.map((lane) => (
                                        <div key={lane} className="space-y-1.5">
                                            <label className="text-xs font-medium text-[var(--app-hint)]">
                                                {t(`projects.automation.lane.${lane}`)}
                                            </label>
                                            <input
                                                type="number"
                                                min={0}
                                                max={50}
                                                value={automationLaneLimits[lane]}
                                                onChange={(e) => setAutomationLaneLimit(lane, Number(e.target.value))}
                                                disabled={isPending}
                                                className="w-full rounded-lg bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                            />
                                        </div>
                                    ))}
                                </div>
                                <div className="text-xs text-[var(--app-hint)]">{t('projects.automation.laneLimitsHint')}</div>
                            </div>

                            <div className="space-y-1.5">
                                <div className="text-xs font-medium text-[var(--app-hint)]">{t('projects.automation.backstopPolicy')}</div>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                    {AUTOMATION_BACKSTOP_FIELDS.map((field) => (
                                        <div key={field.key} className="space-y-1.5">
                                            <label className="text-xs font-medium text-[var(--app-hint)]">
                                                {t(`projects.automation.backstop.${field.key}`)}
                                            </label>
                                            <input
                                                type="number"
                                                min={0}
                                                max={field.max}
                                                value={automationBackstopPolicy[field.key]}
                                                onChange={(e) => setAutomationBackstopLimit(field.key, Number(e.target.value))}
                                                disabled={isPending}
                                                className="w-full rounded-lg bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                            />
                                        </div>
                                    ))}
                                </div>
                                <div className="text-xs text-[var(--app-hint)]">{t('projects.automation.backstopPolicyHint')}</div>
                            </div>

                            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                                <Checkbox checked={improvementsEnabled} onCheckedChange={setImprovementsEnabled} disabled={isPending} />
                                {t('projects.automation.improvements')}
                            </label>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.automation.maxPendingTasks')}</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={50}
                                        value={improvementsMaxPendingTasks}
                                        onChange={(e) => setImprovementsMaxPendingTasks(Number(e.target.value))}
                                        disabled={isPending}
                                        className="w-full rounded-lg bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-sm font-semibold">{t('projects.worktree.title')}</div>

                            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                                <Checkbox
                                    checked={defaultSessionType === 'worktree'}
                                    onCheckedChange={(enabled) => {
                                        setDefaultSessionType(enabled ? 'worktree' : 'simple')
                                        if (!enabled) {
                                            setWorktreeAutoCommitMode('off')
                                        }
                                    }}
                                    disabled={isPending || isWorktreeLocked}
                                />
                                {t('projects.worktree.enable')}
                            </label>

                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.worktree.targetBranch')}</label>
                                    <input
                                        type="text"
                                        value={worktreeTargetBranch}
                                        onChange={(e) => setWorktreeTargetBranch(e.target.value)}
                                        disabled={isPending || defaultSessionType !== 'worktree' || isWorktreeLocked}
                                        placeholder={t('projects.worktree.targetBranchPlaceholder')}
                                        className="w-full rounded-lg bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                    />
                                    <div className="text-xs text-[var(--app-hint)]">{t('projects.worktree.targetBranchHint')}</div>
                                </div>
                            </div>

                            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                                <Checkbox
                                    checked={worktreeAutoCommitMode === 'per_conversation'}
                                    onCheckedChange={(enabled) => setWorktreeAutoCommitMode(enabled ? 'per_conversation' : 'off')}
                                    disabled={isPending || defaultSessionType !== 'worktree'}
                                />
                                {t('projects.worktree.autoCommit')}
                            </label>
                            <div className="text-xs text-[var(--app-hint)]">{t('projects.worktree.autoCommitHint')}</div>

                            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                                <Checkbox
                                    checked={worktreeCleanupAfterMerge}
                                    onCheckedChange={setWorktreeCleanupAfterMerge}
                                    disabled={isPending || defaultSessionType !== 'worktree'}
                                />
                                {t('projects.worktree.cleanup')}
                            </label>
                            <div className="text-xs text-[var(--app-hint)]">{t('projects.worktree.cleanupHint')}</div>
                        </div>
                    </section>

                    <section className="space-y-3">
                        <div>
                            <div>
                                <div className="text-sm font-semibold">{t('projects.workspaces.title')}</div>
                                <div className="text-xs text-[var(--app-hint)]">
                                    {t('projects.workspaces.hint')}
                                </div>
                            </div>
                        </div>

                        {workspaces.length === 0 ? (
                            <div className="text-sm text-[var(--app-hint)]">
                                {t('projects.workspaces.empty')}
                            </div>
                        ) : null}

                        <div className="flex flex-col gap-3">
                            {workspaces.map((workspace) => (
                                <WorkspaceRow
                                    key={workspace.id}
                                    workspace={workspace}
                                    isDefault={(project.defaultWorkspaceId ?? null) === workspace.id}
                                    exists={workspace.path in pathExistence ? Boolean(pathExistence[workspace.path]) : null}
                                />
                            ))}
                        </div>
                    </section>

                    <section className="space-y-2">
                        <div className="text-sm font-semibold">{t('projects.archive.sectionTitle')}</div>
                        <div className="text-xs text-[var(--app-hint)]">{t('projects.archive.sectionHint')}</div>
                        <Button type="button" variant="destructive" onClick={() => setArchiveConfirmOpen(true)} disabled={isPending}>
                            {t('projects.archive.confirm')}
                        </Button>
                    </section>
                </div>
            </div>

            <ConfirmDialog
                isOpen={archiveConfirmOpen}
                onClose={() => setArchiveConfirmOpen(false)}
                title={t('projects.archive.title')}
                description={t('projects.archive.description')}
                confirmLabel={t('projects.archive.confirm')}
                confirmingLabel={t('projects.archive.confirming')}
                onConfirm={handleArchiveProject}
                isPending={isArchivingProject}
                destructive
            />
        </div>
    )
}
