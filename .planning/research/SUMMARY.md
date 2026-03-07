# Project Research Summary

**Project:** HOPI
**Domain:** Conversation-native project actions for a local-first AI coding agent platform
**Researched:** 2026-03-07
**Confidence:** HIGH for brownfield fit and merge-first direction; MEDIUM for later generalization beyond merge

## Executive Summary

HOPI already has the right raw ingredients for conversation-native project actions: linked task sessions, repo-owned `.hopi/*` scripts, worktree-aware merge flows, preview lifecycle hooks, and a local-first hub/CLI/web control plane. The research consistently points toward evolving those existing pieces into a single action runtime where the agent remains in the execution loop, instead of extending the current mix of backend fallbacks, route-local retries, and partially hidden automation.

For merge-first v1, the recommended direction is script-first, agent-driven execution inside the normal session/tool-call flow. The hub should own intent, durable run state, verification, and user-facing status, while the agent owns command execution, reading failures, fixing scripts or repo state inside the workspace sandbox, and retrying until success or a real blocker. This matches the product promise better than a universal built-in merge workflow, because project policy is highly repo-specific.

The biggest risks are false success states, hidden backend behavior the agent cannot see, sandbox drift, and retry loops that keep repeating without new evidence. Roadmap phases should therefore prioritize runtime unification, verified repo-truth completion, and explicit blocker/retry semantics before expanding the same model to preview and init.

## Key Findings

### Recommended Stack

Stay on the existing brownfield stack: Bun workspaces, strict TypeScript, Hono, Socket.IO, SQLite, Zod, and shared protocol contracts. The key stack change is not a framework swap; it is adding a typed action-run layer with durable run/attempt/observation state and clear ownership boundaries between hub orchestration and agent execution.

**Core technologies:**
- Bun + Bun workspaces — keep one runtime for hub/cli/shared and stream action execution without introducing extra sidecars
- TypeScript strict + shared protocol schemas — add typed action intent/result contracts across hub, cli, and web
- Hono + Socket.IO + SQLite — keep the existing local-first control plane and persist action runs, attempts, and replayable status
- Optional OpenTelemetry rollout — useful for deeper cross-process tracing after merge-first semantics are stable

### Expected Features

Conversation-native execution is table stakes for this iteration. Users expect Merge to feel like continuing normal agent work, not launching an opaque backend job.

**Must have (table stakes):**
- Conversation-native Merge trigger — merge starts in the linked task session, not a detached workflow
- Script-first execution — first attempt runs `.hopi/merge.sh` under normal tool-call semantics
- Agent-visible failure handling — stdout/stderr/exit outcome visible to the agent so it can react naturally
- Repair + retry loop — agent can inspect git state, edit `.hopi/merge.sh` or workspace files, and retry
- Verified completion — hub checks git truth before marking merge successful
- Human blocker path — clear stop state when human judgment or out-of-sandbox work is required

**Should have (competitive):**
- Durable action state + replay across web/PWA/phone surfaces
- Transcript-first observability of attempts and retries
- Same execution model extended later to Preview and Init

**Defer (v2+):**
- Generic action registry for arbitrary project actions
- Declarative action manifests and stage-aware resume/checkpoints
- Cross-action orchestration chains

### Architecture Approach

The recommended architecture is hub-orchestrated but agent-executed. The hub records the action run, dispatches a structured action request into the active task session, tracks status, and verifies final repo truth. The agent executes the action using ordinary tool calls in the workspace sandbox, observes failures, applies fixes, and decides retries. Repo-owned scripts remain the project-specific policy surface.

**Major components:**
1. Action runtime in hub — stores run state, attempts, blocker reasons, and replayable status
2. Session action envelope — structured prompt/event injected into the existing task conversation
3. Agent execution loop — runs script/commands, reads failures, edits repo or scripts, retries
4. Verification layer — checks actual merge outcome before updating task/worktree metadata

### Critical Pitfalls

1. **Split execution truth** — backend mutates repo state outside visible agent flow; avoid by making agent/tool output the canonical execution path
2. **False success after script exit 0** — script can exit cleanly without real merge completion; avoid with post-run git-truth verification
3. **Sandbox drift** — `cwd` checks are not enough if hidden shell execution can still escape expectations; keep execution aligned with normal workspace tool semantics
4. **Blind retries** — repeated retries without new evidence create noise, not progress; track retry fingerprints and stop on real loops
5. **Script contract drift** — `.hopi/merge.sh` ages out as repo workflow changes; treat scripts as living, repairable project assets

## Implications for Roadmap

Based on research, suggested coarse phase structure:

### Phase 1: Unify Merge Runtime
**Rationale:** The product problem starts with detached execution semantics, not missing scripts.
**Delivers:** Canonical merge action run model, structured conversation trigger, durable status vocabulary, and hub/session handoff
**Addresses:** Conversation-native Merge trigger, durable action state, transcript-visible execution
**Avoids:** Split execution truth, hidden backend automation

### Phase 2: Ship Self-Healing Merge Loop
**Rationale:** Once action runtime exists, the real user value comes from the agent seeing failure, fixing things, and retrying in place.
**Delivers:** Script-first merge attempt, agent-visible stderr/stdout, repair + retry loop, blocker path, verified repo-truth completion
**Uses:** Existing `.hopi/merge.sh`, worktree metadata, session tool-call flow
**Implements:** Agent-executed action loop with hub verification

### Phase 3: Harden Script Contract and Expand Pattern
**Rationale:** After merge-first flow is trusted, reduce drift and prepare reuse for Preview/Init.
**Delivers:** Script contract cleanup, retry fingerprinting, action history/polish, and preview/init follow-on groundwork
**Addresses:** Script drift, retry loops, future pattern reuse

### Phase Ordering Rationale

- Phase 1 comes first because product trust depends on one execution truth visible to both user and agent.
- Phase 2 follows because repair/retry behavior only works once the runtime can persist attempts and expose outcomes cleanly.
- Phase 3 is deliberately later to avoid overbuilding a generic framework before merge-first reliability is proven.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2:** exact action-state transitions, retry budgets, blocker semantics, and verification contract
- **Phase 3:** preview/init parity details and whether optional action manifests are worth the complexity

Phases with standard patterns:
- **Phase 1:** mostly brownfield integration and state-model work inside existing hub/cli/web architecture

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Strong brownfield fit; recommended direction mainly extends existing repo stack |
| Features | HIGH | User intent and current codebase constraints align clearly around merge-first execution |
| Architecture | HIGH | Existing hub/session/task structure already supports this direction with incremental refactor |
| Pitfalls | HIGH | Most risks are already visible in current code shape and user pain |

**Overall confidence:** HIGH

### Gaps to Address

- Exact event/message shape for a structured action request inside the existing conversation flow
- Precise stop conditions for “real blocker” vs. another agent retry
- Whether merge fallback should remain at all, or only as an explicit/manual escape hatch
- How much attempt detail should surface in chat versus compact status UI

## Sources

### Primary (HIGH confidence)
- `.planning/PROJECT.md` — active scope, constraints, merge-first direction
- `.planning/research/STACK.md` — brownfield stack recommendations and orchestration choices
- `.planning/research/FEATURES.md` — MVP table stakes, differentiators, anti-features
- `.planning/research/ARCHITECTURE.md` — component boundaries, data flow, build order
- `.planning/research/PITFALLS.md` — dominant failure modes and prevention strategies
- `.planning/codebase/ARCHITECTURE.md` — existing system shape and product surfaces
- `hub/src/web/routes/projects.ts` — bootstrap task for `.hopi/init.sh`, `.hopi/merge.sh`, `.hopi/preview.sh`
- `hub/src/sync/taskSessionService.ts` — current init-script-before-kickoff flow
- `hub/src/web/routes/tasks.ts` — current preview setup, merge-script run, fallback merge, and verification behavior
- `shared/src/brand.ts` — canonical script paths and preview marker contract

### Secondary (MEDIUM confidence)
- Worker-authored research inference across current repo state for later phase ordering and future generalization

### Tertiary (LOW confidence)
- None used directly for roadmap-critical claims in this pass

---
*Research completed: 2026-03-07*
*Ready for roadmap: yes*
