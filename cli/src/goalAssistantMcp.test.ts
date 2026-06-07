import { describe, expect, it } from 'vitest'
import { parseGoalAssistantMcpArgs } from './goalAssistantMcp'

describe('parseGoalAssistantMcpArgs', () => {
    it('parses explicit project and goal ids', () => {
        expect(parseGoalAssistantMcpArgs([
            '--project-id',
            'project-1',
            '--goal-id',
            'goal-1'
        ])).toEqual({
            projectId: 'project-1',
            goalId: 'goal-1'
        })
    })

    it('parses inline flag syntax', () => {
        expect(parseGoalAssistantMcpArgs([
            '--project-id=project-1',
            '--goal-id=goal-1'
        ])).toEqual({
            projectId: 'project-1',
            goalId: 'goal-1'
        })
    })

    it('rejects missing required flags', () => {
        expect(() => parseGoalAssistantMcpArgs(['--project-id', 'project-1'])).toThrow('Missing --goal-id')
    })
})
