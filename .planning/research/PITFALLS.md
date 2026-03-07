# Pitfalls Research

**Domain:** Conversation-native merge-first project actions for AI coding agents
**Researched:** 2026-03-07
**Confidence:** MEDIUM

**Confidence note:** HIGH for current HOPI failure modes; MEDIUM for cross-agent generalization across Codex / Claude permission systems.

**Phase note:** No roadmap file yet. Phase labels below inferred from `.planning/PROJECT.md` active requirements.

- **Phase 1 — Runtime Unification:** Merge action runs as normal in-conversation tool use, not hidden backend workflow.
- **Phase 2 — Sandbox Fidelity:** Same workspace boundary / approval model as normal agent work.
- **Phase 3 — Success Verification:** Success based on repo state, not assistant chatter or backend flags.
- **Phase 4 — Retry + Recovery Control:** Bounded retries, blocker detection, safe cleanup, resumability.
- **Phase 5 — UX + Observability:** One understandable thread; low-noise status; user-visible blockers.
- **Phase 6 — Script Contract + Drift Control:** `.hopi/merge.sh` stays versioned, testable, repairable.

## Critical Pitfalls

### Pitfall 1: Assistant completion mistaken for merge completion

**Confidence:** HIGH — repo-grounded.

**What goes wrong:**
Backend treats “assistant replied” or “background retry scheduled” as near-success. User sees progress or success-like UI, but target branch still does not contain task changes.

**Why it happens:**
Proxy signals easier than reading git truth. Current HOPI flow already has assistant-wait loops and `auto_retry_scheduled` responses around merge/script execution, so completion pressure shifts from repo state to orchestration state.

**How to avoid:**
Define success as a tuple, not a vibe: post-action git-state check passes, task metadata updated, and merge thread records exact outcome (`merged`, `already_merged`, `no_changes`, or real blocker). Never persist merged state from assistant text alone.

**Warning signs:**
- Task shows merge progress but `gitMergeWorktreeState.mergeable` still true.
- `mergedAt` or success toast appears without merge commit / verified no-change outcome.
- Transcript ends with agent summary; no final repo-state verification event.

**Phase to address:**
Phase 3 — Success Verification.

---

### Pitfall 2: Hidden backend logic forks reality away from the conversation

**Confidence:** HIGH — repo-grounded.

**What goes wrong:**
Merge behavior split across prompts, RPC helpers, auto-commit paths, fallback merges, and background retries. Agent does not observe every repo mutation, so reasoning drifts from actual state.

**Why it happens:**
Brownfield systems add “helpful” backend automation piecemeal. In HOPI today, merge logic already spans `hub/src/web/routes/tasks.ts`, `hub/src/sync/projectScripts.ts`, and CLI git/bash handlers.

**How to avoid:**
Single runtime path. Backend should broker policy and persistence, not secretly do the work. If any system action still happens outside the agent tool loop, emit it as explicit transcript/tool events or remove it.

**Warning signs:**
- Repo changed, but no corresponding tool-call output in chat.
- Duplicate shell / merge helpers appear in multiple backend files.
- User gets toast-only state changes that the agent cannot cite.

**Phase to address:**
Phase 1 — Runtime Unification.

---

### Pitfall 3: “Workspace sandbox” that is only a checked `cwd`

**Confidence:** HIGH — repo-grounded, plus official agent-doc support.

**What goes wrong:**
System claims workspace-bound execution, but hidden bash execution can still read/write outside the repo if command text does so. Safety model diverges from what users expect from normal agent tools.

**Why it happens:**
`cwd` validation feels like sandboxing, but it is not. Current HOPI bash RPC validates `cwd` path, then runs arbitrary shell via `child_process.exec`. Official Codex and Claude docs both frame permissions around working-directory / allowed-directory boundaries, not “trust any shell once cwd is okay.”

**How to avoid:**
Run merge-first actions through the same tool sandbox as ordinary agent work. If backend shell execution remains, add real OS-level sandboxing, allowed-root enforcement for file access, and tests that prove outside-workspace paths stay denied during run/fix/retry loops.

**Warning signs:**
- Action only works when given broader machine access than normal agent work.
- Special-casing for “outside the working directory” errors grows over time.
- Commands embed absolute paths, home-dir paths, or network calls even when requirement says workspace-only.

**Phase to address:**
Phase 2 — Sandbox Fidelity.

---

### Pitfall 4: Retry loops that repeat failure without generating new evidence

**Confidence:** HIGH — repo-grounded.

**What goes wrong:**
System keeps rerunning merge/script steps after transient-looking 500s, but nothing changed in repo, script, approvals, or conflict set. Users get spinners, toasts, and delay — not progress.

**Why it happens:**
Retry policy often keys off status class alone. Current HOPI background retry loop already retries on retryable merge failures with time/attempt caps, but not on “same failure fingerprint with zero new state.”

**How to avoid:**
Persist retry journal: stderr hash, conflict-file set, script hash, git-state hash, last human action. Allow retry only when something materially changed or retry budget explicitly permits another attempt. Stop with a blocker summary when the system is looping.

**Warning signs:**
- Same stderr or conflict set repeated across attempts.
- `.hopi/merge.sh` unchanged between retries.
- Merge state, branch names, and dirty-tree shape unchanged after each retry.

**Phase to address:**
Phase 4 — Retry + Recovery Control.

---

### Pitfall 5: Conflict recovery mutates or cleans up state too aggressively

**Confidence:** HIGH — repo-grounded, plus official git-doc support.

**What goes wrong:**
Auto-commit before merge plus hard cleanup after failure can erase forensic context, discard manual fixes, or bypass repo-local checks. Recovery becomes harder than the original conflict.

**Why it happens:**
Product wants target tree clean fast. Current built-in merge path auto-commits worktree changes, performs `git merge --squash`, then hard-resets on failure; commit path uses `--no-verify`. Git docs warn merges with non-trivial preexisting changes are hard to unwind cleanly, and `--no-verify` intentionally skips hooks.

**How to avoid:**
Preflight snapshots first. Refuse destructive retry when base repo dirty or recovery point missing. Preserve conflict artifacts, expose hook policy explicitly, and keep cleanup visible to the agent/user instead of silent resets.

**Warning signs:**
- Failed merge leaves less evidence than before it started.
- Manual merge succeeds, automated fallback behaves differently.
- Repo depends on hooks / generated files, but merge logs show silent hook bypass.

**Phase to address:**
Phase 4 — Retry + Recovery Control.

---

### Pitfall 6: Script contract drift masquerades as repo-specific flexibility

**Confidence:** HIGH — repo-grounded.

**What goes wrong:**
`.hopi/merge.sh` exists, exits 0, and still fails the real job: wrong target branch, stale env assumptions, missing prerequisites, partial merge, or old repo topology. “Customizable” turns into “undefined behavior.”

**Why it happens:**
Scripts generated once, then forgotten. Repo evolves faster than script contract. Current HOPI project context explicitly says scripts often fail and recovery is inconsistent.

**How to avoid:**
Treat project scripts as versioned product surface. Define required env vars, expected success semantics, optional machine-readable summary, and a cheap self-test/doctor path. Make the agent able to repair or regenerate scripts in-repo, with visible diffs.

**Warning signs:**
- Script exists, but post-run merge state still says branch mergeable.
- Same project keeps needing “fix `.hopi/merge.sh`” during merge attempts.
- Script references old branch names, tool paths, or bootstrap assumptions.

**Phase to address:**
Phase 6 — Script Contract + Drift Control.

---

### Pitfall 7: Approval churn and multi-surface noise drown the user

**Confidence:** MEDIUM — repo-grounded plus official agent-doc support.

**What goes wrong:**
One merge click creates a chat prompt, approval request(s), thread events, toast events, retry notices, and maybe silent background work. User cannot tell whether agent is blocked, waiting, or actually progressing.

**Why it happens:**
Conversation-native actions cross UI layers. Official Claude permission docs approve bash patterns per project directory / command shape, and current HOPI merge prompt recommends a dynamic one-shot shell command containing task id, branch names, env vars, and path. Small command-shape changes can trigger fresh approvals and extra noise.

**How to avoid:**
Use one canonical action thread. Stable command shapes. Group retries beneath one status node. Distinguish `waiting_for_approval`, `investigating`, `retrying`, `blocked`, `merged`. Toasts should summarize, not become a second reality.

**Warning signs:**
- Same merge action asks for approval multiple times with nearly identical commands.
- Toast says retry scheduled, chat says done, task status says something else.
- Users screenshot the UI to ask “is it still running?”

**Phase to address:**
Phase 5 — UX + Observability.

---

### Pitfall 8: Silent fallback bakes in the wrong merge semantics

**Confidence:** HIGH — repo-grounded, plus official git-doc support.

**What goes wrong:**
Repo-specific merge workflow silently degrades into a universal backend merge. Result: wrong history shape, skipped hooks, skipped repo conventions, broken follow-on scripts, or “success” that is invalid in that project.

**Why it happens:**
Universal fallback tempting. Current HOPI built-in merge path is opinionated: auto-commit, squash merge, cleanup, no-verify. Real repos may require merge commit, rebase, cherry-pick, branch protection conventions, codegen, or repo-local validation.

**How to avoid:**
Make merge strategy explicit per project. If fallback exists, it must be opt-in, visible, and policy-compatible — not silent “best effort.” Prefer agent-visible repair of the project script over backend semantic substitution.

**Warning signs:**
- Same project produces different commit topology depending on code path.
- Preview/init assumptions break after a “successful” merge.
- Users trust manual merge, distrust action merge.

**Phase to address:**
Phase 1 — Runtime Unification, and Phase 6 — Script Contract + Drift Control.

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Hidden backend auto-retry loop | Fewer immediate red errors | Ghost progress, hard-to-debug state divergence, duplicate logic | Only as short-lived instrumentation behind a debug flag |
| One giant dynamic `bash` command with inline env vars | Easy single-shot execution | Poor approval caching, poor failure localization, ugly transcript noise | Only as manual copy/paste hint, not default automation shape |
| Silent universal merge fallback | Fast path for simple repos | Breaks repo-specific merge policy and trust | Only if project explicitly opts in to that exact merge mode |
| Generate `.hopi/merge.sh` once and trust it forever | Fast onboarding | Contract drift, stale assumptions, repeated repair loops | Never, unless paired with self-test on every action run |
| Silent `--no-verify` on fallback commit | Avoids local hook flakiness | False-green merges, skipped repo policy | Only as explicit emergency override visible to the user |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Git merge state ↔ task metadata | Trusting `worktreeMergedAt` / UI state before rechecking git truth | Recompute mergeability after every action attempt; persist metadata only after verified outcome |
| Agent permission runtime (Codex / Claude) | Assuming one-off dynamic shell commands will reuse approvals cleanly | Use stable command shapes, canonical working dir, explicit allowed roots, transcript-visible approval waits |
| Worktree root vs base repo root | Running script from whichever path happens to exist first | Pick one canonical project root for script contract; pass it explicitly and verify it |
| Project script ↔ built-in fallback | Letting fallback change merge semantics silently | Make project strategy explicit; expose fallback choice and policy mismatch |
| Toast/SSE/chat/task state layers | Letting each layer invent its own action status vocabulary | Define one action-state model and map every surface to it |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Polling git merge state on every retry in large repos | Slow merge button, repeated timeouts, hot CPU on repo-heavy machines | Backoff, cache unchanged states, stop polling while agent already thinking, prefer evented checkpoints | Large monorepos (~100k+ files) or ~10+ concurrent active merges on one hub |
| Re-running the full merge script from scratch after every small fix | 2–10 minute loops, duplicate build/test cost, users abandoning action flow | Split preflight / merge / postflight, support resume markers, rerun only the failed stage when safe | Scripts that embed full build/test or repo bootstrap; especially >2 minutes per attempt |
| Dumping full stdout/stderr into transcript on every retry | Chat lag, unreadable timeline, browser memory bloat | Summarize repeated failures, attach latest error hash + expandable raw logs | Repeated failures with >1 MB logs or >5 retries |
| Retrying identical failures after reconnects / background wakeups | Bursty duplicate work after connectivity changes | Persist retry fingerprint and last-attempt outcome; require state delta before retry | Flaky remote-control sessions or long-running background retries |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Using raw backend shell execution as a stand-in for agent sandbox | Workspace escape, secret exposure, trust-boundary mismatch | Enforce the same sandbox/approval policy as normal agent tools; test denied paths and network calls |
| Granting broad approval patterns just to reduce merge friction | Agent can run more than merge flow needs | Narrow approval scope to stable merge wrapper/tool calls and specific roots |
| Letting merge scripts inherit wider machine environment than intended | Medium-to-high risk: credentials, SSH context, or network access leak into automation unexpectedly | Minimize env passed to action runtime; scrub or explicitly declare needed env vars |
| Treating hook bypass as harmless reliability aid | Security / compliance / repo-policy checks silently skipped | Keep hook policy explicit; do not use silent `--no-verify` in default path |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Reporting “merge in progress” or “success” when only a retry was scheduled | User trusts false progress; later surprises | Separate scheduled retry from completed merge; show exact next wake-up condition |
| Mixing chat updates, toast updates, and task status with different wording | User cannot tell canonical truth | One action thread, one state model, optional summarized toasts |
| Showing non-actionable errors like “script failed” | User cannot help, agent cannot recover cleanly | Surface stdout/stderr summary, last command, blocker classification, suggested next step |
| Re-asking for approvals on slightly different commands | Feels broken and noisy | Stable command wrapper or dedicated tool contract for merge actions |
| Hiding what the system already tried | Human repeats failed advice; agent loses momentum after reconnect | Persist retry history and display “attempted / failed / why” summary |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **Merge success:** Agent said “done” — verify target branch now contains task changes and mergeability is false.
- [ ] **Sandbox safety:** Action used workspace-scoped tool semantics — verify outside-root read/write/network attempts are still blocked.
- [ ] **Retry logic:** Automatic retries exist — verify identical failure fingerprints stop with blocker summary, not endless churn.
- [ ] **Script support:** `.hopi/merge.sh` exists — verify contract version/self-test still matches current repo behavior.
- [ ] **UX clarity:** User saw status updates — verify one canonical thread explains start, retries, blocker, and finish.
- [ ] **Fallback safety:** Fallback merge path exists — verify it is opt-in and semantically compatible with this repo.

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| False-success state | HIGH | Recompute git merge state, clear incorrect task merge metadata, post corrective event in transcript, resume from verified repo truth |
| Hidden backend state drift | HIGH | Stop background automation, emit full action history, reconcile repo state vs task state, restart in one visible runtime path |
| Retry storm | MEDIUM | Fingerprint failure, disable auto-retry for that task, surface blocker summary, require state-changing human/agent action before retry |
| Script drift | MEDIUM | Diff current script vs expected contract, repair/regenerate script in repo, run self-test, retry merge with transcript-visible output |
| Aggressive cleanup after conflict | HIGH | Recover from autocommit snapshot / reflog / preserved artifacts, restore worktree, restart with safe preflight and no silent cleanup |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Assistant completion mistaken for merge completion | Phase 3 — Success Verification | Simulate agent saying “done” while merge still pending; system must refuse success |
| Hidden backend logic forks reality away from the conversation | Phase 1 — Runtime Unification | Record a merge action and confirm every repo mutation appears in transcript/tool events |
| “Workspace sandbox” that is only a checked `cwd` | Phase 2 — Sandbox Fidelity | Attempt outside-root file access during merge run/fix/retry; action must be denied consistently |
| Retry loops that repeat failure without new evidence | Phase 4 — Retry + Recovery Control | Feed identical stderr/conflict set repeatedly; system must stop with blocker summary after bounded retries |
| Conflict recovery mutates or cleans up state too aggressively | Phase 4 — Retry + Recovery Control | Run dirty-tree + conflict scenarios; verify recovery point preserved and no silent destructive cleanup |
| Script contract drift masquerades as flexibility | Phase 6 — Script Contract + Drift Control | Break script assumptions intentionally; agent repairs script and self-test passes before merge success |
| Approval churn and multi-surface noise drown the user | Phase 5 — UX + Observability | End-to-end merge should read as one coherent thread with predictable approval behavior |
| Silent fallback bakes in the wrong merge semantics | Phase 1 / Phase 6 | Project with custom merge policy must never silently degrade to squash/no-verify fallback |

## Sources

- **Project context / repo-grounded evidence**
  - `.planning/PROJECT.md`
  - `hub/src/web/routes/tasks.ts`
  - `hub/src/sync/projectScripts.ts`
  - `cli/src/modules/common/handlers/bash.ts`
  - `cli/src/modules/common/handlers/git.ts`
  - `cli/src/modules/common/pathSecurity.ts`
- **Official docs / announcements**
  - OpenAI Codex CLI intro and approval modes: https://developers.openai.com/codex/cli
  - OpenAI Codex security-by-design / Full Auto working-directory sandbox note: https://openai.com/index/introducing-upgrades-to-codex/
  - Anthropic Claude Code settings / permissions / sandbox controls: https://docs.anthropic.com/en/docs/claude-code/settings
  - Anthropic Claude Code common workflows / approval behavior: https://docs.anthropic.com/en/docs/claude-code/common-workflows
  - Git `git-merge` reference (`--squash`, `--abort`, `--no-verify` behavior): https://git-scm.com/docs/git-merge
  - Git `git-rerere` reference (reuse recorded resolution): https://git-scm.com/docs/git-rerere
- **Inference notes**
  - High-confidence inferences tied directly to current HOPI code paths.
  - Medium-confidence generalizations where Codex / Claude permission behavior differs in detail but shares the same failure class.

---
*Pitfalls research for: conversation-native merge-first project actions for AI coding agents*
*Researched: 2026-03-07*
