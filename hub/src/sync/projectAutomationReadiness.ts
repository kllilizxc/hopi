import { join } from 'node:path'
import {
    PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH
} from '@hopi/protocol/brand'
import type { AutomationReadinessStatus } from '@hopi/protocol/types'
import type { Store, StoredProject, StoredTask, StoredWorkspace } from '../store'
import { parseProjectActionContract } from './actionContract'
import type { SyncEngine } from './syncEngine'

export type ProjectAutomationVerificationCheck = {
    key: 'workspace' | 'contract' | 'init' | 'preview' | 'merge'
    label: string
    ok: boolean
    path: string | null
    detail: string
}

export type ProjectAutomationVerificationReport = {
    status: AutomationReadinessStatus
    summary: string
    checkedAt: number
    workspaceId: string | null
    workspacePath: string | null
    checks: ProjectAutomationVerificationCheck[]
}

function pickVerificationWorkspace(store: Store, project: StoredProject): StoredWorkspace | null {
    if (project.defaultWorkspaceId) {
        const workspace = store.workspaces.getWorkspace(project.defaultWorkspaceId)
        if (workspace && workspace.projectId === project.id) {
            return workspace
        }
    }

    const workspaces = store.workspaces.listWorkspacesByProject(project.id)
    return workspaces[0] ?? null
}

function getLatestProjectInitTask(store: Store, projectId: string, namespace: string): StoredTask | null {
    const tasks = store.tasks.listTasksByProjectAndNamespace(projectId, namespace)
    const initTasks = tasks.filter((task) => task.source === 'project_init' && !task.archivedAt)
    if (initTasks.length === 0) {
        return null
    }
    return [...initTasks].sort((left, right) => right.updatedAt - left.updatedAt)[0] ?? null
}

function buildSummary(checks: ProjectAutomationVerificationCheck[], options?: {
    workspacePath?: string | null
    bootstrapTask?: StoredTask | null
}): string {
    const lines: string[] = []

    if (options?.workspacePath) {
        lines.push(`Workspace: ${options.workspacePath}`)
    }

    for (const check of checks) {
        lines.push(`${check.ok ? 'OK' : 'Issue'} ${check.label}${check.path ? ` (${check.path})` : ''}: ${check.detail}`)
    }

    if (options?.bootstrapTask) {
        lines.push(`Bootstrap task: ${options.bootstrapTask.status}`)
    }

    return lines.join('\n')
}

function resolveStatus(checks: ProjectAutomationVerificationCheck[]): AutomationReadinessStatus {
    const workspaceCheck = checks.find((check) => check.key === 'workspace')
    if (!workspaceCheck?.ok) {
        return 'blocked'
    }
    const contractCheck = checks.find((check) => check.key === 'contract')
    if (!contractCheck?.ok) {
        return 'blocked'
    }
    return checks.every((check) => check.ok) ? 'ready' : 'degraded'
}

function persistReadiness(store: Store, project: StoredProject, namespace: string, report: ProjectAutomationVerificationReport): StoredProject {
    return store.projects.updateProject(project.id, namespace, {
        automationReadinessStatus: report.status,
        automationReadinessSummary: report.summary,
        automationReadinessCheckedAt: report.checkedAt
    }) ?? project
}

export async function verifyProjectAutomationReadiness(options: {
    store: Store
    engine: SyncEngine
    namespace: string
    projectId: string
}): Promise<{
    ok: true
    project: StoredProject
    report: ProjectAutomationVerificationReport
} | {
    ok: false
    status: 404
    error: string
}> {
    const project = options.store.projects.getProjectByNamespace(options.projectId, options.namespace)
    if (!project) {
        return { ok: false, status: 404, error: 'Project not found' }
    }

    const workspace = pickVerificationWorkspace(options.store, project)
    const bootstrapTask = getLatestProjectInitTask(options.store, project.id, options.namespace)
    const checkedAt = Date.now()

    if (!workspace) {
        const report: ProjectAutomationVerificationReport = {
            status: 'blocked',
            summary: buildSummary([
                {
                    key: 'workspace',
                    label: 'Workspace path',
                    ok: false,
                    path: null,
                    detail: 'No default workspace is configured.'
                }
            ], { bootstrapTask }),
            checkedAt,
            workspaceId: null,
            workspacePath: null,
            checks: [{
                key: 'workspace',
                label: 'Workspace path',
                ok: false,
                path: null,
                detail: 'No default workspace is configured.'
            }]
        }

        return {
            ok: true,
            project: persistReadiness(options.store, project, options.namespace, report),
            report
        }
    }

    const machine = options.engine.getMachine(project.machineId)
    if (!machine || machine.namespace !== options.namespace || !machine.active) {
        const report: ProjectAutomationVerificationReport = {
            status: 'blocked',
            summary: buildSummary([
                {
                    key: 'workspace',
                    label: 'Workspace path',
                    ok: false,
                    path: workspace.path,
                    detail: 'Machine is offline or not connected.'
                }
            ], { workspacePath: workspace.path, bootstrapTask }),
            checkedAt,
            workspaceId: workspace.id,
            workspacePath: workspace.path,
            checks: [{
                key: 'workspace',
                label: 'Workspace path',
                ok: false,
                path: workspace.path,
                detail: 'Machine is offline or not connected.'
            }]
        }

        return {
            ok: true,
            project: persistReadiness(options.store, project, options.namespace, report),
            report
        }
    }

    const paths = [
        workspace.path,
        join(workspace.path, PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH)
    ]
    let exists: Record<string, boolean>
    try {
        exists = await options.engine.checkPathsExist(project.machineId, paths)
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to check paths on the machine.'
        const report: ProjectAutomationVerificationReport = {
            status: 'blocked',
            summary: buildSummary([
                {
                    key: 'workspace',
                    label: 'Workspace path',
                    ok: false,
                    path: workspace.path,
                    detail: message
                }
            ], { workspacePath: workspace.path, bootstrapTask }),
            checkedAt,
            workspaceId: workspace.id,
            workspacePath: workspace.path,
            checks: [{
                key: 'workspace',
                label: 'Workspace path',
                ok: false,
                path: workspace.path,
                detail: message
            }]
        }

        return {
            ok: true,
            project: persistReadiness(options.store, project, options.namespace, report),
            report
        }
    }
    const contractPath = join(workspace.path, PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH)
    const workspaceCheck: ProjectAutomationVerificationCheck = {
        key: 'workspace',
        label: 'Workspace path',
        ok: Boolean(exists[workspace.path]),
        path: workspace.path,
        detail: Boolean(exists[workspace.path]) ? 'Workspace path exists on the machine.' : 'Workspace path is missing on the machine.'
    }

    let contractCheck: ProjectAutomationVerificationCheck
    let setupCheck: ProjectAutomationVerificationCheck
    let previewCheck: ProjectAutomationVerificationCheck
    let mergeCheck: ProjectAutomationVerificationCheck

    if (!exists[contractPath]) {
        contractCheck = {
            key: 'contract',
            label: '.hopi/actions.yaml',
            ok: false,
            path: contractPath,
            detail: 'Action contract missing.'
        }
        setupCheck = {
            key: 'init',
            label: 'setup workflow',
            ok: false,
            path: contractPath,
            detail: 'Unavailable until the action contract is valid.'
        }
        previewCheck = {
            key: 'preview',
            label: 'preview stack',
            ok: false,
            path: contractPath,
            detail: 'Unavailable until the action contract is valid.'
        }
        mergeCheck = {
            key: 'merge',
            label: 'merge workflow',
            ok: false,
            path: contractPath,
            detail: 'Unavailable until the action contract is valid.'
        }
    } else {
        let contract:
            | ReturnType<typeof parseProjectActionContract>
            | {
                kind: 'invalid'
                manifestPath: string
                error: string
            }

        try {
            const response = await options.engine.readFileOnMachine(project.machineId, PRODUCT_ACTIONS_MANIFEST_RELATIVE_PATH, workspace.path)
            if (!response.success || !response.content) {
                contract = {
                    kind: 'invalid',
                    manifestPath: contractPath,
                    error: response.error ?? 'Failed to read action contract from machine.'
                }
            } else {
                contract = parseProjectActionContract({
                    manifestPath: contractPath,
                    raw: Buffer.from(response.content, 'base64').toString('utf8')
                })
            }
        } catch (error) {
            contract = {
                kind: 'invalid',
                manifestPath: contractPath,
                error: error instanceof Error ? error.message : 'Failed to read action contract from machine.'
            }
        }

        if (contract.kind === 'valid') {
            contractCheck = {
                key: 'contract',
                label: '.hopi/actions.yaml',
                ok: true,
                path: contract.manifestPath,
                detail: 'Action contract parsed successfully.'
            }
            setupCheck = {
                key: 'init',
                label: 'setup workflow',
                ok: contract.contract.setup.steps.length > 0,
                path: contract.manifestPath,
                detail: `${contract.contract.setup.steps.length} setup step${contract.contract.setup.steps.length === 1 ? '' : 's'} declared.`
            }
            previewCheck = {
                key: 'preview',
                label: 'preview stack',
                ok: contract.contract.preview.services.length > 0,
                path: contract.manifestPath,
                detail: `${contract.contract.preview.services.length} preview service${contract.contract.preview.services.length === 1 ? '' : 's'} declared.`
            }
            mergeCheck = {
                key: 'merge',
                label: 'merge workflow',
                ok: contract.contract.merge.targetBranch.trim().length > 0,
                path: contract.manifestPath,
                detail: `Target branch: ${contract.contract.merge.targetBranch}. Strategy: ${contract.contract.merge.strategy}.`
            }
        } else {
            contractCheck = {
                key: 'contract',
                label: '.hopi/actions.yaml',
                ok: false,
                path: contract.manifestPath,
                detail: contract.kind === 'missing' ? 'Action contract missing.' : contract.error
            }
            setupCheck = {
                key: 'init',
                label: 'setup workflow',
                ok: false,
                path: contract.manifestPath,
                detail: 'Unavailable until the action contract is valid.'
            }
            previewCheck = {
                key: 'preview',
                label: 'preview stack',
                ok: false,
                path: contract.manifestPath,
                detail: 'Unavailable until the action contract is valid.'
            }
            mergeCheck = {
                key: 'merge',
                label: 'merge workflow',
                ok: false,
                path: contract.manifestPath,
                detail: 'Unavailable until the action contract is valid.'
            }
        }
    }

    const checks = [workspaceCheck, contractCheck, setupCheck, previewCheck, mergeCheck]
    const report: ProjectAutomationVerificationReport = {
        status: resolveStatus(checks),
        summary: buildSummary(checks, { workspacePath: workspace.path, bootstrapTask }),
        checkedAt,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        checks
    }

    return {
        ok: true,
        project: persistReadiness(options.store, project, options.namespace, report),
        report
    }
}
