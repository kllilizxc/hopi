import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_AUTOMATION_LANE_LIMITS } from '@hopi/protocol'
import type { ApiClient } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { AdaptiveSelectField } from '@/components/ui/AdaptiveSelectField'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getMachineDisplayTitle } from '@/lib/displayNames'
import { useTranslation } from '@/lib/use-translation'
import { getAgentOutputLanguageOptions } from '@/lib/agent-output-language'
import type { AgentOutputLanguage, AutomationLaneLimits, Machine } from '@/types/api'
import { MachineDirectoryPicker } from './MachineDirectoryPicker'

type AutomationLaneKey = 'planner' | 'generator' | 'evaluator' | 'radar'

const AUTOMATION_LANE_FIELDS: AutomationLaneKey[] = ['planner', 'generator', 'evaluator', 'radar']

function clampLaneLimit(value: number): number {
    if (!Number.isFinite(value)) {
        return 0
    }
    return Math.max(0, Math.min(50, Math.trunc(value)))
}

export type CreateProjectDialogProps = {
    api: ApiClient | null
    isOpen: boolean
    onClose: () => void
    machines: Machine[]
    isMachinesLoading: boolean
    onCreate: (input: {
        machineId: string
        name: string
        description?: string
        workspaces: Array<{ path: string; label?: string }>
        defaultSessionType?: 'simple' | 'worktree'
        worktreeTargetBranch?: string
        worktreeAutoCommitMode?: 'off' | 'per_conversation'
        worktreeCleanupAfterMerge?: boolean
        agentOutputLanguage?: AgentOutputLanguage
        autoRunEnabled?: boolean
        automationLaneLimits?: AutomationLaneLimits
        improvementsEnabled?: boolean
        improvementsMaxPendingTasks?: number
    }) => Promise<string | null>
    isPending: boolean
    error: string | null
}

export function CreateProjectDialog(props: CreateProjectDialogProps) {
    const { t } = useTranslation()
    const [machineId, setMachineId] = useState<string>('')
    const [name, setName] = useState('')
    const [description, setDescription] = useState('')
    const [workspacePath, setWorkspacePath] = useState('')
    const [workspaceLabel, setWorkspaceLabel] = useState('')
    const [workspaces, setWorkspaces] = useState<Array<{ path: string; label?: string }>>([])
    const [defaultSessionType, setDefaultSessionType] = useState<'simple' | 'worktree'>('simple')
    const [worktreeTargetBranch, setWorktreeTargetBranch] = useState('')
    const [worktreeAutoCommitMode, setWorktreeAutoCommitMode] = useState<'off' | 'per_conversation'>('off')
    const [worktreeCleanupAfterMerge, setWorktreeCleanupAfterMerge] = useState(false)
    const [agentOutputLanguage, setAgentOutputLanguage] = useState<AgentOutputLanguage>('system')
    const [autoRunEnabled, setAutoRunEnabled] = useState(false)
    const [automationLaneLimits, setAutomationLaneLimits] = useState<Record<AutomationLaneKey, number>>({
        ...DEFAULT_AUTOMATION_LANE_LIMITS
    })
    const [improvementsEnabled, setImprovementsEnabled] = useState(false)
    const [improvementsMaxPendingTasks, setImprovementsMaxPendingTasks] = useState(5)

    const machineOptions = useMemo(() => {
        if (props.isMachinesLoading) {
            return [{ value: '', label: t('loading.machines'), disabled: true }]
        }
        if (props.machines.length === 0) {
            return [{ value: '', label: t('misc.noMachines'), disabled: true }]
        }
        return props.machines.map((machine) => ({
            value: machine.id,
            label: `${getMachineDisplayTitle(machine)}${machine.metadata?.platform ? ` (${machine.metadata.platform})` : ''}`,
        }))
    }, [props.isMachinesLoading, props.machines, t])

    const agentOutputLanguageOptions = useMemo(() => getAgentOutputLanguageOptions(t), [t])

    useEffect(() => {
        if (!props.isOpen) return
        if (machineId) return
        const firstMachineId = props.machines[0]?.id
        if (firstMachineId) {
            setMachineId(firstMachineId)
        }
    }, [props.isOpen, props.machines, machineId])

    useEffect(() => {
        if (!props.isOpen) return
        setWorkspacePath('')
    }, [machineId, props.isOpen])

    const canSubmit = Boolean(machineId && name.trim() && workspaces.length > 0 && !props.isPending)

    const setAutomationLaneLimit = (lane: AutomationLaneKey, value: number) => {
        setAutomationLaneLimits((previous) => ({
            ...previous,
            [lane]: clampLaneLimit(value)
        }))
    }

    const handleSubmit = async () => {
        if (!canSubmit) return
        const normalizedTargetBranch = worktreeTargetBranch.trim()
        const createdId = await props.onCreate({
            machineId,
            name: name.trim(),
            description: description.trim() ? description.trim() : undefined,
            workspaces,
            defaultSessionType,
            worktreeTargetBranch: defaultSessionType === 'worktree' && normalizedTargetBranch ? normalizedTargetBranch : undefined,
            worktreeAutoCommitMode: defaultSessionType === 'worktree' ? worktreeAutoCommitMode : undefined,
            worktreeCleanupAfterMerge: defaultSessionType === 'worktree' ? worktreeCleanupAfterMerge : undefined,
            agentOutputLanguage,
            autoRunEnabled,
            automationLaneLimits,
            improvementsEnabled,
            improvementsMaxPendingTasks,
        })

        if (createdId) {
            setName('')
            setDescription('')
            setWorkspacePath('')
            setWorkspaceLabel('')
            setWorkspaces([])
            setDefaultSessionType('simple')
            setWorktreeTargetBranch('')
            setWorktreeAutoCommitMode('off')
            setWorktreeCleanupAfterMerge(false)
            setAgentOutputLanguage('system')
            setAutoRunEnabled(false)
            setAutomationLaneLimits({ ...DEFAULT_AUTOMATION_LANE_LIMITS })
            setImprovementsEnabled(false)
            setImprovementsMaxPendingTasks(5)
            props.onClose()
        }
    }

    const handleAddWorkspace = () => {
        const path = workspacePath.trim()
        if (!path) return
        if (workspaces.some((workspace) => workspace.path === path)) return

        setWorkspaces((previous) => [...previous, {
            path,
            label: workspaceLabel.trim() ? workspaceLabel.trim() : undefined,
        }])
        setWorkspacePath('')
        setWorkspaceLabel('')
    }

    const handleRemoveWorkspace = (path: string) => {
        setWorkspaces((previous) => previous.filter((workspace) => workspace.path !== path))
    }

    return (
        <Dialog open={props.isOpen} onOpenChange={(open) => {
            if (!open) {
                props.onClose()
            }
        }}>
            <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{t('projects.create.title')}</DialogTitle>
                    <DialogDescription>{t('projects.create.description')}</DialogDescription>
                </DialogHeader>

                <div className="mt-4 space-y-3">
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('misc.machine')}
                        </label>
                        <AdaptiveSelectField
                            title={t('misc.machine')}
                            value={machineId}
                            options={machineOptions}
                            onValueChange={setMachineId}
                            disabled={props.isPending || props.isMachinesLoading || props.machines.length === 0}
                            align="start"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.fields.name')}
                        </label>
                        <input
                            type="text"
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            disabled={props.isPending}
                            className="w-full rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.fields.description')}
                        </label>
                        <textarea
                            value={description}
                            onChange={(event) => setDescription(event.target.value)}
                            disabled={props.isPending}
                            rows={4}
                            className="w-full resize-none rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.agentOutputLanguage.title')}
                        </label>
                        <AdaptiveSelectField
                            title={t('projects.agentOutputLanguage.title')}
                            value={agentOutputLanguage}
                            options={agentOutputLanguageOptions}
                            onValueChange={(value) => setAgentOutputLanguage(value as AgentOutputLanguage)}
                            disabled={props.isPending}
                            align="start"
                        />
                        <div className="text-xs text-[var(--app-hint)]">{t('projects.agentOutputLanguage.hint')}</div>
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.workspaces.fields.path')}
                        </label>
                        <input
                            type="text"
                            value={workspacePath}
                            onChange={(event) => setWorkspacePath(event.target.value)}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    event.preventDefault()
                                    handleAddWorkspace()
                                }
                            }}
                            disabled={props.isPending || !machineId}
                            placeholder={t('projects.workspaces.picker.emptySelection')}
                            aria-label={t('projects.workspaces.fields.path')}
                            spellCheck={false}
                            className="w-full rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                        />
                        {machineId ? (
                            <MachineDirectoryPicker
                                key={machineId}
                                api={props.api}
                                machineId={machineId}
                                selectedPath={workspacePath}
                                onSelect={setWorkspacePath}
                            />
                        ) : (
                            <div className="rounded-md app-shadow-border px-3 py-4 text-xs text-[var(--app-hint)]">
                                {t('projects.workspaces.picker.selectMachine')}
                            </div>
                        )}
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--app-hint)]">
                            {t('projects.workspaces.fields.label')}
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={workspaceLabel}
                                onChange={(event) => setWorkspaceLabel(event.target.value)}
                                disabled={props.isPending}
                                className="w-full rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                placeholder={t('projects.workspaces.fields.labelPlaceholder')}
                            />
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={handleAddWorkspace}
                                disabled={props.isPending || !workspacePath.trim()}
                            >
                                {t('projects.workspaces.add.add')}
                            </Button>
                        </div>
                    </div>

                    {workspaces.length > 0 ? (
                        <div className="space-y-2">
                            <div className="text-xs font-medium text-[var(--app-hint)]">
                                {t('projects.workspaces.add.pending')}
                            </div>
                            <div className="flex flex-col gap-2">
                                {workspaces.map((workspace, index) => (
                                    <div
                                        key={workspace.path}
                                        className="flex items-start justify-between gap-3 rounded-md app-shadow-border bg-[var(--app-bg)] p-2"
                                    >
                                        <div className="min-w-0">
                                            <div className="text-xs font-medium truncate">
                                                {workspace.label ?? t('projects.workspaces.unnamed')}
                                                {index === 0 ? ` · ${t('projects.workspaces.default')}` : ''}
                                            </div>
                                            <div className="text-xs text-[var(--app-hint)] truncate" title={workspace.path}>
                                                {workspace.path}
                                            </div>
                                        </div>
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            onClick={() => handleRemoveWorkspace(workspace.path)}
                                            disabled={props.isPending}
                                        >
                                            {t('projects.workspaces.add.remove')}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="text-xs text-[var(--app-hint)]">
                            {t('projects.create.workspaceRequired')}
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="text-sm font-semibold">{t('projects.automation.title')}</div>

                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <Checkbox checked={autoRunEnabled} onCheckedChange={setAutoRunEnabled} disabled={props.isPending} />
                            {t('projects.automation.autoRun')}
                        </label>
                        <div className="space-y-1.5">
                            <div className="text-xs font-medium text-[var(--app-hint)]">{t('projects.automation.laneLimits')}</div>
                            <div className="grid grid-cols-2 gap-3">
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
                                            onChange={(event) => setAutomationLaneLimit(lane, Number(event.target.value))}
                                            disabled={props.isPending}
                                            className="w-full rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                                        />
                                    </div>
                                ))}
                            </div>
                            <div className="text-xs text-[var(--app-hint)]">{t('projects.automation.laneLimitsHint')}</div>
                        </div>

                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <Checkbox checked={improvementsEnabled} onCheckedChange={setImprovementsEnabled} disabled={props.isPending} />
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
                                    onChange={(event) => setImprovementsMaxPendingTasks(Number(event.target.value))}
                                    disabled={props.isPending}
                                    className="w-full rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
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
                                disabled={props.isPending}
                            />
                            {t('projects.worktree.enable')}
                        </label>

                        <div className="space-y-1.5">
                            <label className="text-xs font-medium text-[var(--app-hint)]">{t('projects.worktree.targetBranch')}</label>
                            <input
                                type="text"
                                value={worktreeTargetBranch}
                                onChange={(event) => setWorktreeTargetBranch(event.target.value)}
                                disabled={props.isPending || defaultSessionType !== 'worktree'}
                                placeholder={t('projects.worktree.targetBranchPlaceholder')}
                                className="w-full rounded-md app-shadow-border bg-[var(--app-bg)] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--app-link)] disabled:opacity-50"
                            />
                            <div className="text-xs text-[var(--app-hint)]">{t('projects.worktree.targetBranchHint')}</div>
                        </div>

                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <Checkbox
                                checked={worktreeAutoCommitMode === 'per_conversation'}
                                onCheckedChange={(enabled) => setWorktreeAutoCommitMode(enabled ? 'per_conversation' : 'off')}
                                disabled={props.isPending || defaultSessionType !== 'worktree'}
                            />
                            {t('projects.worktree.autoCommit')}
                        </label>
                        <div className="text-xs text-[var(--app-hint)]">{t('projects.worktree.autoCommitHint')}</div>

                        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                            <Checkbox
                                checked={worktreeCleanupAfterMerge}
                                onCheckedChange={setWorktreeCleanupAfterMerge}
                                disabled={props.isPending || defaultSessionType !== 'worktree'}
                            />
                            {t('projects.worktree.cleanup')}
                        </label>
                        <div className="text-xs text-[var(--app-hint)]">{t('projects.worktree.cleanupHint')}</div>
                    </div>

                    {props.error ? (
                        <div className="text-sm text-red-600">
                            {props.error}
                        </div>
                    ) : null}
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={props.onClose}
                        disabled={props.isPending}
                    >
                        {t('button.cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={handleSubmit}
                        disabled={!canSubmit}
                    >
                        {props.isPending ? t('projects.create.creating') : t('projects.create.create')}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
