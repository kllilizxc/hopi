import { describe, expect, it } from 'vitest'
import { buildPlanTraceInspection } from './planTrace'
import { createSeededWorldModel, getPrototypeSnapshot } from './scenario'

describe('buildPlanTraceInspection', () => {
    it('prefers exact planId matches over inferred stream/phase matches', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const world = createSeededWorldModel('approval')
        const card = snapshot.planCards.find((item) => item.id === 'plan-approval-1')!

        for (const order of Object.values(world.workOrders)) {
            if (
                order.goalId === card.goalId
                && order.streamId === card.streamId
                && order.phaseId === card.phaseId
            ) {
                order.planId = null
            }
        }

        world.workOrders['inferred-order'] = {
            ...world.workOrders['work-order:approval-branch-ingest'],
            id: 'inferred-order',
            planId: null,
            streamId: card.streamId,
            phaseId: card.phaseId,
        }
        world.workOrders['exact-order'] = {
            ...world.workOrders['work-order:approval-branch-ingest'],
            id: 'exact-order',
            planId: card.id,
            streamId: card.streamId,
            phaseId: card.phaseId,
        }

        const inspection = buildPlanTraceInspection({
            planCard: card,
            worldModel: world,
            decisionTopics: world.decisionTopics,
        })

        expect(inspection.mappingConfidence).toBe('exact')
        expect(inspection.match.kind).toBe('exact')
        expect(inspection.workOrder?.id).toBe('exact-order')
    })

    it('selects an inferred match when no exact match exists', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const world = createSeededWorldModel('approval')
        const card = snapshot.planCards.find((item) => item.id === 'plan-approval-1')!
        const exactCandidate = world.workOrders['work-order:approval-branch-ingest']

        for (const order of Object.values(world.workOrders)) {
            if (order.planId === card.id) {
                order.planId = null
            }
        }

        exactCandidate.state = 'drafting'
        exactCandidate.waitingOnTopicId = null
        world.agentEvents = world.agentEvents.filter((event) => event.workOrderId !== exactCandidate.id)

        world.workOrders['inferred-order'] = {
            ...exactCandidate,
            id: 'inferred-order',
            planId: null,
            streamId: card.streamId,
            phaseId: card.phaseId,
            state: 'waiting_user',
            waitingOnTopicId: 'approval:inferred-order',
        }
        world.agentEvents.push({
            id: 'evt-inferred-order',
            kind: 'Observation',
            workOrderId: 'inferred-order',
            emittedBy: 'driver',
            createdAt: 'Day 1 · 18:32',
            payload: {
                summary: 'Inferred candidate carries the same stream and phase trail.',
            },
        })

        const inspection = buildPlanTraceInspection({
            planCard: card,
            worldModel: world,
            decisionTopics: world.decisionTopics,
        })

        expect(inspection.mappingConfidence).toBe('inferred')
        expect(inspection.match.kind).toBe('inferred')
        expect(inspection.workOrder?.id).toBe('inferred-order')
    })

    it('falls back to planning-only mode when no runtime match exists', () => {
        const snapshot = getPrototypeSnapshot('strategy')
        const world = createSeededWorldModel('strategy')
        const card = snapshot.planCards.find((item) => item.id === 'plan-strategy-3')!

        world.workOrders = {}

        const inspection = buildPlanTraceInspection({
            planCard: card,
            worldModel: world,
            decisionTopics: world.decisionTopics,
        })

        expect(inspection.mappingConfidence).toBe('none')
        expect(inspection.match.kind).toBe('none')
        expect(inspection.events).toEqual([])
        expect(inspection.emptyState?.title).toBe('这张卡还没有运行态输出，当前只有计划信息。')
    })

    it('seeds approval batch work orders with explicit stream, phase, and plan bindings', () => {
        const strategyWorld = createSeededWorldModel('strategy')
        expect(strategyWorld.workOrders['work-order:approval-direction-weekly-brief']).toMatchObject({
            streamId: 'stream-weekly-brief-outline',
            phaseId: 'phase-brief-1',
            planId: 'plan-strategy-3',
        })

        const approvalWorld = createSeededWorldModel('approval')
        expect(approvalWorld.workOrders['work-order:approval-branch-ingest']).toMatchObject({
            streamId: 'stream-ingest-contracts',
            phaseId: 'phase-ingest-3',
            planId: 'plan-approval-1',
        })
        expect(approvalWorld.workOrders['work-order:approval-scope-brief']).toMatchObject({
            streamId: 'stream-weekly-brief-outline',
            phaseId: 'phase-brief-2',
            planId: 'plan-approval-3',
        })

        const executionWorld = createSeededWorldModel('execution')
        expect(executionWorld.workOrders['work-order:approval-branch-ingest']).toMatchObject({
            streamId: 'stream-holdings-normalization',
            phaseId: 'phase-ingest-2',
            planId: 'plan-execution-3',
        })
        expect(executionWorld.workOrders['work-order:approval-direction-brief-replan']).toMatchObject({
            streamId: 'stream-weekly-brief-outline',
            phaseId: 'phase-brief-2',
            planId: 'plan-execution-5',
        })
    })

    it('groups related events, manager decisions, and linked decision topics for the matched work order', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const world = createSeededWorldModel('approval')
        const card = snapshot.planCards.find((item) => item.id === 'plan-approval-1')!
        const matchedWorkOrder = world.workOrders['work-order:approval-branch-ingest']

        world.decisionTopics['topic:approval-linked'] = {
            id: 'topic:approval-linked',
            kind: 'approval',
            title: 'Promote ingest proof branch',
            goalId: card.goalId,
            workOrderId: matchedWorkOrder.id,
            lifecycle: 'pending',
            unread: true,
            messages: ['Awaiting the batch decision.'],
        }
        world.decisionTopics['topic:goal-only'] = {
            id: 'topic:goal-only',
            kind: 'status',
            title: 'Goal-level context only',
            goalId: card.goalId,
            workOrderId: null,
            lifecycle: 'pending',
            unread: false,
            messages: ['This should not be linked to the raw trace.'],
        }
        world.agentEvents.push({
            id: 'evt-approval-branch-manager',
            kind: 'ManagerDecision',
            workOrderId: matchedWorkOrder.id,
            emittedBy: 'manager',
            createdAt: 'Day 1 · 18:32',
            payload: {
                decision: 'replan',
                summary: 'Shift the branch into replanning after the batch review.',
            },
        })

        const inspection = buildPlanTraceInspection({
            planCard: card,
            worldModel: world,
            decisionTopics: world.decisionTopics,
        })

        expect(inspection.mappingConfidence).toBe('exact')
        expect(inspection.match.kind).toBe('exact')
        expect(inspection.events.length).toBeGreaterThan(0)
        expect(inspection.stateTransitions).toEqual([
            'queued -> executing',
            'reviewer_check -> waiting_user',
            'waiting_user -> replanning_needed',
        ])
        expect(inspection.linkedTopics).toHaveLength(1)
        expect(inspection.linkedTopics[0]?.workOrderId).toBe(matchedWorkOrder.id)
    })

    it('orders events by timestamp and id tie-breaker', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const world = createSeededWorldModel('approval')
        const card = snapshot.planCards.find((item) => item.id === 'plan-approval-1')!
        const matchedWorkOrder = world.workOrders['work-order:approval-branch-ingest']

        world.agentEvents.push(
            {
                id: 'evt-tie-a',
                kind: 'Observation',
                workOrderId: matchedWorkOrder.id,
                emittedBy: 'driver',
                createdAt: 'Day 1 · 18:32',
                payload: {
                    summary: 'Tie A.',
                },
            },
            {
                id: 'evt-tie-z',
                kind: 'Proposal',
                workOrderId: matchedWorkOrder.id,
                emittedBy: 'driver',
                createdAt: 'Day 1 · 18:32',
                payload: {
                    summary: 'Tie Z.',
                },
            },
        )

        const inspection = buildPlanTraceInspection({
            planCard: card,
            worldModel: world,
            decisionTopics: world.decisionTopics,
        })

        expect(inspection.events.slice(0, 2).map((event) => event.id)).toEqual(['evt-tie-z', 'evt-tie-a'])
    })

    it('sorts linked decision topics deterministically', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const world = createSeededWorldModel('approval')
        const card = snapshot.planCards.find((item) => item.id === 'plan-approval-1')!
        const matchedWorkOrder = world.workOrders['work-order:approval-branch-ingest']

        world.decisionTopics['topic:gamma'] = {
            id: 'topic:gamma',
            kind: 'direction',
            title: 'Gamma',
            goalId: card.goalId,
            workOrderId: matchedWorkOrder.id,
            lifecycle: 'pending',
            unread: true,
            messages: [],
        }
        world.decisionTopics['topic:beta'] = {
            id: 'topic:beta',
            kind: 'approval',
            title: 'Beta',
            goalId: card.goalId,
            workOrderId: matchedWorkOrder.id,
            lifecycle: 'waiting',
            unread: false,
            messages: [],
        }
        world.decisionTopics['topic:alpha'] = {
            id: 'topic:alpha',
            kind: 'approval',
            title: 'Alpha',
            goalId: card.goalId,
            workOrderId: matchedWorkOrder.id,
            lifecycle: 'in-progress',
            unread: false,
            messages: [],
        }

        const inspection = buildPlanTraceInspection({
            planCard: card,
            worldModel: world,
            decisionTopics: world.decisionTopics,
        })

        expect(inspection.linkedTopics.map((topic) => topic.id)).toEqual([
            'topic:alpha',
            'topic:beta',
            'topic:gamma',
        ])
    })

    it('shows an empty runtime state when a matched work order has no events', () => {
        const snapshot = getPrototypeSnapshot('execution')
        const world = createSeededWorldModel('execution')
        const card = snapshot.planCards.find((item) => item.id === 'plan-execution-2')!

        world.agentEvents = []

        const inspection = buildPlanTraceInspection({
            planCard: card,
            worldModel: world,
            decisionTopics: world.decisionTopics,
        })

        expect(inspection.mappingConfidence).toBe('exact')
        expect(inspection.match.kind).toBe('exact')
        expect(inspection.events).toEqual([])
        expect(inspection.emptyState?.title).toBe('这张卡已经进入运行态，但还没有记录到原始事件。')
    })
})
