# Project: HOPI OMC

## Vision

Build a new HOPI product mode for running a one-person software company through native `Ralph loop + GSD` workflows.

OMC should turn HOPI from a session-first remote control app into an autonomous coding control plane where plans, loops, attempts, evidence, and review gates are first-class objects.

## Product Goal

Ship a Codex-first, markdown-first orchestration surface that can:

- read GSD planning artifacts directly
- execute one plan through Ralph-style fresh-context attempts
- show attempt and evidence history clearly
- keep human review and merge as explicit gates

## Why this exists

Current HOPI project/task surfaces are still session-first. They are useful infrastructure, but not the right product shell for plan-oriented autonomous execution.

OMC exists to create a second product mode with:

- `Program` as the top-level object
- `PLAN.md` as the stable execution card
- `LoopRun` / `Attempt` / `Evidence` as visible runtime primitives
- `Codex` as a first-class autonomous execution runtime

## Non-Negotiables

- New product mode, not a cosmetic extension of the current `projects` board
- `1 card = 1 PLAN.md`
- `phase` groups cards; it is not the primary execution card
- planning truth stays in markdown
- runtime truth lives in DB
- attempts are first-class history
- human review remains explicit
- no auto-merge in the early milestones

## Initial Scope

The first milestone focuses on proving the thinnest useful OMC loop:

- new `OMC-client/` frontend shell
- hub-side OMC runtime records, APIs, and events
- planning indexer for `.planning/phases/**/*PLAN.md`
- manual start of one plan loop
- visible attempt/evidence history

## Canonical Design Input

- `docs/design/factory-mode-ralph-gsd.md`
- `docs/design/omc-phase-01-context.md`
