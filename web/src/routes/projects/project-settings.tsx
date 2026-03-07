import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { getPermissionModeOptionsForFlavor, isPermissionModeAllowedForFlavor, normalizeModelName, resolveClaudeModelMode, resolveStoredModel, shouldResetModelForFlavor } from '@hopi/protocol'
import type { AgentFlavor, PermissionMode, Workspace } from '@/types/api'
import { useAppContext } from '@/lib/app-context'
import { useTranslation } from '@/lib/use-translation'
import { useToast } from '@/lib/toast-context'
import { LoadingState } from '@/components/LoadingState'
import { PageHeader } from '@/components/PageHeader'
import { ModelSelector } from '@/components/NewSession/ModelSelector'
import { Tag } from '@/components/ui/tag'
import { Button } from '@/components/ui/button'
import { AdaptiveSelectField } from '@/components/ui/AdaptiveSelectField'
import { Checkbox } from '@/components/ui/checkbox'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { useProject } from '@/hooks/queries/useProject'
import { useWorkspaces } from '@/hooks/queries/useWorkspaces'
import { useArchiveProject } from '@/hooks/mutations/useArchiveProject'
import { useUpdateProject } from '@/hooks/mutations/useUpdateProject'

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
        <div className="rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] p-3">
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

    const { project, isLoading: projectLoading, error: projectError } = useProject(api, projectId)
    const { workspaces, isLoading: workspacesLoading, error: workspacesError } = useWorkspaces(api, projectId)
    const { updateProject, isPending: isSavingProject } = useUpdateProject(api)
    const { archiveProject, isPending: isArchivingProject } = useArchiveProject(api)

    const isPending = isSavingProject || isArchivingProject
    const isWorktreeLocked = Boolean(project?.worktreeLocked)

    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [defaultAgentFlavor, setDefaultAgentFlavor] = useState<AgentFlavor>('claude')
    const [defaultPermissionMode, setDefaultPermissionMode] = useState<PermissionMode>('default')
    const [defaultModel, setDefaultModel] = useState('auto')
    const [defaultSessionType, setDefaultSessionType] = useState<'simple' | 'worktree'>('simple')
    const [worktreeTargetBranch, setWorktreeTargetBranch] = useState('')
    const [worktreeAutoCommitMode, setWorktreeAutoCommitMode] = useState<'off' | 'per_conversation'>('off')
    const [worktreeCleanupAfterMerge, setWorktreeCleanupAfterMerge] = useState(false)
    const [autoRunEnabled, setAutoRunEnabled] = useState(false)
    const [maxRunningSessions, setMaxRunningSessions] = useState(5)
    const [improvementsEnabled, setImprovementsEnabled] = useState(false)
    const [improvementsMaxPendingTasks, setImprovementsMaxPendingTasks] = useState(5)

    const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)

    const [pathExistence, setPathExistence] = useState<Record<string, boolean>>({})

    useEffect(() => {
        if (!project) return
        setName(project.name ?? '')
        setDescription(project.description ?? '')
        setDefaultAgentFlavor((project.defaultAgentFlavor as AgentFlavor | null) ?? 'claude')
        setDefaultPermissionMode((project.defaultPermissionMode as PermissionMode | null) ?? 'default')
        setDefaultModel(resolveStoredModel(project.defaultModel, project.defaultModelMode) ?? 'auto')
        setDefaultSessionType(project.defaultSessionType === 'worktree' ? 'worktree' : 'simple')
        setWorktreeTargetBranch(project.worktreeTargetBranch ?? '')
        setWorktreeAutoCommitMode(project.worktreeAutoCommitMode === 'per_conversation' ? 'per_conversation' : 'off')
        setWorktreeCleanupAfterMerge(Boolean(project.worktreeCleanupAfterMerge))
        setAutoRunEnabled(Boolean(project.autoRunEnabled))
        setMaxRunningSessions(project.maxRunningSessions ?? 5)
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
                autoRunEnabled,
                maxRunningSessions,
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
        autoRunEnabled,
        maxRunningSessions,
        improvementsEnabled,
        improvementsMaxPendingTasks
    ])

    const handleArchiveProject = useCallback(async () => {
        if (!project) return
        await archiveProject(project.id)
        addToast({ title: t('projects.toast.archived'), body: project.name, sessionId: '', url: '' })
        void navigate({ to: '/projects' })
    }, [project, archiveProject, addToast, t, navigate])

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
                                className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.fields.description')}</label>
                            <textarea
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                disabled={isPending}
                                rows={4}
                                className="w-full resize-none rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
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
                                <ModelSelector
                                    agent={defaultAgentFlavor}
                                    model={defaultModel}
                                    isDisabled={isPending}
                                    onModelChange={setDefaultModel}
                                    compact
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-sm font-semibold">{t('projects.automation.title')}</div>

                            <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                                <Checkbox checked={autoRunEnabled} onCheckedChange={setAutoRunEnabled} disabled={isPending} />
                                {t('projects.automation.autoRun')}
                            </label>
                            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.automation.maxRunning')}</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={50}
                                        value={maxRunningSessions}
                                        onChange={(e) => setMaxRunningSessions(Number(e.target.value))}
                                        disabled={isPending}
                                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                    />
                                </div>
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
                                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
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
                                        className="w-full rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
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
