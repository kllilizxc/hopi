import YAML from 'yaml'
import { z } from 'zod'
import type { GoalAssistantPlanningRequestItem } from '@hopi/protocol/goal-assistant'
import { GoalAssistantPlanningRequestItemSchema } from '@hopi/protocol/goal-assistant'

const plannerMailDocumentSchema = z.object({
    version: z.union([z.literal(1), z.number()]).optional(),
    mail: z.array(GoalAssistantPlanningRequestItemSchema).optional()
}).passthrough()

export type GoalPlannerMailDocument = {
    version: 1
    mail: GoalAssistantPlanningRequestItem[]
}

export function parseGoalPlannerMail(raw: string | null | undefined): GoalPlannerMailDocument {
    if (!raw?.trim()) {
        return { version: 1, mail: [] }
    }

    try {
        const parsed = YAML.parse(raw)
        const result = plannerMailDocumentSchema.safeParse(parsed && typeof parsed === 'object' ? parsed : {})
        if (!result.success) {
            return { version: 1, mail: [] }
        }
        return {
            version: 1,
            mail: (result.data.mail ?? []).map((item) => GoalAssistantPlanningRequestItemSchema.parse(item))
        }
    } catch {
        return { version: 1, mail: [] }
    }
}

export function stringifyGoalPlannerMail(document: GoalPlannerMailDocument): string {
    return YAML.stringify({
        version: 1,
        mail: document.mail
    }, {
        indent: 4,
        lineWidth: 0
    })
}
