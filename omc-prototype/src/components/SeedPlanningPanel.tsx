import { startTransition, useEffect, useMemo, useState, type FormEvent } from 'react'
import type { OmcGuidedPlanningRun, OmcProgramPlanningState } from '@hopi/protocol/types'
import { useOperatorSurface } from '@/components/operator/OperatorSurfaceContext'
import { usePrototypeRemoteApi } from '@/prototype/remoteApi'
import { usePrototypeStore } from '@/prototype/store'
import { MetaBadge } from './StatusBadge'

type SeedPlanningPanelProps = {
    programId: string
    programName?: string
    planning: OmcProgramPlanningState | null
    planningRun: OmcGuidedPlanningRun | null
}

const stageLabels: Record<NonNullable<OmcGuidedPlanningRun['stage']>, string> = {
    brief: 'brief',
    discuss: 'discuss',
    plan: 'plan',
    handoff: 'handoff',
}

function getRunHeadline(status: OmcGuidedPlanningRun['status']): string {
    switch (status) {
        case 'queued':
            return '规划排队中'
        case 'running':
            return '规划进行中'
        case 'failed':
        case 'canceled':
            return '规划未完成'
        case 'completed':
            return '规划已完成'
    }
}

function getPlanningBadgeLabel(planning: OmcProgramPlanningState | null): string {
    if (!planning) {
        return 'planning 未知'
    }

    return planning.status === 'seeded'
        ? 'planning seed 已就绪'
        : 'planning 已接入'
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim()
    }

    const message = String(error).trim()
    return message || '规划启动失败，请重试。'
}

export default function SeedPlanningPanel(props: SeedPlanningPanelProps) {
    const api = usePrototypeRemoteApi()
    const operatorSurface = useOperatorSurface()
    const { actions } = usePrototypeStore()
    const [productIntent, setProductIntent] = useState(props.planningRun?.brief.productIntent ?? '')
    const [firstSlice, setFirstSlice] = useState(props.planningRun?.brief.firstSlice ?? '')
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        setPending(false)
        setError(null)
        setProductIntent(props.planningRun?.brief.productIntent ?? '')
        setFirstSlice(props.planningRun?.brief.firstSlice ?? '')
    }, [props.programId, props.planningRun?.id])

    const trimmedProductIntent = productIntent.trim()
    const trimmedFirstSlice = firstSlice.trim()
    const activeRun = props.planningRun?.status === 'queued' || props.planningRun?.status === 'running'
    const canRetry = props.planningRun?.status === 'failed' || props.planningRun?.status === 'canceled'
    const planningSessionId = props.planningRun?.sessionId ?? null
    const submitDisabled = pending || trimmedProductIntent.length === 0 || trimmedFirstSlice.length === 0
    const lede = useMemo(() => {
        if (canRetry) {
            return '上一轮规划没有完成。你可以直接重试当前 seed，让系统继续生成第一批计划。'
        }

        if (activeRun) {
            return '系统已经拿到你的 brief，正在把它收束成第一批可执行计划。'
        }

        return '项目已经接入，planning seed 也已就绪。现在给系统一句产品意图和第一刀，它就会开始生成第一批真实 PLAN。'
    }, [activeRun, canRetry])

    const statusSummary = props.planningRun?.error
        ?? props.planningRun?.summary
        ?? (activeRun
            ? '系统正在把你的 brief 收束成第一批可执行计划。'
            : '上一轮规划没有完成。你可以直接重试当前 seed。')

    async function handleSubmit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault()
        if (submitDisabled) {
            return
        }

        setPending(true)
        setError(null)

        try {
            await api.startGuidedPlanning(props.programId, {
                productIntent: trimmedProductIntent,
                firstSlice: trimmedFirstSlice,
            })

            startTransition(() => {
                actions.selectProgram?.(props.programId)
            })
        } catch (submitError) {
            setError(getErrorMessage(submitError))
        } finally {
            setPending(false)
        }
    }

    async function handleRetry() {
        if (!canRetry || pending) {
            return
        }

        setPending(true)
        setError(null)

        try {
            await api.retryGuidedPlanning(props.programId)

            startTransition(() => {
                actions.selectProgram?.(props.programId)
            })
        } catch (retryError) {
            setError(getErrorMessage(retryError))
        } finally {
            setPending(false)
        }
    }

    return (
        <section className="prototype-panel prototype-seed-panel">
            <div className="prototype-section-head">
                <div>
                    <h2>开始规划</h2>
                    <p className="prototype-seed-panel__lede">{lede}</p>
                </div>
                <div className="prototype-badge-row">
                    <MetaBadge tone="neutral">{getPlanningBadgeLabel(props.planning)}</MetaBadge>
                    {props.planningRun ? (
                        <MetaBadge tone={canRetry ? 'warning' : 'neutral'}>
                            {getRunHeadline(props.planningRun.status)}
                        </MetaBadge>
                    ) : null}
                    {props.planningRun?.stage ? (
                        <MetaBadge tone="neutral">{stageLabels[props.planningRun.stage]}</MetaBadge>
                    ) : null}
                </div>
            </div>

            {activeRun ? (
                <div className="prototype-seed-panel__status">
                    <strong>{getRunHeadline(props.planningRun!.status)}</strong>
                    <p>{statusSummary}</p>
                    <small>第一批计划写出来后，这里会自动切回正常经营盘。</small>
                    {planningSessionId ? (
                        <div className="prototype-seed-panel__actions">
                            <button
                                type="button"
                                className="prototype-button--ghost"
                                onClick={() => {
                                    operatorSurface.openSessionLog({
                                        sessionId: planningSessionId,
                                        source: 'planning-run',
                                        title: props.programName ?? '规划运行',
                                        subtitle: 'guided planning',
                                    })
                                }}
                            >
                                查看底层日志
                            </button>
                        </div>
                    ) : null}
                </div>
            ) : canRetry ? (
                <div className="prototype-seed-panel__status">
                    <strong>{getRunHeadline(props.planningRun!.status)}</strong>
                    <p>{statusSummary}</p>
                    <div className="prototype-seed-panel__actions">
                        <button
                            type="button"
                            className="prototype-primary-button"
                            onClick={() => {
                                void handleRetry()
                            }}
                            disabled={pending}
                        >
                            重试规划
                        </button>
                        {planningSessionId ? (
                            <button
                                type="button"
                                className="prototype-button--ghost"
                                onClick={() => {
                                    operatorSurface.openSessionLog({
                                        sessionId: planningSessionId,
                                        source: 'planning-run',
                                        title: props.programName ?? '规划运行',
                                        subtitle: 'guided planning',
                                    })
                                }}
                            >
                                查看底层日志
                            </button>
                        ) : null}
                    </div>
                </div>
            ) : (
                <form className="prototype-seed-panel__form" onSubmit={handleSubmit}>
                    <label className="prototype-seed-panel__field">
                        <span>产品意图</span>
                        <input
                            type="text"
                            value={productIntent}
                            onChange={(event) => {
                                setProductIntent(event.currentTarget.value)
                            }}
                            disabled={pending}
                        />
                    </label>

                    <label className="prototype-seed-panel__field">
                        <span>第一刀</span>
                        <textarea
                            value={firstSlice}
                            rows={4}
                            onChange={(event) => {
                                setFirstSlice(event.currentTarget.value)
                            }}
                            disabled={pending}
                        />
                    </label>

                    {error ? (
                        <p className="prototype-seed-panel__error" role="alert" aria-live="assertive" aria-atomic="true">
                            {error}
                        </p>
                    ) : null}

                    <div className="prototype-seed-panel__actions">
                        <button type="submit" className="prototype-primary-button" disabled={submitDisabled}>
                            开始规划
                        </button>
                    </div>
                </form>
            )}

            {!activeRun && canRetry && error ? (
                <p className="prototype-seed-panel__error" role="alert" aria-live="assertive" aria-atomic="true">
                    {error}
                </p>
            ) : null}
        </section>
    )
}
