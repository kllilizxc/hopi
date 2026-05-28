import type { OmcProgramBootstrapResponse } from '@hopi/protocol/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bootstrapNewProject, type BootstrapNewProjectInput } from './newProjectBootstrap'

describe('bootstrapNewProject', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    function makeBootstrapResponse(overrides: Partial<OmcProgramBootstrapResponse> = {}): OmcProgramBootstrapResponse {
        return {
            program: {
                id: 'program-1',
                namespace: 'local',
                name: 'Hopi',
                repoRoot: '/Users/realizer/Code/hopi',
                planningRoot: '/Users/realizer/Code/hopi/.planning',
                createdAt: 1,
                updatedAt: 2,
                counts: {
                    Planning: 1,
                    Running: 0,
                    Review: 0,
                    Done: 0,
                },
            },
            planning: {
                status: 'attached',
                planningRoot: '/Users/realizer/Code/hopi/.planning',
                hasPlanning: true,
                hasPlans: false,
                phaseCount: 1,
                planCount: 0,
                seedFiles: [],
            },
            ...overrides,
        }
    }

    it('returns attach success without seeding when planning already exists', async () => {
        const attach = makeBootstrapResponse({
            planning: {
                status: 'attached',
                planningRoot: '/Users/realizer/Code/hopi/.planning',
                hasPlanning: true,
                hasPlans: true,
                phaseCount: 1,
                planCount: 1,
                seedFiles: ['.planning/seed.md'],
            },
        })
        const api = {
            attachLocalRepo: vi.fn().mockResolvedValue(attach),
            createPlanningSeed: vi.fn(),
        }
        const input: BootstrapNewProjectInput = {
            repoRoot: '/Users/realizer/Code/hopi',
            name: '  Hopi  ',
        }

        const result = await bootstrapNewProject(api, input)

        expect(result).toEqual({
            kind: 'success',
            programId: 'program-1',
            seedCreated: false,
            bootstrap: attach,
        })
        expect(api.attachLocalRepo).toHaveBeenCalledWith({
            repoRoot: '/Users/realizer/Code/hopi',
            name: 'Hopi',
        })
        expect(api.createPlanningSeed).not.toHaveBeenCalled()
    })

    it('omits a blank name when attaching a local repo', async () => {
        const attach = makeBootstrapResponse({
            program: {
                id: 'program-2',
                namespace: 'local',
                name: 'Hopi',
                repoRoot: '/Users/realizer/Code/hopi',
                planningRoot: '/Users/realizer/Code/hopi/.planning',
                createdAt: 3,
                updatedAt: 4,
                counts: {
                    Planning: 0,
                    Running: 0,
                    Review: 0,
                    Done: 0,
                },
            },
            planning: {
                status: 'missing',
                planningRoot: '/Users/realizer/Code/hopi/.planning',
                hasPlanning: false,
                hasPlans: false,
                phaseCount: 0,
                planCount: 0,
                seedFiles: [],
            },
        })
        const seed = makeBootstrapResponse({
            program: {
                id: 'program-2',
                namespace: 'local',
                name: 'Hopi',
                repoRoot: '/Users/realizer/Code/hopi',
                planningRoot: '/Users/realizer/Code/hopi/.planning',
                createdAt: 5,
                updatedAt: 6,
                counts: {
                    Planning: 1,
                    Running: 0,
                    Review: 0,
                    Done: 0,
                },
            },
            planning: {
                status: 'seeded',
                planningRoot: '/Users/realizer/Code/hopi/.planning',
                hasPlanning: true,
                hasPlans: true,
                phaseCount: 1,
                planCount: 1,
                seedFiles: ['.planning/seed.md'],
            },
        })
        const api = {
            attachLocalRepo: vi.fn().mockResolvedValue(attach),
            createPlanningSeed: vi.fn().mockResolvedValue(seed),
        }

        const result = await bootstrapNewProject(api, {
            repoRoot: '/Users/realizer/Code/hopi',
            name: '   ',
        })

        expect(result).toEqual({
            kind: 'success',
            programId: 'program-2',
            seedCreated: true,
            bootstrap: seed,
        })
        expect(api.attachLocalRepo).toHaveBeenCalledWith({
            repoRoot: '/Users/realizer/Code/hopi',
        })
        expect(api.createPlanningSeed).toHaveBeenCalledWith('program-2')
    })

    it('returns a display-ready seed error message when the API body is JSON text', async () => {
        const attach = makeBootstrapResponse({
            program: {
                id: 'program-3',
                namespace: 'local',
                name: 'Hopi',
                repoRoot: '/Users/realizer/Code/hopi',
                planningRoot: '/Users/realizer/Code/hopi/.planning',
                createdAt: 7,
                updatedAt: 8,
                counts: {
                    Planning: 0,
                    Running: 0,
                    Review: 0,
                    Done: 0,
                },
            },
            planning: {
                status: 'missing',
                planningRoot: '/Users/realizer/Code/hopi/.planning',
                hasPlanning: false,
                hasPlans: false,
                phaseCount: 0,
                planCount: 0,
                seedFiles: [],
            },
        })
        const api = {
            attachLocalRepo: vi.fn().mockResolvedValue(attach),
            createPlanningSeed: vi.fn().mockRejectedValue(new Error('{"error":"seed failed"}')),
        }

        const result = await bootstrapNewProject(api, {
            repoRoot: '/Users/realizer/Code/hopi',
        })

        expect(result).toEqual({
            kind: 'seed-error',
            programId: 'program-3',
            seedCreated: false,
            attach,
            error: 'Seed creation failed: seed failed',
        })
        expect(api.createPlanningSeed).toHaveBeenCalledWith('program-3')
    })
})
