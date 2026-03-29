import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { OmcContextPackSchema } from '@hopi/protocol/schemas'
import type { OmcAttempt, OmcContextPack, OmcPlanDetailResponse, OmcProgram } from '@hopi/protocol/types'

function readPackageScripts(repoRoot: string): string[] {
    const packageJsonPath = join(repoRoot, 'package.json')
    if (!existsSync(packageJsonPath)) {
        return []
    }

    try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
            scripts?: Record<string, string>
        }
        const scripts = parsed.scripts ?? {}
        const checks: string[] = []

        if (typeof scripts.typecheck === 'string' && scripts.typecheck.trim()) {
            checks.push('bun run typecheck')
        }
        if (typeof scripts.test === 'string' && scripts.test.trim()) {
            checks.push('bun run test')
        }
        if (typeof scripts.build === 'string' && scripts.build.trim()) {
            checks.push('bun run build')
        }

        return checks
    } catch {
        return []
    }
}

function buildAbsolutePlanningRefs(program: OmcProgram, plan: OmcPlanDetailResponse['plan']): OmcContextPack['planningRefs'] {
    const workspaceRoot = dirname(program.planningRoot)

    return OmcContextPackSchema.shape.planningRefs.parse({
        projectPath: join(workspaceRoot, plan.refs.projectPath),
        roadmapPath: join(workspaceRoot, plan.refs.roadmapPath),
        planPath: join(workspaceRoot, plan.planPath),
        ...(plan.refs.contextPath ? { contextPath: join(workspaceRoot, plan.refs.contextPath) } : {}),
        ...(plan.refs.researchPath ? { researchPath: join(workspaceRoot, plan.refs.researchPath) } : {})
    })
}

export function buildOmcContextPack(options: {
    program: OmcProgram
    plan: OmcPlanDetailResponse['plan']
    attemptId: string
    loopRunId: string
    attemptNumber: number
    sessionId: string
    worktreePath: string | null
    currentBranch: string | null
    targetBranch: string | null
    previousAttempt?: OmcAttempt | null
}): OmcContextPack {
    const requiredChecks = readPackageScripts(options.program.repoRoot)
    const firstOpenChecklistItem = options.plan.checklist.find((item) => !item.checked)?.text ?? null

    const operatingRules = [
        'Stay scoped to this one plan and do not start unrelated work.',
        'Treat this attempt as one smallest-step push, not a whole phase rewrite.',
        'Read the referenced planning files before making changes.',
        'Keep the work inside the assigned repo/worktree path.',
        'If blocked, say exactly why and what signal is missing.'
    ]

    const outputContract = {
        allowedStatuses: ['progressed', 'blocked', 'completed'],
        requiredFields: ['status', 'summary', 'changedFiles', 'checks', 'nextSuggestedStep']
    }

    const planningRefs = buildAbsolutePlanningRefs(options.program, options.plan)
    const promptLines = [
        `You are running one OMC attempt for plan ${options.plan.planKey}: ${options.plan.planTitle}.`,
        '',
        'Identity:',
        `- Program: ${options.program.name} (${options.program.id})`,
        `- Attempt: ${options.attemptId}`,
        `- Loop run: ${options.loopRunId}`,
        `- Phase: ${options.plan.phaseLabel}`,
        '',
        'Workspace:',
        `- Repo root: ${options.program.repoRoot}`,
        `- Worktree path: ${options.worktreePath ?? options.program.repoRoot}`,
        `- Current branch: ${options.currentBranch ?? 'unknown'}`,
        `- Target branch: ${options.targetBranch ?? 'default branch'}`,
        '',
        'Read these planning files first:',
        `- ${planningRefs.projectPath}`,
        `- ${planningRefs.roadmapPath}`,
        `- ${planningRefs.planPath}`,
        ...(planningRefs.contextPath ? [`- ${planningRefs.contextPath}`] : []),
        ...(planningRefs.researchPath ? [`- ${planningRefs.researchPath}`] : []),
        '',
        'Current objective:',
        `- Summary: ${options.plan.summary || options.plan.planTitle}`,
        `- Smallest next step: ${firstOpenChecklistItem ?? 'Wrap up remaining work and verify it.'}`,
        '',
        'Acceptance and checks:',
        `- Completion definition: ${firstOpenChecklistItem ? `Make concrete progress on "${firstOpenChecklistItem}" without starting unrelated follow-up work.` : 'Finish the remaining plan work and leave a clear completion summary.'}`,
        ...(requiredChecks.length > 0
            ? requiredChecks.map((command) => `- Run when relevant: ${command}`)
            : ['- Run the repo checks that prove this step is valid.']),
        '',
        options.previousAttempt
            ? `Previous attempt memory: ${options.previousAttempt.summary ?? 'No summary.'} Failure fingerprint: ${options.previousAttempt.failureFingerprint ?? 'none'}.`
            : 'Previous attempt memory: none.',
        '',
        'Operating rules:',
        ...operatingRules.map((rule) => `- ${rule}`),
        '',
        'Output contract:',
        `- Allowed statuses: ${outputContract.allowedStatuses.join(', ')}`,
        `- Required fields in your stop/update message: ${outputContract.requiredFields.join(', ')}`,
        '',
        'Make the smallest real forward step you can, then report back using the output contract.'
    ]

    return OmcContextPackSchema.parse({
        identity: {
            programId: options.program.id,
            planKey: options.plan.planKey,
            attemptId: options.attemptId,
            loopRunId: options.loopRunId,
            attemptNumber: options.attemptNumber,
            phaseKey: options.plan.phaseKey,
            phaseLabel: options.plan.phaseLabel,
            planTitle: options.plan.planTitle,
            planPath: options.plan.planPath
        },
        workspace: {
            repoRoot: options.program.repoRoot,
            planningRoot: options.program.planningRoot,
            worktreePath: options.worktreePath,
            sessionId: options.sessionId,
            currentBranch: options.currentBranch,
            targetBranch: options.targetBranch
        },
        planningRefs,
        currentObjective: {
            summary: options.plan.summary || options.plan.planTitle,
            smallestNextStep: firstOpenChecklistItem,
            checklistDone: options.plan.checklist.filter((item) => item.checked).length,
            checklistOpen: options.plan.checklist.filter((item) => !item.checked).length
        },
        acceptanceAndChecks: {
            completionDefinition: firstOpenChecklistItem
                ? `Make concrete progress on "${firstOpenChecklistItem}" without starting unrelated follow-up work.`
                : 'Finish the remaining plan work and leave a clear completion summary.',
            requiredChecks
        },
        previousAttemptMemory: options.previousAttempt
            ? {
                attemptId: options.previousAttempt.id,
                summary: options.previousAttempt.summary,
                failureFingerprint: options.previousAttempt.failureFingerprint,
                changedFiles: options.previousAttempt.changedFiles,
                checks: options.previousAttempt.checks
            }
            : null,
        operatingRules,
        outputContract,
        promptText: promptLines.join('\n')
    })
}
