import type { Database } from 'bun:sqlite'

import type { StoredGoalDecisionTopic } from './types'

type DbGoalDecisionTopicRow = {
    id: string
    project_id: string
    goal_id: string
    task_id: string | null
    namespace: string
    title: string
    body: string
    status: StoredGoalDecisionTopic['status']
    blocking: number
    resolution: string | null
    created_at: number
    updated_at: number
}

function toStoredGoalDecisionTopic(row: DbGoalDecisionTopicRow): StoredGoalDecisionTopic {
    return {
        id: row.id,
        projectId: row.project_id,
        goalId: row.goal_id,
        taskId: row.task_id,
        title: row.title,
        body: row.body,
        status: row.status,
        blocking: Boolean(row.blocking),
        resolution: row.resolution,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    }
}

export function listGoalDecisionTopicsByGoalAndNamespace(
    db: Database,
    goalId: string,
    namespace: string
): StoredGoalDecisionTopic[] {
    const rows = db.prepare(`
        SELECT *
        FROM goal_decision_topics
        WHERE goal_id = ? AND namespace = ?
        ORDER BY updated_at DESC
    `).all(goalId, namespace) as DbGoalDecisionTopicRow[]
    return rows.map(toStoredGoalDecisionTopic)
}

export function getGoalDecisionTopicByNamespace(
    db: Database,
    topicId: string,
    namespace: string
): StoredGoalDecisionTopic | null {
    const row = db.prepare(`
        SELECT *
        FROM goal_decision_topics
        WHERE id = ? AND namespace = ?
        LIMIT 1
    `).get(topicId, namespace) as DbGoalDecisionTopicRow | undefined
    return row ? toStoredGoalDecisionTopic(row) : null
}

export function createGoalDecisionTopic(
    db: Database,
    topic: {
        id: string
        projectId: string
        goalId: string
        namespace: string
        taskId?: string | null
        title: string
        body: string
        blocking?: boolean
    }
): StoredGoalDecisionTopic {
    const now = Date.now()
    db.prepare(`
        INSERT INTO goal_decision_topics (
            id, project_id, goal_id, task_id, namespace, title, body,
            status, blocking, resolution, created_at, updated_at
        ) VALUES (
            @id, @project_id, @goal_id, @task_id, @namespace, @title, @body,
            @status, @blocking, NULL, @created_at, @updated_at
        )
    `).run({
        id: topic.id,
        project_id: topic.projectId,
        goal_id: topic.goalId,
        task_id: topic.taskId ?? null,
        namespace: topic.namespace,
        title: topic.title,
        body: topic.body,
        status: 'waiting',
        blocking: topic.blocking === false ? 0 : 1,
        created_at: now,
        updated_at: now
    })

    const stored = getGoalDecisionTopicByNamespace(db, topic.id, topic.namespace)
    if (!stored) {
        throw new Error('Failed to create goal decision topic')
    }
    return stored
}

export function updateGoalDecisionTopicByNamespace(
    db: Database,
    topicId: string,
    namespace: string,
    patch: {
        status?: StoredGoalDecisionTopic['status']
        resolution?: string | null
    }
): StoredGoalDecisionTopic | null {
    const current = getGoalDecisionTopicByNamespace(db, topicId, namespace)
    if (!current) {
        return null
    }

    const next = {
        ...current,
        status: patch.status ?? current.status,
        resolution: patch.resolution !== undefined ? patch.resolution : current.resolution
    }
    const now = Date.now()

    db.prepare(`
        UPDATE goal_decision_topics SET
            status = @status,
            resolution = @resolution,
            updated_at = @updated_at
        WHERE id = @id AND namespace = @namespace
    `).run({
        id: topicId,
        namespace,
        status: next.status,
        resolution: next.resolution,
        updated_at: now
    })

    return getGoalDecisionTopicByNamespace(db, topicId, namespace)
}
