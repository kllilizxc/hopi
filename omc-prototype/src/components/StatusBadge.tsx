import type {
    PrototypeGoalStatus,
    PrototypeRiskSeverity,
    PrototypeStreamStatus
} from '@/prototype/types'
import {
    labelGoalStatus,
    labelRiskSeverity,
    labelStreamStatus
} from '@/prototype/presenter'

type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

function toneForGoal(status: PrototypeGoalStatus): BadgeTone {
    switch (status) {
        case 'on-track':
            return 'success'
        case 'ready-for-approval':
            return 'accent'
        case 'at-risk':
            return 'warning'
        case 'blocked':
            return 'danger'
        case 'intake':
            return 'neutral'
    }
}

function toneForStream(status: PrototypeStreamStatus): BadgeTone {
    switch (status) {
        case 'running':
            return 'success'
        case 'ready-for-approval':
            return 'accent'
        case 'blocked':
            return 'danger'
        case 'watching':
            return 'warning'
        case 'mapping':
            return 'neutral'
    }
}

function toneForRisk(severity: PrototypeRiskSeverity): BadgeTone {
    switch (severity) {
        case 'low':
            return 'neutral'
        case 'medium':
            return 'warning'
        case 'high':
            return 'danger'
    }
}

function Badge(props: { tone: BadgeTone; children: React.ReactNode }) {
    const toneClasses = {
        neutral: 'bg-zinc-100 text-zinc-700 border-zinc-200',
        accent: 'bg-indigo-50 text-indigo-700 border-indigo-200',
        success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        warning: 'bg-amber-50 text-amber-700 border-amber-200',
        danger: 'bg-red-50 text-red-700 border-red-200',
    }

    const dotClasses = {
        neutral: 'bg-zinc-400',
        accent: 'bg-indigo-500',
        success: 'bg-emerald-500',
        warning: 'bg-amber-500',
        danger: 'bg-red-500',
    }

    return (
        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs font-medium border rounded-full whitespace-nowrap min-w-max ${toneClasses[props.tone]}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${dotClasses[props.tone]}`} />
            {props.children}
        </span>
    )
}

export function GoalStatusBadge(props: { status: PrototypeGoalStatus }) {
    return <Badge tone={toneForGoal(props.status)}>{labelGoalStatus(props.status)}</Badge>
}

export function StreamStatusBadge(props: { status: PrototypeStreamStatus }) {
    return <Badge tone={toneForStream(props.status)}>{labelStreamStatus(props.status)}</Badge>
}

export function RiskSeverityBadge(props: { severity: PrototypeRiskSeverity }) {
    return <Badge tone={toneForRisk(props.severity)}>{labelRiskSeverity(props.severity)}风险</Badge>
}

export function MetaBadge(props: { tone?: BadgeTone; children: React.ReactNode }) {
    return <Badge tone={props.tone ?? 'neutral'}>{props.children}</Badge>
}
