# TODO: Web UI Refactor (Radix Themes + Telegram Tokens + Bottom Sheets)

Goal
- unified component look; modern "graphite" vibe
- keep Telegram WebApp colors; `--tg-theme-*` stays source-of-truth
- light/dark; theme system (user override + presets)
- smooth + efficient motion; `prefers-reduced-motion` support
- mobile-first; all menus/actions -> bottom sheet (ActionSheet)

Non-goals
- feature expansion; new routes; new major UI paradigms
- pixel-perfect desktop redesign (desktop gets benefit, mobile drives decisions)

Constraints / Rules
- business code imports only from `web/src/components/ui/*` (no direct Radix Themes in feature components)
- keep existing `--app-*` semantic vars; bridge Radix Themes tokens to these vars
- Telegram: "use as-is" (no filtering/tonemapping of Telegram-provided colors)


## Milestone 0: Audit + Inventory
- [x] UI surface list: sessions, chat, new session, files, terminal, projects, settings
- [x] Component inventory: current `web/src/components/ui/*`; where raw `<button>` / dropdowns exist
- [x] Decide "graphite defaults": radius, scaling, gray palette; motion durations
- [x] Define mobile patterns: list row, header, icon button, action sheet item

Audit Notes (initial)
- UI surfaces (key files)
  - Sessions: `web/src/router.tsx` (SessionsPage), `web/src/components/SessionList.tsx`, `web/src/components/SessionHeader.tsx`
  - Chat: `web/src/components/SessionChat.tsx`, `web/src/components/AssistantChat/*`
  - New session: `web/src/components/NewSession/*`
  - Files/diff: `web/src/routes/sessions/files.tsx`, `web/src/routes/sessions/file.tsx`, `web/src/components/DiffView.tsx`
  - Terminal: `web/src/routes/sessions/terminal.tsx`, `web/src/components/Terminal/*`
  - Projects: `web/src/routes/projects/*`
  - Settings: `web/src/routes/settings/index.tsx`

- UI primitives (current)
  - `web/src/components/ui/button.tsx`
  - `web/src/components/ui/card.tsx`
  - `web/src/components/ui/dialog.tsx`
  - `web/src/components/ui/ConfirmDialog.tsx`
  - `web/src/components/ui/badge.tsx`
  - `web/src/components/ui/Toast.tsx`

- graphite defaults (initial; tweak after first visual pass)
  - radius: "large" (~12px) for panels/sheets; pills stay 999px
  - scaling/density: default 100% (use existing `useFontScale` for accessibility)
  - gray palette: slate/graphite neutrals (Radix `grayColor` once wired)
  - motion: 180ms (micro), 220ms (menu), 260ms (sheet); easing `cubic-bezier(0.16, 1, 0.3, 1)`

- mobile patterns (first pass)
  - touch targets: min 44px
  - icon button: 44x44 hit area; 20px icon; subtle hover/pressed state
  - list row: 48–56px height, clear pressed feedback, optional trailing meta
  - ActionSheet item: 52px row; left icon; label; optional destructive tone

- floating dropdown/listbox patterns (migrated to bottom sheets):
  - [x] `web/src/components/SessionActionMenu.tsx`
  - [x] `web/src/routes/settings/index.tsx`
  - [x] `web/src/components/LanguageSwitcher.tsx`
- hard-coded visual outliers to normalize later:
  - `web/src/components/AssistantChat/ComposerButtons.tsx` (`bg-black`)


## Milestone 1: Radix Themes Base Integration
- [x] Add dependency: `@radix-ui/themes` (workspace `web/`)
- [x] Import `@radix-ui/themes/styles.css` in `web/src/main.tsx` (before `./index.css`)
- [x] Add provider: `web/src/components/app/AppThemeProvider.tsx`
      - wraps children with Radix `<Theme>`
      - defaults: graphite-ish (gray palette, radius, scaling)
      - appearance: derived from Telegram/system + user override
- [x] Wire provider in `web/src/main.tsx`
- [ ] Smoke test: no layout break; no obvious style collisions


## Milestone 2: Token Bridge (Telegram -> app -> Radix)
Intent
- Telegram stays primary source (`--tg-theme-*`)
- app semantic vars (`--app-*`) remain stable API for the codebase
- Radix Themes CSS variables consume `--app-*` so 3rd-party components match app colors

Tasks
- [x] Create `web/src/styles/radix-bridge.css`
      - map Radix Themes core tokens (bg/panel/text/border/accent) to `--app-*`
      - keep overrides minimal; prefer semantic mapping, not per-component hacks
- [x] Update `web/src/index.css`
      - keep current `:root` + `[data-theme="dark"]` blocks
      - remove any hard-coded non-Telegram fallbacks only if they conflict (otherwise keep as safety net)
      - ensure `--app-button` / `--app-button-text` still come from Telegram
- [x] Ensure shiki dual-theme still works (`html[data-theme="dark"]` selectors)

Acceptance
- Radix Themes components (Button/Select/etc) render with Telegram colors inside Telegram
- non-Telegram browser still OK via existing fallbacks


## Milestone 3: Appearance + Theme Settings
- [x] Extend `web/src/hooks/useTheme.ts`
      - `appearance`: `auto | light | dark`
      - auto: Telegram scheme if present; else system preference
      - persist via localStorage
      - still listen to Telegram `themeChanged` + system media query when in auto
- [x] Add theme presets (derived neutrals only)
      - `graphite | soft | contrast` via `data-theme-preset`
      - stored in localStorage; defaults to graphite
- [x] Update `web/src/routes/settings/index.tsx`
      - add "Theme" section: Appearance selector (auto/light/dark)
      - keep existing language/font/voice sections (will migrate to ActionSheet later)
- [x] Add `prefers-reduced-motion` and optional manual motion toggle (optional; can be later)


## Milestone 4: ActionSheet (Bottom Sheet) UI Primitive
- [x] Add `web/src/components/ui/ActionSheet.tsx` (Radix Dialog-based)
      - bottom anchored; safe-area padding
      - drag handle (visual only; optional)
      - accessible: title/description; focus management; Escape/overlay close
      - motion: slide-up + fade; reduced-motion support
- [x] Add `web/src/components/ui/ActionSheetSelect.tsx` (optional helper)
      - generic "choose one" list; supports current selection
      - re-use for Settings and selectors
- [x] Add styles: minimal Tailwind; relies on `--app-*` + Radix tokens

Tests (Vitest)
- [x] open/close behavior (basic render gating)
- [x] click item fires callback
- [x] reduced motion class present (DOM class expectation)


## Milestone 5: Replace Menus With ActionSheet (Mobile-First)
- [x] Replace `web/src/components/SessionActionMenu.tsx`
      - new: `SessionActionSheet` (items: rename, archive/delete, import task)
      - remove anchorPoint positioning; keep long-press to open
- [x] Update `web/src/components/SessionList.tsx`
      - long press -> open ActionSheet
      - (optional) add explicit "more" icon button per row for discoverability
- [x] Replace Settings dropdowns in `web/src/routes/settings/index.tsx`
      - Language / Font scale / Voice language -> ActionSheetSelect
      - remove custom absolute listbox + outside click handlers (simplify)
- [x] Replace Kanban task move context menu with ActionSheet (no anchor-point popovers)

Acceptance
- no floating menus on mobile; bottom sheet everywhere for "actions" and "choices"
- touch targets >= 44px; safe-area respected


## Milestone 6: Core UI Unification Pass (High-ROI Pages)
- [x] IconButton primitive; replace scattered round buttons (partial)
      - [x] `web/src/components/AssistantChat/ComposerButtons.tsx` (remove hard-coded `bg-black`)
      - [x] `web/src/components/SessionHeader.tsx`
      - [x] sessions toolbar in `web/src/router.tsx` (settings/new session buttons)
- [x] Inputs
      - [x] NewSession directory/machine/model selectors -> ActionSheetSelect + unified field styling
      - [x] chat composer textarea + attachments tray polish (focus ring + touch targets)
- [x] Dialog/Confirm
      - ensure confirm destructive styling consistent; no ad-hoc reds


## Milestone 7: Motion + Polish
- [x] Standardize motion tokens (CSS vars): duration/easing
- [x] Ensure `prefers-reduced-motion` disables key animations globally
- [x] Background + surface layering (graphite feel)
      - subtle gradient / noise; low contrast; no purple bias
- [x] Mobile scroll/keyboard edge cases
      - sheet scroll; textarea focus; overscroll; iOS Safari quirks


## Verification Checklist
- commands
  - `bun run typecheck:web`
  - `bun run test:web`
  - `bun run check:i18n:web`
  - `bun run dev:web` (manual QA)
- manual QA matrix
  - Telegram WebApp: light/dark toggle; themeChanged; safe-area
  - iOS Safari: bottom sheet; scroll lock; keyboard
  - Android Chrome: long press; touch targets; motion
- regressions to watch
  - shiki theme colors
  - Dialog focus trap + close behavior
  - Scrollbars / layout on desktop split view
