# task-loading-kanban

Status: resolved

## Symptoms
- New task dialog stayed in `Creating…` state before the new card became visible on kanban.
- Repeated task creation felt serialized / slow.

## Root cause
1. `useCreateTask` already inserted an optimistic temporary task into the kanban cache.
2. But `ProjectsPage.handleCreateTask` awaited the server round-trip before closing the dialog.
3. Because the modal stayed open, the optimistic card was hidden; user perception = waiting on loading before task appears.
4. If we close immediately, optimistic cards become visible, but they also need guarding because temporary `temp:*` ids are not navigable / movable yet.

## Fix
- Close the new-task dialog immediately after submit; let request finish in background.
- Stop binding the dialog disabled state to mutation pending; allows rapid repeated creates.
- Reuse shared optimistic-task id helper.
- Make optimistic kanban cards visibly `Creating…` and non-interactive until the real task id arrives.

## Verification
- `cd web && bun run test -- useCreateTask.test.tsx kanban-new-task-dialog.test.tsx`
- `cd web && bun run typecheck`
