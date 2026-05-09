import { DEFAULT_AGENT_FLAVOR, DEFAULT_TASK_MODEL, PERMISSION_MODES } from '@hopi/protocol'
import { productStorageNamespaceKey } from '@hopi/protocol/brand'
import type { AgentType } from '@/components/NewSession/types'
import { resolveTaskPermissionModeForFlavor } from '@/lib/taskPermissionMode'
import type { PermissionMode, TaskPriority } from '@/types/api'

export const NEW_TASK_DIALOG_STORAGE_KEY = productStorageNamespaceKey('newTaskDialog:lastOptions')

const DEFAULT_AGENT: AgentType = DEFAULT_AGENT_FLAVOR
const VALID_AGENTS: ReadonlySet<AgentType> = new Set(['claude', 'codex', 'gemini', 'opencode'])
const VALID_PRIORITIES: ReadonlySet<TaskPriority | ''> = new Set(['', 'high', 'medium', 'low'])
const VALID_PERMISSION_MODES: ReadonlySet<PermissionMode> = new Set(PERMISSION_MODES)

export type StoredNewTaskDialogOptions = {
    priority: TaskPriority | ''
    agent: AgentType
    model: string
    permissionMode: PermissionMode
    workflowProfile: string
}

type LoadStoredNewTaskDialogOptionsResult = {
    hasStoredOptions: boolean
    options: Partial<StoredNewTaskDialogOptions>
}

type ResolveNewTaskDialogOptionsInput = {
    defaultAgent: AgentType
    defaultPermissionMode: PermissionMode | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function normalizeWorkflowProfile(value: string | undefined): string {
    return (value ?? 'default').trim() || 'default'
}

export function loadStoredNewTaskDialogOptions(): LoadStoredNewTaskDialogOptionsResult {
    const empty = { hasStoredOptions: false, options: {} } as const

    try {
        const raw = localStorage.getItem(NEW_TASK_DIALOG_STORAGE_KEY)
        if (raw === null) {
            return empty
        }

        let parsed: unknown
        try {
            parsed = JSON.parse(raw)
        } catch {
            return { hasStoredOptions: true, options: {} }
        }

        if (!isRecord(parsed)) {
            return { hasStoredOptions: true, options: {} }
        }

        const options: Partial<StoredNewTaskDialogOptions> = {}

        if (typeof parsed.agent === 'string' && VALID_AGENTS.has(parsed.agent as AgentType)) {
            options.agent = parsed.agent as AgentType
        }
        if (typeof parsed.priority === 'string' && VALID_PRIORITIES.has(parsed.priority as TaskPriority | '')) {
            options.priority = parsed.priority as TaskPriority | ''
        }
        if (typeof parsed.model === 'string') {
            options.model = parsed.model
        }
        if (typeof parsed.permissionMode === 'string' && VALID_PERMISSION_MODES.has(parsed.permissionMode as PermissionMode)) {
            options.permissionMode = parsed.permissionMode as PermissionMode
        }
        if (typeof parsed.workflowProfile === 'string') {
            options.workflowProfile = parsed.workflowProfile
        }

        return { hasStoredOptions: true, options }
    } catch {
        return empty
    }
}

export function saveStoredNewTaskDialogOptions(options: StoredNewTaskDialogOptions): void {
    try {
        localStorage.setItem(NEW_TASK_DIALOG_STORAGE_KEY, JSON.stringify(options))
    } catch {
        // Ignore storage errors
    }
}

export function resolveNewTaskDialogOptions(input: ResolveNewTaskDialogOptionsInput): StoredNewTaskDialogOptions {
    const { hasStoredOptions, options: storedOptions } = loadStoredNewTaskDialogOptions()
    const defaultPermissionPreference = hasStoredOptions ? null : input.defaultPermissionMode
    const agent = storedOptions.agent ?? (hasStoredOptions ? DEFAULT_AGENT : input.defaultAgent)
    const model = storedOptions.model ?? (agent === DEFAULT_AGENT_FLAVOR ? DEFAULT_TASK_MODEL : 'auto')

    return {
        priority: storedOptions.priority ?? '',
        agent,
        model,
        permissionMode: storedOptions.permissionMode ?? resolveTaskPermissionModeForFlavor(agent, defaultPermissionPreference),
        workflowProfile: normalizeWorkflowProfile(storedOptions.workflowProfile),
    }
}
