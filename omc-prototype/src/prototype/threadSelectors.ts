import type { OperatorThread } from './types'

function isUnresolved(thread: OperatorThread) {
    return thread.lifecycle === 'pending'
        || thread.lifecycle === 'waiting'
        || thread.lifecycle === 'in-progress'
}

function scoreThread(thread: OperatorThread, params: {
    goalId?: string | null
    streamId?: string | null
}) {
    let score = 0

    if (params.goalId && thread.goalId === params.goalId) {
        score += 40
    }
    if (params.streamId && thread.refs.some((ref) => ref.kind === 'stream' && ref.id === params.streamId)) {
        score += 30
    }
    if (!thread.passive) {
        score += 10
    }
    if (isUnresolved(thread)) {
        score += 6
    }
    if (thread.unread) {
        score += 3
    }

    return score
}

export function getRelatedThreads(
    threads: OperatorThread[],
    params: {
        goalId?: string | null
        streamId?: string | null
    }
) {
    return threads
        .filter((thread) => {
            if (params.streamId && thread.refs.some((ref) => ref.kind === 'stream' && ref.id === params.streamId)) {
                return true
            }
            if (params.goalId && thread.goalId === params.goalId) {
                return true
            }
            return false
        })
        .sort((left, right) => scoreThread(right, params) - scoreThread(left, params))
}

export function getPrimaryRelatedThread(
    threads: OperatorThread[],
    params: {
        goalId?: string | null
        streamId?: string | null
    }
) {
    return getRelatedThreads(threads, params)[0] ?? null
}

export function countUnresolvedThreads(threads: OperatorThread[]) {
    return threads.filter(isUnresolved).length
}
