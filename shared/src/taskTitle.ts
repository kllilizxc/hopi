const REF_FIELD_PATTERN = '(?:ref|todoRef|todo-ref|todo_ref)'
const SEPARATOR_PATTERN = '[:\\-\\u2013\\u2014]'

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function cleanTitleRemainder(value: string | undefined): string | null {
    const trimmed = value?.trim()
    if (!trimmed) return null

    const titleField = /^(?:[-*]\s+)?title\s*:\s*([\s\S]+)$/iu.exec(trimmed)
    return (titleField?.[1] ?? trimmed).trim() || null
}

function stripExactTodoRefPrefix(title: string, todoRef: string | null | undefined): string | null {
    const ref = todoRef?.trim()
    if (!ref) return null

    const escapedRef = escapeRegExp(ref)
    const labeledWithRemainder = new RegExp(
        `^\\s*(?:[-*]\\s+)?(?:\\[\\s*)?${REF_FIELD_PATTERN}\\s*:\\s*${escapedRef}\\s*(?:\\]\\s*)?(?:(?:\\r?\\n)+|\\s*${SEPARATOR_PATTERN}\\s+)([\\s\\S]+)$`,
        'iu'
    )
    const labeledMatch = labeledWithRemainder.exec(title)
    const labeledRemainder = cleanTitleRemainder(labeledMatch?.[1])
    if (labeledRemainder) return labeledRemainder

    const bareWithRemainder = new RegExp(
        `^\\s*(?:\\[\\s*)?${escapedRef}\\s*(?:\\]\\s*)?(?:(?:\\r?\\n)+|\\s*${SEPARATOR_PATTERN}\\s+)([\\s\\S]+)$`,
        'iu'
    )
    const bareMatch = bareWithRemainder.exec(title)
    const bareRemainder = cleanTitleRemainder(bareMatch?.[1])
    if (bareRemainder) return bareRemainder

    const labeledOnly = new RegExp(
        `^\\s*(?:[-*]\\s+)?(?:\\[\\s*)?${REF_FIELD_PATTERN}\\s*:\\s*${escapedRef}\\s*(?:\\]\\s*)?$`,
        'iu'
    )
    return labeledOnly.test(title) ? ref : null
}

export function stripLeadingTaskTitleRef(title: string, todoRef?: string | null): string {
    const trimmed = title.trim()
    if (!trimmed) return trimmed

    const exact = stripExactTodoRefPrefix(trimmed, todoRef)
    if (exact) return exact

    const bracketMatch = new RegExp(
        `^\\s*\\[\\s*${REF_FIELD_PATTERN}\\s*:\\s*[^\\]]+\\]\\s+([\\s\\S]+)$`,
        'iu'
    ).exec(trimmed)
    const bracketRemainder = cleanTitleRemainder(bracketMatch?.[1])
    if (bracketRemainder) return bracketRemainder

    const lineMatch = new RegExp(
        `^\\s*(?:[-*]\\s+)?${REF_FIELD_PATTERN}\\s*:\\s*[^\\r\\n]+\\r?\\n+([\\s\\S]+)$`,
        'iu'
    ).exec(trimmed)
    const lineRemainder = cleanTitleRemainder(lineMatch?.[1])
    if (lineRemainder) return lineRemainder

    const inlineMatch = new RegExp(
        `^\\s*(?:[-*]\\s+)?${REF_FIELD_PATTERN}\\s*:\\s*.+?(?:\\s+[\\-\\u2013\\u2014]\\s+|:\\s+)([\\s\\S]+)$`,
        'iu'
    ).exec(trimmed)
    const inlineRemainder = cleanTitleRemainder(inlineMatch?.[1])
    if (inlineRemainder) return inlineRemainder

    return trimmed
}
