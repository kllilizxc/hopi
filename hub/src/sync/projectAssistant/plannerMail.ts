import type { Store } from '../../store'
import {
    appendPlannerMail,
    type OperatorSource,
    type PlannerMailItem,
    type PlannerMailKind
} from '../operator/operatorDocs'
import { getGoal, getProject, getProjectWorkspace } from './projectStore'

export function sendProjectAssistantPlannerMail(options: {
    store: Store
    namespace: string
    projectId: string
    goalId: string
    kind: PlannerMailKind
    body: string
    source: OperatorSource
    now?: number
}): PlannerMailItem {
    const project = getProject(options.store, options.projectId, options.namespace)
    const workspace = getProjectWorkspace(options.store, project)
    const goal = getGoal(options.store, options.goalId, options.namespace, project.id)
    return appendPlannerMail({
        workspacePath: workspace.path,
        goalKey: goal.goalKey,
        kind: options.kind,
        body: options.body,
        source: options.source,
        now: options.now
    })
}
