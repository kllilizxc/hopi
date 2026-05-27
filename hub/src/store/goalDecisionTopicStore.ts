import type { Database } from 'bun:sqlite'

import {
    createGoalDecisionTopic,
    getGoalDecisionTopicByNamespace,
    listGoalDecisionTopicsByGoalAndNamespace,
    updateGoalDecisionTopicByNamespace
} from './goalDecisionTopics'
import type { StoredGoalDecisionTopic } from './types'

export class GoalDecisionTopicStore {
    constructor(private readonly db: Database) {
    }

    listByGoalAndNamespace(goalId: string, namespace: string): StoredGoalDecisionTopic[] {
        return listGoalDecisionTopicsByGoalAndNamespace(this.db, goalId, namespace)
    }

    getByNamespace(topicId: string, namespace: string): StoredGoalDecisionTopic | null {
        return getGoalDecisionTopicByNamespace(this.db, topicId, namespace)
    }

    create(topic: {
        id: string
        projectId: string
        goalId: string
        namespace: string
        scope?: StoredGoalDecisionTopic['scope']
        taskId?: string | null
        title: string
        body: string
        blocking?: boolean
    }): StoredGoalDecisionTopic {
        return createGoalDecisionTopic(this.db, topic)
    }

    updateByNamespace(
        topicId: string,
        namespace: string,
        patch: {
            status?: StoredGoalDecisionTopic['status']
            resolution?: string | null
        }
    ): StoredGoalDecisionTopic | null {
        return updateGoalDecisionTopicByNamespace(this.db, topicId, namespace, patch)
    }

    resolveByNamespace(topicId: string, namespace: string, resolution: string): StoredGoalDecisionTopic | null {
        return updateGoalDecisionTopicByNamespace(this.db, topicId, namespace, {
            status: 'resolved',
            resolution
        })
    }
}
