import DemoAttachPanel from '@/components/DemoAttachPanel'
import {
    DailyDigestPanel,
    GoalPortfolioPanel,
    StreamsOverviewPanel
} from '@/components/DashboardPanels'
import { MetaBadge } from '@/components/StatusBadge'
import { Glyph } from '@/components/Visuals'
import { labelCheckpoint } from '@/prototype/presenter'
import { usePrototypeStore } from '@/prototype/store'

export default function DashboardPage() {
    const { state, dataSource } = usePrototypeStore()

    if (!state.attachedProgramId) {
        return <DemoAttachPanel />
    }

    const portfolio = dataSource.getPortfolio(state.window)
    const checkpoint = labelCheckpoint(portfolio.checkpoint.id)
    const openRiskCount = portfolio.risks.filter((risk) => risk.state === 'open').length
    const pendingApprovalCount = portfolio.approvalBatch.items.filter((item) => item.state === 'pending').length
    const approvalStateLabel = pendingApprovalCount > 0 ? '已有待批事项' : '今天尽量少打扰你'
    const topGoal = portfolio.goals[0]
    const summaryLine = pendingApprovalCount > 0
        ? `当前主线是「${topGoal?.title ?? '当前目标'}」；还有 ${pendingApprovalCount} 项待批。`
        : openRiskCount > 0
            ? `当前主线是「${topGoal?.title ?? '当前目标'}」；有 ${openRiskCount} 条风险还在观察。`
            : `当前主线是「${topGoal?.title ?? '当前目标'}」，其余动作都在静默推进。`

    return (
        <div className="prototype-dashboard">
            <section className="prototype-dashboard-hero prototype-panel">
                <div className="prototype-dashboard-hero__copy">
                    <div className="prototype-icon-pill prototype-icon-pill--large">
                        <Glyph name="repo" />
                    </div>
                    <div>
                        <p className="prototype-eyebrow">{portfolio.program.name}</p>
                        <h2>目标经营盘</h2>
                    </div>
                </div>

                <div className="prototype-dashboard-hero__meta">
                    <div className="prototype-badge-row">
                        <MetaBadge tone="neutral">{checkpoint.label}</MetaBadge>
                        <MetaBadge tone="neutral">{portfolio.checkpoint.stamp}</MetaBadge>
                        <MetaBadge tone={pendingApprovalCount > 0 ? 'accent' : 'success'}>
                            {approvalStateLabel}
                        </MetaBadge>
                    </div>
                    <p className="prototype-dashboard-hero__summary">{summaryLine}</p>
                </div>
            </section>

            <GoalPortfolioPanel goals={portfolio.goals} checkpointId={portfolio.checkpoint.id} />

            <DailyDigestPanel
                window={portfolio.digest.window}
                headline="今天系统做了什么"
                summary={checkpoint.synopsis}
            />

            <StreamsOverviewPanel
                goals={portfolio.goals}
                streams={portfolio.streams}
                checkpointId={portfolio.checkpoint.id}
            />
        </div>
    )
}
