import { afterEach, describe, expect, it, vi } from 'vitest'
import { PrototypeRemoteApiClient } from './remoteApi'

describe('PrototypeRemoteApiClient bootstrap methods', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('posts repoRoot and optional name when attaching a local repo', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                program: { id: 'program-attach-named' },
                planning: { id: 'planning-attach-named' },
            }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const api = new PrototypeRemoteApiClient('http://localhost:3006', 'jwt-token')

        const response = await api.attachLocalRepo({
            repoRoot: '/Users/realizer/Code/hopi',
            name: 'Hopi',
        })

        expect(response).toEqual({
            program: { id: 'program-attach-named' },
            planning: { id: 'planning-attach-named' },
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3006/api/omc/programs/attach-local-repo',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    authorization: 'Bearer jwt-token',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    repoRoot: '/Users/realizer/Code/hopi',
                    name: 'Hopi',
                }),
            }),
        )
    })

    it('posts repoRoot without name when attaching a local repo', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                program: { id: 'program-attach-unnamed' },
                planning: { id: 'planning-attach-unnamed' },
            }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const api = new PrototypeRemoteApiClient('http://localhost:3006', 'jwt-token')

        const response = await api.attachLocalRepo({
            repoRoot: '/Users/realizer/Code/hopi',
        })

        expect(response).toEqual({
            program: { id: 'program-attach-unnamed' },
            planning: { id: 'planning-attach-unnamed' },
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3006/api/omc/programs/attach-local-repo',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    authorization: 'Bearer jwt-token',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    repoRoot: '/Users/realizer/Code/hopi',
                }),
            }),
        )
    })

    it('posts an empty payload when creating a planning seed', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                program: { id: 'program-seed-1' },
                planning: { id: 'planning-seed-1' },
            }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const api = new PrototypeRemoteApiClient('http://localhost:3006', 'jwt-token')

        const response = await api.createPlanningSeed('program-123')

        expect(response).toEqual({
            program: { id: 'program-seed-1' },
            planning: { id: 'planning-seed-1' },
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3006/api/omc/programs/program-123/create-planning-seed',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    authorization: 'Bearer jwt-token',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({}),
            }),
        )
    })

    it('posts the guided-planning brief when starting guided planning', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                programId: 'program-123',
                run: {
                    id: 'run-1',
                    programId: 'program-123',
                    status: 'queued',
                    stage: 'brief',
                    brief: {
                        productIntent: 'Ship a card game MVP',
                        firstSlice: 'Create a playable local prototype',
                    },
                    createdAt: 1,
                    updatedAt: 1,
                    generatedPlanPaths: [],
                },
            }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const api = new PrototypeRemoteApiClient('http://localhost:3006', 'jwt-token')

        const response = await api.startGuidedPlanning('program-123', {
            productIntent: 'Ship a card game MVP',
            firstSlice: 'Create a playable local prototype',
        })

        expect(response).toEqual({
            programId: 'program-123',
            run: {
                id: 'run-1',
                programId: 'program-123',
                status: 'queued',
                stage: 'brief',
                brief: {
                    productIntent: 'Ship a card game MVP',
                    firstSlice: 'Create a playable local prototype',
                },
                createdAt: 1,
                updatedAt: 1,
                generatedPlanPaths: [],
            },
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3006/api/omc/programs/program-123/planning-run/start',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    authorization: 'Bearer jwt-token',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({
                    brief: {
                        productIntent: 'Ship a card game MVP',
                        firstSlice: 'Create a playable local prototype',
                    },
                }),
            }),
        )
    })

    it('posts to retry the latest guided planning run', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                programId: 'program-123',
                run: {
                    id: 'run-2',
                    programId: 'program-123',
                    status: 'queued',
                    stage: 'brief',
                    brief: {
                        productIntent: 'Retry the card game MVP',
                        firstSlice: 'Regenerate the first executable plans',
                    },
                    createdAt: 2,
                    updatedAt: 2,
                    generatedPlanPaths: [],
                },
            }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const api = new PrototypeRemoteApiClient('http://localhost:3006', 'jwt-token')

        const response = await api.retryGuidedPlanning('program-123')

        expect(response).toEqual({
            programId: 'program-123',
            run: {
                id: 'run-2',
                programId: 'program-123',
                status: 'queued',
                stage: 'brief',
                brief: {
                    productIntent: 'Retry the card game MVP',
                    firstSlice: 'Regenerate the first executable plans',
                },
                createdAt: 2,
                updatedAt: 2,
                generatedPlanPaths: [],
            },
        })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3006/api/omc/programs/program-123/planning-run/retry',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    authorization: 'Bearer jwt-token',
                },
            }),
        )
    })

    it('loads the latest message page for a session', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                messages: [
                    {
                        id: 'message-1',
                        seq: 1,
                        localId: null,
                        createdAt: 1,
                        content: { role: 'user', content: { type: 'text', text: 'hello' } },
                    },
                ],
                page: {
                    limit: 50,
                    beforeSeq: null,
                    nextBeforeSeq: null,
                    hasMore: false,
                },
            }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const api = new PrototypeRemoteApiClient('http://localhost:3006', 'jwt-token')

        const response = await api.getMessages('session-123')

        expect(response.messages).toHaveLength(1)
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3006/api/sessions/session-123/messages',
            expect.objectContaining({
                headers: {
                    authorization: 'Bearer jwt-token',
                },
            }),
        )
    })

    it('passes pagination params when loading older session messages', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                messages: [],
                page: {
                    limit: 20,
                    beforeSeq: 10,
                    nextBeforeSeq: null,
                    hasMore: false,
                },
            }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const api = new PrototypeRemoteApiClient('http://localhost:3006', 'jwt-token')

        await api.getMessages('session-123', {
            beforeSeq: 10,
            limit: 20,
        })

        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3006/api/sessions/session-123/messages?beforeSeq=10&limit=20',
            expect.objectContaining({
                headers: {
                    authorization: 'Bearer jwt-token',
                },
            }),
        )
    })

    it('loads combined git numstat for the current session worktree', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                success: true,
                stdout: '4\t1\tsrc/game.ts\n',
            }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const api = new PrototypeRemoteApiClient('http://localhost:3006', 'jwt-token')

        const response = await api.getGitDiffNumstat('session-123')

        expect(response).toEqual({
            success: true,
            stdout: '4\t1\tsrc/game.ts\n',
        })
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3006/api/sessions/session-123/git-diff-numstat',
            expect.objectContaining({
                headers: {
                    authorization: 'Bearer jwt-token',
                },
            }),
        )
    })

    it('loads a unified diff for a specific changed file', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                success: true,
                stdout: 'diff --git a/src/game.ts b/src/game.ts',
            }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const api = new PrototypeRemoteApiClient('http://localhost:3006', 'jwt-token')

        const response = await api.getGitDiffFile('session-123', 'src/game.ts')

        expect(response).toEqual({
            success: true,
            stdout: 'diff --git a/src/game.ts b/src/game.ts',
        })
        expect(fetchMock).toHaveBeenCalledWith(
            'http://localhost:3006/api/sessions/session-123/git-diff-file?path=src%2Fgame.ts',
            expect.objectContaining({
                headers: {
                    authorization: 'Bearer jwt-token',
                },
            }),
        )
    })
})
