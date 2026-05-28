import { describe, expect, it } from 'vitest'
import { createDecisionTopic, createInitialWorldModel, createWorkOrder } from './orchestration'
import { countActionableTopics, sortTopicsForInbox } from './threadSelectors'
import { deriveDecisionTopics } from './decisionTopics'

describe('decision topic derivation', () => {
    it('opens a new topic for work orders waiting on user input', () => {
        const world = createInitialWorldModel({
            focusGoalId: 'goal-portfolio-foundation',
        })
        const order = createWorkOrder({
            id: 'wo-import-lane',
            goalId: 'goal-portfolio-foundation',
            summary: 'Lock the first broker import contract and proof path.',
        })

        world.workOrders[order.id] = {
            ...order,
            state: 'waiting_user',
            waitingOnTopicId: 'topic-import-decision',
        }

        const nextTopics = deriveDecisionTopics({
            world,
            previousTopics: {},
        })

        expect(nextTopics['topic-import-decision']).toEqual({
            id: 'topic-import-decision',
            kind: 'approval',
            title: '需要你的决定',
            goalId: 'goal-portfolio-foundation',
            workOrderId: 'wo-import-lane',
            lifecycle: 'pending',
            unread: true,
            messages: [],
        })
    })

    it('keeps informational topics passive while intervention topics stay active', () => {
        const world = createInitialWorldModel({
            focusGoalId: 'goal-portfolio-foundation',
        })
        const previousTopics = {
            'topic-status': createDecisionTopic({
                id: 'topic-status',
                kind: 'status',
                title: '当前主线',
                goalId: 'goal-portfolio-foundation',
            }),
            'topic-approval': createDecisionTopic({
                id: 'topic-approval',
                kind: 'approval',
                title: '需要你的决定',
                goalId: 'goal-portfolio-foundation',
            }),
        }

        previousTopics['topic-approval'].lifecycle = 'waiting'

        const nextTopics = deriveDecisionTopics({
            world,
            previousTopics,
        })
        const sortedTopics = sortTopicsForInbox(Object.values(nextTopics))

        expect(nextTopics['topic-status'].lifecycle).toBe('in-progress')
        expect(sortedTopics[0]?.id).toBe('topic-approval')
        expect(sortedTopics[1]?.id).toBe('topic-status')
        expect(countActionableTopics(Object.values(nextTopics))).toBe(1)
    })

    it('rebinds an existing waiting topic back to the work order source of truth', () => {
        const world = createInitialWorldModel({
            focusGoalId: 'goal-portfolio-foundation',
        })
        const order = createWorkOrder({
            id: 'wo-import-lane',
            goalId: 'goal-portfolio-foundation',
            summary: 'Lock the first broker import contract and proof path.',
        })
        const previousTopic = createDecisionTopic({
            id: 'topic-import-decision',
            kind: 'approval',
            title: '旧标题',
            goalId: 'goal-legacy',
            workOrderId: 'wo-legacy',
        })

        previousTopic.lifecycle = 'resolved'
        previousTopic.unread = false
        previousTopic.messages.push('stale note')

        world.workOrders[order.id] = {
            ...order,
            goalId: 'goal-portfolio-foundation',
            state: 'waiting_user',
            waitingOnTopicId: 'topic-import-decision',
        }

        const nextTopics = deriveDecisionTopics({
            world,
            previousTopics: {
                [previousTopic.id]: previousTopic,
            },
        })

        expect(nextTopics['topic-import-decision']).toEqual({
            id: 'topic-import-decision',
            kind: 'approval',
            title: '旧标题',
            goalId: 'goal-portfolio-foundation',
            workOrderId: 'wo-import-lane',
            lifecycle: 'pending',
            unread: false,
            messages: ['stale note'],
        })
        expect(previousTopic.goalId).toBe('goal-legacy')
        expect(previousTopic.workOrderId).toBe('wo-legacy')
        expect(previousTopic.lifecycle).toBe('resolved')
    })
})
