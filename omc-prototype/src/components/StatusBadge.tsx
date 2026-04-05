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
    return (
        <span className={`prototype-badge prototype-badge--${props.tone}`}>
            <span className="prototype-badge__dot" />
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
