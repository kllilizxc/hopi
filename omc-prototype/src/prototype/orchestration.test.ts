import { describe, expect, it } from 'vitest'
import {
    createDecisionTopic,
    createInitialWorldModel,
    createWorkOrder,
    appendAgentEvent,
    type AgentEvent,
} from './orchestration'

describe('orchestration domain', () => {
    it('creates a world model with empty work orders and decision topics', () => {
        const world = createInitialWorldModel({
            focusGoalId: 'goal-portfolio-foundation',
        })

        expect(world.currentFocus.goalId).toBe('goal-portfolio-foundation')
        expect(world.workOrders).toEqual({})
        expect(world.decisionTopics).toEqual({})
        expect(world.agentEvents).toEqual([])
    })

    it('creates a work order in drafting state with a fresh loop counter', () => {
        const constraints = ['keep scope tight', 'avoid breaking changes']
        const order = createWorkOrder({
            id: 'wo-import-lane',
            goalId: 'goal-portfolio-foundation',
            streamId: 'stream-ingest-contracts',
            summary: 'Lock the first broker import contract and proof path.',
            constraints,
        })

        expect(order.state).toBe('drafting')
        expect(order.loop.round).toBe(0)
        expect(order.loop.reviewerVerdict).toBe(null)
        expect(order.constraints).toEqual(constraints)
        expect(order.constraints).not.toBe(constraints)

        constraints.push('mutated after creation')
        expect(order.constraints).toEqual(['keep scope tight', 'avoid breaking changes'])
    })

    it('creates a decision topic with pending lifecycle', () => {
        const topic = createDecisionTopic({
            id: 'topic-release-import',
            kind: 'approval',
            title: '要不要现在放行导入分支',
            goalId: 'goal-portfolio-foundation',
        })

        expect(topic.lifecycle).toBe('pending')
        expect(topic.messages).toEqual([])
    })

    it('appends agent events in order without mutating the original world model', () => {
        const world = createInitialWorldModel({
            focusGoalId: 'goal-portfolio-foundation',
        })
        const firstEvent: AgentEvent = {
            id: 'evt-1',
            kind: 'Observation',
            workOrderId: 'wo-import-lane',
            emittedBy: 'driver',
            createdAt: '2026-04-06T10:00:00.000Z',
            payload: {
                summary: 'Driver observed a missing import contract.',
            },
        }
        const secondEvent: AgentEvent = {
            id: 'evt-2',
            kind: 'ReviewerVerdict',
            workOrderId: 'wo-import-lane',
            emittedBy: 'reviewer',
            createdAt: '2026-04-06T10:00:00.000Z',
            payload: {
                verdict: 'revision_needed',
                summary: 'Proof is close but acceptance criteria are not fully covered.',
            },
        }

        const nextWorld = appendAgentEvent(world, firstEvent)
        const finalWorld = appendAgentEvent(nextWorld, secondEvent)
        const storedFirstEvent = nextWorld.agentEvents[0]
        firstEvent.payload.summary = 'Driver observed a changed contract after append.'

        expect(world.agentEvents).toEqual([])
        expect(storedFirstEvent).not.toBe(firstEvent)
        expect(storedFirstEvent.payload.summary).toBe('Driver observed a missing import contract.')
        expect(nextWorld.agentEvents).toEqual([storedFirstEvent])
        expect(finalWorld.agentEvents).toHaveLength(2)
        expect(finalWorld.agentEvents[0].payload.summary).toBe('Driver observed a missing import contract.')
        expect(finalWorld.agentEvents[1].payload.summary).toBe('Proof is close but acceptance criteria are not fully covered.')
        expect(finalWorld.agentEvents).not.toBe(world.agentEvents)
        expect(finalWorld).not.toBe(world)
    })
})
