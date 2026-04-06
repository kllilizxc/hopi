import type {
    PrototypeApprovalItem,
    PrototypeApprovalState,
    PrototypeCheckpointId,
    PrototypeDirectionPosture,
    PrototypeGoal,
    PrototypeGoalPriority,
    PrototypeGoalStatus,
    PrototypePhase,
    PrototypePlanCard,
    PrototypePlanColumn,
    PrototypeRisk,
    PrototypeRiskSeverity,
    PrototypeStream,
    PrototypeStreamStatus,
    PrototypeTimeWindow
} from './types'

export type PrototypeGlyphName =
    | 'back'
    | 'close'
    | 'portfolio'
    | 'brief'
    | 'repo'
    | 'digest'
    | 'approval'
    | 'risk'
    | 'stream'
    | 'strategy'
    | 'phase'
    | 'kanban'
    | 'clock'
    | 'pulse'

export function labelTimeWindow(window: PrototypeTimeWindow): string {
    switch (window) {
        case 'today':
            return '今天'
        case 'yesterday':
            return '昨天'
        case 'last24h':
            return '近 24 小时'
    }
}

export function labelCheckpoint(checkpoint: PrototypeCheckpointId): { label: string; synopsis: string } {
    switch (checkpoint) {
        case 'intake':
            return {
                label: '目标接入',
                synopsis: '系统刚接到目标，先收窄边界与主路线。'
            }
        case 'strategy':
            return {
                label: '策略成形',
                synopsis: '路线、流和优先级都已经稳定下来。'
            }
        case 'execution':
            return {
                label: '静默执行',
                synopsis: '系统在后台持续推进，并主动暴露风险。'
            }
        case 'approval':
            return {
                label: '日终批次',
                synopsis: '系统把真正需要你的决定收成一批。'
            }
    }
}

export function labelGoalStatus(status: PrototypeGoalStatus): string {
    switch (status) {
        case 'intake':
            return '待启动'
        case 'on-track':
            return '推进中'
        case 'at-risk':
            return '有风险'
        case 'blocked':
            return '已阻塞'
        case 'ready-for-approval':
            return '待审批'
    }
}

export function labelStreamStatus(status: PrototypeStreamStatus): string {
    switch (status) {
        case 'mapping':
            return '建模中'
        case 'running':
            return '运行中'
        case 'watching':
            return '观察中'
        case 'blocked':
            return '已阻塞'
        case 'ready-for-approval':
            return '待审批'
    }
}

export function labelRiskSeverity(severity: PrototypeRiskSeverity): string {
    switch (severity) {
        case 'low':
            return '低'
        case 'medium':
            return '中'
        case 'high':
            return '高'
    }
}

export function labelApprovalState(state: PrototypeApprovalState): string {
    switch (state) {
        case 'pending':
            return '待处理'
        case 'approved':
            return '已通过'
        case 'deferred':
            return '已延后'
        case 'guided':
            return '已指导'
    }
}

export function labelPriority(priority: PrototypeGoalPriority): string {
    switch (priority) {
        case 'highest':
            return '最高'
        case 'high':
            return '高'
        case 'medium':
            return '中'
    }
}

export function labelDirection(direction: PrototypeDirectionPosture): string {
    switch (direction) {
        case 'maintain':
            return '保持路线'
        case 'tighten-scope':
            return '收紧范围'
        case 'accelerate':
            return '加速推进'
    }
}

export function labelPlanColumn(column: PrototypePlanColumn): string {
    switch (column) {
        case 'Planning':
            return '待规划'
        case 'Running':
            return '执行中'
        case 'Review':
            return '待审核'
        case 'Done':
            return '已完成'
    }
}

export function labelPhaseStatus(status: PrototypePhase['status']): string {
    switch (status) {
        case 'Planned':
            return '待规划'
        case 'Running':
            return '执行中'
        case 'Review':
            return '待审核'
        case 'Done':
            return '已完成'
    }
}

export function labelApprovalKind(kind: PrototypeApprovalItem['kind']): string {
    switch (kind) {
        case 'branch-promotion':
            return '分支放行'
        case 'direction-change':
            return '方向调整'
        case 'scope-change':
            return '范围调整'
    }
}

export function labelApprovalAction(kind: PrototypeApprovalItem['kind']): string {
    switch (kind) {
        case 'branch-promotion':
            return '批准放行'
        case 'direction-change':
            return '接受调整'
        case 'scope-change':
            return '确认范围'
    }
}

export function labelPlanBadge(badge: string): string {
    switch (badge) {
        case 'strategy-forming':
            return '策略成形中'
        case 'no-human-action':
            return '无需打扰'
        case 'downstream-goal':
            return '下游目标'
        case 'watching':
            return '观察中'
        case 'autonomous':
            return '自动推进'
        case 'critical-path':
            return '主路径'
        case 'dependent':
            return '等待上游'
        case 'no-approval-yet':
            return '暂不审批'
        case 'proof-complete':
            return '证明完成'
        case 'approval-near':
            return '接近审批'
        case 'at-risk':
            return '风险升高'
        case 'direction-change':
            return '方向变更'
        case 'blocked-on-approval':
            return '卡在审批'
        case 'batch-ready':
            return '批次就绪'
        case 'ready-for-approval':
            return '待审批'
        case 'batch-item':
            return '批次项'
        case 'done':
            return '已完成'
        case 'scope-change':
            return '范围调整'
        case 'next-up':
            return '下一项'
        default:
            return badge
    }
}

export function formatMoment(input: string): string {
    return input
        .replace(/^Day\s+(\d+)\s+·/i, '第 $1 天 ·')
        .replace(/(\d+)\s*min ago/i, '$1 分钟前')
        .replace(/(\d+)\s*hr ago/i, '$1 小时前')
}

export function goalGlyph(goalId: string): PrototypeGlyphName {
    return goalId === 'goal-portfolio-foundation' ? 'portfolio' : 'brief'
}

export function streamGlyph(streamId: string): PrototypeGlyphName {
    return streamId === 'stream-weekly-brief-outline' ? 'brief' : 'stream'
}

export function goalTitle(goalId: string): string {
    switch (goalId) {
        case 'goal-portfolio-foundation':
            return '把持仓导入跑稳'
        case 'goal-weekly-brief':
            return '做出每周投资简报'
        default:
            return goalId
    }
}

export function goalPresentation(goal: PrototypeGoal, checkpoint: PrototypeCheckpointId): {
    title: string
    summary: string
    headline: string
    successSignal: string
    progressLabel: string
} {
    if (goal.id === 'goal-portfolio-foundation') {
        return {
            title: goalTitle(goal.id),
            summary: '先把导入、归一化、验证三段链路跑顺，再扩分析面。',
            headline: ({
                intake: '先收窄到一个可信入口，别急着铺太大。',
                strategy: '路线已经明确：先导入，再归一化，再放大。',
                execution: '证明链在收口，主目标已经接近可审批状态。',
                approval: '结果包和分支都已准备好，只等你统一放行。'
            })[checkpoint],
            successSignal: '券商 CSV 可以稳定导入，持仓快照能持续自洽。',
            progressLabel: ({
                intake: '等待执行流',
                strategy: '导入主脊柱已成形',
                execution: '分支接近放行',
                approval: '等待分支放行'
            })[checkpoint]
        }
    }

    if (goal.id === 'goal-weekly-brief') {
        return {
            title: goalTitle(goal.id),
            summary: '先做可信的周报底座，暂不把异常叙事做重。',
            headline: ({
                intake: '先保留目标，不急着把它做成内容项目。',
                strategy: '周报已经绑定到信号质量，不再空转。',
                execution: '系统主动收 scope，避免在噪声上硬推版本。',
                approval: '收紧后已经恢复稳定，可以低打扰继续推进。'
            })[checkpoint],
            successSignal: '每周简报能稳定给出漂移、数据新鲜度和可行动提示。',
            progressLabel: ({
                intake: '等待策略成形',
                strategy: '围绕信号质量重新定调',
                execution: '已降 scope，等待方向确认',
                approval: '收紧后恢复稳定'
            })[checkpoint]
        }
    }

    return {
        title: goal.title,
        summary: goal.summary,
        headline: goal.headline,
        successSignal: goal.successSignal,
        progressLabel: goal.progressLabel
    }
}

type StrategyCopy = {
    thesis: string
    reason: string
    focusAreas: string[]
    todayMoves: string[]
    nextQuestions: string[]
}

const STRATEGY_COPY: Record<string, Record<PrototypeCheckpointId, StrategyCopy>> = {
    'goal-portfolio-foundation': {
        intake: {
            thesis: '先选一个券商入口，做出最窄但可信的导入主链。',
            reason: '当前价值不在多做，而在先锁边界。',
            focusAreas: ['券商范围', 'CSV 契约', '导入边界'],
            todayMoves: ['读现有导入代码', '收窄第一条链路', '生成执行流'],
            nextQuestions: ['先支持哪一家券商？', '归一化是不是必须立刻做？']
        },
        strategy: {
            thesis: '以导入契约为主脊柱，把持仓归一化放到证明链里一起收口。',
            reason: '仓库信息已经足够支持一条导入优先路线。',
            focusAreas: ['CSV 契约', '持仓证明', '验证样例'],
            todayMoves: ['跑通首条导入链', '保持分析为下游', '准备未来审批包'],
            nextQuestions: ['下一轮证明需要补哪类样例？']
        },
        execution: {
            thesis: '继续压实证明链，先守住验证通过，再谈扩新范围。',
            reason: '分支已经有真实成果，接下来重点是证明它值得放行。',
            focusAreas: ['验证链', '审批包', '防止扩范围'],
            todayMoves: ['完成最后验证', '整理放行材料', '冻结非关键扩展'],
            nextQuestions: ['还需要补一轮证明再放行吗？']
        },
        approval: {
            thesis: '审批后把火力转向自动化加固，而不是立刻扩更多券商。',
            reason: '主目标已经产出业务结果，下一步重点是稳住收益。',
            focusAreas: ['分支放行', '合并后加固', '控制扩张'],
            todayMoves: ['保持分支稳定', '准备加固流', '避免当天扩面'],
            nextQuestions: ['放行后先做自动化加固，还是再接下一家券商？']
        }
    },
    'goal-weekly-brief': {
        intake: {
            thesis: '先保留周报目标，但不抢主目标火力。',
            reason: '当前更重要的是避免它变成提前做内容。',
            focusAreas: ['周报骨架', '信号门槛', '数据新鲜度'],
            todayMoves: ['收集预期', '勾周报栏目', '观察导入目标'],
            nextQuestions: ['什么才算值得写进周报的异常？']
        },
        strategy: {
            thesis: '把周报建立在信号质量和置信度之上，而不是指标堆叠。',
            reason: '导入主脊柱确定后，周报路线也更安全了。',
            focusAreas: ['栏目框架', '置信阈值', '信任感'],
            todayMoves: ['观察导入就绪度', '按置信度重写栏目', '延后异常叙事'],
            nextQuestions: ['置信度下降时，周报措辞要不要一起收缩？']
        },
        execution: {
            thesis: '先把周报收紧到漂移与新鲜度，暂停异常叙事。',
            reason: '异常信号噪声过高，继续硬做只会伤害信任。',
            focusAreas: ['漂移报告', '新鲜度', '降 scope'],
            todayMoves: ['收缩周报范围', '发出方向调整请求', '维持目标但降低野心'],
            nextQuestions: ['首版要不要完全移除异常栏目？']
        },
        approval: {
            thesis: '先交付更窄但可信的周报，再为异常叙事设置未来触发器。',
            reason: '范围收紧之后，目标重新回到稳定推进状态。',
            focusAreas: ['精简周报', '触发条件', '未来扩展'],
            todayMoves: ['保持精简版', '记录何时重开异常工作', '避免重复进入审批'],
            nextQuestions: ['什么信号出现时，才重新打开异常叙事？']
        }
    }
}

export function strategyPresentation(
    goalId: string,
    checkpoint: PrototypeCheckpointId,
    direction: PrototypeDirectionPosture,
    priority: PrototypeGoalPriority
): StrategyCopy {
    const base = STRATEGY_COPY[goalId]?.[checkpoint] ?? STRATEGY_COPY['goal-portfolio-foundation'].intake

    let thesis = base.thesis
    let reason = base.reason

    if (direction === 'tighten-scope') {
        thesis = goalId === 'goal-weekly-brief'
            ? '先把周报收紧到漂移与新鲜度，异常叙事等未来触发器。'
            : '先守住最窄导入证明链，把扩面和并行都往后放。'
        reason = '当前路线已收紧；系统优先降低风险、减少打扰。'
    } else if (direction === 'accelerate') {
        thesis = goalId === 'goal-weekly-brief'
            ? '加速把周报推到前台，但接受更高的噪声和返工概率。'
            : '并行压进导入和归一化，更快换取可见结果。'
        reason = '当前路线已加速；系统愿意接受更高波动来换取更快产出。'
    }

    if (priority === 'highest') {
        reason = `${reason} 现在它占用第一顺位火力。`
    } else if (priority === 'medium') {
        reason = `${reason} 现在它让出主火力，系统会更克制地推进。`
    }

    return {
        ...base,
        thesis,
        reason
    }
}

export function streamPresentation(
    stream: PrototypeStream,
    checkpoint: PrototypeCheckpointId
): {
    title: string
    summary: string
    whyNow: string
    latestMove: string
    dependencyLabel: string | null
} {
    const titles: Record<string, string> = {
        'stream-ingest-contracts': '券商导入契约',
        'stream-holdings-normalization': '持仓归一化',
        'stream-weekly-brief-outline': '周报框架'
    }

    const genericSummary: Record<PrototypeStreamStatus, string> = {
        mapping: '系统还在定义边界，暂时不扩大工作面。',
        running: '系统正在静默推进这条执行流。',
        watching: '这条流被保留观察，但不抢主目标火力。',
        blocked: '这条流已暂停，等待信号或路线收束。',
        'ready-for-approval': '这条流已经具备进入审批批次的条件。'
    }

    const genericWhyNow: Record<string, string> = {
        'stream-ingest-contracts': '这是最接近真实结果的主路径。',
        'stream-holdings-normalization': '这是证明链是否可信的关键一段。',
        'stream-weekly-brief-outline': '这是保持周报目标活着但不打扰主路径的方式。'
    }

    const genericMove: Record<PrototypeCheckpointId, Record<string, string>> = {
        intake: {
            'stream-ingest-contracts': '正在读取现有导入代码与样例假设。',
            'stream-holdings-normalization': '尚未进入主执行面。',
            'stream-weekly-brief-outline': '正在粗定栏目，不承诺指标。'
        },
        strategy: {
            'stream-ingest-contracts': '导入契约已经从想法变成可执行路线。',
            'stream-holdings-normalization': '正在为后续证明链准备样例。',
            'stream-weekly-brief-outline': '栏目开始围绕置信度重写。'
        },
        execution: {
            'stream-ingest-contracts': '分支和证明链都在逼近放行条件。',
            'stream-holdings-normalization': '最后一轮验证正在收口。',
            'stream-weekly-brief-outline': '系统已发出收缩方向的请求。'
        },
        approval: {
            'stream-ingest-contracts': '分支审批包已经封装完毕。',
            'stream-holdings-normalization': '这条流当前主要承担守门职责。',
            'stream-weekly-brief-outline': '精简版路线已经恢复到可静默推进状态。'
        }
    }

    return {
        title: titles[stream.id] ?? stream.title,
        summary: genericSummary[stream.status],
        whyNow: genericWhyNow[stream.id] ?? '系统认为这条流值得保持推进。',
        latestMove: genericMove[checkpoint]?.[stream.id] ?? '系统仍在推进中。',
        dependencyLabel: stream.dependencyLabel
            ? ({
                'stream-holdings-normalization': '依赖上游导入证明继续为真。',
                'stream-weekly-brief-outline': '依赖主目标先稳住信号质量。'
            })[stream.id] ?? '依赖上游信号后再继续。'
            : null
    }
}

export function approvalPresentation(item: PrototypeApprovalItem): {
    title: string
    summary: string
} {
    switch (item.id) {
        case 'approval-direction-weekly-brief':
            return {
                title: '把周报放到导入稳定之后',
                summary: '先保护主目标火力，别让周报在数据未稳时抢跑。'
            }
        case 'approval-branch-ingest':
            return {
                title: '放行导入证明分支',
                summary: '分支已经接近可进主审核队列，批准后系统会转向合并后加固。'
            }
        case 'approval-direction-brief-replan':
            return {
                title: '把周报收缩到漂移 + 新鲜度',
                summary: '先去掉高噪声异常叙事，守住可解释性。'
            }
        case 'approval-scope-brief':
            return {
                title: '确认精简版 v1 周报范围',
                summary: '先锁定漂移与新鲜度，把异常叙事延后。'
            }
        default:
            return {
                title: item.title,
                summary: item.summary
            }
    }
}

export function approvalContextPresentation(item: PrototypeApprovalItem): {
    background: string
    systemDecision: string
    approveEffect: string
    deferEffect: string
    guideLabel: string | null
    guideDirection: PrototypeDirectionPosture | null
} {
    switch (item.id) {
        case 'approval-branch-ingest':
            return {
                background: '这件事对应导入主线的分支放行，已经有证明链和验证材料。',
                systemDecision: '系统判断它接近可放行，但仍接受你要求它先再加固一轮。',
                approveEffect: '放行后，系统会把火力切到放行后加固。',
                deferEffect: '这件事会退出今天的打扰面，分支继续保持稳定。',
                guideLabel: '继续加固一轮',
                guideDirection: 'tighten-scope'
            }
        case 'approval-direction-weekly-brief':
        case 'approval-direction-brief-replan':
        case 'approval-scope-brief':
            return {
                background: '这件事对应周报目标的方向或范围选择，不是单纯的确认动作。',
                systemDecision: '系统倾向于收紧范围，先守住可信度，再决定是否扩展。',
                approveEffect: '接受后，周报会按更窄的路线继续推进。',
                deferEffect: '这件事会回到下一批，周报暂时不会继续扩面。',
                guideLabel: '保持原路线',
                guideDirection: 'maintain'
            }
        default:
            return {
                background: '这是一个需要你给出经营判断的待批项。',
                systemDecision: '系统已经形成建议，但仍保留你手动调整方向的空间。',
                approveEffect: '接受后，系统会按当前建议继续推进。',
                deferEffect: '延后后，这件事会退出本轮打扰。',
                guideLabel: null,
                guideDirection: null
            }
    }
}

export function riskPresentation(risk: PrototypeRisk): {
    title: string
    summary: string
    signal: string
} {
    switch (risk.id) {
        case 'risk-scope-first-broker':
            return {
                title: '首个券商范围仍偏大',
                summary: '如果首刀切得过宽，第一天就会失焦。',
                signal: '还没完全锁定第一家券商范围。'
            }
        case 'risk-brief-premature':
            return {
                title: '周报可能过早做成内容项目',
                summary: '数据还不稳时，越像成品越危险。',
                signal: '异常词汇和数据门槛都还没冻结。'
            }
        case 'risk-normalization-creep':
            return {
                title: '归一化可能膨胀成架构活',
                summary: '如果脱离证明链，很容易变成无边界重构。',
                signal: '验证样例还没完全固定。'
            }
        case 'risk-brief-drift':
            return {
                title: '周报范围仍可能继续漂',
                summary: '目标还活着，但很容易被过度设计。',
                signal: '这条流仍处在观察态。'
            }
        case 'risk-holdings-proof-slip':
            return {
                title: '最后一轮验证仍可能失手',
                summary: '分支接近放行，但仍依赖最后一轮绿灯。',
                signal: '持仓证明链还没彻底稳住。'
            }
        case 'risk-brief-noise':
            return {
                title: '异常信号噪声过高',
                summary: '现在就写投资人语言，会直接损伤信任。',
                signal: '最近一次策略迭代先降了信心，而不是抬高。'
            }
        case 'risk-post-promo-creep':
            return {
                title: '成功后容易立刻扩范围',
                summary: '一旦放行，系统可能太快去接更多券商。',
                signal: '最强目标会立刻释放出更多产能。'
            }
        case 'risk-brief-expansion-trigger':
            return {
                title: '周报后续扩张触发条件不清',
                summary: '目标恢复健康了，但未来扩展规则还不够硬。',
                signal: '策略已经回稳，扩张门槛仍偏软。'
            }
        default:
            return {
                title: risk.title,
                summary: risk.summary,
                signal: risk.signal
            }
    }
}

export function riskContextPresentation(risk: PrototypeRisk): {
    background: string
    systemDecision: string
    continueEffect: string
    deferEffect: string
    guideLabel: string
    guideDirection: PrototypeDirectionPosture
} {
    switch (risk.id) {
        case 'risk-normalization-creep':
        case 'risk-holdings-proof-slip':
        case 'risk-post-promo-creep':
            return {
                background: '这条风险来自导入主线，核心问题是工作面可能又开始变宽。',
                systemDecision: '系统认为最稳的做法是先收紧工作面，把证明链做厚。',
                continueEffect: '系统继续跑，但不再重复提醒这条风险。',
                deferEffect: '这条风险会从首页撤下，转成后台观察。',
                guideLabel: '收紧范围',
                guideDirection: 'tighten-scope'
            }
        default:
            return {
                background: '这条风险来自周报目标，核心问题是范围和噪声还没完全站稳。',
                systemDecision: '系统倾向于把周报收紧到更可信的范围，而不是继续追完整叙事。',
                continueEffect: '系统继续跑，但会记住这条风险已经被你接受。',
                deferEffect: '这条风险会退出首页，转成后台观察。',
                guideLabel: '收紧周报',
                guideDirection: 'tighten-scope'
            }
    }
}

export function phasePresentation(phase: PrototypePhase): { title: string } {
    const titles: Record<string, string> = {
        'phase-ingest-1': '阶段 01 · 锁定导入契约',
        'phase-ingest-2': '阶段 02 · 持仓证明链',
        'phase-ingest-3': '阶段 03 · 分支放行',
        'phase-brief-1': '阶段 01 · 周报定调',
        'phase-brief-2': '阶段 02 · 收紧周报范围',
        'phase-brief-3': '阶段 03 · 低打扰执行'
    }

    return {
        title: titles[phase.id] ?? phase.title
    }
}

export function planPresentation(card: PrototypePlanCard): { title: string } {
    const titles: Record<string, string> = {
        'plan-intake-1': '确定首个券商导入范围',
        'plan-intake-2': '勾出周报栏目骨架',
        'plan-strategy-1': '锁定首个券商 CSV 契约',
        'plan-strategy-2': '准备持仓归一化验证样例',
        'plan-strategy-3': '起草低噪声周报栏目',
        'plan-execution-1': '锁定券商 CSV 契约',
        'plan-execution-2': '验证持仓归一化分支',
        'plan-execution-3': '整理分支审批包',
        'plan-execution-4': '复核高噪声周报草案',
        'plan-execution-5': '把周报收缩到漂移与新鲜度',
        'plan-approval-1': '放行导入证明分支',
        'plan-approval-2': '完成持仓证明链',
        'plan-approval-3': '确认精简版周报范围',
        'plan-approval-4': '继续执行低噪声周报'
    }

    return {
        title: titles[card.id] ?? card.title
    }
}
