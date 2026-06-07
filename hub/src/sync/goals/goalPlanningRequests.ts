import YAML from 'yaml'
import { z } from 'zod'
import type { GoalAssistantPlanningRequestItem } from '@hopi/protocol/goal-assistant'
import { GoalAssistantPlanningRequestItemSchema } from '@hopi/protocol/goal-assistant'

const planningRequestsDocumentSchema = z.object({
    version: z.union([z.literal(1), z.number()]).optional(),
    requests: z.array(GoalAssistantPlanningRequestItemSchema).optional()
}).passthrough()

export type GoalPlanningRequestsDocument = {
    version: 1
    requests: GoalAssistantPlanningRequestItem[]
}

export function parseGoalPlanningRequests(raw: string | null | undefined): GoalPlanningRequestsDocument {
    if (!raw?.trim()) {
        return { version: 1, requests: [] }
    }

    try {
        const parsed = YAML.parse(raw)
        const result = planningRequestsDocumentSchema.safeParse(parsed && typeof parsed === 'object' ? parsed : {})
        if (!result.success) {
            return { version: 1, requests: [] }
        }
        return {
            version: 1,
            requests: (result.data.requests ?? []).map((item) => GoalAssistantPlanningRequestItemSchema.parse(item))
        }
    } catch {
        return { version: 1, requests: [] }
    }
}

export function stringifyGoalPlanningRequests(document: GoalPlanningRequestsDocument): string {
    return YAML.stringify({
        version: 1,
        requests: document.requests
    }, {
        indent: 4,
        lineWidth: 0
    })
}
