import { isObject, safeStringify } from './utils'

export type ToolDisplayMode = 'markdown' | 'code'

export type ToolDisplayBlock = {
    mode: ToolDisplayMode
    content: string
    language?: string
}

export type ToolDisplayPresentation = {
    title: string
    subtitle: string | null
}

export type ToolDisplaySections = {
    input: ToolDisplayBlock | null
    result: ToolDisplayBlock | null
}

function getInputStringAny(input: unknown, keys: string[]): string | null {
    if (!isObject(input)) return null

    for (const key of keys) {
        const value = input[key]
        if (typeof value === 'string' && value.trim().length > 0) {
            return value
        }
    }

    return null
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value
    }
    return `${value.slice(0, Math.max(0, maxLength - 1))}…`
}

function snakeToTitleWithSpaces(value: string): string {
    return value
        .split('_')
        .filter((part) => part.length > 0)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ')
}

function formatMcpTitle(toolName: string): string {
    const withoutPrefix = toolName.replace(/^mcp__/, '')
    const parts = withoutPrefix.split('__')
    if (parts.length >= 2) {
        return `MCP: ${snakeToTitleWithSpaces(parts[0])} ${snakeToTitleWithSpaces(parts.slice(1).join('_'))}`
    }
    return `MCP: ${snakeToTitleWithSpaces(withoutPrefix)}`
}

function extractCommand(input: unknown): string | null {
    if (!isObject(input)) return null

    if (Array.isArray(input.command)) {
        const command = input.command.filter((part): part is string => typeof part === 'string').join(' ').trim()
        if (command.length > 0) {
            return command
        }
    }

    const stringCommand = getInputStringAny(input, ['command', 'cmd'])
    if (stringCommand) {
        return stringCommand
    }

    return null
}

function countLines(text: string): number {
    return text.split('\n').length
}

function parseToolUseError(message: string): { isToolUseError: boolean; errorMessage: string | null } {
    const match = message.match(/<tool_use_error>(.*?)<\/tool_use_error>/s)
    if (!match) {
        return { isToolUseError: false, errorMessage: null }
    }

    return {
        isToolUseError: true,
        errorMessage: typeof match[1] === 'string' ? match[1].trim() : '',
    }
}

function extractTextFromContentBlock(block: unknown): string | null {
    if (typeof block === 'string') return block
    if (!isObject(block)) return null
    if (block.type === 'text' && typeof block.text === 'string') return block.text
    if (typeof block.text === 'string') return block.text
    return null
}

function extractTextFromResult(result: unknown, depth: number = 0): string | null {
    if (depth > 2) return null
    if (result === null || result === undefined) return null

    if (typeof result === 'string') {
        const toolUseError = parseToolUseError(result)
        return toolUseError.isToolUseError ? (toolUseError.errorMessage ?? '') : result
    }

    if (Array.isArray(result)) {
        const parts = result
            .map(extractTextFromContentBlock)
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
        return parts.length > 0 ? parts.join('\n') : null
    }

    if (!isObject(result)) return null

    if (typeof result.content === 'string') return result.content
    if (typeof result.text === 'string') return result.text
    if (typeof result.output === 'string') return result.output
    if (typeof result.error === 'string') return result.error
    if (typeof result.message === 'string') return result.message

    const contentArray = Array.isArray(result.content) ? result.content : null
    if (contentArray) {
        const parts = contentArray
            .map(extractTextFromContentBlock)
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
        return parts.length > 0 ? parts.join('\n') : null
    }

    const nestedOutput = isObject(result.output) ? result.output : null
    if (nestedOutput) {
        if (typeof nestedOutput.content === 'string') return nestedOutput.content
        if (typeof nestedOutput.text === 'string') return nestedOutput.text
    }

    const nestedError = isObject(result.error) ? result.error : null
    if (nestedError) {
        if (typeof nestedError.message === 'string') return nestedError.message
        if (typeof nestedError.error === 'string') return nestedError.error
    }

    const nestedResult = isObject(result.result) ? result.result : null
    if (nestedResult) {
        const nestedText = extractTextFromResult(nestedResult, depth + 1)
        if (nestedText) return nestedText
    }

    const nestedData = isObject(result.data) ? result.data : null
    if (nestedData) {
        const nestedText = extractTextFromResult(nestedData, depth + 1)
        if (nestedText) return nestedText
    }

    return null
}

function getNumberValue(obj: Record<string, unknown>, keys: string[]): number | null {
    for (const key of keys) {
        const value = obj[key]
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value
        }
    }
    return null
}

function getStringValue(obj: Record<string, unknown>, keys: string[]): string | null {
    for (const key of keys) {
        const value = obj[key]
        if (typeof value === 'string' && value.length > 0) {
            return value
        }
    }
    return null
}

export function getToolDisplayPresentation(opts: {
    toolName: string
    input: unknown
    result?: unknown
    childrenCount?: number
    description?: string | null
}): ToolDisplayPresentation {
    const description = opts.description ?? null

    if (opts.toolName.startsWith('mcp__')) {
        return {
            title: formatMcpTitle(opts.toolName),
            subtitle: null,
        }
    }

    if (opts.toolName === 'Task') {
        const taskTitle = getInputStringAny(opts.input, ['description']) ?? 'Task'
        const prompt = getInputStringAny(opts.input, ['prompt'])
        return {
            title: taskTitle,
            subtitle: prompt ? truncate(prompt, 120) : null,
        }
    }

    if (opts.toolName === 'CodexBash' || opts.toolName === 'Bash' || opts.toolName === 'shell_command') {
        const command = extractCommand(opts.input)
        return {
            title: description ?? 'Terminal',
            subtitle: command,
        }
    }

    if (opts.toolName === 'Write') {
        const filePath = getInputStringAny(opts.input, ['file_path', 'path'])
        const content = getInputStringAny(opts.input, ['content', 'text'])
        const subtitle = content
            ? `${countLines(content)} line${countLines(content) === 1 ? '' : 's'}`
            : null

        return {
            title: filePath ?? 'Write file',
            subtitle,
        }
    }

    if (opts.toolName === 'Edit' || opts.toolName === 'MultiEdit') {
        return {
            title: getInputStringAny(opts.input, ['file_path', 'path']) ?? 'Edit file',
            subtitle: null,
        }
    }

    if (opts.toolName === 'Read') {
        return {
            title: getInputStringAny(opts.input, ['file_path', 'path', 'file']) ?? 'Read file',
            subtitle: null,
        }
    }

    if (opts.toolName === 'ExitPlanMode' || opts.toolName === 'exit_plan_mode') {
        return {
            title: 'Plan proposal',
            subtitle: null,
        }
    }

    if (opts.toolName === 'AskUserQuestion' || opts.toolName === 'ask_user_question' || opts.toolName === 'request_user_input') {
        const questions = isObject(opts.input) && Array.isArray(opts.input.questions)
            ? opts.input.questions
            : []
        const first = questions[0]
        const subtitle = isObject(first) && typeof first.question === 'string'
            ? truncate(first.question.trim(), 120)
            : null

        return {
            title: questions.length > 1 ? `${questions.length} Questions` : 'Question',
            subtitle,
        }
    }

    return {
        title: description ?? opts.toolName,
        subtitle: null,
    }
}

function extractCommandOutputText(result: unknown): string | null {
    if (result === undefined || result === null) {
        return null
    }

    if (typeof result === 'string') {
        const toolUseError = parseToolUseError(result)
        return toolUseError.isToolUseError ? (toolUseError.errorMessage ?? '') : result
    }

    if (!isObject(result)) {
        return extractTextFromResult(result)
    }

    const nestedOutput = isObject(result.output) ? result.output : null
    const primary = getStringValue(result, ['output', 'stdout'])
        ?? (nestedOutput ? getStringValue(nestedOutput, ['output', 'stdout', 'text', 'content']) : null)
        ?? getStringValue(result, ['delta'])
        ?? extractTextFromResult(result)

    const stderr = getStringValue(result, ['stderr'])
        ?? (nestedOutput ? getStringValue(nestedOutput, ['stderr']) : null)
    const error = getStringValue(result, ['error'])
    const command = getStringValue(result, ['command', 'cmd'])
        ?? (nestedOutput ? getStringValue(nestedOutput, ['command', 'cmd']) : null)
    const cwd = getStringValue(result, ['cwd', 'workingDirectory'])
        ?? (nestedOutput ? getStringValue(nestedOutput, ['cwd', 'workingDirectory']) : null)

    const status = getStringValue(result, ['status'])
    const exitCode = getNumberValue(result, ['exit_code', 'exitCode'])
    const wallTime = getStringValue(result, ['wall_time', 'wallTime', 'duration'])

    const meta: string[] = []
    if (status) meta.push(`Status: ${status}`)
    if (exitCode !== null) meta.push(`Exit code: ${exitCode}`)
    if (wallTime) meta.push(`Wall time: ${wallTime}`)

    const sections: string[] = []
    if (primary) sections.push(primary)
    if (!primary && command) sections.push(`$ ${command}`)
    if (cwd) sections.push(`[cwd]\n${cwd}`)
    if (stderr && stderr !== primary) sections.push(`[stderr]\n${stderr}`)
    if (error && error !== primary && error !== stderr) sections.push(`[error]\n${error}`)
    if (meta.length > 0) sections.push(meta.join(' · '))

    return sections.length > 0 ? sections.join('\n\n') : null
}

export function getToolDisplaySections(opts: {
    toolName: string
    input: unknown
    result?: unknown
}): ToolDisplaySections {
    let input: ToolDisplayBlock | null = null
    let result: ToolDisplayBlock | null = null

    if (opts.toolName === 'Task') {
        const prompt = getInputStringAny(opts.input, ['prompt'])
        input = prompt ? { mode: 'markdown', content: prompt } : null
    } else if (opts.toolName === 'ExitPlanMode' || opts.toolName === 'exit_plan_mode') {
        const plan = getInputStringAny(opts.input, ['plan'])
        input = plan ? { mode: 'markdown', content: plan } : null
    } else if (opts.toolName === 'CodexBash' || opts.toolName === 'Bash' || opts.toolName === 'shell_command') {
        const command = extractCommand(opts.input)
        input = command ? { mode: 'code', content: command, language: 'bash' } : null
    } else if (opts.toolName === 'Write') {
        const content = getInputStringAny(opts.input, ['content', 'text'])
        input = content ? { mode: 'code', content, language: 'text' } : null
    } else {
        input = opts.input === undefined
            ? null
            : { mode: 'code', content: safeStringify(opts.input), language: 'json' }
    }

    if (opts.result !== undefined) {
        if (opts.toolName === 'CodexBash' || opts.toolName === 'Bash' || opts.toolName === 'shell_command') {
            const output = extractCommandOutputText(opts.result)
            result = output ? { mode: 'code', content: output, language: 'text' } : null
        } else {
            const text = extractTextFromResult(opts.result)
            if (text && !text.trim().startsWith('{') && !text.trim().startsWith('[')) {
                result = { mode: 'markdown', content: text }
            } else {
                result = { mode: 'code', content: safeStringify(opts.result), language: 'json' }
            }
        }
    }

    return { input, result }
}
