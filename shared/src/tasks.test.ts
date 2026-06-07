import { describe, expect, it } from 'bun:test'
import { TaskStatusSchema } from './schemas'
import { LEGACY_TASK_STATUS_ORDER, TASK_STATUS_ORDER, TASK_STATUS_VALUES } from './tasks'

describe('task status vocabulary', () => {
    it('uses canonical Goal board statuses as the primary task status order', () => {
        expect(TASK_STATUS_ORDER).toEqual(['planned', 'in_progress', 'in_review', 'merging', 'done'])
    })

    it('keeps legacy DB/runtime aliases only as compatibility values', () => {
        expect(LEGACY_TASK_STATUS_ORDER).toEqual(['planning', 'running', 'review', 'blocked', 'finished'])
        expect(TASK_STATUS_VALUES).toEqual([
            'planned',
            'in_progress',
            'in_review',
            'merging',
            'done',
            'planning',
            'running',
            'review',
            'blocked',
            'finished'
        ])
    })

    it('accepts both canonical and legacy task statuses during migration', () => {
        expect(TaskStatusSchema.parse('planned')).toBe('planned')
        expect(TaskStatusSchema.parse('merging')).toBe('merging')
        expect(TaskStatusSchema.parse('blocked')).toBe('blocked')
        expect(TaskStatusSchema.parse('running')).toBe('running')
    })
})
