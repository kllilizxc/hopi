export const KANBAN_SKILL_MARKDOWN = `# HOPI Kanban

Project-local control surface for Goal kanban workflow state.

Use this skill to read or mutate \`.hopi/docs/goals/<goalKey>/todo.yml\`.
The script is intentionally self-contained: Node.js only, no package install.

Commands:

\`\`\`bash
node .hopi/skills/kanban/todo.mjs list --goal <goalKey>
node .hopi/skills/kanban/todo.mjs add --goal <goalKey> --ref <ref> --title <title> --status candidate|planned
node .hopi/skills/kanban/todo.mjs move --goal <goalKey> --ref <ref> --status candidate|planned|in_progress|in_review|merging|blocked|done
node .hopi/skills/kanban/todo.mjs update --goal <goalKey> --ref <ref> --title <title> --body <body>
node .hopi/skills/kanban/todo.mjs link-dependency --goal <goalKey> --ref <ref> --depends-on <ref>
\`\`\`

Rules:

- \`todo.yml\` is the durable kanban source of truth.
- Every mutation validates refs, statuses, dependency targets, and dependency cycles.
- Successful mutations atomically rewrite \`todo.yml\` and append \`events.jsonl\`.
- Failed mutations leave files unchanged.
`

export const KANBAN_YAML_MJS = String.raw`function countIndent(line) {
    const match = /^ */.exec(line)
    return match ? match[0].length : 0
}

function stripComment(line) {
    let inQuote = false
    let quote = ''
    let escaped = false
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]
        if (escaped) {
            escaped = false
            continue
        }
        if (char === '\\') {
            escaped = true
            continue
        }
        if (inQuote) {
            if (char === quote) {
                inQuote = false
                quote = ''
            }
            continue
        }
        if (char === '"' || char === "'") {
            inQuote = true
            quote = char
            continue
        }
        if (char === '#') {
            return line.slice(0, index).trimEnd()
        }
    }
    return line.trimEnd()
}

function splitKeyValue(text) {
    const index = text.indexOf(':')
    if (index < 0) {
        return null
    }
    return {
        key: text.slice(0, index).trim(),
        value: text.slice(index + 1).trim()
    }
}

function parseScalar(raw) {
    const value = raw.trim()
    if (value === '') return ''
    if (value === 'null') return null
    if (value === 'true') return true
    if (value === 'false') return false
    if (value === '[]') return []
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        try {
            return JSON.parse(value)
        } catch {
            return value.slice(1, -1)
        }
    }
    if (/^-?\d+(?:\.\d+)?$/.test(value)) {
        return Number(value)
    }
    return value
}

function formatScalar(value) {
    if (value === null || value === undefined) return 'null'
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    const text = String(value)
    if (/^[A-Za-z0-9_.@/-]+$/.test(text)) {
        return text
    }
    return JSON.stringify(text)
}

function setField(target, key, value) {
    if (!key) return
    target[key] = parseScalar(value)
}

function normalizeDependencyList(value) {
    if (!Array.isArray(value)) return []
    const seen = new Set()
    const result = []
    for (const entry of value) {
        const ref = typeof entry === 'string'
            ? entry.trim()
            : entry && typeof entry === 'object' && typeof entry.ref === 'string'
                ? entry.ref.trim()
                : ''
        if (!ref || seen.has(ref)) continue
        result.push({ ref })
        seen.add(ref)
    }
    return result
}

function normalizeBlockers(value) {
    if (!Array.isArray(value)) return undefined
    const result = value
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => {
            const next = {}
            for (const [key, raw] of Object.entries(entry)) {
                if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
                    next[key] = raw
                }
            }
            return next
        })
        .filter((entry) => Object.keys(entry).length > 0)
    return result.length > 0 ? result : undefined
}

export function parseTodoYaml(rawYaml) {
    const doc = {
        version: 1,
        goal: {},
        items: []
    }
    let section = null
    let currentItem = null
    let currentListName = null
    let currentListItem = null

    const lines = String(rawYaml ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
    for (const originalLine of lines) {
        const line = stripComment(originalLine)
        if (!line.trim()) continue
        const indent = countIndent(line)
        const text = line.trim()

        if (indent === 0) {
            currentItem = null
            currentListName = null
            currentListItem = null
            const kv = splitKeyValue(text)
            if (!kv) continue
            if (kv.key === 'goal') {
                section = 'goal'
                continue
            }
            if (kv.key === 'items') {
                section = 'items'
                if (Array.isArray(parseScalar(kv.value))) {
                    doc.items = []
                }
                continue
            }
            if (kv.key === 'version') {
                const version = parseScalar(kv.value)
                doc.version = typeof version === 'number' ? version : 1
            }
            continue
        }

        if (section === 'goal' && indent === 2) {
            const kv = splitKeyValue(text)
            if (kv) setField(doc.goal, kv.key, kv.value)
            continue
        }

        if (section !== 'items') continue

        if ((indent === 2 || indent === 0) && text.startsWith('- ')) {
            currentItem = {}
            currentListName = null
            currentListItem = null
            doc.items.push(currentItem)
            const rest = text.slice(2).trim()
            const kv = splitKeyValue(rest)
            if (kv) setField(currentItem, kv.key, kv.value)
            continue
        }

        if (!currentItem) continue

        if (indent === 4) {
            currentListItem = null
            const kv = splitKeyValue(text)
            if (!kv) continue
            if (kv.value === '') {
                currentListName = kv.key
                currentItem[currentListName] = Array.isArray(currentItem[currentListName])
                    ? currentItem[currentListName]
                    : []
                continue
            }
            currentListName = null
            setField(currentItem, kv.key, kv.value)
            continue
        }

        if (indent === 6 && currentListName && text.startsWith('- ')) {
            currentListItem = {}
            currentItem[currentListName].push(currentListItem)
            const rest = text.slice(2).trim()
            const kv = splitKeyValue(rest)
            if (kv) setField(currentListItem, kv.key, kv.value)
            continue
        }

        if (indent === 8 && currentListItem) {
            const kv = splitKeyValue(text)
            if (kv) setField(currentListItem, kv.key, kv.value)
        }
    }

    doc.items = doc.items.map((item) => ({
        ...item,
        dependencyTaskList: normalizeDependencyList(item.dependencyTaskList),
        blockers: normalizeBlockers(item.blockers)
    }))
    return doc
}

function writeKeyValue(lines, indent, key, value) {
    if (value === undefined || value === null || String(value).trim() === '') return
    lines.push(' '.repeat(indent) + key + ': ' + formatScalar(value))
}

export function stringifyTodoYaml(document) {
    const lines = ['version: 1']
    const goal = document.goal && typeof document.goal === 'object' ? document.goal : {}
    if (Object.keys(goal).length > 0) {
        lines.push('goal:')
        writeKeyValue(lines, 2, 'goalKey', goal.goalKey)
        writeKeyValue(lines, 2, 'goalId', goal.goalId)
        writeKeyValue(lines, 2, 'title', goal.title)
    }

    const items = Array.isArray(document.items) ? document.items : []
    if (items.length === 0) {
        lines.push('items: []')
        return lines.join('\n') + '\n'
    }

    lines.push('items:')
    for (const item of items) {
        lines.push('  - ref: ' + formatScalar(item.ref))
        writeKeyValue(lines, 4, 'status', item.status)
        writeKeyValue(lines, 4, 'title', item.title)
        writeKeyValue(lines, 4, 'body', item.body)

        const dependencies = normalizeDependencyList(item.dependencyTaskList)
        if (dependencies.length > 0) {
            lines.push('    dependencyTaskList:')
            for (const dependency of dependencies) {
                lines.push('      - ref: ' + formatScalar(dependency.ref))
            }
        }

        const blockers = normalizeBlockers(item.blockers)
        if (blockers && blockers.length > 0) {
            lines.push('    blockers:')
            for (const blocker of blockers) {
                const entries = Object.entries(blocker)
                const [firstKey, firstValue] = entries.shift() ?? ['kind', 'blocked']
                lines.push('      - ' + firstKey + ': ' + formatScalar(firstValue))
                for (const [key, value] of entries) {
                    writeKeyValue(lines, 8, key, value)
                }
            }
        }
    }
    return lines.join('\n') + '\n'
}
`

export const KANBAN_TODO_MJS = String.raw`#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseTodoYaml, stringifyTodoYaml } from './yaml.mjs'

const STATUSES = new Set(['candidate', 'planned', 'in_progress', 'in_review', 'merging', 'blocked', 'done'])
const ADD_STATUSES = new Set(['candidate', 'planned'])
const REF_PATTERN = /^[A-Za-z0-9_.-]+$/

function fail(message) {
    throw new Error(message)
}

function parseArgs(argv) {
    const [command, ...rest] = argv
    const flags = {}
    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index]
        if (!token.startsWith('--')) {
            fail('Unexpected argument: ' + token)
        }
        const key = token.slice(2)
        const value = rest[index + 1]
        if (!key || value === undefined || value.startsWith('--')) {
            fail('Missing value for --' + key)
        }
        flags[key] = value
        index += 1
    }
    return { command, flags }
}

function requireFlag(flags, name) {
    const value = flags[name]
    if (typeof value !== 'string' || value.trim() === '') {
        fail('Missing --' + name)
    }
    return value.trim()
}

function validateToken(name, value) {
    if (!REF_PATTERN.test(value)) {
        fail(name + ' must match ' + REF_PATTERN.source)
    }
}

function pathsForGoal(goalKey) {
    validateToken('goal', goalKey)
    const goalDir = join(process.cwd(), '.hopi', 'docs', 'goals', goalKey)
    return {
        goalDir,
        todoPath: join(goalDir, 'todo.yml'),
        eventsPath: join(goalDir, 'events.jsonl')
    }
}

function readDocument(goalKey) {
    const paths = pathsForGoal(goalKey)
    if (!existsSync(paths.todoPath)) {
        fail('todo.yml not found for goal ' + goalKey)
    }
    const document = parseTodoYaml(readFileSync(paths.todoPath, 'utf8'))
    if (!document.goal || typeof document.goal !== 'object') {
        document.goal = {}
    }
    document.goal.goalKey = document.goal.goalKey || goalKey
    document.items = Array.isArray(document.items) ? document.items : []
    validateDocument(document)
    return { paths, document }
}

function normalizeItem(item) {
    const ref = typeof item.ref === 'string' ? item.ref.trim() : ''
    const status = typeof item.status === 'string' ? item.status.trim() : ''
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    return {
        ...item,
        ref,
        status,
        title,
        body: typeof item.body === 'string' ? item.body : item.body == null ? null : String(item.body),
        dependencyTaskList: Array.isArray(item.dependencyTaskList)
            ? item.dependencyTaskList
                .map((dependency) => ({ ref: typeof dependency?.ref === 'string' ? dependency.ref.trim() : '' }))
                .filter((dependency) => dependency.ref)
            : []
    }
}

function assertNoDependencyCycle(items) {
    const byRef = new Map(items.map((item) => [item.ref, item]))
    const visiting = new Set()
    const visited = new Set()

    function visit(ref, path) {
        if (visited.has(ref)) return
        if (visiting.has(ref)) {
            fail('dependency cycle detected: ' + [...path, ref].join(' -> '))
        }
        visiting.add(ref)
        const item = byRef.get(ref)
        for (const dependency of item?.dependencyTaskList ?? []) {
            visit(dependency.ref, [...path, ref])
        }
        visiting.delete(ref)
        visited.add(ref)
    }

    for (const item of items) {
        visit(item.ref, [])
    }
}

function validateDocument(document) {
    const refs = new Set()
    document.items = document.items.map(normalizeItem)
    for (const item of document.items) {
        if (!item.ref) fail('item ref is required')
        validateToken('ref', item.ref)
        if (refs.has(item.ref)) fail('duplicate ref: ' + item.ref)
        refs.add(item.ref)
        if (!STATUSES.has(item.status)) fail('invalid status for ' + item.ref + ': ' + item.status)
        if (!item.title) fail('title is required for ' + item.ref)
    }
    for (const item of document.items) {
        const seen = new Set()
        item.dependencyTaskList = item.dependencyTaskList.filter((dependency) => {
            if (seen.has(dependency.ref)) return false
            seen.add(dependency.ref)
            if (!refs.has(dependency.ref)) fail('missing dependency target for ' + item.ref + ': ' + dependency.ref)
            if (dependency.ref === item.ref) fail('dependency cycle detected: ' + item.ref + ' -> ' + dependency.ref)
            return true
        })
    }
    assertNoDependencyCycle(document.items)
}

function atomicWrite(path, content) {
    mkdirSync(dirname(path), { recursive: true })
    const tmpPath = path + '.tmp-' + process.pid + '-' + Date.now()
    writeFileSync(tmpPath, content, 'utf8')
    renameSync(tmpPath, path)
}

function appendEvent(paths, input) {
    mkdirSync(dirname(paths.eventsPath), { recursive: true })
    appendFileSync(paths.eventsPath, JSON.stringify({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        createdAt: Date.now(),
        writer: 'kanban_skill',
        action: input.action,
        entity: input.entity,
        before: input.before ?? null,
        after: input.after ?? null,
        reason: input.reason ?? null,
        command: input.command
    }) + '\n', 'utf8')
}

function writeDocument(paths, document, event) {
    validateDocument(document)
    atomicWrite(paths.todoPath, stringifyTodoYaml(document))
    appendEvent(paths, event)
}

function findItem(document, ref) {
    return document.items.find((item) => item.ref === ref) ?? null
}

function commandList(flags, command) {
    const goal = requireFlag(flags, 'goal')
    const { paths, document } = readDocument(goal)
    return {
        ok: true,
        command,
        goal,
        path: paths.todoPath,
        items: document.items
    }
}

function commandAdd(flags, command) {
    const goal = requireFlag(flags, 'goal')
    const ref = requireFlag(flags, 'ref')
    const title = requireFlag(flags, 'title')
    const status = requireFlag(flags, 'status')
    validateToken('ref', ref)
    if (!ADD_STATUSES.has(status)) {
        fail('add status must be candidate or planned')
    }
    const { paths, document } = readDocument(goal)
    if (findItem(document, ref)) fail('duplicate ref: ' + ref)
    const item = { ref, status, title, dependencyTaskList: [] }
    document.items.push(item)
    writeDocument(paths, document, {
        action: 'item_added',
        entity: { type: 'task', id: ref },
        after: item,
        reason: flags.reason ?? null,
        command
    })
    return { ok: true, item }
}

function commandMove(flags, command) {
    const goal = requireFlag(flags, 'goal')
    const ref = requireFlag(flags, 'ref')
    const status = requireFlag(flags, 'status')
    if (!STATUSES.has(status)) fail('invalid status: ' + status)
    const { paths, document } = readDocument(goal)
    const item = findItem(document, ref)
    if (!item) fail('ref not found: ' + ref)
    const before = { ...item }
    item.status = status
    writeDocument(paths, document, {
        action: 'item_moved',
        entity: { type: 'task', id: ref },
        before,
        after: item,
        reason: flags.reason ?? null,
        command
    })
    return { ok: true, item }
}

function commandUpdate(flags, command) {
    const goal = requireFlag(flags, 'goal')
    const ref = requireFlag(flags, 'ref')
    const { paths, document } = readDocument(goal)
    const item = findItem(document, ref)
    if (!item) fail('ref not found: ' + ref)
    const before = { ...item }
    if (flags.title !== undefined) item.title = String(flags.title).trim()
    if (flags.body !== undefined) item.body = String(flags.body).trim()
    writeDocument(paths, document, {
        action: 'item_updated',
        entity: { type: 'task', id: ref },
        before,
        after: item,
        reason: flags.reason ?? null,
        command
    })
    return { ok: true, item }
}

function commandLinkDependency(flags, command) {
    const goal = requireFlag(flags, 'goal')
    const ref = requireFlag(flags, 'ref')
    const dependsOn = requireFlag(flags, 'depends-on')
    validateToken('ref', ref)
    validateToken('depends-on', dependsOn)
    const { paths, document } = readDocument(goal)
    const item = findItem(document, ref)
    if (!item) fail('ref not found: ' + ref)
    if (!findItem(document, dependsOn)) fail('missing dependency target for ' + ref + ': ' + dependsOn)
    const before = { ...item, dependencyTaskList: [...(item.dependencyTaskList ?? [])] }
    item.dependencyTaskList = Array.isArray(item.dependencyTaskList) ? item.dependencyTaskList : []
    if (!item.dependencyTaskList.some((dependency) => dependency.ref === dependsOn)) {
        item.dependencyTaskList.push({ ref: dependsOn })
    }
    writeDocument(paths, document, {
        action: 'dependency_linked',
        entity: { type: 'task', id: ref },
        before,
        after: item,
        reason: flags.reason ?? null,
        command
    })
    return { ok: true, item }
}

function main() {
    const { command, flags } = parseArgs(process.argv.slice(2))
    if (!command) {
        fail('Missing command')
    }
    const handlers = {
        list: commandList,
        add: commandAdd,
        move: commandMove,
        update: commandUpdate,
        'link-dependency': commandLinkDependency
    }
    const handler = handlers[command]
    if (!handler) {
        fail('Unknown command: ' + command)
    }
    const result = handler(flags, command)
    process.stdout.write(JSON.stringify(result, null, 2) + '\n')
}

try {
    main()
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
}
`
