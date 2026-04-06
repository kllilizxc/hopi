import { createDecisionTopic } from './orchestration'
import type { DecisionTopic, WorldModel } from './types'

function cloneDecisionTopic(topic: DecisionTopic): DecisionTopic {
    return {
        ...topic,
        messages: [...topic.messages],
    }
}

function normalizeDecisionTopic(topic: DecisionTopic): DecisionTopic {
    const nextTopic = cloneDecisionTopic(topic)
    if (nextTopic.kind === 'status' && nextTopic.lifecycle === 'pending') {
        nextTopic.lifecycle = 'in-progress'
    }
    return nextTopic
}

function mergeDecisionTopicFromWorkOrder(topic: DecisionTopic, workOrder: WorldModel['workOrders'][string]): DecisionTopic {
    const nextTopic = normalizeDecisionTopic(topic)
    nextTopic.goalId = workOrder.goalId
    nextTopic.workOrderId = workOrder.id

    if (nextTopic.lifecycle === 'silent' || nextTopic.lifecycle === 'resolved') {
        nextTopic.lifecycle = 'pending'
    }

    return nextTopic
}

export function deriveDecisionTopics(params: {
    world: WorldModel
    previousTopics: Record<string, DecisionTopic>
}): Record<string, DecisionTopic> {
    const nextTopics: Record<string, DecisionTopic> = {}

    for (const topic of Object.values(params.previousTopics)) {
        nextTopics[topic.id] = normalizeDecisionTopic(topic)
    }

    for (const topic of Object.values(params.world.decisionTopics)) {
        nextTopics[topic.id] = normalizeDecisionTopic(topic)
    }

    for (const workOrder of Object.values(params.world.workOrders)) {
        if (workOrder.state !== 'waiting_user' || !workOrder.waitingOnTopicId) {
            continue
        }

        const existingTopic =
            nextTopics[workOrder.waitingOnTopicId]
            ?? params.world.decisionTopics[workOrder.waitingOnTopicId]
            ?? params.previousTopics[workOrder.waitingOnTopicId]

        if (existingTopic) {
            nextTopics[existingTopic.id] = mergeDecisionTopicFromWorkOrder(existingTopic, workOrder)
            continue
        }

        nextTopics[workOrder.waitingOnTopicId] = createDecisionTopic({
            id: workOrder.waitingOnTopicId,
            kind: 'approval',
            title: '需要你的决定',
            goalId: workOrder.goalId,
            workOrderId: workOrder.id,
        })
    }

    return nextTopics
}
