import { describe, expect, it } from 'vitest'
import { TASK_STATUS_ORDER } from '@hopi/protocol/tasks'
import { KANBAN_COLUMNS } from '@/lib/task-status'

describe('task status ordering', () => {
    it('keeps Finished before Blocked', () => {
        const statuses = KANBAN_COLUMNS.map((c) => c.status)

        expect(statuses).toEqual([...TASK_STATUS_ORDER])
        expect(statuses.indexOf('finished')).toBeGreaterThan(-1)
        expect(statuses.indexOf('blocked')).toBeGreaterThan(-1)
        expect(statuses.indexOf('finished')).toBeLessThan(statuses.indexOf('blocked'))
    })
})

