import { z } from 'zod'

const IdentifierSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9_.-]*$/i)
const ShellTokenSchema = z.string().min(1)
const CommandSchema = z.array(ShellTokenSchema).min(1)
const EnvSchema = z.record(z.string(), z.string()).optional()

const BaseWorkflowNodeSchema = z.object({
    id: IdentifierSchema,
    cwd: z.string().min(1).optional(),
    env: EnvSchema,
    timeoutSec: z.number().int().min(1).max(21_600).optional(),
    dependsOn: z.array(IdentifierSchema).max(32).optional()
})

export const SetupRunStepSchema = BaseWorkflowNodeSchema.extend({
    type: z.literal('run'),
    run: CommandSchema,
    inputs: z.array(z.string().min(1)).max(256).optional()
})

export const SetupGitSubmoduleStepSchema = BaseWorkflowNodeSchema.extend({
    type: z.literal('git_submodule'),
    recursive: z.boolean().optional(),
    update: z.boolean().optional(),
    init: z.boolean().optional()
})

export const SetupWorkflowStepSchema = z.discriminatedUnion('type', [
    SetupRunStepSchema,
    SetupGitSubmoduleStepSchema
])

export const SetupWorkflowSchema = z.object({
    steps: z.array(SetupWorkflowStepSchema).min(1).max(128)
})

export const ReadyCheckSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('http'),
        url: z.string().min(1),
        expectStatus: z.number().int().min(100).max(599).optional(),
        timeoutSec: z.number().int().min(1).max(600).optional()
    }),
    z.object({
        type: z.literal('tcp'),
        host: z.string().min(1),
        port: z.union([z.number().int().min(1).max(65_535), z.string().min(1)]),
        timeoutSec: z.number().int().min(1).max(600).optional()
    }),
    z.object({
        type: z.literal('stdout_marker'),
        marker: z.string().min(1),
        timeoutSec: z.number().int().min(1).max(600).optional()
    }),
    z.object({
        type: z.literal('process_alive'),
        timeoutSec: z.number().int().min(1).max(600).optional()
    })
])

export const PreviewServiceSchema = BaseWorkflowNodeSchema.extend({
    type: z.literal('run'),
    run: CommandSchema,
    ready: ReadyCheckSchema,
    expose: z.enum(['none', 'primary']).optional()
})

export const PreviewWorkflowSchema = z.object({
    services: z.array(PreviewServiceSchema).min(1).max(32),
    success: z.object({
        require: z.array(IdentifierSchema).min(1).max(32)
    }).optional()
})

export const MergeVerifyCheckSchema = z.discriminatedUnion('type', [
    z.object({
        type: z.literal('run'),
        cwd: z.string().min(1).optional(),
        env: EnvSchema,
        run: CommandSchema,
        timeoutSec: z.number().int().min(1).max(21_600).optional()
    }),
    z.object({
        type: z.literal('snapshot_contains_changes')
    })
])

export const MergeWorkflowSchema = z.object({
    targetBranch: z.string().min(1),
    strategy: z.enum(['ff', 'merge_commit', 'squash']).default('merge_commit'),
    conflictResolution: z.object({
        mode: z.enum(['off', 'ai']).default('ai'),
        maxAttempts: z.number().int().min(1).max(10).optional(),
        blockPaths: z.array(z.string().min(1)).max(256).optional()
    }).optional(),
    verify: z.array(MergeVerifyCheckSchema).max(64).optional()
})

export const ProjectActionContractSchema = z.object({
    version: z.literal(1),
    setup: SetupWorkflowSchema,
    preview: PreviewWorkflowSchema,
    merge: MergeWorkflowSchema
})

export type SetupWorkflowStep = z.infer<typeof SetupWorkflowStepSchema>
export type SetupWorkflow = z.infer<typeof SetupWorkflowSchema>
export type ReadyCheck = z.infer<typeof ReadyCheckSchema>
export type PreviewService = z.infer<typeof PreviewServiceSchema>
export type PreviewWorkflow = z.infer<typeof PreviewWorkflowSchema>
export type MergeVerifyCheck = z.infer<typeof MergeVerifyCheckSchema>
export type MergeWorkflow = z.infer<typeof MergeWorkflowSchema>
export type ProjectActionContract = z.infer<typeof ProjectActionContractSchema>
