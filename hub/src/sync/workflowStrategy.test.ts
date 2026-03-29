import { describe, expect, it } from 'bun:test'
import {
    getDefaultWorkflowPhase,
    getWorkflowStrategy,
    listWorkflowStrategyDescriptors,
    registerWorkflowStrategy,
    type WorkflowStrategy
} from './workflowStrategy'

describe('workflowStrategy', () => {
    it('exposes built-in strategies and defaults', () => {
        const listed = listWorkflowStrategyDescriptors()
        expect(listed.some((strategy) => strategy.id === 'default')).toBe(true)
        expect(listed.some((strategy) => strategy.id === 'gsd')).toBe(true)
        expect(getDefaultWorkflowPhase({ workflowProfile: null })).toBeNull()
        expect(getDefaultWorkflowPhase({ workflowProfile: 'gsd' })).toBe('discuss')
    })

    it('applies built-in gsd behavior without skipping discuss/plan', () => {
        const strategy = getWorkflowStrategy({ workflowProfile: 'gsd' })
        expect(strategy.canAutoRunTask({ workflowPhase: 'execute_ready' })).toBe(true)
        expect(strategy.canAutoRunTask({ workflowPhase: 'discuss' })).toBe(false)
        expect(strategy.getTaskPatchForTransition('session_started', {
            status: 'planned',
            workflowPhase: 'discuss'
        })).toEqual({
            status: 'planned',
            workflowPhase: 'discuss'
        })
        expect(strategy.getTaskPatchForTransition('task_prompted', {
            status: 'planned',
            workflowPhase: 'discuss'
        })).toEqual({
            status: 'planned',
            workflowPhase: 'discuss'
        })
        expect(strategy.getTaskPatchForTransition('task_prompted', {
            status: 'planned',
            workflowPhase: 'execute_ready'
        })).toEqual({
            status: 'in_progress',
            workflowPhase: 'execute'
        })
        expect(strategy.getTaskPatchForTransition('assistant_ready', {
            status: 'in_progress',
            workflowPhase: 'execute'
        })).toEqual({
            status: 'in_review',
            workflowPhase: 'verify'
        })
        expect(strategy.getTaskPatchForTransition('assistant_ready', {
            status: 'planned',
            workflowPhase: 'plan'
        })).toEqual({
            status: 'planned',
            workflowPhase: 'plan'
        })
    })

    it('supports registering custom strategy profiles', () => {
        const id = `custom-${Date.now()}`
        const custom: WorkflowStrategy = {
            id,
            label: 'Custom',
            defaultTaskPhase: 'triage',
            phaseOptions: ['triage', 'ship'],
            canAutoRunTask(task) {
                return task.workflowPhase === 'ship'
            },
            getTaskPatchForTransition(transition) {
                if (transition === 'task_prompted') {
                    return { status: 'in_progress', workflowPhase: 'ship' }
                }
                return null
            }
        }

        registerWorkflowStrategy(custom)
        const strategy = getWorkflowStrategy({ workflowProfile: id.toUpperCase() })
        expect(strategy.id).toBe(id)
        expect(strategy.canAutoRunTask({ workflowPhase: 'ship' })).toBe(true)
        expect(getDefaultWorkflowPhase({ workflowProfile: id })).toBe('triage')
    })
})
