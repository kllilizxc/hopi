import { describe, expect, it } from 'bun:test'
import { MetadataSchema } from './schemas'
import {
    GOAL_ASSISTANT_SYSTEM_PROMPT,
    GoalAssistantResolveDecisionTopicBodySchema,
    GoalAssistantRequestTaskLaneBodySchema,
    GoalAssistantResumeGoalAutomationResponseSchema,
    GoalAssistantSessionProfileSchema,
    GoalAssistantLegacyRequestTaskLaneBodySchema,
    normalizeGoalAssistantTaskLane
} from './goalAssistant'

describe('goal assistant schemas', () => {
    it('accepts valid lane requests', () => {
        const parsed = GoalAssistantRequestTaskLaneBodySchema.parse({
            taskId: 'task-1',
            lane: 'merging',
            message: 'Retry merge after base branch advanced.'
        })

        expect(parsed.lane).toBe('merging')
    })

    it('does not expose in_progress as a canonical assistant lane', () => {
        expect(() => GoalAssistantRequestTaskLaneBodySchema.parse({
            taskId: 'task-1',
            lane: 'in_progress',
            message: 'Continue this task.'
        })).toThrow()
    })

    it('normalizes legacy in_progress requests to planned', () => {
        const parsed = GoalAssistantLegacyRequestTaskLaneBodySchema.parse({
            taskId: 'task-1',
            lane: 'in_progress',
            message: 'Continue this task.'
        })

        expect(normalizeGoalAssistantTaskLane(parsed.lane)).toBe('planned')
    })

    it('accepts goal assistant session profiles', () => {
        const parsed = GoalAssistantSessionProfileSchema.parse({
            kind: 'goal_assistant',
            projectId: 'project-1',
            goalId: 'goal-1'
        })

        expect(parsed.kind).toBe('goal_assistant')
    })

    it('accepts decision topic resolutions', () => {
        const parsed = GoalAssistantResolveDecisionTopicBodySchema.parse({
            topicId: 'topic-1',
            resolution: 'Use the Master Duel style hand fan preview.'
        })

        expect(parsed.topicId).toBe('topic-1')
    })

    it('models resumed goal automation as no longer paused', () => {
        const parsed = GoalAssistantResumeGoalAutomationResponseSchema.parse({
            ok: true,
            goalId: 'goal-1',
            goalStatus: 'active',
            goalAutomationPaused: false
        })

        expect(parsed.goalAutomationPaused).toBe(false)
    })

    it('preserves goal assistant tooling version in session metadata', () => {
        const parsed = MetadataSchema.parse({
            path: '/tmp/project',
            host: 'test',
            hopiController: true,
            goalAssistantToolingVersion: 6
        })

        expect(parsed.goalAssistantToolingVersion).toBe(6)
    })

    it('instructs the assistant to classify by workflow intent instead of keywords', () => {
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('Goal-scoped Kanban operator assistant for the user, not a coding agent.')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('Act like the user\'s butler for this Goal: questions about board state and instructions about board operations should come through you.')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('Infer tool choice from workflow effect, not exact keywords.')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('For Kanban questions or Kanban instructions, treat read_goal_snapshot() as the workflow source of truth before relying on repo inspection.')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('Existing work that should retry, resume, continue, or requeue normally maps to request_task_lane(taskId, "planned", message).')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('Do not request an in_progress lane.')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('When the user answers an existing waiting DecisionTopic, prefer resolve_decision_topic(topicId, resolution).')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('When the user wants paused automation running again, prefer resume_goal_automation().')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('New work, scope expansion, replanning, future follow-up, or task-graph changes normally map to request_planning(...).')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('A concrete repo problem report such as a build failure, test failure, runtime stack trace, broken behavior report, or code regression is usually operational, not just informational.')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('If the user pasted a concrete error log or failure report and did not explicitly ask for explanation only, do not stop at diagnosis alone. Use the appropriate operator tool when available.')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('Do not bounce Kanban instructions back to the user when a typed operator tool can carry them out safely.')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('If resolve_decision_topic(...) succeeds, describe it as a resolved DecisionTopic.')
        expect(GOAL_ASSISTANT_SYSTEM_PROMPT).toContain('If request_task_lane(...) succeeds, describe it as a queued or requested lane change.')
    })
})
