import { describe, expect, it } from 'bun:test'
import { KeyedMutex } from './keyedMutex'

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('KeyedMutex', () => {
    it('serializes tasks for the same key', async () => {
        const mutex = new KeyedMutex()
        let inFlight = 0
        let maxInFlight = 0

        await Promise.all([
            mutex.runExclusive('project-a', async () => {
                inFlight += 1
                maxInFlight = Math.max(maxInFlight, inFlight)
                await delay(20)
                inFlight -= 1
            }),
            mutex.runExclusive('project-a', async () => {
                inFlight += 1
                maxInFlight = Math.max(maxInFlight, inFlight)
                await delay(20)
                inFlight -= 1
            }),
            mutex.runExclusive('project-a', async () => {
                inFlight += 1
                maxInFlight = Math.max(maxInFlight, inFlight)
                await delay(20)
                inFlight -= 1
            })
        ])

        expect(maxInFlight).toBe(1)
        expect(mutex.getActiveKeyCount()).toBe(0)
    })

    it('allows different keys to run in parallel', async () => {
        const mutex = new KeyedMutex()
        let inFlight = 0
        let maxInFlight = 0

        await Promise.all([
            mutex.runExclusive('project-a', async () => {
                inFlight += 1
                maxInFlight = Math.max(maxInFlight, inFlight)
                await delay(20)
                inFlight -= 1
            }),
            mutex.runExclusive('project-b', async () => {
                inFlight += 1
                maxInFlight = Math.max(maxInFlight, inFlight)
                await delay(20)
                inFlight -= 1
            })
        ])

        expect(maxInFlight).toBe(2)
        expect(mutex.getActiveKeyCount()).toBe(0)
    })

    it('releases key after task throws', async () => {
        const mutex = new KeyedMutex()

        await expect(
            mutex.runExclusive('project-a', async () => {
                throw new Error('boom')
            })
        ).rejects.toThrow('boom')

        const result = await mutex.runExclusive('project-a', async () => 'ok')
        expect(result).toBe('ok')
        expect(mutex.getActiveKeyCount()).toBe(0)
    })
})
