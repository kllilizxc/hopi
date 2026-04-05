import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { OmcGuidedPlanningRun, OmcProgramOverviewResponse } from '@hopi/protocol/types'
import { useOmcApi } from '@/api/client'

type PlanningBootstrapPanelProps = {
    programId: string
    program: OmcProgramOverviewResponse['program']
    planning: OmcProgramOverviewResponse['planning']
    planningRun: OmcGuidedPlanningRun | null
}

const DEFAULT_SEED_FILES = [
    '.planning/PROJECT.md',
    '.planning/REQUIREMENTS.md',
    '.planning/ROADMAP.md',
    '.planning/STATE.md',
    '.planning/phases/01-bootstrap/01-CONTEXT.md'
]

const GUIDED_STAGE_LABELS: Array<{
    key: OmcGuidedPlanningRun['stage']
    title: string
    detail: string
}> = [
    {
        key: 'brief',
        title: 'Brief',
        detail: 'Capture repo intent and first slice.'
    },
    {
        key: 'discuss',
        title: 'Discuss',
        detail: 'Read the seed and frame the planning pass.'
    },
    {
        key: 'plan',
        title: 'Plan',
        detail: 'Draft real executable PLAN cards.'
    },
    {
        key: 'handoff',
        title: 'Handoff',
        detail: 'Return to the normal board.'
    }
]

function getRunTone(run: OmcGuidedPlanningRun | null): 'neutral' | 'warning' | 'success' | 'accent' {
    if (!run) {
        return 'neutral'
    }

    if (run.status === 'completed') {
        return 'success'
    }

    if (run.status === 'failed' || run.status === 'canceled') {
        return 'warning'
    }

    return 'accent'
}

function formatRunTimestamp(timestamp: number | null | undefined): string {
    if (!timestamp) {
        return 'Waiting for the first live signal.'
    }

    return new Date(timestamp).toLocaleString()
}

export default function PlanningBootstrapPanel(props: PlanningBootstrapPanelProps) {
    const api = useOmcApi()
    const queryClient = useQueryClient()
    const [planningRoot, setPlanningRoot] = useState(props.planning.planningRoot)
    const [productIntent, setProductIntent] = useState(props.planningRun?.brief.productIntent ?? '')
    const [firstSlice, setFirstSlice] = useState(props.planningRun?.brief.firstSlice ?? '')

    useEffect(() => {
        setPlanningRoot(props.planning.planningRoot)
    }, [props.planning.planningRoot])

    useEffect(() => {
        if (!props.planningRun) {
            return
        }
        setProductIntent((current) => current.trim() ? current : props.planningRun?.brief.productIntent ?? '')
        setFirstSlice((current) => current.trim() ? current : props.planningRun?.brief.firstSlice ?? '')
    }, [props.planningRun])

    const refreshProgram = async () => {
        await queryClient.invalidateQueries({ queryKey: ['omc', 'programs'] })
        await queryClient.invalidateQueries({ queryKey: ['omc', 'program', props.programId] })
        await queryClient.invalidateQueries({ queryKey: ['omc', 'planning-run', props.programId] })
        await queryClient.invalidateQueries({ queryKey: ['omc', 'planning-index', props.programId] })
        await queryClient.invalidateQueries({ queryKey: ['omc', 'plan-runtimes', props.programId] })
    }

    const attachPlanningMutation = useMutation({
        mutationFn: async () => await api.attachPlanningRoot(props.programId, {
            planningRoot
        }),
        onSuccess: refreshProgram
    })

    const seedMutation = useMutation({
        mutationFn: async () => await api.createPlanningSeed(props.programId),
        onSuccess: refreshProgram
    })

    const startGuidedPlanningMutation = useMutation({
        mutationFn: async () => await api.startGuidedPlanning(props.programId, {
            productIntent: productIntent.trim(),
            firstSlice: firstSlice.trim()
        }),
        onSuccess: refreshProgram
    })

    const retryGuidedPlanningMutation = useMutation({
        mutationFn: async () => await api.retryGuidedPlanning(props.programId),
        onSuccess: refreshProgram
    })

    const cancelGuidedPlanningMutation = useMutation({
        mutationFn: async () => await api.cancelGuidedPlanning(props.programId),
        onSuccess: refreshProgram
    })

    const latestPlanning = seedMutation.data?.planning
        ?? attachPlanningMutation.data?.planning
        ?? props.planning
    const latestRun = startGuidedPlanningMutation.data?.run
        ?? retryGuidedPlanningMutation.data?.run
        ?? cancelGuidedPlanningMutation.data?.run
        ?? props.planningRun
    const planningReady = latestPlanning.hasPlanning
    const activeRun = latestRun?.status === 'queued' || latestRun?.status === 'running'
    const visibleSeedFiles = latestPlanning.seedFiles.length > 0
        ? latestPlanning.seedFiles
        : latestPlanning.hasPlanning
            ? DEFAULT_SEED_FILES
            : []
    const primaryError = attachPlanningMutation.error
        ?? seedMutation.error
        ?? startGuidedPlanningMutation.error
        ?? retryGuidedPlanningMutation.error
        ?? cancelGuidedPlanningMutation.error
    const canStartGuidedPlanning = planningReady
        && !latestPlanning.hasPlans
        && !activeRun
        && productIntent.trim().length > 0
        && firstSlice.trim().length > 0
    const sessionHref = api.createSessionUrl(latestRun?.sessionId)
    const guidedStatusLabel = latestRun
        ? `guided-${latestRun.status}`
        : 'guided-idle'
    const currentStageIndex = latestRun
        ? GUIDED_STAGE_LABELS.findIndex((stage) => stage.key === latestRun.stage)
        : -1
    const nextStepItems = useMemo(() => {
        if (!planningReady) {
            return [
                {
                    title: 'Attach or seed planning.',
                    detail: 'Point OMC at a real planning tree, or let it write the thinnest possible repo-local scaffold.'
                },
                {
                    title: 'Keep the repo planning-first.',
                    detail: 'OMC will not start execution until real PLAN cards exist.'
                }
            ]
        }

        if (latestPlanning.hasPlans) {
            return [
                {
                    title: 'Executable plan cards detected.',
                    detail: 'OMC is handing you back to the normal plan board now.'
                }
            ]
        }

        if (activeRun) {
            return [
                {
                    title: 'Keep this page open.',
                    detail: 'OMC will refresh back into the normal board as soon as executable PLAN cards appear.'
                },
                {
                    title: 'Jump into the linked session if needed.',
                    detail: 'Take over only if guided planning needs human help before the first plan cards emerge.'
                }
            ]
        }

        return [
            {
                title: 'Write a lightweight planning brief.',
                detail: 'Only capture what the repo is for and what the first working slice should accomplish.'
            },
            {
                title: 'Start guided planning from OMC.',
                detail: 'OMC will run the planning continuation flow without dropping you back to the CLI.'
            }
        ]
    }, [activeRun, latestPlanning.hasPlans, planningReady])

    return (
        <section className="omc-panel omc-bootstrap-panel">
            <div className="omc-panel__header">
                <div>
                    <p className="omc-phase__eyebrow">Planning First</p>
                    <h2>
                        {!planningReady
                            ? 'This repo still needs planning'
                            : latestPlanning.hasPlans
                                ? 'Executable plan cards are now emerging'
                                : 'Guided planning can take over from the seed scaffold'}
                    </h2>
                </div>
                <span className={`omc-badge omc-badge--${planningReady ? getRunTone(latestRun) : 'warning'}`}>
                    {planningReady ? guidedStatusLabel : 'planning-missing'}
                </span>
            </div>

            <p>
                {!planningReady
                    ? 'This repo is attached, but it is not execution-ready yet. Either point OMC at an existing planning tree or let it create the thinnest possible seed inside the repo.'
                    : latestPlanning.hasPlans
                        ? 'OMC can already see executable PLAN cards. The bootstrap surface is about to hand back to the normal board.'
                        : 'Stay in planning mode and let OMC bridge the gap between the seed scaffold and the first executable PLAN cards.'}
            </p>

            {latestRun ? (
                <section className={`omc-panel__subsection omc-guided-progress omc-guided-progress--${getRunTone(latestRun)}`}>
                    <div className="omc-guided-progress__header">
                        <div>
                            <p className="omc-phase__eyebrow">Live progress</p>
                            <h3>
                                {latestRun.status === 'completed'
                                    ? 'Guided planning finished'
                                    : latestRun.status === 'failed'
                                        ? 'Guided planning needs help'
                                        : latestRun.status === 'canceled'
                                            ? 'Guided planning was stopped'
                                            : 'Guided planning is moving'}
                            </h3>
                        </div>
                        <div className="omc-card__badges">
                            <span className={`omc-badge omc-badge--${getRunTone(latestRun)}`}>{latestRun.status}</span>
                            <span className="omc-badge omc-badge--neutral">{latestRun.stage}</span>
                        </div>
                    </div>

                    <div className="omc-guided-progress__signal">
                        <span>Current signal</span>
                        <strong>{latestRun.summary ?? 'OMC is waiting for the next guided-planning signal.'}</strong>
                        <small>Updated {formatRunTimestamp(latestRun.updatedAt)}</small>
                    </div>

                    <ol className="omc-guided-progress__rail">
                        {GUIDED_STAGE_LABELS.map((stage, index) => {
                            const state = latestRun.stage === stage.key
                                ? 'current'
                                : currentStageIndex >= 0 && index < currentStageIndex
                                    ? 'complete'
                                    : 'upcoming'

                            return (
                                <li key={stage.key} data-state={state}>
                                    <span>{stage.title}</span>
                                    <strong>{stage.detail}</strong>
                                </li>
                            )
                        })}
                    </ol>

                    <div className="omc-guided-progress__meta">
                        <div className="omc-key-value">
                            <span>Session</span>
                            <strong>{latestRun.sessionId ?? 'Not attached yet'}</strong>
                        </div>
                        <div className="omc-key-value">
                            <span>Last transition</span>
                            <strong>{formatRunTimestamp(latestRun.updatedAt)}</strong>
                        </div>
                        <div className="omc-key-value">
                            <span>Target outcome</span>
                            <strong>At least one executable `*-PLAN.md` under `.planning/phases/`</strong>
                        </div>
                    </div>
                </section>
            ) : null}

            <div className="omc-callout">
                <div className="omc-key-value">
                    <span>Repo root</span>
                    <strong>{props.program.repoRoot}</strong>
                </div>
                <div className="omc-key-value">
                    <span>Planning root</span>
                    <strong>{latestPlanning.planningRoot}</strong>
                </div>
                <div className="omc-key-value">
                    <span>Current posture</span>
                    <strong>{latestPlanning.hasPlans ? `${latestPlanning.planCount} plan cards detected` : 'No plan cards yet'}</strong>
                </div>
            </div>

            {!planningReady ? (
                <div className="omc-bootstrap-panel__actions">
                    <form
                        className="omc-form omc-panel__subsection"
                        onSubmit={(event) => {
                            event.preventDefault()
                            attachPlanningMutation.mutate()
                        }}
                    >
                        <div>
                            <h3>Attach existing planning</h3>
                            <p className="omc-empty-copy">Use an explicit absolute path if the repo already has a planning tree somewhere else.</p>
                        </div>
                        <label className="omc-form__field">
                            <span>Planning root path</span>
                            <input
                                className="omc-input"
                                value={planningRoot}
                                onChange={(event) => setPlanningRoot(event.target.value)}
                                placeholder={`${props.program.repoRoot}/.planning`}
                                autoCapitalize="off"
                                autoCorrect="off"
                                spellCheck={false}
                            />
                        </label>
                        <div className="omc-action-row">
                            <button type="submit" className="omc-secondary-button" disabled={attachPlanningMutation.isPending}>
                                {attachPlanningMutation.isPending ? 'Attaching…' : 'Attach existing planning'}
                            </button>
                        </div>
                    </form>

                    <section className="omc-panel__subsection">
                        <div>
                            <h3>Create planning seed</h3>
                            <p className="omc-empty-copy">Write a minimal repo-local `.planning/*` scaffold and stay in planning mode.</p>
                        </div>
                        <div className="omc-action-row">
                            <button type="button" className="omc-primary-button" disabled={seedMutation.isPending} onClick={() => seedMutation.mutate()}>
                                {seedMutation.isPending ? 'Creating…' : 'Create planning seed'}
                            </button>
                        </div>
                    </section>
                </div>
            ) : latestPlanning.hasPlans ? (
                <section className="omc-panel__subsection">
                    <div className="omc-callout omc-callout--guided">
                        <h3>Executable planning is ready</h3>
                        <p>OMC detected the first executable PLAN cards. This surface will hand back to the normal board automatically as the planning index refreshes.</p>
                    </div>
                </section>
            ) : (
                <div className="omc-bootstrap-panel__guided">
                    <form
                        className="omc-form omc-panel__subsection"
                        onSubmit={(event) => {
                            event.preventDefault()
                            if (!canStartGuidedPlanning) {
                                return
                            }
                            startGuidedPlanningMutation.mutate()
                        }}
                    >
                        <div>
                            <h3>Guided planning brief</h3>
                            <p className="omc-empty-copy">Keep it light. OMC only needs enough intent to turn the seed scaffold into the first executable plan cards.</p>
                        </div>

                        <label className="omc-form__field">
                            <span>What is this repo for?</span>
                            <textarea
                                className="omc-input omc-textarea"
                                value={productIntent}
                                onChange={(event) => setProductIntent(event.target.value)}
                                placeholder="PersonalQuant tracks portfolio performance, trades, and analytics."
                                disabled={activeRun}
                            />
                        </label>

                        <label className="omc-form__field">
                            <span>What should the first working slice accomplish?</span>
                            <textarea
                                className="omc-input omc-textarea"
                                value={firstSlice}
                                onChange={(event) => setFirstSlice(event.target.value)}
                                placeholder="Create the first executable plan cards for portfolio ingest and analytics foundations."
                                disabled={activeRun}
                            />
                        </label>

                        <div className="omc-action-row">
                            <button type="submit" className="omc-primary-button" disabled={!canStartGuidedPlanning || startGuidedPlanningMutation.isPending}>
                                {startGuidedPlanningMutation.isPending ? 'Starting…' : 'Start guided planning'}
                            </button>
                            {latestRun ? (
                                <button
                                    type="button"
                                    className="omc-secondary-button"
                                    disabled={activeRun || retryGuidedPlanningMutation.isPending}
                                    onClick={() => retryGuidedPlanningMutation.mutate()}
                                >
                                    {retryGuidedPlanningMutation.isPending ? 'Retrying…' : 'Retry last run'}
                                </button>
                            ) : null}
                            {activeRun ? (
                                <button
                                    type="button"
                                    className="omc-secondary-button"
                                    disabled={cancelGuidedPlanningMutation.isPending}
                                    onClick={() => cancelGuidedPlanningMutation.mutate()}
                                >
                                    {cancelGuidedPlanningMutation.isPending ? 'Canceling…' : 'Cancel run'}
                                </button>
                            ) : null}
                            {sessionHref ? (
                                <a className="omc-secondary-link" href={sessionHref}>
                                    Open session
                                </a>
                            ) : null}
                        </div>
                    </form>

                    {latestRun ? (
                        <section className="omc-panel__subsection">
                            <div className={`omc-callout omc-callout--guided omc-callout--${getRunTone(latestRun)}`}>
                                <div className="omc-inline-links">
                                    <span className={`omc-badge omc-badge--${getRunTone(latestRun)}`}>{latestRun.status}</span>
                                    <span className="omc-badge omc-badge--neutral">{latestRun.stage}</span>
                                    {latestRun.sessionId ? <span className="omc-badge omc-badge--neutral">{latestRun.sessionId}</span> : null}
                                </div>
                                <p>{latestRun.summary ?? 'OMC is waiting for the next guided-planning signal.'}</p>
                                {latestRun.error ? (
                                    <p className="omc-error-copy">{latestRun.error}</p>
                                ) : null}
                                {latestRun.generatedPlanPaths.length > 0 ? (
                                    <ul className="omc-simple-list">
                                        {latestRun.generatedPlanPaths.map((path) => (
                                            <li key={path}>
                                                <strong>{path}</strong>
                                            </li>
                                        ))}
                                    </ul>
                                ) : null}
                            </div>
                        </section>
                    ) : null}
                </div>
            )}

            {primaryError ? (
                <p className="omc-error-copy">{primaryError instanceof Error ? primaryError.message : 'OMC could not update guided planning.'}</p>
            ) : null}

            {visibleSeedFiles.length > 0 && !activeRun && !latestPlanning.hasPlans ? (
                <div className="omc-panel__subsection">
                    <h3>Planning files</h3>
                    <ul className="omc-simple-list">
                        {visibleSeedFiles.map((file) => (
                            <li key={file}>
                                <strong>{file}</strong>
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <div className="omc-panel__subsection">
                <h3>Next step</h3>
                <ul className="omc-simple-list">
                    {nextStepItems.map((item) => (
                        <li key={item.title}>
                            <strong>{item.title}</strong>
                            <small>{item.detail}</small>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    )
}
