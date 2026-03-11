import { useMemo, useRef } from 'react'

type ProjectLike = {
    id: string
    name: string
    updatedAt: number
    archivedAt?: number | null
}

function buildRecentProjectTabs<TProject extends ProjectLike>(input: {
    projects: TProject[]
    currentProjectId: string
    currentProject: TProject | null
    recentProjectIds: string[]
    maxTabs: number
    previousOrderIds: string[]
}): { projects: TProject[]; orderIds: string[] } {
    const projectById = new Map<string, TProject>()
    for (const project of input.projects) {
        projectById.set(project.id, project)
    }
    if (input.currentProject && !projectById.has(input.currentProject.id)) {
        projectById.set(input.currentProject.id, input.currentProject)
    }

    const desiredIds: string[] = []
    const desiredIdSet = new Set<string>()

    const current = projectById.get(input.currentProjectId) ?? null
    if (current) {
        desiredIds.push(current.id)
        desiredIdSet.add(current.id)
    }

    for (const projectId of input.recentProjectIds) {
        if (desiredIds.length >= input.maxTabs) break
        if (projectId === input.currentProjectId) continue
        const project = projectById.get(projectId)
        if (!project) continue
        if (project.archivedAt) continue
        if (desiredIdSet.has(project.id)) continue
        desiredIds.push(project.id)
        desiredIdSet.add(project.id)
    }

    if (desiredIds.length < Math.min(input.maxTabs, projectById.size)) {
        const byUpdatedAt = [...projectById.values()]
            .filter((project) => !project.archivedAt && project.id !== input.currentProjectId)
            .sort((a, b) => b.updatedAt - a.updatedAt)

        for (const project of byUpdatedAt) {
            if (desiredIds.length >= input.maxTabs) break
            if (desiredIdSet.has(project.id)) continue
            desiredIds.push(project.id)
            desiredIdSet.add(project.id)
        }
    }

    const desiredIdSetFinal = new Set(desiredIds)
    const stableIds: string[] = []
    const stableIdSet = new Set<string>()

    for (const id of input.previousOrderIds) {
        if (!desiredIdSetFinal.has(id)) continue
        if (stableIdSet.has(id)) continue
        stableIds.push(id)
        stableIdSet.add(id)
    }

    for (const id of desiredIds) {
        if (stableIdSet.has(id)) continue
        stableIds.push(id)
        stableIdSet.add(id)
    }

    const stableProjects: TProject[] = []
    for (const id of stableIds) {
        const project = projectById.get(id)
        if (!project) continue
        stableProjects.push(project)
    }

    return { projects: stableProjects, orderIds: stableIds }
}

export function useRecentProjectTabs<TProject extends ProjectLike>(input: {
    projects: TProject[]
    currentProjectId: string
    currentProject: TProject | null
    recentProjectIds: string[]
    maxTabs?: number
}): TProject[] {
    const orderRef = useRef<string[]>([])

    return useMemo(() => {
        const result = buildRecentProjectTabs({
            projects: input.projects,
            currentProjectId: input.currentProjectId,
            currentProject: input.currentProject,
            recentProjectIds: input.recentProjectIds,
            maxTabs: input.maxTabs ?? 5,
            previousOrderIds: orderRef.current
        })
        orderRef.current = result.orderIds
        return result.projects
    }, [
        input.projects,
        input.currentProjectId,
        input.currentProject,
        input.recentProjectIds,
        input.maxTabs
    ])
}
