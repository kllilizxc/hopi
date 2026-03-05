# Projects + Kanban + Tasks + Sessions (Web) — Plan

Date: 2026-02-25
Status: planning draft

## Goal

Replace primary navigation: `Session list → Session chat` with:

1. Project list (create/select)
2. Project board (Kanban: Planned / In Progress / In Review / Finished / Blocked)
3. Task card detail (edit, move, assign)
4. Task chat view (only if task has working session)

Keep sessions feature set (chat/files/terminal/approvals) but make it task-driven.

## Terminology

- **Project**: user container; owns task board; binds to 1+ workspaces (directories).
- **Workspace**: directory path on a machine; allowed work roots for task sessions.
- **Task**: kanban card; optional link to one “active” working session.
- **Working session**: existing HOPI `Session`; agent chat/files/terminal.

## User stories

- As user, create project; name + optional description.
- As user, bind project to directories (1+); choose default workspace (reuse `/sessions/new` directory picker; multi-select).
- As user, see project board; create tasks; drag tasks across columns.
- As user, open task; add notes; set status; set priority (optional).
- As user, attach images/files to a task for context.
- As user, start/attach a working session to task; then open chat.
- As user, jump back: chat → task → board → projects.
- As user (mobile), same flows; minimal taps; no cramped 3-pane.
- As user, enable automation:
    - review suggested tasks generated after finishing work
    - mark tasks “Planned”; auto-run keeps WIP ≤ N
    - task status auto-flips between In Progress / In Review based on prompts

## Information architecture (routes)

Primary:

- `/projects` — project list
- `/projects/$projectId` — kanban board
- `/projects/$projectId/tasks/$taskId` — task detail
- `/projects/$projectId/tasks/$taskId/chat` — task chat (wrap existing session UI)

Secondary / legacy (keep):

- `/sessions` — “All sessions” (debug / power users / migration)
- `/sessions/$sessionId` — direct session access (deep links)

Redirect:

- `/` → `/projects` (new default)

## Data model (shared + hub DB)

### Project

Fields (suggested):

- `id` (uuid)
- `namespace` (string; reuse existing namespace isolation)
- `machineId` (string; required v1; single-machine project)
- `name` (string; required)
- `description` (string; optional)
- `defaultWorkspaceId` (string; optional)
- Session defaults (per-project defaults):
    - `defaultAgentFlavor` (claude/codex/gemini/opencode)
    - `defaultPermissionMode` (default/acceptEdits/bypassPermissions/plan)
    - `defaultModelMode` (existing model modes)
- Automation config:
    - `autoRunEnabled` (boolean; default false)
    - `maxRunningSessions` (number; default 5)
        - definition: count sessions with `thinking=true` in this project
    - `improvementsEnabled` (boolean; default false)
    - `improvementsMaxPendingTasks` (number; default 5)
    - `lastImprovementsAt` (number; optional)
- `createdAt`, `updatedAt`
- `archivedAt` (nullable)

### Workspace

Fields (suggested):

- `id` (uuid)
- `projectId`
- `label` (string; optional; display name)
- `path` (string; required; absolute path on machine)
- `sort` (number; optional)
- `createdAt`, `updatedAt`

Constraints:

- unique (`projectId`, `path`)
- v1: all workspaces share same `machineId` via project

### Task

Fields (suggested):

- `id` (uuid)
- `projectId`
- `title` (string; required)
- `description` (string; optional; markdown)
- `status` (`planned` | `in_progress` | `in_review` | `blocked` | `finished`)
- `priority` (`low` | `medium` | `high`) optional v1
- `sortKey` (number/string; for column ordering)
- `activeSessionId` (string nullable; link to `Session.id`)
- `workspaceId` (string nullable; override project default)
- `attachments` (optional; v1 “simple” = embed content)
    - `TaskAttachment`: `{ id, filename, mimeType, size, base64 | dataUrl, previewUrl? }`
    - Limit: 10MB max total per task (sum of attachment sizes)
    - On session start: upload attachments into the new session, then send message with `AttachmentMetadata`
- `source` (optional; helps automation + limits)
    - `manual` | `improvements_scan`
    - `sourceTaskId` (optional; for “suggested after finishing task X”)
- `createdAt`, `updatedAt`
- `finishedAt` (nullable; set when status becomes finished)
- `archivedAt` (nullable)

Notes:

- Allow “task without session” (planning + backlog).
- One active session per task in v1; later: session history.

### Task ↔ Session linkage

Decision: dual-write for fast lookup:

- On `Task`: `activeSessionId`
- On `Session.metadata`: add `projectId`, `taskId` (optional)

Benefits:

- Session list can show “belongs to task”
- Task can “jump to session”

Migration risk: existing sessions without metadata → fine.

## Hub API + sync (SSE)

Add REST endpoints:

- `GET /api/projects`
- `POST /api/projects`
- `GET /api/projects/:projectId`
- `PATCH /api/projects/:projectId`
- `POST /api/projects/:projectId/archive`

- `GET /api/projects/:projectId/workspaces`
- `POST /api/projects/:projectId/workspaces`
- `PATCH /api/workspaces/:workspaceId`
- `DELETE /api/workspaces/:workspaceId`

- `GET /api/projects/:projectId/tasks`
- `POST /api/projects/:projectId/tasks`
- `GET /api/tasks/:taskId`
- `PATCH /api/tasks/:taskId`
- `POST /api/tasks/:taskId/archive`

Session attach flow:

- `POST /api/tasks/:taskId/attach-session` (payload: `sessionId`)
- `POST /api/tasks/:taskId/start-session` (payload: optional `workspaceId`, agent flavor, model, permission mode)
    - server delegates to existing “new session” flow; prefill from task/project
    - server writes back `activeSessionId` + session metadata linkage

Automation (auto-run + improvements scan):

- `POST /api/projects/:projectId/improvements/scan` (manual; creates pending improvements tasks up to `improvementsMaxPendingTasks`)
- `POST /api/projects/:projectId/auto-run/tick` (optional; forces auto-run scheduler to run now)

SSE events (extend existing `SyncEvent`):

- `project-added`, `project-updated`, `project-removed`
- `task-added`, `task-updated`, `task-removed`
- `workspace-updated` (or just `project-updated` + refetch)

Principle:

- Keep SSE payloads small; client invalidates relevant queries (TanStack Query).

## Web UI layout

### Desktop (>= md breakpoint)

Recommended structure: split view (“two panels”)

Left panel (navigation + board):

- Project selector (list + create)
- When project selected: kanban view (columns)

Right panel (task workbench):

- When task selected, no session:
    - Task detail view (edit + attachments)
    - Primary CTA: Start session / Attach session
- When task selected, has session:
    - Default: Chat view
    - Switchable tabs: Chat / Task detail / Terminal / Diffs / Files (reuse existing session subviews)
    - Always-available: back to board + copy link

Navigation patterns:

- Left board stays visible; right panel swaps content (task / chat / session tools)
- URL reflects selection (`/projects/$pid?task=$tid&tab=chat`) or nested route
    - Deep link support for mobile + share

### Mobile (< md breakpoint)

No 3-pane; stacked navigation + bottom actions.

Same as desktop mental model, but only 1 panel (merge left + right):

- Board screen as primary
- Task detail screen as next
- Chat/Terminal/Files/Diffs as tabs within task session screen

Flow:

1. Projects list screen
2. Board screen (single column view by default)
    - Horizontal swipe between columns OR top segmented control
    - Floating “+ Task” button
3. Task detail screen (full screen)
4. Chat screen (full screen; reuse existing session chat UI)

Key mobile ergonomics:

- Sticky project header with project switch
- Column selector always reachable (top tabs)
- Task detail uses “sheet” for quick peek (optional) but full page for editing
- “Back” behavior: Chat → Task → Board → Projects

Telegram Mini App considerations:

- Avoid hover-only interactions
- Use safe-area insets
- Keep drag-and-drop optional; allow “Move to…” menu as fallback

## UI details (v1)

### Project list screen

Project row/card content:

- Name + short description
- Machine badge (v1: single machine)
- Workspace count
- Task counts (total + blocked + finished) optional
- “Last activity” timestamp (max of tasks + linked sessions)

Primary actions:

- Create project
- Select project (enter board)
- Project settings (rename, archive, manage workspaces)

### Kanban board

Board behavior:

- Desktop: 6 columns; horizontal scroll allowed if narrow
- Mobile: 1 column at a time; swipe / segmented control

DnD behavior:

- Narrow desktop / mobile: show 1–2 columns; when dragging near edge, auto-scroll to reveal other columns
- Always-available fallback: “Move to…” menu (no DnD required)

Column header:

- Status label + count
- Quick-add (desktop inline; mobile via FAB)

Task card content (minimum):

- Title
- Workspace label chip (or “default”)
- Linked session state
    - active/inactive dot (from `Session.active`)
    - pending approvals badge (if any)
    - todos progress mini bar (if present)
- Updated time (relative)

Card interactions:

- Click/tap: open detail (panel/page)
- Drag: reorder within column + move columns
- Long-press menu (mobile): move to…, archive, open chat (if linked)

### Task detail

Sections:

- Header: title inline edit; status picker; priority optional
- Workspace: selector (project default or override)
- Notes: markdown textarea (simple) + preview toggle optional
- Session:
    - If no session: Start session / Attach existing
    - If linked: Open chat + quick metadata (agent flavor, model, permission mode)
    - Session health: offline/archived indicator; replace session link
- Danger: archive task (soft delete)

### Task chat view

Principle: reuse existing session routes/components.

Implementation options:

1. Route wrapper renders existing session views
    - `/projects/$pid/tasks/$tid/chat` → renders `SessionChat` using `task.activeSessionId`
2. Redirect to session route
    - `/projects/.../chat` → navigates to `/sessions/$sessionId` but keeps “Back to task” breadcrumb

Preference: wrapper route for consistent nav + breadcrumbs.

## Task lifecycle UX

### Create project

- Name required
- Machine selection required (v1)
    - Default to “current machine” if only one
- Workspace binding step:
    - Add 1+ paths (multi-select; reuse NewSession directory input UX)
    - Select default workspace
    - Validate path exists (via existing machine FS capabilities)

### Create task

Create modal/sheet:

- Title
- Status default `planned`
- Workspace (default project default)
- Optional description
- Images/files attachments (optional; appear in task detail + first prompt when starting session)

Post-create:

- Card appears in column; auto-open detail panel (desktop) / detail page (mobile)

### Start session from task

From task detail:

- “Start session” opens reuse of NewSession UI with prefilled:
    - directory path = chosen workspace
    - session name = task title
    - agent flavor/model/permission mode = project defaults (overrideable)
    - session metadata links: `projectId`, `taskId`
- After session created:
    - If task has attachments: upload into session first (reuse existing session upload endpoint)
    - Auto-send first user message = task notes (description) + attachments
- After session created:
    - `task.activeSessionId` set
    - CTA changes to “Open chat”

### Attach existing session

Used when session already running.

- Picker: show sessions on same machine + same namespace
- Optional filters: by path prefix under workspaces; by “unassigned only”

### Finish task

- Moving to Finished sets `finishedAt`
- Auto-archive linked session (if any)
    - If improvements scan enabled: run scan first, then archive
    - Keep `activeSessionId` for history (chat/files/diffs still viewable)
    - Allow “Start new session” later to reopen work

## Ordering + drag/drop

Decision: per-column ordering; stable; multi-client safe.

Approach options:

1. Simple float `sortKey` (average neighbors)
    - easy, no reindex
    - beware precision drift over many moves
2. LexoRank-like string ranks
    - robust; more implementation

Recommendation: start with float; add “normalize ranks” server job when needed.

Drag/drop fallback:

- If DnD unsupported (mobile/Telegram quirks): card menu “Move to…”

## Existing features integration

- Approvals, permission modes, model modes: unchanged; live in session view.
- File browser:
    - remains per-session (safe + consistent)
    - later: project/workspace file browser (optional)
- Session summary / todos:
    - show in task detail if session linked
- Global “All sessions” view:
    - keep for power users + debugging
    - show badge if session linked to task

## Migration plan (from session-first UI)

Min disruption strategy:

Phase 1:

- Add Projects/Kanban screens; keep Sessions screens unchanged
- Add “Import session as task” action in session view
    - creates task in chosen project, links session

Phase 2:

- Change default route to `/projects`
- Keep `/sessions` reachable from sidebar

Optional auto-migration (later):

- Create “Imported” project per namespace + machine
- One task per existing session (title from session name/summary/path)

## Edge cases

- Project with 0 workspaces: allow but block “Start session” until workspace added
- Workspace path invalid (deleted/moved): show warning; allow edit
- Multiple machines connected:
    - v1: project bound to one machine; enforce at API + UI
    - session attach: only sessions on same machine
- Session ended/archived:
    - task still links; “Open chat” shows archived state; allow “Start new session” and replace link
- Namespace switching:
    - project/task scoped by namespace; ensure all queries include namespace

## Security / safety

- Do not expose arbitrary filesystem via project alone
    - operations still gated by session + existing permission model
- Workspace path validation:
    - server-side: ensure path is under allowed roots (if such concept exists) OR explicit user confirmation
    - avoid path traversal bugs; canonicalize paths

## Implementation phases (suggested)

1. Shared types + DB schema
    - Zod schemas in `shared`
    - SQLite migrations in hub
2. Hub CRUD API + SSE events
    - projects/tasks/workspaces endpoints
    - SSE invalidation hooks
3. Web: routes + query/mutation hooks
    - TanStack Query keys + optimistic updates for task moves
4. Web: UI components
    - ProjectSidebar
    - KanbanBoard + Column + Card
    - TaskDetailPanel / TaskDetailPage
5. Session linkage
    - Start session from task (prefill new session)
    - Attach existing session
6. Polish
    - search, keyboard shortcuts, empty states
    - mobile gestures + fallback menus

## Repo touchpoints (when implementing)

Shared:

- `shared/src/schemas.ts` — add `Project`, `Workspace`, `Task` schemas; extend `SyncEvent` union
- `shared/src/types.ts` — re-export new types

Hub:

- `hub/src/store/index.ts` — bump schema version; create new tables; add migrations
- `hub/src/store/*` — new stores: `projectStore`, `taskStore` (or extend existing pattern)
- `hub/src/web/routes/*` — new routes: `projects.ts`, `tasks.ts`, `workspaces.ts`; register in `hub/src/web/index.ts`
- `hub/src/sse/*` — emit new SSE events; hook into store writes
- `hub/src/sync/*` — optional: sessionCache integration for “task last activity”

Web:

- `web/src/router.tsx` — new routes; default redirect to `/projects`
- `web/src/routes/projects/*` — screens: list, board, task, chat wrapper
- `web/src/hooks/queries/*` + `web/src/hooks/mutations/*` — CRUD hooks; optimistic board moves
- `web/src/components/*` — `ProjectSidebar`, `KanbanBoard`, `TaskCard`, `TaskDetail*`
- `web/src/components/NewSession/*` — reuse; add prefill inputs from task/project

## Acceptance criteria (v1)

- Create/select project; add/remove workspaces; set default workspace
- Create task; edit title/description; move across columns incl. Planned + In Review
- Task attachments supported; sent as kickoff prompt attachments on session start
- Link task ↔ session via “Start session” and “Attach existing”
- Open chat for linked session; return to task + board
- Move task to Finished auto-archives linked session
- If improvements enabled: moving task → `finished` can create up to N pending auto-generated tasks in `planned`
- If auto-run enabled: planned queue starts sessions up to `maxRunningSessions`
- Desktop: board + detail panel usable without route churn
- Mobile: projects → board → task → chat flow; no unusable DnD dependency

## Automation: status + auto-run + improvements scan (vite-kanban-like)

Concept (split into: status automation, auto-run scheduler, improvements scan):

Status automation:

- Any user prompt in a task’s linked session ⇒ move task → `in_progress`
- When assistant finishes answering that prompt ⇒ move task → `in_review`
- If user prompts again while in review ⇒ move task back → `in_progress`

Auto-run scheduler:

- User reviews backlog, switches task status to `planned`
- Auto-run controller:
    - If running sessions count < `maxRunningSessions` (default 5; configurable)
    - Pick next `planned` task(s) (by sort/order)
    - Auto-start session on chosen workspace using project defaults
    - Move task → `in_progress`, link `activeSessionId`

Human review:

- In review, user can:
    - Move task → `finished` (auto-archives linked session)
    - Move back → `in_progress` (follow-up needed)
    - Move → `blocked` (needs input)

Guardrails:

- Auto-run off by default (explicit opt-in per project)
- Automation safety: recommend project default permission mode = `acceptEdits` or `bypassPermissions` (otherwise auto-run may stall on approvals)
- “Run improvements scan now” button + “Pause automation” toggle

Improvements scan (instead of periodic heartbeat):

- Trigger: after a task is moved to `finished` (before auto-archive) + manual button
- Mechanism:
    - Prefer reusing the task’s linked session (`task.activeSessionId`) right before archiving
    - Fallback: reuse latest active session in project
    - Send a prompt that includes the finished task title/notes and asks for up to N improvement tasks (structured output)
    - Parse output and auto-create tasks in `planned` (pending approval)
- Limits:
    - Max pending auto-generated tasks in `planned` (default 5; configurable)
        - counts only `source=improvements_scan` tasks
        - user-created planned tasks not included
        - if limit reached, stop generating
        - if limit already reached: skip sending the scan prompt (no additional pending tasks possible)
    - Dedupe by normalized title (best-effort)
- UX:
    - Suggested tasks appear in `planned` immediately, marked as pending approval
    - User approves to queue for auto-run (or rejects/deletes)
- Optional UI:
    - “Generate improvements” button (manual) in project settings or task detail
    - Banner/toast when generation skipped due to limit

Implementation notes (simple v1):

- Status automation heuristic:
    - on `sendMessage` (role=user) in linked session: move → `in_progress`
    - after an assistant message arrives AND session `thinking` becomes false: move → `in_review`
    - if another user message sent while `in_review`: move back → `in_progress`
- Running session heuristic (for `maxRunningSessions`):
    - count sessions where `thinking=true` and `metadata.projectId = projectId`
- Ignore automation-originated user messages for status automation (otherwise improvements scan would flip status)
    - tag via `localId` prefix, e.g. `auto:improvements:...`
- Improvements prompt should request strict JSON; if parse fails, create 0 tasks and show the raw suggestions for manual copy
- Improvements prompt must explicitly forbid code changes / tool use; “suggest tasks only”

## Future (nice-to-have)

- Labels/tags, due dates, estimates
- Swimlanes by workspace or priority
- “Blocked reason” field; block/unblock UX
- Cross-machine projects (workspaces per machine)
- Task templates; recurring tasks
- Activity feed; audit log; notifications
