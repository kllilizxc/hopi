import { describe, expect, it } from 'vitest'
import { getPrototypeSnapshot } from './scenario'
import { buildOperatorThreadSeeds, selectDefaultActiveThreadId, syncOperatorThreadBundle } from './threads'

describe('operator threads', () => {
    it('builds structured approval, risk, direction, and status topics', () => {
        const snapshot = getPrototypeSnapshot('execution')
        const threads = buildOperatorThreadSeeds(snapshot)

        expect(threads.some((thread) => thread.kind === 'approval')).toBe(true)
        expect(threads.some((thread) => thread.kind === 'risk')).toBe(true)
        expect(threads.some((thread) => thread.kind === 'direction')).toBe(true)
        expect(threads.some((thread) => thread.kind === 'status')).toBe(true)
    })

    it('keeps the first agent message contract complete for approval threads', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const approvalThread = buildOperatorThreadSeeds(snapshot).find((thread) => thread.kind === 'approval')

        expect(approvalThread).toBeDefined()
        expect(approvalThread?.introMessage.body).toContain('### 现状')
        expect(approvalThread?.introMessage.body).toContain('### 背景')
        expect(approvalThread?.introMessage.body).toContain('### 为什么现在找你')
        expect(approvalThread?.introMessage.body).toContain('### 建议动作')
        expect(approvalThread?.introMessage.body).toContain('确认后')
        expect(approvalThread?.introMessage.body).toContain('稍后后')
        expect(approvalThread?.introMessage.body).not.toContain('### 关联上下文')
        expect(approvalThread?.refs.some((ref) => ref.kind === 'goal')).toBe(true)
        expect(approvalThread?.refs.some((ref) => ref.kind === 'stream')).toBe(true)
        expect(approvalThread?.refs.some((ref) => ref.kind === 'impact')).toBe(true)
    })

    it('prefers unresolved intervention threads over passive status threads', () => {
        const snapshot = getPrototypeSnapshot('execution')
        const seeds = buildOperatorThreadSeeds(snapshot)
        const next = syncOperatorThreadBundle({
            snapshot,
            previousState: {
                threadsById: {},
                messagesByThread: {},
                activeThreadId: null,
            },
        })

        const active = next.activeThreadId ? next.bundle.threadsById[next.activeThreadId] : null

        expect(active).toBeDefined()
        expect(active?.passive).toBe(false)
        expect(active?.kind).not.toBe('status')
        expect(selectDefaultActiveThreadId(seeds.map((thread) => ({ ...thread, unread: true })), null)).toBe(next.activeThreadId)
    })

    it('reopens a previously resolved thread when the topic becomes active again', () => {
        const snapshot = getPrototypeSnapshot('approval')
        const seeds = buildOperatorThreadSeeds(snapshot)
        const approvalThread = seeds.find((thread) => thread.kind === 'approval')

        expect(approvalThread).toBeDefined()

        const reopened = syncOperatorThreadBundle({
            snapshot,
            previousState: {
                threadsById: {
                    [approvalThread!.id]: {
                        ...approvalThread!,
                        unread: false,
                        lifecycle: 'resolved',
                    },
                },
                messagesByThread: {
                    [approvalThread!.id]: [approvalThread!.introMessage],
                },
                activeThreadId: null,
            },
        })

        expect(reopened.bundle.threadsById[approvalThread!.id]?.lifecycle).toBe('pending')
        expect(reopened.bundle.threadsById[approvalThread!.id]?.unread).toBe(true)
    })
})
