import { describe, expect, it } from 'vitest'
import { buildAppEventSubscription } from './app-event-subscription'

describe('buildAppEventSubscription', () => {
    it('subscribes project pages to project-linked session updates', () => {
        expect(buildAppEventSubscription({
            pathname: '/projects/project-1/tasks/task-1',
            selectedProjectId: 'project-1',
            selectedSessionId: null
        })).toEqual({
            all: false,
            projectId: 'project-1',
            include: ['projects', 'workspaces', 'tasks', 'sessions', 'machines', 'toasts']
        })
    })
})
