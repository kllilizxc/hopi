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
        <section className="flex flex-col gap-6 p-8 bg-white border border-zinc-200 rounded-xl shadow-sm">
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 pb-6 border-b border-zinc-100">
                <div className="flex flex-col max-w-2xl">
                    <h2 className="text-xl font-bold text-zinc-900 mb-2">开始规划</h2>
                    <p className="text-sm text-zinc-500 leading-relaxed">{lede}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 shrink-0">
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
                <div className="flex flex-col gap-3 p-6 bg-blue-50 border border-blue-100 rounded-xl">
                    <strong className="text-sm font-semibold text-blue-900">{getRunHeadline(props.planningRun!.status)}</strong>
                    <p className="text-sm text-blue-800">{statusSummary}</p>
                    <small className="text-xs text-blue-600 mt-2">第一批计划写出来后，这里会自动切回正常经营盘。</small>
                    {planningSessionId ? (
                        <div className="flex items-center gap-3 mt-4 pt-4 border-t border-blue-200/50">
                            <button
                                type="button"
                                className="px-4 py-2 text-sm font-medium text-blue-700 bg-white border border-blue-200 rounded-lg hover:bg-blue-50 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                <div className="flex flex-col gap-3 p-6 bg-amber-50 border border-amber-100 rounded-xl">
                    <strong className="text-sm font-semibold text-amber-900">{getRunHeadline(props.planningRun!.status)}</strong>
                    <p className="text-sm text-amber-800">{statusSummary}</p>
                    <div className="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-amber-200/50">
                        <button
                            type="button"
                            className="px-4 py-2 text-sm font-medium text-white bg-zinc-900 rounded-lg hover:bg-zinc-800 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed"
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
                                className="px-4 py-2 text-sm font-medium text-amber-700 bg-white border border-amber-200 rounded-lg hover:bg-amber-50 shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500"
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
                <form className="flex flex-col gap-6 max-w-2xl" onSubmit={handleSubmit}>
                    <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-zinc-700">产品意图</span>
                        <input
                            type="text"
                            className="w-full px-4 py-2.5 text-sm border border-zinc-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-zinc-100 disabled:text-zinc-500 transition-colors"
                            value={productIntent}
                            onChange={(event) => {
                                setProductIntent(event.currentTarget.value)
                            }}
                            disabled={pending}
                        />
                    </label>

                    <label className="flex flex-col gap-2">
                        <span className="text-sm font-semibold text-zinc-700">第一刀</span>
                        <textarea
                            className="w-full px-4 py-2.5 text-sm border border-zinc-300 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-zinc-100 disabled:text-zinc-500 transition-colors resize-y min-h-[100px]"
                            value={firstSlice}
                            rows={4}
                            onChange={(event) => {
                                setFirstSlice(event.currentTarget.value)
                            }}
                            disabled={pending}
                        />
                    </label>

                    {error ? (
                        <p className="p-3 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg" role="alert" aria-live="assertive" aria-atomic="true">
                            {error}
                        </p>
                    ) : null}

                    <div className="flex items-center gap-4 mt-2">
                        <button
                            type="submit"
                            className="px-6 py-2.5 text-sm font-medium text-white bg-zinc-900 rounded-lg shadow-sm hover:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed"
                            disabled={submitDisabled}
                        >
                            开始规划
                        </button>
                    </div>
                </form>
            )}

            {!activeRun && canRetry && error ? (
                <p className="p-3 mt-4 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg" role="alert" aria-live="assertive" aria-atomic="true">
                    {error}
                </p>
            ) : null}
        </section>
    )
}
