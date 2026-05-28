import type { TaskStatus, TaskWorkflowPhase } from '@hopi/protocol/types'
import type { StoredTask } from '../store'

export type WorkflowTransition = 'session_started' | 'task_prompted' | 'assistant_ready' | 'thinking_resumed' | 'task_finished'

export type WorkflowTaskPatch = {
    status?: TaskStatus
    workflowPhase?: TaskWorkflowPhase | null
}

export type WorkflowStrategyDescriptor = {
    id: string
    label: string
    defaultTaskPhase: TaskWorkflowPhase | null
    phaseOptions: TaskWorkflowPhase[]
}

export type WorkflowStrategy = WorkflowStrategyDescriptor & {
    canAutoRunTask: (task: Pick<StoredTask, 'workflowPhase'>) => boolean
    getTaskPatchForTransition: (
        transition: WorkflowTransition,
        task: Pick<StoredTask, 'status' | 'workflowPhase'>
    ) => WorkflowTaskPatch | null
}

type WorkflowProfileSource = Pick<StoredTask, 'workflowProfile'> | { workflowProfile?: string | null }

const strategyRegistry = new Map<string, WorkflowStrategy>()

function normalizeProfile(value: string | null | undefined): string {
    const normalized = value?.trim().toLowerCase()
    return normalized && normalized.length > 0 ? normalized : 'default'
}

function setBuiltInStrategy(strategy: WorkflowStrategy): void {
    strategyRegistry.set(normalizeProfile(strategy.id), strategy)
}

const defaultStrategy: WorkflowStrategy = {
    id: 'default',
    label: 'Default',
    defaultTaskPhase: null,
    phaseOptions: [],
    canAutoRunTask: () => true,
    getTaskPatchForTransition(transition) {
        if (transition === 'task_finished') {
            return null
        }
        if (transition === 'assistant_ready') {
            return { status: 'review' }
        }
        if (transition === 'session_started' || transition === 'task_prompted' || transition === 'thinking_resumed') {
            return { status: 'running' }
        }
        return null
    }
}

function preserveGsdTaskPatch(task: Pick<StoredTask, 'status' | 'workflowPhase'>): WorkflowTaskPatch {
    return {
        status: task.status as TaskStatus,
        workflowPhase: task.workflowPhase ?? null
    }
}

function getGsdPromptPatch(task: Pick<StoredTask, 'status' | 'workflowPhase'>): WorkflowTaskPatch {
    if (task.workflowPhase === 'execute_ready' || task.workflowPhase === 'execute' || task.workflowPhase === 'verify') {
        return {
            status: 'running',
            workflowPhase: 'execute'
        }
    }
    return preserveGsdTaskPatch(task)
}

function getGsdReadyPatch(task: Pick<StoredTask, 'status' | 'workflowPhase'>): WorkflowTaskPatch {
    if (task.workflowPhase === 'execute') {
        return {
            status: 'review',
            workflowPhase: 'verify'
        }
    }
    return preserveGsdTaskPatch(task)
}

const gsdStrategy: WorkflowStrategy = {
    id: 'gsd',
    label: 'GSD',
    defaultTaskPhase: 'discuss',
    phaseOptions: ['discuss', 'plan', 'execute_ready', 'execute', 'verify', 'done'],
    canAutoRunTask(task) {
        return task.workflowPhase === 'execute_ready'
    },
    getTaskPatchForTransition(transition, task) {
        if (transition === 'task_finished') {
            return {
                workflowPhase: 'done'
            }
        }

        if (transition === 'assistant_ready') {
            return getGsdReadyPatch(task)
        }

        if (transition === 'task_prompted' || transition === 'thinking_resumed') {
            return getGsdPromptPatch(task)
        }

        if (transition === 'session_started') {
            return preserveGsdTaskPatch(task)
        }

        return null
    }
}

setBuiltInStrategy(defaultStrategy)
setBuiltInStrategy(gsdStrategy)

export function registerWorkflowStrategy(strategy: WorkflowStrategy): void {
    const key = normalizeProfile(strategy.id)
    if (key === 'default') {
        throw new Error('Cannot override built-in default workflow strategy')
    }
    strategyRegistry.set(key, {
        ...strategy,
        id: key
    })
}

export function listWorkflowStrategyDescriptors(): WorkflowStrategyDescriptor[] {
    return Array.from(strategyRegistry.values())
        .map((strategy) => ({
            id: strategy.id,
            label: strategy.label,
            defaultTaskPhase: strategy.defaultTaskPhase,
            phaseOptions: [...strategy.phaseOptions]
        }))
        .sort((left, right) => {
            if (left.id === 'default') return -1
            if (right.id === 'default') return 1
            return left.id.localeCompare(right.id)
        })
}

export function getWorkflowStrategy(source: WorkflowProfileSource): WorkflowStrategy {
    const profile = normalizeProfile(source.workflowProfile)
    return strategyRegistry.get(profile) ?? defaultStrategy
}

export function getDefaultWorkflowPhase(source: WorkflowProfileSource): TaskWorkflowPhase | null {
    return getWorkflowStrategy(source).defaultTaskPhase
}

export function getWorkflowPhaseOptions(source: WorkflowProfileSource): TaskWorkflowPhase[] {
    return [...getWorkflowStrategy(source).phaseOptions]
}
