# Feature Research

**Domain:** conversation-native project actions in a brownfield AI coding agent platform
**Researched:** 2026-03-07
**Confidence:** HIGH for current-state constraints and MVP table stakes; MEDIUM for v1.x/v2+ sequencing, which is inferred from current scope and architecture research

Primary thesis: project actions should run as normal agent work inside the existing task conversation. Same session, same sandbox, same tool-call loop, same visible stdout/stderr, same repair/retry behavior. Hidden backend workflows only as narrow fallback or verification layer, not product-default execution.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Conversation-native Merge trigger | Clicking Merge should feel like continuing the task, not starting an opaque side workflow | MEDIUM | Trigger action from the linked task session; keep chat/action/thread continuity |
| Script-first action execution | Existing projects already have repo-specific `.hopi/merge.sh`; users expect project policy to live in-repo | MEDIUM | First attempt: run repo script in workspace sandbox with normal tool semantics |
| Agent-visible failure handling | Coding agents are expected to inspect stderr, edit files, and retry when commands fail | HIGH | Exit code, stdout/stderr, and permission waits must be visible to the agent, not hidden in backend state |
| Repair + retry loop in same session | Without retry, custom scripts feel brittle and low-trust | HIGH | Agent should inspect git state, fix script/workspace issues, and retry until success or real blocker |
| Same sandbox and approvals as normal work | Users trust normal agent guardrails; actions should not get special hidden powers | MEDIUM | Reuse stable command shapes, workspace roots, approval semantics |
| Verified outcome before UI success | Merge buttons that say “done” before git truth is checked destroy trust | MEDIUM | Hub re-checks merge state and updates task/worktree metadata only after verified success |
| Durable action status across reconnects | Web/PWA/Telegram handoff is core product value; action truth cannot live only in one browser tab | MEDIUM | Persist run state and replay over SSE/query refresh |
| Human blocker + takeover path | Some failures need judgment, credentials, or out-of-sandbox work | LOW | Clear blocked/manual-needed state; user can resume manually or continue conversation |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Repo-owned workflows with agent self-repair | Keeps per-repo flexibility while avoiding brittle fixed backend flows | HIGH | `.hopi/*.sh` stays source of truth; agent can improve scripts when reality drifts |
| One execution model across merge, preview, init | Reduces product inconsistency; users learn one mental model | HIGH | Merge first in v1; preview/init reuse later on same envelope |
| Transcript-first observability | Users can see what command ran, why it failed, what changed, and why retry happened | MEDIUM | Prefer concise summaries plus expandable raw output/artifacts |
| Action continuity across local/remote surfaces | Distinct fit for local-first agent control product | MEDIUM | Same run visible in desktop terminal, web, phone, notifications |
| Self-healing project automation bootstrap | Project scripts stop being one-shot scaffolding and become living, repairable workflow assets | HIGH | Agent can create, validate, repair, and re-run scripts as part of normal work |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Hidden backend auto-retry loop | Seems “smoother” because fewer visible errors | Agent cannot see failures, users lose trust, duplicate logic emerges outside normal agent loop | Keep retries transcript-visible; persist concise attempt summaries |
| Universal built-in merge workflow | Fast to implement once | Real repos have custom merge/test/release policy; silent semantics drift | Script-first, repo-owned merge contract under `.hopi/merge.sh` |
| Silent fallback merge after script failure | Reduces short-term support load | Can “succeed” with wrong policy and masks broken project automation | Explicit fallback policy, visible to user, preferably opt-in |
| Separate action-only backend logs | Looks cleaner than chat noise | Splits truth across surfaces; agent loses direct feedback loop | One action thread with readable summaries and linked raw artifacts |
| Full generic action framework in v1 | Feels future-proof | Overbuild risk; delays proof of core merge loop | Merge-first envelope now; generalize after reliability proof |
| Automatic success based only on process exit 0 | Easy implementation | Script may exit cleanly without real merge/preview readiness | Post-run verification against git truth or readiness marker |

## Feature Dependencies

```text
[Conversation-native Merge trigger]
    └──requires──> [Durable action run state]
                       └──requires──> [Canonical action-state vocabulary]

[Script-first execution]
    ├──requires──> [Workspace-root resolution]
    └──requires──> [Sandboxed tool-call runner]

[Repair + retry loop]
    └──requires──> [Agent-visible stdout/stderr + exit status]
                       └──requires──> [Prompt/instruction contract for inspect-fix-retry]

[Verified success]
    └──requires──> [Post-run repo truth check]
                       └──requires──> [Task/worktree metadata sync]

[Preview/init reuse]
    └──requires──> [Reusable action envelope]

[Hidden backend fallback] ──conflicts──> [Conversation-native execution]
[Unbounded raw log dumping] ──conflicts──> [Readable task timeline]
```

### Dependency Notes

- **Conversation-native Merge trigger requires durable action run state:** otherwise refresh/reconnect loses action truth and users cannot trust the status.
- **Durable action run state requires canonical action-state vocabulary:** web, SSE, notifications, and chat must agree on `queued/running/retrying/blocked/succeeded/failed` semantics.
- **Script-first execution requires workspace-root resolution:** action runtime must know the canonical repo root vs worktree root before calling `.hopi/merge.sh`.
- **Script-first execution requires sandboxed tool-call runner:** action command must inherit the same safety boundary and approval behavior as normal coding work.
- **Repair + retry loop requires agent-visible stdout/stderr + exit status:** the model cannot self-correct if failures are translated into opaque backend statuses.
- **Agent-visible failure handling requires a prompt contract:** system/user action prompt should explicitly tell the agent to inspect, repair minimal files, retry, and stop only on real blockers.
- **Verified success requires post-run repo truth check:** UI success should depend on merge reality, not script optimism.
- **Preview/init reuse requires a reusable action envelope:** same run/attempt/state plumbing should work for different action types without inventing three separate systems.
- **Hidden backend fallback conflicts with conversation-native execution:** it creates a second source of truth and makes failures non-repairable by the agent.
- **Unbounded raw log dumping conflicts with readable task timeline:** repeated retries need compression, fingerprints, and artifact links.

## MVP Definition

### Launch With (v1)

- [ ] Conversation-native Merge action entrypoint — Merge button creates or resumes an action run inside the linked task session.
- [ ] Script-first merge execution — first attempt runs `.hopi/merge.sh` from the canonical project root inside normal tool-call semantics.
- [ ] Agent-visible repair loop — agent sees failures directly, can inspect git state, edit `.hopi/merge.sh` or related files, and retry.
- [ ] Durable action state + replay — action status survives reload/reconnect and is visible across web/PWA/phone surfaces.
- [ ] Verified merge completion — hub checks actual git merge outcome before updating task/worktree merge markers.
- [ ] Human blocker path — blocked/manual-needed state, cancel/stop affordance, and clear explanation of what needs human help.

### Add After Validation (v1.x)

- [ ] Preview action on same runtime envelope — once merge loop is trusted, move preview setup/start/repair into the same conversation-native model.
- [ ] Init action on same runtime envelope — replace special pre-kickoff init handling with the same observable action contract.
- [ ] Attempt summarization + retry fingerprints — compress repeated failures, avoid duplicate retries after reconnects, keep transcript readable.
- [ ] Project-level policy knobs — explicit fallback policy, retry limits, timeout caps, and optional script health checks.
- [ ] Action history views — show recent run outcomes per task/project for debugging trust and drift.

### Future Consideration (v2+)

- [ ] Custom project action registry — support more than merge/preview/init after the base action model proves stable.
- [ ] Stage-aware resume/checkpoints — rerun only failed stages when project scripts become long-running and structured enough.
- [ ] Declarative script contract or manifest — optional metadata around env vars, success markers, and verification rules.
- [ ] Cross-action orchestration — chained flows only after single-action reliability is high.
- [ ] Script lint/self-test assistant flows — proactive drift detection instead of waiting for first failure.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Conversation-native Merge trigger | HIGH | MEDIUM | P1 |
| Script-first execution in normal tool loop | HIGH | MEDIUM | P1 |
| Agent-visible repair + retry loop | HIGH | HIGH | P1 |
| Durable run state and replay | HIGH | MEDIUM | P1 |
| Verified repo-truth completion | HIGH | MEDIUM | P1 |
| Human blocker/takeover controls | MEDIUM | LOW | P1 |
| Preview action on same envelope | HIGH | MEDIUM | P2 |
| Init action on same envelope | MEDIUM | MEDIUM | P2 |
| Retry fingerprints and log summarization | MEDIUM | MEDIUM | P2 |
| Project policy knobs | MEDIUM | MEDIUM | P2 |
| Custom action registry | MEDIUM | HIGH | P3 |
| Stage-aware resume/checkpoints | LOW | HIGH | P3 |

**Priority key:**
- P1: required to validate merge-first conversation-native loop
- P2: extends the same model after v1 trust is established
- P3: future/generalization work; do not block merge-first proof

## Existing-Flow Comparison

| Capability | Current repo behavior | Detached backend workflow approach | Recommended direction |
|------------|-----------------------|------------------------------------|-----------------------|
| Merge execution | Partial script run + built-in merge route; agent not consistently in repair loop | Fast happy path, opaque failure path | Agent-driven execution in normal session/tool loop |
| Preview recovery | Can prompt agent to create/fix preview script when start fails | Usually separate job/log system | Reuse same action-run model after merge-first validation |
| Init workflow | Runs before kickoff when present, but outside a typed action run model | Often hidden bootstrap step | Later fold into same observable action envelope |
| Failure visibility | Mixed; some failures returned to UI, some logic stays in route handlers | Backend owns retries/status | Agent and user both see attempt result and next step |
| Workflow flexibility | Repo scripts exist, but fallback semantics can drift | Usually standardized but rigid | Repo-owned script contract first; fallback explicit and visible |

## Sources

- `README.md` — product promise: local-first agent control, remote surfaces, seamless handoff; HIGH confidence.
- `.planning/PROJECT.md` — core value, active requirements, constraints, out-of-scope decisions; HIGH confidence.
- `.planning/research/ARCHITECTURE.md` — recommended split: hub as orchestrator/verifier, agent as executor/repair owner; HIGH confidence.
- `.planning/research/PITFALLS.md` — anti-feature candidates, UX/security/perf failure modes; HIGH confidence.
- `.planning/codebase/ARCHITECTURE.md` — current platform building blocks and brownfield boundaries; HIGH confidence.
- `hub/src/web/routes/tasks.ts` — current merge route, merge-script attempt, preview setup prompt, existing fallback behavior; HIGH confidence.
- `hub/src/web/routes/projects.ts` — bootstrap task for `.hopi/init.sh`, `.hopi/merge.sh`, `.hopi/preview.sh`; HIGH confidence.
- `hub/src/sync/taskSessionService.ts` — current init-script-before-kickoff behavior; HIGH confidence.
- `shared/src/brand.ts` — canonical `.hopi/*` script paths and preview marker constants; HIGH confidence.

## Inference Notes

- v1.x ordering assumes merge-first proof before preview/init parity. This is directly aligned with `PROJECT.md` scope, but exact phase boundaries remain inference.
- “Table stakes” vs “differentiators” reflects product judgment from current repo direction, not external market benchmarking.
- No external competitor sweep used for this pass; document optimized for brownfield feature decisions inside current HOPI architecture.

---
*Feature research for: conversation-native project actions / merge-first brownfield iteration*
*Researched: 2026-03-07*
