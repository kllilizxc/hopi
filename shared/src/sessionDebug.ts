const DEBUG_ID_PREFIX = 'S'
const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

export const SESSION_DEBUG_ID_PATTERN = /^S-[0-9a-f]{8}$/

export function getSessionDebugId(sessionId: string): string {
    let hash = FNV_OFFSET_BASIS

    for (let index = 0; index < sessionId.length; index += 1) {
        hash ^= sessionId.charCodeAt(index)
        hash = Math.imul(hash, FNV_PRIME) >>> 0
    }

    return `${DEBUG_ID_PREFIX}-${hash.toString(16).padStart(8, '0')}`
}
