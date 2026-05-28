type JsonRecord = Record<string, unknown>

export type HopiActionView = {
    type: string
    titleKey: string
    titleFallback: string
    status: string | null
    handoff: string | null
    evidence: string | null
    description: string | null
}

export type HopiActionPacketView = {
    introText: string
    rawPayload: string
    actions: HopiActionView[]
}

function isRecord(value: unknown): value is JsonRecord {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function normalizeStatus(value: unknown): string | null {
    const status = asString(value)
    if (!status) return null

    const normalized = status
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[\s-]+/g, '_')
        .toLowerCase()

    if (normalized === 'inreview') return 'in_review'
    if (normalized === 'inprogress') return 'in_progress'
    return normalized
}

function titleForAction(action: JsonRecord): { key: string; fallback: string } {
    const type = asString(action.type) ?? 'unknown'
    if (type === 'update_current_task') {
        const status = normalizeStatus(action.status)
        if (status) {
            return {
                key: `hopiActions.status.${status}`,
                fallback: `Task ${status.replace(/_/g, ' ')}`
            }
        }
    }

    return {
        key: `hopiActions.type.${type}`,
        fallback: type.replace(/_/g, ' ')
    }
}

function extractBalancedJsonObject(text: string, startIndex: number): string | null {
    let depth = 0
    let inString = false
    let escaped = false

    for (let index = startIndex; index < text.length; index += 1) {
        const char = text[index]

        if (inString) {
            if (escaped) {
                escaped = false
                continue
            }
            if (char === '\\') {
                escaped = true
                continue
            }
            if (char === '"') {
                inString = false
            }
            continue
        }

        if (char === '"') {
            inString = true
            continue
        }
        if (char === '{') {
            depth += 1
            continue
        }
        if (char === '}') {
            depth -= 1
            if (depth === 0) {
                return text.slice(startIndex, index + 1).trim()
            }
        }
    }

    return null
}

function findTrailingFencedPayload(
    text: string,
    pattern: RegExp
): { introText: string; payload: string } | null {
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
        const payload = match[1]
        const matchEnd = match.index + match[0].length
        if (payload && text.slice(matchEnd).trim().length === 0) {
            return {
                introText: text.slice(0, match.index).trim(),
                payload: payload.trim()
            }
        }
    }

    return null
}

function extractPayload(text: string): { introText: string; payload: string; source: 'marker' | 'bare' } | null {
    const markerThenFence = findTrailingFencedPayload(
        text,
        /HOPI_ACTIONS\s*:?\s*```(?:json)?\s*([\s\S]*?)```/giu
    )
    if (markerThenFence) {
        return {
            introText: markerThenFence.introText,
            payload: markerThenFence.payload,
            source: 'marker'
        }
    }

    const markerFence = findTrailingFencedPayload(
        text,
        /```HOPI_ACTIONS\s*([\s\S]*?)```/giu
    )
    if (markerFence) {
        return {
            introText: markerFence.introText,
            payload: markerFence.payload,
            source: 'marker'
        }
    }

    const markerIndex = text.lastIndexOf('HOPI_ACTIONS')
    if (markerIndex >= 0) {
        const afterMarker = text.slice(markerIndex + 'HOPI_ACTIONS'.length)
        const jsonStart = afterMarker.indexOf('{')
        if (jsonStart < 0) return null

        const balanced = extractBalancedJsonObject(afterMarker, jsonStart)
        if (!balanced) return null
        if (afterMarker.slice(jsonStart + balanced.length).trim().length > 0) return null

        return {
            introText: text.slice(0, markerIndex).trim(),
            payload: balanced,
            source: 'marker'
        }
    }

    const trimmed = text.trim()
    if (!trimmed.startsWith('{')) return null
    const balanced = extractBalancedJsonObject(trimmed, 0)
    if (!balanced || balanced.length !== trimmed.length) return null

    return {
        introText: '',
        payload: balanced,
        source: 'bare'
    }
}

function actionToView(action: JsonRecord): HopiActionView {
    const title = titleForAction(action)
    return {
        type: asString(action.type) ?? 'unknown',
        titleKey: title.key,
        titleFallback: title.fallback,
        status: normalizeStatus(action.status),
        handoff: asString(action.handoff),
        evidence: asString(action.evidence),
        description: asString(action.description)
    }
}

function isKnownAction(action: HopiActionView): boolean {
    return [
        'update_current_task',
        'create_task',
        'create_goal_task',
        'create_decision_topic',
        'update_goal',
        'append_goal_todo',
        'request_human_input',
        'start_preview',
        'stop_preview',
        'merge_task_worktree'
    ].includes(action.type)
}

export function extractHopiActionPacketView(text: string): HopiActionPacketView | null {
    const extracted = extractPayload(text)
    if (!extracted) return null

    let parsed: unknown
    try {
        parsed = JSON.parse(extracted.payload)
    } catch {
        return null
    }

    if (!isRecord(parsed) || !Array.isArray(parsed.actions)) return null

    const actions = parsed.actions
        .filter(isRecord)
        .map(actionToView)

    if (actions.length === 0) return null
    if (extracted.source === 'bare' && !actions.some(isKnownAction)) return null

    return {
        introText: extracted.introText,
        rawPayload: extracted.payload,
        actions
    }
}
