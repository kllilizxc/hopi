import type { SessionProfile } from '@hopi/protocol/goal-assistant'

export interface SpawnSessionOptions {
    machineId?: string
    directory: string
    worktreeWorkspacePaths?: string[]
    sessionId?: string
    resumeSessionId?: string
    approvedNewDirectoryCreation?: boolean
    agent?: 'claude' | 'codex' | 'gemini' | 'opencode'
    model?: string
    yolo?: boolean
    token?: string
    sessionType?: 'simple' | 'worktree'
    worktreeName?: string
    worktreeTargetBranch?: string
    sessionProfile?: SessionProfile
}

export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string }
