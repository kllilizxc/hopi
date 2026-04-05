# Phase 3: Review and Merge Cockpit - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in `03-CONTEXT.md` — this log preserves the alternatives considered.

**Date:** 2026-03-30
**Phase:** 03-review-and-merge-cockpit
**Areas discussed:** Review cockpit shape, merge packet posture, review decisions, merge failure handling

---

## Review cockpit shape

| Option | Description | Selected |
|--------|-------------|----------|
| Hybrid | Keep plan detail as runtime overview; add a dedicated review cockpit for review/merge decisions | ✓ |
| Plan-page only | Keep all review and merge UI inside the existing plan detail page | |
| Cockpit-only | Move review work into a standalone cockpit and treat plan detail as secondary | |

**User's choice:** Hybrid
**Notes:** Runtime overview and attempt history already live well on the plan page. Review/merge decision work deserves its own cockpit rather than bloating the plan detail route.

---

## Merge packet posture

| Option | Description | Selected |
|--------|-------------|----------|
| Decision-first | Lead with blockers, checks, branch/worktree context, attempts, and changed-files summary | ✓ |
| Diff-first | Lead with the code changes and file-level details | |
| Timeline-first | Lead with attempt/evidence chronology before decision data | |

**User's choice:** Decision-first
**Notes:** The first question in review is "Can I merge this?" The cockpit should answer that before showing deep evidence or long timelines.

---

## Review decisions and reopen semantics

| Option | Description | Selected |
|--------|-------------|----------|
| Resume loop + Back to planning | Two explicit actions: one returns to `Running`, one returns to `Planning` | ✓ |
| Single reopen + chooser | One reopen action that prompts for the next state | |
| Retry-only | Collapse reopening into a single retry action | |

**User's choice:** Resume loop + Back to planning
**Notes:** The two paths represent different operator intent. One means the plan is still valid and execution should continue; the other means the plan or acceptance needs revision first.

---

## Merge failure handling

| Option | Description | Selected |
|--------|-------------|----------|
| Merge-blocked in Review | Keep merge failures in `Review` and let the operator choose the next action explicitly | ✓ |
| Auto takeover | Automatically jump into a takeover session when merge fails | |
| Auto return to Running | Automatically send merge failures back into autonomous execution | |

**User's choice:** Merge-blocked in Review
**Notes:** Merge failure should remain an operator decision point rather than silently weakening the review gate.

### Conflict handling follow-up

| Option | Description | Selected |
|--------|-------------|----------|
| Review conflict state | Keep conflicts in `Review` as `merge-blocked: conflict` with `Resolve conflicts` as the main action | ✓ |
| Auto takeover on conflict | Immediately jump to a live takeover session | |
| Auto resume loop on conflict | Treat conflicts as normal execution failure and re-enter `Running` | |

**User's choice:** Review conflict state
**Notes:** Conflicts are urgent, but they still belong in the review posture. The main CTA should be `Resolve conflicts`, reusing the takeover/session path on the same worktree.

---

## the agent's Discretion

- Final route naming for the review cockpit
- Final section layout within the cockpit
- Final badge names for blocked/conflict/approved states

## Deferred Ideas

- Default auto-merge after review approval
- Automatic state-jumping repair on merge failures
- Embedded conflict editor inside OMC-client
- Cross-plan review queue or bulk review operations
