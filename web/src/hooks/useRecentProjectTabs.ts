import { useMemo } from 'react'

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
}): TProject[] {
    const projectById = new Map<string, TProject>()
    for (const project of input.projects) {
        projectById.set(project.id, project)
    }
    if (input.currentProject && !projectById.has(input.currentProject.id)) {
        projectById.set(input.currentProject.id, input.currentProject)
    }

    const result: TProject[] = []

    const current = projectById.get(input.currentProjectId) ?? null
    if (current) {
        result.push(current)
    }

    for (const projectId of input.recentProjectIds) {
        if (result.length >= input.maxTabs) break
        if (projectId === input.currentProjectId) continue
        const project = projectById.get(projectId)
        if (!project) continue
        if (project.archivedAt) continue
        result.push(project)
    }

    if (result.length < Math.min(input.maxTabs, projectById.size)) {
        const byUpdatedAt = [...projectById.values()]
            .filter((project) => !project.archivedAt && project.id !== input.currentProjectId)
            .sort((a, b) => b.updatedAt - a.updatedAt)

        for (const project of byUpdatedAt) {
            if (result.length >= input.maxTabs) break
            if (result.some((existing) => existing.id === project.id)) continue
            result.push(project)
        }
    }

    return result
}

export function useRecentProjectTabs<TProject extends ProjectLike>(input: {
    projects: TProject[]
    currentProjectId: string
    currentProject: TProject | null
    recentProjectIds: string[]
    maxTabs?: number
}): TProject[] {
    return useMemo(() => {
        return buildRecentProjectTabs({
            projects: input.projects,
            currentProjectId: input.currentProjectId,
            currentProject: input.currentProject,
            recentProjectIds: input.recentProjectIds,
            maxTabs: input.maxTabs ?? 5,
        })
    }, [
        input.projects,
        input.currentProjectId,
        input.currentProject,
        input.recentProjectIds,
        input.maxTabs
    ])
}

