# Bootstrap Preview-Ready Loop

`project_init` should not succeed because an agent session became ready.

It should succeed only when the project reaches `preview ready`.

## Goal

Turn bootstrap into an AI-driven loop with system-enforced evidence:

1. AI inspects repo and edits repo / `.hopi/actions.yaml`
2. System validates contract
3. System probes preview
4. Failures go back into the same session as repair context
5. Only `preview ready` can advance bootstrap to review-ready

## Design

### Principles

- Keep dialogic AI loop; do not hardcode repo-specific flows
- Do not treat `assistant ready` as bootstrap success
- Use contract validity as a mid-step gate, not the final gate
- Use preview success as the bootstrap completion gate
- Keep failures observable and repairable inside the same session

### Runtime Model

`project_init` loop:

1. agent edits repo
2. agent emits `ready`
3. HOPI validates `.hopi/actions.yaml`
4. if invalid:
   - send repair prompt into same session
5. if valid:
   - start preview probe
6. if preview ready:
   - bootstrap success
7. if preview fails:
   - send preview failure context into same session
8. retry until success or attempts exhausted

### Evidence Gates

- Progress evidence:
  - repo or contract changed
- Structure evidence:
  - `.hopi/actions.yaml` parses and validates
- Result evidence:
  - preview reaches `ready`

Only result evidence can complete bootstrap.

## TODO

- [x] Stop treating `assistant_ready` as automatic bootstrap success
- [x] Keep contract validation inside the bootstrap loop
- [x] Auto-send contract repair prompts into the same session
- [x] Add bootstrap-specific preview probe after contract becomes valid
- [x] Auto-send preview repair prompts into the same session
- [x] Make `preview ready` the bootstrap success gate
- [ ] Reuse one shared preview orchestration helper instead of bootstrap-local logic plus route-local logic
- [ ] Persist a dedicated `bootstrapRuntime` instead of overloading `initRuntime`
- [ ] Add richer preview failure context: command, url, healthcheck summary, compact log tail
- [ ] Add setup probe into the same bootstrap loop before preview probe
- [ ] Add end-to-end tests for `project_init -> contract valid -> preview ready`

## Current Status

- `project_init` no longer advances on a bare `ready` event
- Invalid contract still triggers same-session repair turns
- Valid contract now triggers an automatic preview probe
- Preview failure now triggers same-session repair turns
- Bootstrap only moves to review-ready after preview reaches `ready`
