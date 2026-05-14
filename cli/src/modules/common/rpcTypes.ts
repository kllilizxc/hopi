export type OperatorConsoleSpawnConfig = {
    projectId: string
    goalId?: string | null
    taskId?: string | null
}

export interface SpawnSessionOptions {
    machineId?: string
    directory: string
    worktreeWorkspacePaths?: string[]
    sessionId?: string
    sessionTag?: string
    resumeSessionId?: string
    approvedNewDirectoryCreation?: boolean
    agent?: 'claude' | 'codex' | 'gemini' | 'opencode'
    model?: string
    yolo?: boolean
    token?: string
    sessionType?: 'simple' | 'worktree'
    worktreeName?: string
    worktreeTargetBranch?: string
    operatorConsole?: OperatorConsoleSpawnConfig
}

export type SpawnSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'requestToApproveDirectoryCreation'; directory: string }
    | { type: 'error'; errorMessage: string }
