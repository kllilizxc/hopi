# Projects + Kanban (Web) — Acceptance Standard TODO

Date: 2026-02-25
Scope: v1
Reference: `docs/design/projects-kanban.md`

Goal: shippable “project-first” UX; tasks drive sessions; automation optional.

Notation:

- `[ ]` todo / not accepted
- `[x]` accepted
- “Accept” lines = objective pass/fail checks

---

## A0. Release gates

- [x] All “Must” sections below accepted
- [x] No regression: existing `/sessions/*` routes still work
- [x] No crash: empty DB, no machines online, no sessions
- [x] Telemetry/logging: enough to debug automation issues (server logs ok)

---

## A1. Navigation + routing (Must)

- [x] Route default: `/` → `/projects`
    - Accept: fresh load lands on Projects list
- [x] Legacy keep: `/sessions`, `/sessions/$sessionId` reachable
    - Accept: deep-link opens session chat directly
- [x] New routes exist (can be nested or query-param based)
    - `/projects`
    - `/projects/$projectId`
    - `/projects/$projectId/tasks/$taskId`
    - `/projects/$projectId/tasks/$taskId/chat`
    - Accept: browser refresh on any route works (no blank screen)
- [x] Back navigation sane
    - Accept (mobile): Chat → Task → Board → Projects
    - Accept (desktop): board stays; right panel tab changes do not reset board scroll

---

## A2. Project list (Must)

- [x] Project list screen
    - Accept: shows 0-state when none
    - Accept: shows at least name + machine badge + workspace count
    - Accept: project selection navigates to board
- [x] Create project flow
    - Required: name
    - Required (v1): machine selection
    - Accept: project created appears in list immediately (SSE or optimistic)
- [x] Edit project basics
    - Rename
    - Description optional
    - Accept: updates visible without reload
- [x] Archive project
    - Accept: archived project hidden by default; optional “show archived”

---

## A3. Workspaces (Must)

- [x] Bind 1+ directories to project
    - Reuse `/sessions/new` directory picker UX (multi-select)
    - Accept: add multiple paths in one flow
    - Accept: paths validated (existence check) OR explicit warning UI
- [x] Default workspace
    - Accept: default workspace can be set/changed
    - Accept: used when creating tasks + starting sessions (unless task overrides)
- [x] Workspace management
    - Edit label/path
    - Remove workspace
    - Accept: cannot remove last workspace if project has auto-run enabled (guardrail) OR show clear warning

---

## A4. Kanban board (Must)

Columns:

- New
- Planned
- In Progress
- In Review
- Finished
- Blocked

- [x] Board renders all columns (desktop: horizontal scroll ok)
    - Accept: counts per column visible
- [x] Mobile board column switching
    - Accept: segmented control OR swipe; always reachable
- [x] Task create from board
    - Accept: quick add into New (desktop inline)
    - Accept: FAB + modal/sheet (mobile)
- [x] Drag/drop move
    - Accept: drag task within column reorder
    - Accept: drag across columns
    - Accept: narrow layout shows 1–2 columns while dragging + auto-scroll reveals more columns
- [x] Fallback move menu (no DnD)
    - Accept: each card has “Move to…” menu; works on mobile + Telegram
- [x] Board ordering persistence
    - Accept: refresh preserves order (sortKey)
    - Accept: reorder is stable across clients (basic multi-tab)

---

## A5. Task detail (Must)

- [x] Task detail view (right panel desktop / full screen mobile)
    - Title edit inline
    - Status picker
    - Workspace selector (default vs override)
    - Notes field (markdown ok)
- [x] Task lifecycle controls
    - Archive task (soft delete)
    - Restore (optional) OR explicit “archived hidden”
- [x] Copy link
    - Accept: deep-link opens same task

---

## A6. Task attachments (Must)

Definition:

- Attachments stored on task as embedded content (base64/dataUrl) for v1 simplicity
- Limit: 10MB total per task (sum sizes)

- [x] Attach files/images in task detail
    - Accept: UI shows current attachments list (name + size + remove)
    - Accept: total size enforced; clear error message on exceed
- [x] Kickoff upload on session start
    - Accept: when starting a session from a task, attachments uploaded into that session
    - Accept: first user prompt includes attachments metadata
- [x] Attachment removal
    - Accept: remove attachment updates size budget + UI immediately

---

## A7. Session linkage + workbench tabs (Must)

Task states:

- Unassigned task (no `activeSessionId`)
- Assigned task (has `activeSessionId`)

- [x] Start session from task
    - Accept: reuse NewSession UI with prefilled:
        - directory = task workspace (or project default)
        - session name = task title
        - agent/model/permission = project defaults (override allowed)
        - metadata includes `projectId`, `taskId`
    - Accept: after create, task links `activeSessionId`
    - Accept: kickoff message sent automatically (task notes + attachments)
- [x] Attach existing session
    - Accept: session picker filters to same namespace + machine
    - Accept: “unassigned only” filter exists OR clear visual for already-linked sessions
- [x] Workbench tabs (right panel)
    - When assigned: default tab = Chat
    - Tabs: Chat / Task / Terminal / Diffs / Files
    - Accept: switching tabs keeps same task context
    - Accept: tabs reuse existing session views (no feature regression)
- [x] Session deep links
    - Accept: from legacy `/sessions/$id` UI, show “Back to task” if metadata has task link

---

## A8. Status automation (Must)

Rule:

- Any user prompt in linked session ⇒ task → `in_progress`
- When assistant finishes answering that prompt ⇒ task → `in_review`
- If user prompts again while in review ⇒ task → `in_progress`

- [x] Detect user prompt send
    - Accept: sending any chat message from task workbench flips status to In Progress
- [x] Detect assistant “finished answering”
    - Definition: assistant message arrives AND session `thinking` becomes false
    - Accept: task flips to In Review without manual drag
- [x] Avoid automation feedback loops
    - Accept: automation-originated prompts (improvements scan) do not flip task status

---

## A9. Auto-run scheduler (Should; but required if enabled)

Config:

- `autoRunEnabled` boolean (per project)
- `maxRunningSessions` default 5; configurable
- “Running” definition: sessions with `thinking=true` in project

- [x] Planned queue behavior
    - Accept: user drags tasks to Planned to queue
    - Accept: scheduler picks earliest Planned by sort order
- [x] Running sessions cap
    - Accept: if running < cap, scheduler starts next planned task session
    - Accept: if running >= cap, scheduler does not start new session
- [x] Manual tick (debug)
    - Accept: `/auto-run/tick` or UI button triggers scheduler pass
- [x] Safety
    - Accept: auto-run disabled by default
    - Accept: clear UI state when enabled (badge/toggle)

---

## A10. Improvements scan (Should; but required if enabled)

Concept:

- Trigger: task moved to Finished (human-approved), before auto-archive
- Output: auto-create tasks immediately in Planned (pending approval); user approves or deletes
- Limit: max 5 pending auto-generated tasks (configurable)
    - counts only `source=improvements_scan` + status=Planned
    - user-created Planned tasks not counted

- [x] Prompt target session selection
    - Prefer: task’s linked session (`activeSessionId`) before archive
    - Fallback: latest active session in project
- [x] Prompt contract
    - Accept: prompt requests strict JSON array of tasks (title + optional notes + workspace hint)
    - Accept: prompt forbids tool use / code edits (“suggest tasks only”)
    - Accept: if workspace has `.hopi/improvements-scan.md`, prompt inlines it as repo-specific best-practice guidance
    - Accept: prompt includes architecture/code-quality checklist guidance, not only feature polish framing
- [x] Parse + create tasks
    - Accept: valid JSON creates tasks in Planned with `source=improvements_scan` + `sourceTaskId`
    - Accept: parse failure creates 0 tasks + surfaces raw text in UI (manual copy)
- [x] Limit enforcement
    - Accept: if already at limit, skip sending prompt; show “limit reached” toast/badge
- [x] Dedupe (best effort)
    - Accept: identical normalized titles not duplicated in same scan batch

---

## A11. Finished behavior (Must)

- [x] Move to Finished auto-archives linked session
    - Accept: archive called after improvements scan (if enabled)
    - Accept: task keeps `activeSessionId` for history
    - Accept: user can still open chat/files/diffs for archived session (read-only ok)
- [x] Reopen after finish
    - Accept: “Start new session” action creates new session and updates `activeSessionId`

---

## A12. Real-time sync (Must)

- [x] SSE events / cache invalidation for:
    - project add/update/archive
    - workspace add/update/remove
    - task add/update/move/archive
- [x] Multi-tab correctness
    - Accept: moving card in one tab updates other tab within seconds
    - Accept: no duplicated cards after rapid moves

---

## A13. Error handling + empty states (Must)

- [x] No machine online
    - Accept: project list still works; start session disabled with clear reason
- [x] Invalid workspace path
    - Accept: show warning; prevent auto-run start until fixed
- [x] Session resume/attach failure
    - Accept: error toast + task remains usable
- [x] Automation disabled states
    - Accept: no hidden background behavior unless enabled

---

## A14. Mobile + Telegram UX (Must)

- [x] Mobile sizing
    - Accept: board usable; no clipped columns; sticky header ok
    - Accept: task detail + chat tabs reachable
- [x] Telegram WebApp
    - Accept: no hover-only actions
    - Accept: long-press menu works for move actions
    - Accept: safe-area insets respected

---

## A15. Migration / coexistence (Must)

- [x] Existing sessions still visible in `/sessions`
- [x] Import session as task
    - Accept: from session view, action creates task in chosen project + links session
- [x] Session metadata linkage
    - Accept: sessions started from tasks include `projectId` + `taskId` in metadata

---

## A16. Performance (Should)

- [ ] Board render perf
    - Accept: 200 cards across columns still scrollable (no major jank)
- [ ] Query efficiency
    - Accept: no full refetch storm on single card move (invalidate only needed keys)
