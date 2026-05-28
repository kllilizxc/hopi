import { describe, expect, it } from 'bun:test'
import {
    resolveSessionBasePath,
    resolveSessionLocalPath,
    resolveSessionMetadataPath,
    resolveSessionPreferredRootPath,
    resolveSessionRootPathCandidates,
    resolveSessionWorktreePath
} from './sessionRootPaths'

describe('session root path helpers', () => {
    it('prefers worktree path over metadata and base paths', () => {
        const session = {
            metadata: {
                path: '/repo',
                worktree: {
                    worktreePath: '/repo-worktrees/task-1',
                    basePath: '/repo'
                }
            }
        }

        expect(resolveSessionWorktreePath(session)).toBe('/repo-worktrees/task-1')
        expect(resolveSessionMetadataPath(session)).toBe('/repo')
        expect(resolveSessionBasePath(session)).toBe('/repo')
        expect(resolveSessionLocalPath(session)).toBe('/repo')
        expect(resolveSessionPreferredRootPath(session)).toBe('/repo-worktrees/task-1')
        expect(resolveSessionRootPathCandidates({ session, workspacePath: '/repo' })).toEqual([
            '/repo-worktrees/task-1',
            '/repo'
        ])
    })

    it('falls back to workspace path when session metadata is incomplete', () => {
        const session = {
            metadata: {
                path: '   '
            }
        }

        expect(resolveSessionPreferredRootPath(session)).toBeNull()
        expect(resolveSessionRootPathCandidates({
            session,
            workspacePath: '/tmp/workspace'
        })).toEqual(['/tmp/workspace'])
    })
})
