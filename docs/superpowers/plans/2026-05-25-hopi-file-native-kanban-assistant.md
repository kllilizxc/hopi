# HOPI File-Native Kanban Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build P0 file-native goal kanban: project-local kanban scripts write `todo.yml`, board reads workflow state from docs, DB only overlays runtime/session data, and write traces are recorded separately.

**Architecture:** `todo.yml` becomes the only durable kanban workflow truth. Hub APIs parse docs on read and overlay runtime data from DB by `goalId/goalKey + taskRef`; mutating goal-board APIs are disabled until they can call the project-local script. Bootstrap creates a self-contained `.hopi/skills/kanban/` directory, and a unified write trace recorder appends compact file-write audit entries.

**Tech Stack:** Bun workspace, TypeScript hub/web, Hono routes, Vitest/Bun test runner, Node.js ESM for project-local `.hopi/skills/kanban/todo.mjs`.

---

## Scope

This plan implements P0 only.

In scope:

- Bootstrap `.hopi/skills/kanban/SKILL.md`, `todo.mjs`, and `yaml.mjs`.
- Keep the skill self-contained and runnable with `node`.
- Parse `todo.yml` as canonical board state.
- Overlay DB runtime/session fields without treating DB task fields as workflow truth.
- Make goal-board UI workflow mutations read-only in P0.
- Reject hidden server-side goal-kanban writes with actionable guidance.
- Add `write-trace.jsonl` path support and a normalized `WriteTraceRecorder`.

Out of scope:

- P1 assistant-made skill creation.
- Skill manifests, template versions, auto-upgrades.
- Full session transcript persistence into docs.
- Replaying `events.jsonl`.
- Removing every legacy DB task column. P0 stops relying on those columns for canonical goal-board reads.

## File Structure

Create:

- `hub/src/sync/goals/goalDocPaths.test.ts` - path helper coverage.
- `hub/src/sync/goals/kanbanSkillTemplates.ts` - embedded project-local skill file contents.
- `hub/src/sync/goals/kanbanSkillTemplates.test.ts` - writes templates to a temp workspace and executes `node todo.mjs`.
- `hub/src/sync/goals/fileNativeBoard.ts` - builds board cards from `todo.yml` plus runtime overlay.
- `hub/src/sync/goals/fileNativeBoard.test.ts` - board projection tests.
- `hub/src/sync/goals/writeTraceRecorder.ts` - normalized write trace append helper.
- `hub/src/sync/goals/writeTraceRecorder.test.ts` - trace filtering and append tests.

Modify:

- `hub/src/sync/goals/goalDocPaths.ts` - add skill and trace path helpers.
- `hub/src/sync/goals/goalDocs.ts` - bootstrap skill files and empty `write-trace.jsonl`.
- `hub/src/sync/goals/goalTodo.ts` - preserve P0 statuses, dependencies, and blockers.
- `hub/src/sync/goals/goalTodo.test.ts` - cover P0 schema.
- `hub/src/web/routes/tasks.ts` - read goal tasks from file-native board builder; reject hidden goal task writes.
- `hub/src/web/routes/tasks.goal.test.ts` - update API expectations.
- `hub/src/sync/goals/goalAssistantCommands.ts` - keep read commands; reject write commands that would mutate kanban through DB.
- `hub/src/web/routes/goal-assistant-commands.test.ts` - update assistant command tests.
- `web/src/routes/projects/kanban.tsx` - hide goal-board workflow mutation buttons in P0.
- `web/src/routes/projects/layout.tsx` - do not open New Task dialog for file-native goals.
- `web/src/routes/projects/kanban.test.tsx` - verify read-only goal board controls.

Do not modify unrelated dirty files except where the task explicitly says so. The current worktree already contains many unrelated changes; read each file before editing and preserve user/other-agent work.

---

### Task 1: Add File-Native Paths

**Files:**

- Modify: `hub/src/sync/goals/goalDocPaths.ts`
- Create: `hub/src/sync/goals/goalDocPaths.test.ts`

- [ ] **Step 1: Write failing tests for skill and write-trace paths**

Create `hub/src/sync/goals/goalDocPaths.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'
import {
    getGoalWriteTracePath,
    getHopiSkillsRoot,
    getKanbanSkillDir,
    getKanbanSkillFilePath,
    getKanbanSkillPath,
    getDocsRoot
} from './goalDocPaths'

describe('goal doc paths', () => {
    it('resolves file-native kanban skill paths from a workspace', () => {
        const workspace = { path: '/repo' } as never

        expect(getDocsRoot(workspace)).toBe(join('/repo', '.hopi', 'docs'))
        expect(getHopiSkillsRoot(workspace)).toBe(join('/repo', '.hopi', 'skills'))
        expect(getKanbanSkillDir(workspace)).toBe(join('/repo', '.hopi', 'skills', 'kanban'))
        expect(getKanbanSkillPath(workspace)).toBe(join('/repo', '.hopi', 'skills', 'kanban', 'todo.mjs'))
        expect(getKanbanSkillFilePath(workspace, 'SKILL.md')).toBe(join('/repo', '.hopi', 'skills', 'kanban', 'SKILL.md'))
        expect(getKanbanSkillFilePath(workspace, 'yaml.mjs')).toBe(join('/repo', '.hopi', 'skills', 'kanban', 'yaml.mjs'))
    })

    it('resolves goal write trace under the goal docs directory', () => {
        expect(getGoalWriteTracePath('/repo/.hopi/docs', 'ship-it')).toBe(
            join('/repo', '.hopi', 'docs', 'goals', 'ship-it', 'write-trace.jsonl')
        )
    })

    it('returns null skill roots when no workspace path exists', () => {
        expect(getHopiSkillsRoot(null)).toBe(null)
        expect(getKanbanSkillDir(null)).toBe(null)
        expect(getKanbanSkillPath(null)).toBe(null)
    })
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
cd hub && bun test src/sync/goals/goalDocPaths.test.ts
```

Expected: FAIL because `getGoalWriteTracePath`, `getHopiSkillsRoot`, `getKanbanSkillDir`, `getKanbanSkillFilePath`, and `getKanbanSkillPath` do not exist.

- [ ] **Step 3: Add path helpers**

Modify `hub/src/sync/goals/goalDocPaths.ts` by adding constants and functions:

```ts
export const GOAL_WRITE_TRACE_FILENAME = 'write-trace.jsonl'
export const HOPI_SKILLS_DIRNAME = 'skills'
export const KANBAN_SKILL_DIRNAME = 'kanban'
export const KANBAN_SKILL_DOC_FILENAME = 'SKILL.md'
export const KANBAN_SKILL_TODO_FILENAME = 'todo.mjs'
export const KANBAN_SKILL_YAML_FILENAME = 'yaml.mjs'

export function getHopiSkillsRoot(defaultWorkspace: StoredWorkspace | null): string | null {
    const hopiRoot = getHopiRoot(defaultWorkspace)
    return hopiRoot ? join(hopiRoot, HOPI_SKILLS_DIRNAME) : null
}

export function getKanbanSkillDir(defaultWorkspace: StoredWorkspace | null): string | null {
    const skillsRoot = getHopiSkillsRoot(defaultWorkspace)
    return skillsRoot ? join(skillsRoot, KANBAN_SKILL_DIRNAME) : null
}

export function getKanbanSkillFilePath(
    defaultWorkspace: StoredWorkspace | null,
    filename: typeof KANBAN_SKILL_DOC_FILENAME | typeof KANBAN_SKILL_TODO_FILENAME | typeof KANBAN_SKILL_YAML_FILENAME
): string | null {
    const skillDir = getKanbanSkillDir(defaultWorkspace)
    return skillDir ? join(skillDir, filename) : null
}

export function getKanbanSkillPath(defaultWorkspace: StoredWorkspace | null): string | null {
    return getKanbanSkillFilePath(defaultWorkspace, KANBAN_SKILL_TODO_FILENAME)
}

export function getGoalWriteTracePath(docsRoot: string, goalKey: string): string {
    return join(getGoalDocsDir(docsRoot, goalKey), GOAL_WRITE_TRACE_FILENAME)
}
```

- [ ] **Step 4: Run the focused test and confirm pass**

Run:

```bash
cd hub && bun test src/sync/goals/goalDocPaths.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hub/src/sync/goals/goalDocPaths.ts hub/src/sync/goals/goalDocPaths.test.ts
git commit -m "feat: add file-native goal doc paths"
```

---

### Task 2: Add Project-Local Kanban Skill Templates

**Files:**

- Create: `hub/src/sync/goals/kanbanSkillTemplates.ts`
- Create: `hub/src/sync/goals/kanbanSkillTemplates.test.ts`

- [ ] **Step 1: Write tests that execute the generated Node script**

Create `hub/src/sync/goals/kanbanSkillTemplates.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KANBAN_SKILL_FILES } from './kanbanSkillTemplates'

function writeSkill(workspacePath: string): string {
    const dir = join(workspacePath, '.hopi', 'skills', 'kanban')
    mkdirSync(dir, { recursive: true })
    for (const file of KANBAN_SKILL_FILES) {
        writeFileSync(join(dir, file.filename), file.content, 'utf8')
    }
    return join(dir, 'todo.mjs')
}

function run(scriptPath: string, cwd: string, args: string[]): unknown {
    const output = execFileSync('node', [scriptPath, ...args], {
        cwd,
        encoding: 'utf8',
        env: { ...process.env, NO_COLOR: '1' }
    })
    return JSON.parse(output)
}

describe('kanban skill templates', () => {
    it('adds, moves, updates, and links dependencies in todo.yml', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-kanban-skill-'))
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'demo')
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            '  goalKey: demo',
            '  title: Demo',
            'items: []',
            ''
        ].join('\n'), 'utf8')

        const script = writeSkill(workspacePath)

        expect(run(script, workspacePath, ['add', '--goal', 'demo', '--ref', 'first', '--title', 'First task', '--status', 'planned'])).toMatchObject({ ok: true })
        expect(run(script, workspacePath, ['add', '--goal', 'demo', '--ref', 'second', '--title', 'Second task', '--status', 'candidate'])).toMatchObject({ ok: true })
        expect(run(script, workspacePath, ['move', '--goal', 'demo', '--ref', 'second', '--status', 'planned'])).toMatchObject({ ok: true })
        expect(run(script, workspacePath, ['update', '--goal', 'demo', '--ref', 'second', '--body', 'Updated body'])).toMatchObject({ ok: true })
        expect(run(script, workspacePath, ['link-dependency', '--goal', 'demo', '--ref', 'second', '--depends-on', 'first'])).toMatchObject({ ok: true })

        const todo = readFileSync(join(goalDir, 'todo.yml'), 'utf8')
        expect(todo).toContain('ref: first')
        expect(todo).toContain('ref: second')
        expect(todo).toContain('status: planned')
        expect(todo).toContain('body: Updated body')
        expect(todo).toContain('dependencyTaskList:')
        expect(todo).toContain('ref: first')

        const eventsPath = join(goalDir, 'events.jsonl')
        expect(existsSync(eventsPath)).toBe(true)
        const events = readFileSync(eventsPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { action: string })
        expect(events.map((event) => event.action)).toEqual([
            'item_added',
            'item_added',
            'item_moved',
            'item_updated',
            'dependency_linked'
        ])
    })

    it('rejects invalid writes without mutating todo.yml', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-kanban-skill-'))
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'demo')
        mkdirSync(goalDir, { recursive: true })
        const original = [
            'version: 1',
            'goal:',
            '  goalKey: demo',
            '  title: Demo',
            'items:',
            '  - ref: first',
            '    status: planned',
            '    title: First task',
            ''
        ].join('\n')
        writeFileSync(join(goalDir, 'todo.yml'), original, 'utf8')
        const script = writeSkill(workspacePath)

        expect(() => run(script, workspacePath, ['add', '--goal', 'demo', '--ref', 'first', '--title', 'Duplicate', '--status', 'planned'])).toThrow()
        expect(readFileSync(join(goalDir, 'todo.yml'), 'utf8')).toBe(original)
    })
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```bash
cd hub && bun test src/sync/goals/kanbanSkillTemplates.test.ts
```

Expected: FAIL because `kanbanSkillTemplates.ts` does not exist.

- [ ] **Step 3: Create template module**

Create `hub/src/sync/goals/kanbanSkillTemplates.ts` with this exported shape:

```ts
export type KanbanSkillTemplateFile = {
    filename: 'SKILL.md' | 'todo.mjs' | 'yaml.mjs'
    content: string
}

export const KANBAN_SKILL_FILES: KanbanSkillTemplateFile[] = [
    { filename: 'SKILL.md', content: KANBAN_SKILL_DOC },
    { filename: 'todo.mjs', content: KANBAN_TODO_SCRIPT },
    { filename: 'yaml.mjs', content: KANBAN_YAML_HELPER }
]
```

The `KANBAN_SKILL_DOC` string must tell assistant to use only:

```bash
node .hopi/skills/kanban/todo.mjs list --goal <goalKey>
node .hopi/skills/kanban/todo.mjs add --goal <goalKey> --ref <ref> --title <title> --status candidate|planned
node .hopi/skills/kanban/todo.mjs move --goal <goalKey> --ref <ref> --status candidate|planned|in_progress|in_review|merging|done
node .hopi/skills/kanban/todo.mjs update --goal <goalKey> --ref <ref> --title <title> --body <body>
node .hopi/skills/kanban/todo.mjs link-dependency --goal <goalKey> --ref <ref> --depends-on <ref>
```

The `KANBAN_TODO_SCRIPT` string must implement:

```js
#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { parseYaml, stringifyYaml } from './yaml.mjs'

const VALID_STATUSES = new Set(['candidate', 'planned', 'in_progress', 'in_review', 'merging', 'done'])

function fail(message, details = {}) {
    console.error(JSON.stringify({ ok: false, error: message, ...details }))
    process.exit(1)
}

function parseArgs(argv) {
    const [command, ...rest] = argv
    const flags = {}
    for (let index = 0; index < rest.length; index += 1) {
        const key = rest[index]
        if (!key?.startsWith('--')) fail(`Unexpected argument: ${key}`)
        const value = rest[index + 1]
        if (value === undefined || value.startsWith('--')) fail(`Missing value for ${key}`)
        flags[key.slice(2)] = value
        index += 1
    }
    return { command, flags }
}

function workspaceRoot() {
    return process.cwd()
}

function todoPath(goalKey) {
    return join(workspaceRoot(), '.hopi', 'docs', 'goals', goalKey, 'todo.yml')
}

function eventsPath(goalKey) {
    return join(workspaceRoot(), '.hopi', 'docs', 'goals', goalKey, 'events.jsonl')
}

function readTodo(goalKey) {
    const path = todoPath(goalKey)
    if (!existsSync(path)) fail(`todo.yml not found for goal ${goalKey}`, { path })
    const raw = readFileSync(path, 'utf8')
    const parsed = parseYaml(raw)
    const doc = parsed && typeof parsed === 'object' ? parsed : {}
    if (!Array.isArray(doc.items)) doc.items = []
    if (!doc.goal || typeof doc.goal !== 'object') doc.goal = { goalKey }
    doc.version = 1
    return { path, doc }
}

function normalizeItem(item) {
    if (!item || typeof item !== 'object') fail('Invalid todo item')
    if (typeof item.ref !== 'string' || item.ref.trim() === '') fail('Todo item missing ref')
    if (typeof item.title !== 'string' || item.title.trim() === '') fail(`Todo item ${item.ref} missing title`)
    if (!VALID_STATUSES.has(item.status)) fail(`Todo item ${item.ref} has invalid status ${item.status}`)
    if (item.dependencyTaskList !== undefined && !Array.isArray(item.dependencyTaskList)) {
        fail(`Todo item ${item.ref} has invalid dependencyTaskList`)
    }
    return {
        ...item,
        ref: item.ref.trim(),
        title: item.title.trim(),
        body: typeof item.body === 'string' ? item.body : item.body ?? undefined,
        dependencyTaskList: Array.isArray(item.dependencyTaskList) ? item.dependencyTaskList : []
    }
}

function validate(doc) {
    const items = doc.items.map(normalizeItem)
    const refs = new Set()
    for (const item of items) {
        if (refs.has(item.ref)) fail(`Duplicate ref: ${item.ref}`)
        refs.add(item.ref)
    }
    for (const item of items) {
        for (const dep of item.dependencyTaskList) {
            const depRef = typeof dep === 'string' ? dep : dep?.ref
            if (typeof depRef !== 'string' || !refs.has(depRef)) fail(`Missing dependency ${depRef} for ${item.ref}`)
        }
    }
    const graph = new Map(items.map((item) => [
        item.ref,
        item.dependencyTaskList.map((dep) => typeof dep === 'string' ? dep : dep.ref)
    ]))
    for (const ref of graph.keys()) {
        const visiting = new Set()
        const visited = new Set()
        function visit(current) {
            if (visited.has(current)) return
            if (visiting.has(current)) fail(`Dependency cycle at ${current}`)
            visiting.add(current)
            for (const next of graph.get(current) ?? []) visit(next)
            visiting.delete(current)
            visited.add(current)
        }
        visit(ref)
    }
    doc.items = items
}

function atomicWrite(path, doc) {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`
    writeFileSync(tmp, stringifyYaml(doc), 'utf8')
    renameSync(tmp, path)
}

function appendEvent(goalKey, event) {
    const path = eventsPath(goalKey)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, `${JSON.stringify({
        id: randomUUID(),
        timestamp: Date.now(),
        writer: 'hopi_kanban_skill',
        ...event
    })}\n`, { encoding: 'utf8', flag: 'a' })
}
```

Then add command handlers:

```js
const { command, flags } = parseArgs(process.argv.slice(2))
const goal = flags.goal
if (!goal) fail('Missing --goal')
const { path, doc } = readTodo(goal)
validate(doc)

const find = (ref) => doc.items.find((item) => item.ref === ref)

if (command === 'list') {
    console.log(JSON.stringify({ ok: true, path, items: doc.items }, null, 2))
    process.exit(0)
}

if (command === 'add') {
    if (!flags.ref || !flags.title) fail('add requires --ref and --title')
    const status = flags.status ?? 'candidate'
    if (!VALID_STATUSES.has(status)) fail(`Invalid status: ${status}`)
    if (find(flags.ref)) fail(`Duplicate ref: ${flags.ref}`)
    const before = { count: doc.items.length }
    doc.items.push({ ref: flags.ref, status, title: flags.title, dependencyTaskList: [] })
    validate(doc)
    atomicWrite(path, doc)
    appendEvent(goal, { action: 'item_added', entity: { type: 'todo_item', ref: flags.ref }, before, after: { status, title: flags.title } })
    console.log(JSON.stringify({ ok: true, ref: flags.ref, status }))
    process.exit(0)
}

if (command === 'move') {
    if (!flags.ref || !flags.status) fail('move requires --ref and --status')
    if (!VALID_STATUSES.has(flags.status)) fail(`Invalid status: ${flags.status}`)
    const item = find(flags.ref)
    if (!item) fail(`Unknown ref: ${flags.ref}`)
    const before = { status: item.status }
    item.status = flags.status
    validate(doc)
    atomicWrite(path, doc)
    appendEvent(goal, { action: 'item_moved', entity: { type: 'todo_item', ref: flags.ref }, before, after: { status: flags.status } })
    console.log(JSON.stringify({ ok: true, ref: flags.ref, status: flags.status }))
    process.exit(0)
}

if (command === 'update') {
    if (!flags.ref) fail('update requires --ref')
    const item = find(flags.ref)
    if (!item) fail(`Unknown ref: ${flags.ref}`)
    const before = { title: item.title, body: item.body ?? null }
    if (flags.title !== undefined) item.title = flags.title
    if (flags.body !== undefined) item.body = flags.body
    validate(doc)
    atomicWrite(path, doc)
    appendEvent(goal, { action: 'item_updated', entity: { type: 'todo_item', ref: flags.ref }, before, after: { title: item.title, body: item.body ?? null } })
    console.log(JSON.stringify({ ok: true, ref: flags.ref }))
    process.exit(0)
}

if (command === 'link-dependency') {
    if (!flags.ref || !flags['depends-on']) fail('link-dependency requires --ref and --depends-on')
    const item = find(flags.ref)
    const dep = find(flags['depends-on'])
    if (!item) fail(`Unknown ref: ${flags.ref}`)
    if (!dep) fail(`Unknown dependency ref: ${flags['depends-on']}`)
    item.dependencyTaskList = item.dependencyTaskList ?? []
    if (!item.dependencyTaskList.some((entry) => (typeof entry === 'string' ? entry : entry.ref) === dep.ref)) {
        item.dependencyTaskList.push({ ref: dep.ref })
    }
    validate(doc)
    atomicWrite(path, doc)
    appendEvent(goal, { action: 'dependency_linked', entity: { type: 'todo_item', ref: flags.ref }, after: { dependsOn: dep.ref } })
    console.log(JSON.stringify({ ok: true, ref: flags.ref, dependsOn: dep.ref }))
    process.exit(0)
}

fail(`Unknown command: ${command}`)
```

The `KANBAN_YAML_HELPER` string can import no dependencies. Implement enough YAML support for HOPI's P0 shape:

```js
export function parseYaml(raw) {
    const lines = raw.replace(/\r\n/g, '\n').split('\n')
    const doc = { version: 1, goal: {}, items: [] }
    let currentItem = null
    let inGoal = false
    let inItems = false
    let inDeps = false

    for (const line of lines) {
        if (!line.trim() || line.trimStart().startsWith('#')) continue
        if (/^version:\s*/.test(line)) doc.version = Number(line.split(':').slice(1).join(':').trim()) || 1
        else if (line === 'goal:') { inGoal = true; inItems = false; inDeps = false }
        else if (line === 'items:') { inGoal = false; inItems = true; inDeps = false }
        else if (inGoal && /^  [A-Za-z][A-Za-z0-9_-]*:\s*/.test(line)) {
            const [key, ...rest] = line.trim().split(':')
            doc.goal[key] = unquote(rest.join(':').trim())
        } else if (inItems && /^  - ref:\s*/.test(line)) {
            currentItem = { ref: unquote(line.replace(/^  - ref:\s*/, '').trim()), dependencyTaskList: [] }
            doc.items.push(currentItem)
            inDeps = false
        } else if (currentItem && /^    [A-Za-z][A-Za-z0-9_-]*:\s*/.test(line)) {
            const [key, ...rest] = line.trim().split(':')
            const value = rest.join(':').trim()
            if (key === 'dependencyTaskList') {
                currentItem.dependencyTaskList = []
                inDeps = true
            } else {
                currentItem[key] = unquote(value)
                inDeps = false
            }
        } else if (currentItem && inDeps && /^      - ref:\s*/.test(line)) {
            currentItem.dependencyTaskList.push({ ref: unquote(line.replace(/^      - ref:\s*/, '').trim()) })
        }
    }
    return doc
}

export function stringifyYaml(doc) {
    const lines = ['version: 1', 'goal:']
    for (const [key, value] of Object.entries(doc.goal ?? {})) {
        if (value !== undefined && value !== null) lines.push(`  ${key}: ${quote(value)}`)
    }
    lines.push('items:')
    for (const item of doc.items ?? []) {
        lines.push(`  - ref: ${quote(item.ref)}`)
        lines.push(`    status: ${quote(item.status)}`)
        lines.push(`    title: ${quote(item.title)}`)
        if (item.body !== undefined && item.body !== null && item.body !== '') lines.push(`    body: ${quote(item.body)}`)
        const deps = Array.isArray(item.dependencyTaskList) ? item.dependencyTaskList : []
        if (deps.length > 0) {
            lines.push('    dependencyTaskList:')
            for (const dep of deps) lines.push(`      - ref: ${quote(typeof dep === 'string' ? dep : dep.ref)}`)
        } else {
            lines.push('    dependencyTaskList: []')
        }
    }
    return `${lines.join('\n')}\n`
}

function unquote(value) {
    if (value === '[]') return []
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1)
    }
    return value
}

function quote(value) {
    const text = String(value)
    return /^[A-Za-z0-9_-]+$/.test(text) ? text : JSON.stringify(text)
}
```

- [ ] **Step 4: Run template tests**

Run:

```bash
cd hub && bun test src/sync/goals/kanbanSkillTemplates.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hub/src/sync/goals/kanbanSkillTemplates.ts hub/src/sync/goals/kanbanSkillTemplates.test.ts
git commit -m "feat: add project-local kanban skill template"
```

---

### Task 3: Bootstrap Skill Files And Write Trace File

**Files:**

- Modify: `hub/src/sync/goals/goalDocs.ts`
- Create or modify: `hub/src/sync/goals/goalDocs.test.ts`

- [ ] **Step 1: Write bootstrap test**

Create `hub/src/sync/goals/goalDocs.test.ts` if missing. Add:

```ts
import { describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { bootstrapGoalDocs } from './goalDocs'

describe('goal docs bootstrap', () => {
    it('creates self-contained kanban skill files and write trace file', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-goal-docs-'))
        bootstrapGoalDocs({
            project: { id: 'project-1', name: 'Project One' } as never,
            goal: {
                id: 'goal-1',
                goalKey: 'demo',
                title: 'Demo',
                description: null,
                successCriteria: null,
                status: 'planning',
                autopilotEnabled: true,
                deployRequiresApproval: true,
                currentFocus: null
            } as never,
            defaultWorkspace: { path: workspacePath } as never
        })

        const skillDir = join(workspacePath, '.hopi', 'skills', 'kanban')
        expect(readFileSync(join(skillDir, 'SKILL.md'), 'utf8')).toContain('node .hopi/skills/kanban/todo.mjs')
        expect(readFileSync(join(skillDir, 'todo.mjs'), 'utf8')).toContain('VALID_STATUSES')
        expect(readFileSync(join(skillDir, 'yaml.mjs'), 'utf8')).toContain('parseYaml')
        expect(existsSync(join(workspacePath, '.hopi', 'docs', 'goals', 'demo', 'write-trace.jsonl'))).toBe(true)
    })
})
```

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
cd hub && bun test src/sync/goals/goalDocs.test.ts
```

Expected: FAIL because bootstrap does not create skill files or write trace.

- [ ] **Step 3: Bootstrap files**

Modify imports in `hub/src/sync/goals/goalDocs.ts`:

```ts
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { KANBAN_SKILL_FILES } from './kanbanSkillTemplates'
import {
    getGoalWriteTracePath,
    getKanbanSkillDir,
    getKanbanSkillFilePath,
    KANBAN_SKILL_TODO_FILENAME,
    // keep existing imports
} from './goalDocPaths'
```

Add helper:

```ts
function bootstrapKanbanSkill(defaultWorkspace: StoredWorkspace | null): void {
    const skillDir = getKanbanSkillDir(defaultWorkspace)
    if (!skillDir) return
    mkdirSync(skillDir, { recursive: true })
    for (const file of KANBAN_SKILL_FILES) {
        const path = getKanbanSkillFilePath(defaultWorkspace, file.filename)
        if (!path) continue
        ensureFile(path, file.content)
        if (file.filename === KANBAN_SKILL_TODO_FILENAME) {
            chmodSync(path, 0o755)
        }
    }
}
```

Call it inside `bootstrapGoalDocs` after docs root is known:

```ts
bootstrapKanbanSkill(input.defaultWorkspace)
ensureFile(getGoalWriteTracePath(docsRoot, input.goal.goalKey), '')
```

- [ ] **Step 4: Run bootstrap tests**

Run:

```bash
cd hub && bun test src/sync/goals/goalDocs.test.ts src/sync/goals/kanbanSkillTemplates.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hub/src/sync/goals/goalDocs.ts hub/src/sync/goals/goalDocs.test.ts
git commit -m "feat: bootstrap file-native kanban skill"
```

---

### Task 4: Preserve P0 Todo Schema In Hub Parser

**Files:**

- Modify: `hub/src/sync/goals/goalTodo.ts`
- Modify: `hub/src/sync/goals/goalTodo.test.ts`

- [ ] **Step 1: Add failing parser test for dependencies and blockers**

Append to `describe('goal todo yaml', ...)` in `hub/src/sync/goals/goalTodo.test.ts`:

```ts
it('preserves P0 statuses, dependencies, and blockers', () => {
    const parsed = parseGoalTodoYaml([
        'version: 1',
        'goal:',
        '  goalKey: tutorial',
        '  title: Tutorial',
        'items:',
        '  - ref: teaching-matrix',
        '    status: done',
        '    title: Teaching matrix',
        '    dependencyTaskList: []',
        '  - ref: tutorial-story',
        '    status: planned',
        '    title: Tutorial story',
        '    body: Story body',
        '    dependencyTaskList:',
        '      - ref: teaching-matrix',
        '    blockers:',
        '      - kind: decision',
        '        ref: choose-tone',
        '        summary: Waiting for tone'
    ].join('\n'), {
        goalId: 'goal-1',
        goalKey: 'tutorial'
    })

    expect(parsed.sections[0]).toMatchObject({
        id: 'teaching-matrix',
        status: 'done',
        lane: 'done',
        dependencyTaskList: []
    })
    expect(parsed.sections[1]).toMatchObject({
        id: 'tutorial-story',
        status: 'planned',
        lane: 'planned',
        dependencyTaskList: [{ ref: 'teaching-matrix' }],
        blockers: [{ kind: 'decision', ref: 'choose-tone', summary: 'Waiting for tone' }]
    })
})
```

- [ ] **Step 2: Run focused test and confirm failure**

Run:

```bash
cd hub && bun test src/sync/goals/goalTodo.test.ts
```

Expected: FAIL because `GoalTodoSection` currently normalizes statuses to legacy `planning/running/review` and does not expose `lane`, `dependencyTaskList`, or `blockers`.

- [ ] **Step 3: Update types and normalization**

Modify `hub/src/sync/goals/goalTodo.ts`:

```ts
export type GoalTodoStatus = 'candidate' | 'planned' | 'in_progress' | 'in_review' | 'merging' | 'done'
export type GoalTodoLane = GoalTodoStatus

export type GoalTodoDependency = {
    ref: string
}

export type GoalTodoBlocker = {
    kind: string
    ref?: string | null
    summary: string | null
}

export type GoalTodoSection = {
    id: string
    ref: string
    status: GoalTodoStatus
    lane: GoalTodoLane
    title: string
    body: string
    dependencyTaskList: GoalTodoDependency[]
    blockers: GoalTodoBlocker[]
    taskId: string | null
    todoRef: string
}
```

Keep legacy helpers only where needed for migration tests. Add P0 schemas:

```ts
const goalTodoStatusSchema = z.enum(['candidate', 'planned', 'in_progress', 'in_review', 'merging', 'done'])
const goalTodoDependencySchema = z.object({
    ref: z.string().trim().min(1)
}).passthrough()
const goalTodoBlockerSchema = z.object({
    kind: z.string().trim().min(1),
    ref: z.string().trim().min(1).nullable().optional(),
    summary: z.string().trim().min(1).nullable().optional()
}).passthrough()
```

Update item parsing:

```ts
function normalizeP0Status(value: unknown): GoalTodoStatus {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : ''
    if (normalized === 'planning') return 'planned'
    if (normalized === 'running') return 'in_progress'
    if (normalized === 'review') return 'in_review'
    if (normalized === 'finished') return 'done'
    const parsed = goalTodoStatusSchema.safeParse(normalized)
    return parsed.success ? parsed.data : 'candidate'
}

function normalizeDependencies(value: unknown): GoalTodoDependency[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((entry) => {
        if (typeof entry === 'string' && entry.trim()) return [{ ref: entry.trim() }]
        const parsed = goalTodoDependencySchema.safeParse(entry)
        return parsed.success ? [{ ref: parsed.data.ref }] : []
    })
}

function normalizeBlockers(value: unknown): GoalTodoBlocker[] {
    if (!Array.isArray(value)) return []
    return value.flatMap((entry) => {
        const parsed = goalTodoBlockerSchema.safeParse(entry)
        return parsed.success ? [{
            kind: parsed.data.kind,
            ref: parsed.data.ref ?? null,
            summary: parsed.data.summary ?? null
        }] : []
    })
}
```

Update `sectionFromYamlItem` to return the new fields. Preserve `todoRef` as `ref` for current consumers.

- [ ] **Step 4: Update existing tests intentionally**

Existing tests that expect `kind: 'ready'` for `planned` should be updated to expect:

```ts
expect(parsed.sections.map((section) => section.lane)).toEqual(['planned', 'candidate'])
expect(parsed.sections.map((section) => section.todoRef)).toEqual(['reconnect-indicator', 'resume-affordance'])
```

Do not remove legacy markdown fallback tests; update them to assert P0 statuses after conversion.

- [ ] **Step 5: Run goal todo tests**

Run:

```bash
cd hub && bun test src/sync/goals/goalTodo.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add hub/src/sync/goals/goalTodo.ts hub/src/sync/goals/goalTodo.test.ts
git commit -m "feat: parse file-native goal todo schema"
```

---

### Task 5: Build File-Native Board Projection

**Files:**

- Create: `hub/src/sync/goals/fileNativeBoard.ts`
- Create: `hub/src/sync/goals/fileNativeBoard.test.ts`
- Modify: `hub/src/web/routes/tasks.ts`

- [ ] **Step 1: Write projection tests**

Create `hub/src/sync/goals/fileNativeBoard.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFileNativeGoalBoard } from './fileNativeBoard'

describe('file native goal board', () => {
    it('builds cards from todo.yml and overlays runtime data from stored tasks', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-file-board-'))
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'demo')
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), [
            'version: 1',
            'goal:',
            '  goalKey: demo',
            '  title: Demo',
            'items:',
            '  - ref: first',
            '    status: planned',
            '    title: First from docs',
            '    body: Docs body',
            '    dependencyTaskList: []',
            '  - ref: second',
            '    status: in_progress',
            '    title: Second from docs',
            '    dependencyTaskList:',
            '      - ref: first',
            ''
        ].join('\n'), 'utf8')

        const tasks = buildFileNativeGoalBoard({
            project: {
                id: 'project-1',
                defaultAgentFlavor: 'claude',
                defaultPermissionMode: 'default',
                defaultModel: null,
                defaultModelMode: null
            } as never,
            goal: {
                id: 'goal-1',
                goalKey: 'demo',
                title: 'Demo'
            } as never,
            defaultWorkspace: { id: 'workspace-1', path: workspacePath } as never,
            runtimeOverlays: [{
                id: 'db-row-1',
                goalTodoRef: 'first',
                activeSessionId: 'session-1',
                initRuntime: { status: 'waiting', latestNote: 'runner offline' }
            } as never],
            includeArchived: false
        })

        expect(tasks).toHaveLength(2)
        expect(tasks[0]).toMatchObject({
            id: 'first',
            goalTodoRef: 'first',
            title: 'First from docs',
            description: 'Docs body',
            status: 'planned',
            activeSessionId: 'session-1'
        })
        expect(tasks[1]).toMatchObject({
            id: 'second',
            goalTodoRef: 'second',
            status: 'in_progress',
            dependsOnTaskRefs: ['first']
        })
    })

    it('ignores runtime overlays for refs not present in todo.yml', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-file-board-'))
        const goalDir = join(workspacePath, '.hopi', 'docs', 'goals', 'demo')
        mkdirSync(goalDir, { recursive: true })
        writeFileSync(join(goalDir, 'todo.yml'), 'version: 1\ngoal:\n  goalKey: demo\nitems: []\n', 'utf8')

        const tasks = buildFileNativeGoalBoard({
            project: { id: 'project-1' } as never,
            goal: { id: 'goal-1', goalKey: 'demo', title: 'Demo' } as never,
            defaultWorkspace: { id: 'workspace-1', path: workspacePath } as never,
            runtimeOverlays: [{ id: 'orphan', goalTodoRef: 'missing' } as never],
            includeArchived: false
        })

        expect(tasks).toEqual([])
    })
})
```

- [ ] **Step 2: Run projection test and confirm failure**

Run:

```bash
cd hub && bun test src/sync/goals/fileNativeBoard.test.ts
```

Expected: FAIL because `fileNativeBoard.ts` does not exist.

- [ ] **Step 3: Implement board builder**

Create `hub/src/sync/goals/fileNativeBoard.ts`:

```ts
import type { StoredGoal, StoredProject, StoredTask, StoredWorkspace } from '../../store'
import { readGoalTodo } from './goalTodo'

export type FileNativeBoardTask = StoredTask & {
    tag?: string | null
    dependsOnTaskRefs?: string[]
    workflowBlockers?: Array<{ kind: string; ref?: string | null; summary: string | null }>
}

export function buildFileNativeGoalBoard(input: {
    project: StoredProject
    goal: StoredGoal
    defaultWorkspace: StoredWorkspace | null
    runtimeOverlays: StoredTask[]
    includeArchived: boolean
}): FileNativeBoardTask[] {
    const todo = readGoalTodo({
        project: input.project,
        goal: input.goal,
        defaultWorkspace: input.defaultWorkspace
    })
    const overlayByRef = new Map<string, StoredTask>()
    for (const overlay of input.runtimeOverlays) {
        if (overlay.goalTodoRef) overlayByRef.set(overlay.goalTodoRef, overlay)
    }

    const baseTime = todo.updatedAt ?? Date.now()
    return todo.sections.flatMap((section, index) => {
        const overlay = overlayByRef.get(section.ref) ?? null
        if (!input.includeArchived && overlay?.archivedAt) return []
        return [{
            id: section.ref,
            projectId: input.project.id,
            goalId: input.goal.id,
            goalTodoRef: section.ref,
            title: section.title,
            description: section.body || null,
            status: section.status,
            blockedReason: overlay?.blockedReason ?? null,
            blockedAt: overlay?.blockedAt ?? null,
            blockedSource: overlay?.blockedSource ?? null,
            blockedSessionId: overlay?.blockedSessionId ?? null,
            priority: overlay?.priority ?? null,
            sortKey: overlay?.sortKey ?? baseTime - index,
            activeSessionId: overlay?.activeSessionId ?? null,
            workspaceId: overlay?.workspaceId ?? input.defaultWorkspace?.id ?? null,
            agentFlavor: overlay?.agentFlavor ?? input.project.defaultAgentFlavor,
            permissionMode: overlay?.permissionMode ?? input.project.defaultPermissionMode,
            model: overlay?.model ?? input.project.defaultModel,
            modelMode: overlay?.modelMode ?? input.project.defaultModelMode,
            attachments: overlay?.attachments ?? null,
            source: overlay?.source ?? 'manual',
            sourceTaskId: overlay?.sourceTaskId ?? null,
            workflowProfile: overlay?.workflowProfile ?? 'default',
            workflowPhase: overlay?.workflowPhase ?? null,
            subTasks: overlay?.subTasks ?? null,
            subTasksUpdatedAt: overlay?.subTasksUpdatedAt ?? null,
            worktreeMergedAt: overlay?.worktreeMergedAt ?? null,
            worktreeMergeCommit: overlay?.worktreeMergeCommit ?? null,
            mergedDiffSnapshot: overlay?.mergedDiffSnapshot ?? null,
            mergeRuntime: overlay?.mergeRuntime ?? null,
            previewRuntime: overlay?.previewRuntime ?? null,
            initRuntime: overlay?.initRuntime ?? null,
            contract: overlay?.contract ?? null,
            handoff: overlay?.handoff ?? null,
            evidence: overlay?.evidence ?? null,
            createdAt: overlay?.createdAt ?? baseTime,
            updatedAt: Math.max(overlay?.updatedAt ?? 0, baseTime),
            finishedAt: overlay?.finishedAt ?? null,
            archivedAt: overlay?.archivedAt ?? null,
            tag: section.status === 'candidate' ? 'candidate' : null,
            dependsOnTaskRefs: section.dependencyTaskList.map((dependency) => dependency.ref),
            workflowBlockers: section.blockers
        } satisfies FileNativeBoardTask]
    })
}
```

- [ ] **Step 4: Replace route-local projection helper**

In `hub/src/web/routes/tasks.ts`, import:

```ts
import { buildFileNativeGoalBoard } from '../../sync/goals/fileNativeBoard'
```

Replace `buildGoalTodoTaskProjection(...)` implementation with a wrapper that gathers runtime overlays and calls `buildFileNativeGoalBoard`:

```ts
function buildGoalTodoTaskProjection(options: {
    store: Store
    project: StoredProject
    goalId: string
    namespace: string
    includeArchived: boolean
}): StoredTask[] {
    const goal = options.store.goals.getGoalByNamespace(options.goalId, options.namespace)
    if (!goal || goal.projectId !== options.project.id) return []
    const defaultWorkspace = getDefaultWorkspaceForProject(options.store, options.project)
    const runtimeOverlays = options.store.tasks.listTasksByProjectAndNamespace(options.project.id, options.namespace, {
        includeArchived: true,
        goalId: goal.id
    })
    return buildFileNativeGoalBoard({
        project: options.project,
        goal,
        defaultWorkspace,
        runtimeOverlays,
        includeArchived: options.includeArchived
    })
}
```

Remove repair-on-read behavior from this path. Do not call `syncTaskStateToGoalTodo` while listing tasks.

- [ ] **Step 5: Run projection tests**

Run:

```bash
cd hub && bun test src/sync/goals/fileNativeBoard.test.ts src/web/routes/tasks.goal.test.ts
```

Expected: `fileNativeBoard.test.ts` passes. `tasks.goal.test.ts` may fail on tests expecting read-time DB-to-doc repair; update those tests in Task 6.

- [ ] **Step 6: Commit**

```bash
git add hub/src/sync/goals/fileNativeBoard.ts hub/src/sync/goals/fileNativeBoard.test.ts hub/src/web/routes/tasks.ts
git commit -m "feat: derive goal board from todo docs"
```

---

### Task 6: Reject Hidden Goal-Kanban Writes

**Files:**

- Modify: `hub/src/web/routes/tasks.ts`
- Modify: `hub/src/web/routes/tasks.goal.test.ts`

- [ ] **Step 1: Add API tests for read-only goal kanban writes**

In `hub/src/web/routes/tasks.goal.test.ts`, add tests using the existing `Store`, `seedProject`, `seedWorkspace`, `seedGoal`, and `createTestApp` helpers:

```ts
it('rejects direct goal task creation in file-native mode', async () => {
    const store = new Store(':memory:')
    const projectId = 'project-file-native-create'
    const goalId = 'goal-file-native-create'
    seedProject(store, projectId)
    seedWorkspace(store, projectId)
    seedGoal(store, { id: goalId, projectId, goalKey: 'file-native-create' })
    const app = createTestApp(store)

    const response = await app.request(`/api/projects/${projectId}/tasks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            goalId,
            title: 'Hidden write'
        })
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
        error: 'Goal kanban is file-native; use .hopi/skills/kanban/todo.mjs'
    })
})

it('rejects direct goal task patch in file-native mode', async () => {
    const store = new Store(':memory:')
    const projectId = 'project-file-native-patch'
    const goalId = 'goal-file-native-patch'
    seedProject(store, projectId)
    seedWorkspace(store, projectId)
    seedGoal(store, { id: goalId, projectId, goalKey: 'file-native-patch' })
    const app = createTestApp(store)

    store.tasks.createTask({
        id: 'overlay-1',
        projectId,
        goalId,
        goalTodoRef: 'first',
        title: 'Runtime overlay',
        status: 'planned',
        source: 'manual'
    } as never)

    const response = await app.request('/api/tasks/overlay-1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'done' })
    })

    expect(response.status).toBe(409)
})
```

- [ ] **Step 2: Run route tests and confirm failure**

Run:

```bash
cd hub && bun test src/web/routes/tasks.goal.test.ts
```

Expected: FAIL because routes still create/patch goal tasks through DB and `todo.yml`.

- [ ] **Step 3: Add a single rejection helper**

In `hub/src/web/routes/tasks.ts`, add:

```ts
function goalKanbanFileNativeResponse(c: { json: (body: unknown, status?: number) => Response }): Response {
    return c.json({
        error: 'Goal kanban is file-native; use .hopi/skills/kanban/todo.mjs'
    }, 409)
}
```

In `POST /projects/:projectId/tasks`, after resolving `goal`:

```ts
if (goal) {
    return goalKanbanFileNativeResponse(c)
}
```

In `PATCH /tasks/:taskId`, after `existing` is loaded:

```ts
if (existing.goalId) {
    return goalKanbanFileNativeResponse(c)
}
```

In archive/delete routes, reject when `existing.goalId` is set. Keep non-goal project tasks unchanged.

- [ ] **Step 4: Update route tests that expected DB-to-doc writes**

For tests whose old purpose was "goal task API writes todo.yml", replace assertions with 409 expectations. Keep tests that list tasks from `todo.yml` and overlay runtime info.

- [ ] **Step 5: Run route tests**

Run:

```bash
cd hub && bun test src/web/routes/tasks.goal.test.ts src/web/routes/tasks.start-session.test.ts src/web/routes/tasks.workflow.test.ts
```

Expected: PASS. Runtime-only routes such as start-session must still pass because they update session/runtime overlay fields, not docs-owned workflow fields.

- [ ] **Step 6: Commit**

```bash
git add hub/src/web/routes/tasks.ts hub/src/web/routes/tasks.goal.test.ts
git commit -m "feat: reject hidden goal kanban writes"
```

---

### Task 7: Make Assistant Commands Read-Only For Kanban Mutations

**Files:**

- Modify: `hub/src/sync/goals/goalAssistantCommands.ts`
- Modify: `hub/src/web/routes/goal-assistant-commands.test.ts`

- [ ] **Step 1: Add tests for rejected hidden write commands**

In `hub/src/web/routes/goal-assistant-commands.test.ts`, update write-command tests for:

- `request_planning`
- `request_task_lane`
- `retry_task_merge`
- `answer_decision_topic`

Use this assertion shape:

```ts
expect(response.status).toBe(409)
expect(await response.json()).toMatchObject({
    ok: false,
    error: 'Goal kanban is file-native; use .hopi/skills/kanban/todo.mjs'
})
```

Keep inspect tests:

```ts
expect(inspectResponse.status).toBe(200)
expect(inspectBody.state.tasks[0].title).toBe('Title from todo.yml')
```

- [ ] **Step 2: Run assistant command tests and confirm failure**

Run:

```bash
cd hub && bun test src/web/routes/goal-assistant-commands.test.ts
```

Expected: FAIL because write commands still mutate DB/docs via server code.

- [ ] **Step 3: Add rejection response and use it for kanban write commands**

In `hub/src/sync/goals/goalAssistantCommands.ts`, add:

```ts
function fileNativeKanbanWriteRejected(): CommandResponse {
    return {
        status: 409,
        body: {
            ok: false,
            error: 'Goal kanban is file-native; use .hopi/skills/kanban/todo.mjs',
            command: 'node .hopi/skills/kanban/todo.mjs'
        }
    }
}
```

In `executeGoalAssistantCommand`, route kanban write commands to the rejection:

```ts
case 'request_task_lane':
case 'retry_task_merge':
case 'request_planning':
case 'answer_decision_topic':
    return fileNativeKanbanWriteRejected()
```

Keep:

- `inspect_goal_state`
- `inspect_task_history`
- `read_preference`
- `write_preference`

Keep `write_preference` because it writes `.hopi/preference.md`, not kanban workflow state.

- [ ] **Step 4: Run assistant command tests**

Run:

```bash
cd hub && bun test src/web/routes/goal-assistant-commands.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hub/src/sync/goals/goalAssistantCommands.ts hub/src/web/routes/goal-assistant-commands.test.ts
git commit -m "feat: make assistant kanban commands file-native"
```

---

### Task 8: Make Goal Board UI Workflow Controls Read-Only

**Files:**

- Modify: `web/src/routes/projects/kanban.tsx`
- Modify: `web/src/routes/projects/layout.tsx`
- Modify: `web/src/routes/projects/kanban.test.tsx`

- [ ] **Step 1: Add UI tests**

In `web/src/routes/projects/kanban.test.tsx`, add:

```tsx
it('does not render workflow mutation controls for a goal board', async () => {
    mocks.tasks = [createTask({ id: 'first', goalId: 'goal-1', goalTodoRef: 'first', source: 'improvements_scan' })]

    render(
        <ProjectKanbanBoard
            projectId="project-1"
            goalId="goal-1"
            onOpenNewTask={vi.fn()}
        />
    )

    expect(await screen.findByText('First task')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /new task/i })).not.toBeInTheDocument()
})
```

The existing test harness uses English labels such as `Expand subtasks`, so use English text assertions here.

- [ ] **Step 2: Run UI test and confirm failure**

Run:

```bash
cd web && bun test src/routes/projects/kanban.test.tsx
```

Expected: FAIL because current board renders approve/reject and new task controls.

- [ ] **Step 3: Hide generated-task approve/reject for goal boards**

In `web/src/routes/projects/kanban.tsx`, pass a boolean to `KanbanTaskCard`:

```tsx
isWorkflowReadOnly={Boolean(props.goalId)}
```

Add to `KanbanTaskCardProps`:

```ts
isWorkflowReadOnly: boolean
```

Change generated controls condition:

```tsx
{isGeneratedPending && !props.isWorkflowReadOnly ? (
    // existing approve/reject buttons
) : null}
```

- [ ] **Step 4: Hide new task button for goal boards**

In `web/src/routes/projects/kanban.tsx`, wrap the footer/new-task button:

```tsx
{!props.goalId ? (
    <button
        type="button"
        onClick={props.onOpenNewTask}
        // keep existing props/classes
    >
        ...
    </button>
) : null}
```

In `web/src/routes/projects/layout.tsx`, guard `handleOpenNewTaskDialog`:

```ts
const handleOpenNewTaskDialog = useCallback(() => {
    if (selectedGoalId) return
    setNewTaskOpen(true)
}, [selectedGoalId])
```

- [ ] **Step 5: Run UI tests**

Run:

```bash
cd web && bun test src/routes/projects/kanban.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/src/routes/projects/kanban.tsx web/src/routes/projects/layout.tsx web/src/routes/projects/kanban.test.tsx
git commit -m "feat: make goal kanban board read-only"
```

---

### Task 9: Add WriteTraceRecorder

**Files:**

- Create: `hub/src/sync/goals/writeTraceRecorder.ts`
- Create: `hub/src/sync/goals/writeTraceRecorder.test.ts`

- [ ] **Step 1: Write recorder tests**

Create `hub/src/sync/goals/writeTraceRecorder.test.ts`:

```ts
import { describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordNormalizedWriteTrace } from './writeTraceRecorder'

describe('write trace recorder', () => {
    it('records write events without full file content', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-write-trace-'))
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(join(docsRoot, 'goals', 'demo'), { recursive: true })

        const recorded = recordNormalizedWriteTrace({
            docsRoot,
            goalKey: 'demo',
            event: {
                kind: 'tool_result',
                writesFile: true,
                agent: 'codex',
                sessionId: 'session-1',
                cwd: workspacePath,
                toolName: 'apply_patch',
                callId: 'call-1',
                targetPaths: ['src/app.ts'],
                argumentsSummary: 'apply patch to src/app.ts\nFULL CONTENT SHOULD NOT BE HERE',
                resultSummary: 'success',
                timestamp: 123
            }
        })

        expect(recorded).toBe(true)
        const raw = readFileSync(join(docsRoot, 'goals', 'demo', 'write-trace.jsonl'), 'utf8').trim()
        const entry = JSON.parse(raw) as Record<string, unknown>
        expect(entry).toMatchObject({
            agent: 'codex',
            sessionId: 'session-1',
            toolName: 'apply_patch',
            callId: 'call-1',
            targetPaths: ['src/app.ts'],
            resultSummary: 'success',
            timestamp: 123
        })
        expect(String(entry.argumentsSummary)).not.toContain('FULL CONTENT SHOULD NOT BE HERE')
    })

    it('ignores non-write events', () => {
        const workspacePath = mkdtempSync(join(tmpdir(), 'hopi-write-trace-'))
        const docsRoot = join(workspacePath, '.hopi', 'docs')
        mkdirSync(join(docsRoot, 'goals', 'demo'), { recursive: true })

        const recorded = recordNormalizedWriteTrace({
            docsRoot,
            goalKey: 'demo',
            event: {
                kind: 'tool_call',
                writesFile: false,
                agent: 'claude',
                sessionId: 'session-1',
                cwd: workspacePath,
                toolName: 'Read',
                callId: 'call-2',
                targetPaths: ['src/app.ts'],
                argumentsSummary: 'read src/app.ts',
                resultSummary: 'ok',
                timestamp: 123
            }
        })

        expect(recorded).toBe(false)
    })
})
```

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
cd hub && bun test src/sync/goals/writeTraceRecorder.test.ts
```

Expected: FAIL because `writeTraceRecorder.ts` does not exist.

- [ ] **Step 3: Implement recorder**

Create `hub/src/sync/goals/writeTraceRecorder.ts`:

```ts
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { getGoalWriteTracePath } from './goalDocPaths'

export type NormalizedWriteTraceEvent = {
    kind: 'tool_call' | 'tool_result' | 'patch_event'
    writesFile: boolean
    agent: string
    sessionId: string
    cwd: string
    toolName: string
    callId: string | null
    targetPaths: string[]
    argumentsSummary: string | null
    resultSummary: string | null
    timestamp: number
}

function compactSummary(value: string | null): string | null {
    if (!value) return null
    return value
        .replace(/\r\n/g, '\n')
        .split('\n')
        .slice(0, 12)
        .join('\n')
        .slice(0, 2_000)
}

export function recordNormalizedWriteTrace(input: {
    docsRoot: string
    goalKey: string
    event: NormalizedWriteTraceEvent
}): boolean {
    if (!input.event.writesFile) return false
    const path = getGoalWriteTracePath(input.docsRoot, input.goalKey)
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, `${JSON.stringify({
        agent: input.event.agent,
        sessionId: input.event.sessionId,
        cwd: input.event.cwd,
        toolName: input.event.toolName,
        callId: input.event.callId,
        targetPaths: input.event.targetPaths,
        argumentsSummary: compactSummary(input.event.argumentsSummary),
        resultSummary: compactSummary(input.event.resultSummary),
        timestamp: input.event.timestamp
    })}\n`, 'utf8')
    return true
}
```

- [ ] **Step 4: Run recorder tests**

Run:

```bash
cd hub && bun test src/sync/goals/writeTraceRecorder.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add hub/src/sync/goals/writeTraceRecorder.ts hub/src/sync/goals/writeTraceRecorder.test.ts
git commit -m "feat: add normalized write trace recorder"
```

---

### Task 10: Wire Minimal Write Trace Sources

**Files:**

- Modify: `hub/src/sync/taskAutomation.ts`
- Modify: `hub/src/sync/taskSessionService.ts`
- Modify: `hub/src/sync/taskAutomation.test.ts`

- [ ] **Step 1: Add a task automation test around patch/file-write events**

In `hub/src/sync/taskAutomation.test.ts`, add a focused test near existing action-output or file-change tests:

```ts
it('records write trace for normalized file write events tied to a goal task', async () => {
    const fixture = createTaskAutomationFixture()
    const { store, project, goal, workspacePath, engine } = fixture
    const task = store.tasks.createTask({
        id: 'task-1',
        projectId: project.id,
        goalId: goal.id,
        goalTodoRef: 'first',
        title: 'First',
        status: 'running',
        activeSessionId: 'session-1',
        source: 'planner'
    } as never)

    await handleTaskAutomationEvent({
        store,
        engine,
        namespace: 'default',
        event: {
            type: 'message-received',
            sessionId: 'session-1',
            message: {
                id: 'message-1',
                seq: 1,
                localId: null,
                createdAt: Date.now(),
                content: {
                    type: 'event',
                    data: {
                        type: 'fileChange',
                        path: 'src/app.ts',
                        action: 'write',
                        toolName: 'apply_patch',
                        callId: 'call-1'
                    }
                }
            }
        } as never
    })

    const trace = readFileSync(join(workspacePath, '.hopi', 'docs', 'goals', goal.goalKey, 'write-trace.jsonl'), 'utf8')
    expect(trace).toContain('src/app.ts')
    expect(trace).toContain('apply_patch')
})
```

Use the existing task automation fixture style in `taskAutomation.test.ts`: create a goal task with `activeSessionId`, feed the same automation entry point used by nearby message-received tests, then assert `write-trace.jsonl`.

- [ ] **Step 2: Run test and confirm failure**

Run:

```bash
cd hub && bun test src/sync/taskAutomation.test.ts --test-name-pattern "records write trace"
```

Expected: FAIL because no write trace recorder is wired.

- [ ] **Step 3: Add a small adapter function**

In `hub/src/sync/taskAutomation.ts`, import:

```ts
import { getDocsRoot } from './goals/goalDocPaths'
import { recordNormalizedWriteTrace } from './goals/writeTraceRecorder'
```

Add helper:

```ts
function maybeRecordGoalWriteTrace(input: {
    store: Store
    namespace: string
    sessionId: string
    toolName: string
    callId: string | null
    targetPaths: string[]
    argumentsSummary: string | null
    resultSummary: string | null
    timestamp: number
}): void {
    const task = input.store.tasks
        .listTasksByNamespace?.(input.namespace)
        ?.find((candidate) => candidate.activeSessionId === input.sessionId && candidate.goalId && candidate.goalTodoRef)
    if (!task?.goalId) return
    const project = input.store.projects.getProjectByNamespace(task.projectId, input.namespace)
    const goal = input.store.goals.getGoalByNamespace(task.goalId, input.namespace)
    if (!project || !goal) return
    const defaultWorkspace = project.defaultWorkspaceId
        ? input.store.workspaces.getWorkspace(project.defaultWorkspaceId)
        : input.store.workspaces.listWorkspacesByProject(project.id)[0] ?? null
    const docsRoot = getDocsRoot(defaultWorkspace)
    if (!docsRoot) return
    recordNormalizedWriteTrace({
        docsRoot,
        goalKey: goal.goalKey,
        event: {
            kind: 'patch_event',
            writesFile: input.targetPaths.length > 0,
            agent: 'hopi-normalized',
            sessionId: input.sessionId,
            cwd: defaultWorkspace?.path ?? '',
            toolName: input.toolName,
            callId: input.callId,
            targetPaths: input.targetPaths,
            argumentsSummary: input.argumentsSummary,
            resultSummary: input.resultSummary,
            timestamp: input.timestamp
        }
    })
}
```

If `listTasksByNamespace` does not exist, add this local fallback inside `maybeRecordGoalWriteTrace`:

```ts
const projects = input.store.projects.listProjectsByNamespace(input.namespace)
const task = projects
    .flatMap((project) => input.store.tasks.listTasksByProjectAndNamespace(project.id, input.namespace, { includeArchived: true }))
    .find((candidate) => candidate.activeSessionId === input.sessionId && candidate.goalId && candidate.goalTodoRef)
```

- [ ] **Step 4: Call adapter from existing normalized file/patch event handling**

Find current handling for Codex/app-server file changes or patch events in `taskAutomation.ts` and call:

```ts
maybeRecordGoalWriteTrace({
    store,
    namespace,
    sessionId,
    toolName,
    callId,
    targetPaths,
    argumentsSummary,
    resultSummary,
    timestamp: Date.now()
})
```

Use only already-normalized data. Do not parse raw transcript text in this task.

- [ ] **Step 5: Run focused trace test**

Run:

```bash
cd hub && bun test src/sync/taskAutomation.test.ts --test-name-pattern "records write trace"
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add hub/src/sync/taskAutomation.ts hub/src/sync/taskAutomation.test.ts
git commit -m "feat: record goal write traces from normalized events"
```

---

### Task 11: Full Verification

**Files:**

- No new files.

- [ ] **Step 1: Run focused hub tests**

Run:

```bash
cd hub && bun test src/sync/goals/goalDocPaths.test.ts src/sync/goals/kanbanSkillTemplates.test.ts src/sync/goals/goalDocs.test.ts src/sync/goals/goalTodo.test.ts src/sync/goals/fileNativeBoard.test.ts src/sync/goals/writeTraceRecorder.test.ts src/web/routes/tasks.goal.test.ts src/web/routes/goal-assistant-commands.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run focused web tests**

Run:

```bash
cd web && bun test src/routes/projects/kanban.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run package typechecks**

Run:

```bash
bun run typecheck:hub
bun run typecheck:web
```

Expected: both commands exit 0.

- [ ] **Step 4: Run broader tests**

Run:

```bash
bun run test:hub
bun run test:web
```

Expected: both commands exit 0.

- [ ] **Step 5: Manual smoke test the generated skill**

Run from repo root:

```bash
tmpdir="$(mktemp -d)"
mkdir -p "$tmpdir/.hopi/docs/goals/demo"
cp -R /Users/realizer/Code/hopi/.hopi/skills "$tmpdir/.hopi/" 2>/dev/null || true
printf 'version: 1\ngoal:\n  goalKey: demo\n  title: Demo\nitems: []\n' > "$tmpdir/.hopi/docs/goals/demo/todo.yml"
cd "$tmpdir"
node .hopi/skills/kanban/todo.mjs add --goal demo --ref first --title "First task" --status planned
node .hopi/skills/kanban/todo.mjs list --goal demo
```

Expected output contains JSON with `"ok": true` and an item with `"ref": "first"`.

If the copy command does not find `/Users/realizer/Code/hopi/.hopi/skills`, create a temporary HOPI project through the goal creation flow after Task 3 and run the same `node` commands in that bootstrapped workspace.

## Self-Review Checklist

- Spec coverage:
  - `todo.yml` as kanban truth: Tasks 4-6.
  - Project-local skill scripts: Tasks 2-3.
  - DB runtime overlay only: Task 5.
  - UI read-only workflow state in P0: Task 8.
  - Assistant no hidden kanban writes: Task 7.
  - `events.jsonl` workflow trace from skill: Task 2.
  - `write-trace.jsonl` write audit: Tasks 9-10.
  - P1 self-made skills excluded from P0: Scope section.

- Placeholder scan:
  - No `TBD`.
  - No "implement later".
  - No unbounded "add error handling" steps.
  - Every task has exact files, commands, and expected results.

- Type consistency:
  - P0 statuses use `candidate | planned | in_progress | in_review | merging | done`.
  - Board overlay key is `goalTodoRef` matching `todo.yml` `ref`.
  - `write-trace.jsonl` is separate from `events.jsonl`.
