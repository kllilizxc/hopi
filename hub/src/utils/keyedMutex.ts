type MutexState = {
    locked: boolean
    waiters: Array<() => void>
}

export class KeyedMutex {
    private readonly states: Map<string, MutexState> = new Map()

    async runExclusive<T>(key: string, task: () => Promise<T> | T): Promise<T> {
        const state = this.getOrCreateState(key)
        if (state.locked) {
            await new Promise<void>((resolve) => state.waiters.push(resolve))
        }

        state.locked = true
        try {
            return await task()
        } finally {
            const next = state.waiters.shift()
            if (next) {
                next()
            } else {
                this.states.delete(key)
            }
        }
    }

    getActiveKeyCount(): number {
        return this.states.size
    }

    private getOrCreateState(key: string): MutexState {
        const existing = this.states.get(key)
        if (existing) {
            return existing
        }

        const created: MutexState = {
            locked: false,
            waiters: []
        }
        this.states.set(key, created)
        return created
    }
}
