import { createInitialWorldModel, createWorkOrder } from './orchestration'
import type {
    AgentEvent,
    PrototypeApprovalItem,
    PrototypeCheckpoint,
    PrototypeCheckpointId,
    PrototypeDirectionPosture,
    PrototypeGoal,
    PrototypeGoalPriority,
    PrototypeRiskState,
    PrototypeApprovalState,
    PrototypePhase,
    PrototypePlanCard,
    PrototypeScenarioSnapshot,
    PrototypeStream,
    PrototypeTimeWindow,
    WorldModel,
    WorkOrder,
    WorkOrderState,
} from './types'

const CHECKPOINTS: PrototypeCheckpoint[] = [
    {
        id: 'intake',
        label: 'Goal intake',
        stamp: 'Day 0 · 08:30',
        synopsis: '目标刚被设定；系统正在形成策略与执行流。'
    },
    {
        id: 'strategy',
        label: 'Strategy formed',
        stamp: 'Day 0 · 16:20',
        synopsis: '策略成形；系统把目标拆成稳定 streams。'
    },
    {
        id: 'execution',
        label: 'Autonomous execution',
        stamp: 'Day 1 · 09:10',
        synopsis: '一个目标持续推进，另一个进入风险并触发重规划。'
    },
    {
        id: 'approval',
        label: 'Daily review batch',
        stamp: 'Day 1 · 18:40',
        synopsis: '系统形成日报和成批审批包，等待你统一放行。'
    }
]

function goalBase(overrides: Partial<PrototypeGoal> = {}): PrototypeGoal {
    return {
        id: 'goal-portfolio-foundation',
        programId: 'personal-quant',
        title: 'Stabilize autonomous portfolio ingestion',
        summary: 'Build the ingestion, normalization, and validation foundation so PersonalQuant can trust holdings and trade history every day.',
        successSignal: 'Broker CSVs ingest without manual cleanup and holdings snapshots stay internally consistent.',
        status: 'intake',
        confidence: 32,
        priority: 'highest',
        direction: 'maintain',
        headline: 'System has accepted the mandate and is drafting the first operating thesis.',
        progressLabel: 'No execution streams yet',
        needsApproval: false,
        lastWorkedAt: '5 min ago',
        ...overrides
    }
}

function goalBBase(overrides: Partial<PrototypeGoal> = {}): PrototypeGoal {
    return {
        id: 'goal-weekly-brief',
        programId: 'personal-quant',
        title: 'Launch the weekly insight brief',
        summary: 'Create a trustworthy weekly intelligence brief for portfolio drift, anomalies, and actions worth reviewing.',
        successSignal: 'A weekly brief can be generated from current data and surfaces useful anomalies instead of noise.',
        status: 'intake',
        confidence: 24,
        priority: 'high',
        direction: 'maintain',
        headline: 'Still gathering the data assumptions needed for a credible investor summary.',
        progressLabel: 'Waiting for strategy',
        needsApproval: false,
        lastWorkedAt: '12 min ago',
        ...overrides
    }
}

export const prototypeCheckpoints = CHECKPOINTS

export const prototypeScenario: Record<PrototypeCheckpointId, PrototypeScenarioSnapshot> = {
    intake: {
        checkpoint: CHECKPOINTS[0],
        program: {
            id: 'personal-quant',
            name: 'PersonalQuant',
            repoRoot: '/Users/realizer/Code/PersonalQuant',
            primaryBranch: 'main',
            summary: 'Single-repo finance product used as the main demo for 24-hour autonomous goal execution.'
        },
        goals: [
            goalBase(),
            goalBBase()
        ],
        strategies: [
            {
                goalId: 'goal-portfolio-foundation',
                thesis: 'Start with ingestion reliability before expanding analytics; without trustworthy holdings snapshots, every downstream insight will drift.',
                reason: 'System is still mapping broker formats and bootstrapping execution streams.',
                changedAt: '10 min ago',
                confidenceDelta: '+0.12',
                focusAreas: [
                    'Broker CSV contract mapping',
                    'Snapshot normalization',
                    'Import verification posture'
                ],
                todayMoves: [
                    'Map likely broker file shapes',
                    'Decide the first stable ingest slice',
                    'Draft a minimal execution ladder'
                ],
                nextQuestions: [
                    'Which broker formats matter first?',
                    'Should normalization happen before analytics scaffolding?'
                ]
            },
            {
                goalId: 'goal-weekly-brief',
                thesis: 'Delay investor-facing copy until the anomaly model and confidence scoring are less brittle.',
                reason: 'The weekly brief depends on ingest stability and an agreed anomaly vocabulary.',
                changedAt: '18 min ago',
                confidenceDelta: '+0.05',
                focusAreas: [
                    'Brief sections and signal quality',
                    'Anomaly confidence thresholds',
                    'Data freshness contract'
                ],
                todayMoves: [
                    'Collect existing report expectations',
                    'Sketch brief sections',
                    'Watch ingest goal for readiness'
                ],
                nextQuestions: [
                    'What qualifies as a useful weekly anomaly?',
                    'Should the brief wait for live trade ingestion?'
                ]
            }
        ],
        streams: [
            {
                id: 'stream-ingest-contracts',
                goalId: 'goal-portfolio-foundation',
                title: 'Broker ingest contracts',
                summary: 'Identify the first broker formats and define the normalization edge.',
                status: 'mapping',
                progress: 18,
                whyNow: 'This stream reduces the biggest source of downstream uncertainty.',
                latestMove: 'System is reading existing import helpers and sample CSV assumptions.',
                dependencyLabel: 'Depends on choosing the first broker scope',
                phaseIds: ['phase-ingest-1', 'phase-ingest-2']
            },
            {
                id: 'stream-weekly-brief-outline',
                goalId: 'goal-weekly-brief',
                title: 'Weekly brief framing',
                summary: 'Define the brief posture without overcommitting to brittle metrics.',
                status: 'watching',
                progress: 8,
                whyNow: 'A thin framing pass keeps the downstream brief goal from drifting while ingest hardens.',
                latestMove: 'System drafted a first pass of sections and left anomaly scoring uncommitted.',
                dependencyLabel: 'Waiting on ingest confidence',
                phaseIds: ['phase-brief-1']
            }
        ],
        digests: {
            today: {
                window: 'today',
                headline: 'The system accepted two goals and is shaping a coherent operating thesis.',
                summary: 'No execution yet; the valuable work today is strategy formation and avoiding brittle early commitments.',
                highlights: [
                    'Ingestion was identified as the critical path for the repo.',
                    'The weekly brief goal was kept alive but intentionally downstream.',
                    'The first execution streams are now visible instead of one large vague backlog.'
                ],
                decisions: [
                    'No human approval needed yet.',
                    'System posture: keep planning broad and execution narrow.'
                ],
                watchlist: [
                    'Broker format choice can still widen scope too early.',
                    'Weekly brief risks turning into content work before data quality exists.'
                ]
            },
            yesterday: {
                window: 'yesterday',
                headline: 'No historical operations yet; this is the initial operating day.',
                summary: 'The portfolio started empty because the program was just attached.',
                highlights: [
                    'Repo attached.',
                    'Goals accepted.',
                    'No execution backlog existed before today.'
                ],
                decisions: [
                    'Treat this as the first operating day.'
                ],
                watchlist: [
                    'Historical digest intentionally blank.'
                ]
            },
            last24h: {
                window: 'last24h',
                headline: 'In the last 24 hours, OMC moved from no operating model to a first pass at strategy.',
                summary: 'The most important shift was replacing vague goals with bounded operating theses.',
                highlights: [
                    'Two goals ingested.',
                    'First streams drafted.',
                    'No approvals requested.'
                ],
                decisions: [
                    'Delay branch-level execution until strategy is less brittle.'
                ],
                watchlist: [
                    'Need a stronger readiness signal before execution.'
                ]
            }
        },
        approvalBatches: {
            today: {
                id: 'approval-intake-today',
                window: 'today',
                title: 'Nothing to batch yet',
                summary: 'The system is still shaping strategy, so there are no branch promotions or direction changes awaiting your approval.',
                items: []
            },
            yesterday: {
                id: 'approval-intake-yesterday',
                window: 'yesterday',
                title: 'No approvals yesterday',
                summary: 'This prototype began operating today.',
                items: []
            },
            last24h: {
                id: 'approval-intake-last24h',
                window: 'last24h',
                title: 'Approval queue still empty',
                summary: 'No approvals are useful until execution creates concrete outputs.',
                items: []
            }
        },
        risks: [
            {
                id: 'risk-scope-first-broker',
                goalId: 'goal-portfolio-foundation',
                title: 'First broker scope still ambiguous',
                severity: 'medium',
                state: 'open',
                summary: 'If the first ingest slice widens to multiple brokers, execution will lose focus on day one.',
                signal: 'Strategy still asks which broker format matters first.',
                owner: 'OMC strategy engine'
            },
            {
                id: 'risk-brief-premature',
                goalId: 'goal-weekly-brief',
                title: 'Weekly brief could become premature content work',
                severity: 'low',
                state: 'open',
                summary: 'The brief can look productive while still leaning on unstable data.',
                signal: 'The supporting anomaly vocabulary is not frozen.',
                owner: 'OMC strategy engine'
            }
        ],
        phases: [
            {
                id: 'phase-ingest-1',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-ingest-contracts',
                title: 'Phase 01 · Ingest framing',
                status: 'Planned',
                summary: 'Draft the first safe execution sequence.'
            },
            {
                id: 'phase-brief-1',
                goalId: 'goal-weekly-brief',
                streamId: 'stream-weekly-brief-outline',
                title: 'Phase 01 · Brief framing',
                status: 'Planned',
                summary: 'Keep the brief bounded while ingest matures.'
            }
        ],
        planCards: [
            {
                id: 'plan-intake-1',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-ingest-contracts',
                phaseId: 'phase-ingest-1',
                title: 'Draft first broker import scope',
                column: 'Planning',
                summary: 'Pick the first supported broker and define the ingest boundary.',
                signal: 'Waiting for strategy confidence.',
                updatedAt: 'Day 0 · 08:30',
                badges: ['strategy-forming', 'no-human-action']
            },
            {
                id: 'plan-intake-2',
                goalId: 'goal-weekly-brief',
                streamId: 'stream-weekly-brief-outline',
                phaseId: 'phase-brief-1',
                title: 'Frame weekly brief sections',
                column: 'Planning',
                summary: 'Define what the brief should eventually say without committing to metrics yet.',
                signal: 'Watching ingest readiness.',
                updatedAt: 'Day 0 · 08:30',
                badges: ['downstream-goal', 'watching']
            }
        ]
    },
    strategy: {
        checkpoint: CHECKPOINTS[1],
        program: {
            id: 'personal-quant',
            name: 'PersonalQuant',
            repoRoot: '/Users/realizer/Code/PersonalQuant',
            primaryBranch: 'main',
            summary: 'Single-repo finance product used as the main demo for 24-hour autonomous goal execution.'
        },
        goals: [
            goalBase({
                status: 'on-track',
                confidence: 58,
                headline: 'The system now has a concrete theory: stabilize ingest before widening analytics.',
                progressLabel: '2 execution streams opened',
                lastWorkedAt: '3 min ago'
            }),
            goalBBase({
                status: 'on-track',
                confidence: 46,
                headline: 'The weekly brief is now tied to concrete signal quality gates instead of generic copy work.',
                progressLabel: '1 stream active, 1 stream watching',
                lastWorkedAt: '9 min ago'
            })
        ],
        strategies: [
            {
                goalId: 'goal-portfolio-foundation',
                thesis: 'Treat broker ingest and holdings normalization as the first production spine; only after that should portfolio analytics harden.',
                reason: 'System found enough repo signal to commit to a narrow ingestion-first route.',
                changedAt: '32 min ago',
                confidenceDelta: '+0.26',
                focusAreas: [
                    'CSV parsing edge discipline',
                    'Holdings normalization',
                    'Verification fixtures'
                ],
                todayMoves: [
                    'Run one narrow ingest slice end-to-end',
                    'Keep analytics scaffolding downstream',
                    'Prepare a future branch-promotion path'
                ],
                nextQuestions: [
                    'Which fixture best proves normalized holdings are stable?'
                ]
            },
            {
                goalId: 'goal-weekly-brief',
                thesis: 'Build the weekly brief on top of anomaly confidence and freshness checks, not raw metric exhaust.',
                reason: 'The brief became safer once ingest was recognized as an upstream contract.',
                changedAt: '27 min ago',
                confidenceDelta: '+0.19',
                focusAreas: [
                    'Brief outline',
                    'Anomaly score thresholds',
                    'Digest tone and trust'
                ],
                todayMoves: [
                    'Watch ingestion for readiness',
                    'Draft brief sections around confidence, not volume',
                    'Stage the anomaly stream behind ingestion'
                ],
                nextQuestions: [
                    'Should anomaly wording change when confidence dips?'
                ]
            }
        ],
        streams: [
            {
                id: 'stream-ingest-contracts',
                goalId: 'goal-portfolio-foundation',
                title: 'Broker ingest contracts',
                summary: 'Turn broker CSV assumptions into a narrow, testable ingest contract.',
                status: 'running',
                progress: 44,
                whyNow: 'This stream is the narrowest way to create trustworthy portfolio state.',
                latestMove: 'A normalized holdings target contract has been drafted.',
                dependencyLabel: null,
                phaseIds: ['phase-ingest-1', 'phase-ingest-2']
            },
            {
                id: 'stream-holdings-normalization',
                goalId: 'goal-portfolio-foundation',
                title: 'Holdings normalization',
                summary: 'Align raw imports into durable holdings snapshots and validation rules.',
                status: 'running',
                progress: 26,
                whyNow: 'It de-risks every downstream analytics and briefing feature.',
                latestMove: 'Validation fixtures are being identified.',
                dependencyLabel: 'Follows broker ingest contract',
                phaseIds: ['phase-ingest-2']
            },
            {
                id: 'stream-weekly-brief-outline',
                goalId: 'goal-weekly-brief',
                title: 'Weekly brief framing',
                summary: 'Structure the brief around confidence, drift, and actionability.',
                status: 'watching',
                progress: 24,
                whyNow: 'It keeps the brief goal alive without stealing focus from ingest.',
                latestMove: 'The brief now references anomaly quality gates instead of freeform commentary.',
                dependencyLabel: 'Depends on ingest readiness',
                phaseIds: ['phase-brief-1', 'phase-brief-2']
            }
        ],
        digests: {
            today: {
                window: 'today',
                headline: 'Strategy became execution-ready without exploding into plan micromanagement.',
                summary: 'The biggest win was replacing fuzzy goals with a narrow ingest-first operating spine.',
                highlights: [
                    'The portfolio goal moved from vague intake into concrete execution streams.',
                    'The weekly brief stayed alive but subordinate to data trust.',
                    'No branch approval was requested early.'
                ],
                decisions: [
                    'Keep branch promotion deferred until ingest outputs look repeatable.'
                ],
                watchlist: [
                    'Normalization might still widen into schema work too early.'
                ]
            },
            yesterday: {
                window: 'yesterday',
                headline: 'Yesterday ended with only high-level intent.',
                summary: 'The operating model had not yet committed to specific streams.',
                highlights: [
                    'Goals existed without execution structure.'
                ],
                decisions: [
                    'Use today to lock strategy.'
                ],
                watchlist: [
                    'Yesterday had no objective stream hierarchy.'
                ]
            },
            last24h: {
                window: 'last24h',
                headline: 'In 24 hours, the repo moved from undirected ambition to a disciplined operating spine.',
                summary: 'The crucial change was turning “do the finance app” into concrete execution streams with explicit downstream dependencies.',
                highlights: [
                    'Two goals retained.',
                    'Three streams created.',
                    'Execution has begun without user micromanagement.'
                ],
                decisions: [
                    'Stay off main until branch outputs are easier to trust.'
                ],
                watchlist: [
                    'Need one concrete proof that ingest fixtures actually hold.'
                ]
            }
        },
        approvalBatches: {
            today: {
                id: 'approval-strategy-today',
                window: 'today',
                title: 'Light operating approvals',
                summary: 'Only one strategic adjustment is worth acknowledging today; no branch promotion yet.',
                items: [
                    {
                        id: 'approval-direction-weekly-brief',
                        goalId: 'goal-weekly-brief',
                        title: 'Keep the weekly brief downstream of ingest stability',
                        kind: 'direction-change',
                        summary: 'System wants to lock the brief goal behind ingest confidence instead of parallelizing too aggressively.',
                        branchName: null,
                        requestedAt: 'Day 0 · 16:10',
                        state: 'pending'
                    }
                ]
            },
            yesterday: {
                id: 'approval-strategy-yesterday',
                window: 'yesterday',
                title: 'No approvals yesterday',
                summary: 'The system had not yet produced any durable decisions.',
                items: []
            },
            last24h: {
                id: 'approval-strategy-last24h',
                window: 'last24h',
                title: 'One strategic approval',
                summary: 'Only one direction decision is worth surfacing from the last 24 hours.',
                items: [
                    {
                        id: 'approval-direction-weekly-brief',
                        goalId: 'goal-weekly-brief',
                        title: 'Keep the weekly brief downstream of ingest stability',
                        kind: 'direction-change',
                        summary: 'System wants to lock the brief goal behind ingest confidence instead of parallelizing too aggressively.',
                        branchName: null,
                        requestedAt: 'Day 0 · 16:10',
                        state: 'pending'
                    }
                ]
            }
        },
        risks: [
            {
                id: 'risk-normalization-creep',
                goalId: 'goal-portfolio-foundation',
                title: 'Normalization may widen into schema refactor',
                severity: 'medium',
                state: 'open',
                summary: 'The work could turn into infrastructure work unless the stream stays tied to ingest proof.',
                signal: 'Validation fixtures are not chosen yet.',
                owner: 'Execution stream watcher'
            },
            {
                id: 'risk-brief-drift',
                goalId: 'goal-weekly-brief',
                title: 'Weekly brief scope can still drift into product design',
                severity: 'low',
                state: 'open',
                summary: 'The brief remains tempting to over-design before signals are stable.',
                signal: 'The stream is still in watching posture.',
                owner: 'Strategy engine'
            }
        ],
        phases: [
            {
                id: 'phase-ingest-1',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-ingest-contracts',
                title: 'Phase 01 · Ingest contract lock',
                status: 'Running',
                summary: 'Drive the first broker path end-to-end.'
            },
            {
                id: 'phase-ingest-2',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-holdings-normalization',
                title: 'Phase 02 · Holdings proof',
                status: 'Planned',
                summary: 'Stage normalization after ingest confidence improves.'
            },
            {
                id: 'phase-brief-1',
                goalId: 'goal-weekly-brief',
                streamId: 'stream-weekly-brief-outline',
                title: 'Phase 01 · Brief posture',
                status: 'Planned',
                summary: 'Keep the brief bounded and confidence-aware.'
            }
        ],
        planCards: [
            {
                id: 'plan-strategy-1',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-ingest-contracts',
                phaseId: 'phase-ingest-1',
                title: 'Lock first broker CSV contract',
                column: 'Running',
                summary: 'Capture the first broker’s CSV assumptions and a narrow parsing contract.',
                signal: 'Files and parser seams are being mapped.',
                updatedAt: 'Day 0 · 16:20',
                badges: ['autonomous', 'critical-path']
            },
            {
                id: 'plan-strategy-2',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-holdings-normalization',
                phaseId: 'phase-ingest-2',
                title: 'Stage holdings normalization proof',
                column: 'Planning',
                summary: 'Prepare validation fixtures without widening scope prematurely.',
                signal: 'Waiting on ingest contract.',
                updatedAt: 'Day 0 · 16:18',
                badges: ['dependent']
            },
            {
                id: 'plan-strategy-3',
                goalId: 'goal-weekly-brief',
                streamId: 'stream-weekly-brief-outline',
                phaseId: 'phase-brief-1',
                title: 'Draft confidence-aware brief sections',
                column: 'Planning',
                summary: 'Shape the brief around confidence, drift, and useful actions.',
                signal: 'Deliberately downstream.',
                updatedAt: 'Day 0 · 16:12',
                badges: ['watching', 'no-approval-yet']
            }
        ]
    },
    execution: {
        checkpoint: CHECKPOINTS[2],
        program: {
            id: 'personal-quant',
            name: 'PersonalQuant',
            repoRoot: '/Users/realizer/Code/PersonalQuant',
            primaryBranch: 'main',
            summary: 'Single-repo finance product used as the main demo for 24-hour autonomous goal execution.'
        },
        goals: [
            goalBase({
                status: 'on-track',
                confidence: 76,
                headline: 'Ingest execution is compounding; the branch now has real proof-bearing changes.',
                progressLabel: 'One branch close to promotion',
                lastWorkedAt: '2 min ago'
            }),
            goalBBase({
                status: 'at-risk',
                confidence: 38,
                headline: 'The weekly brief lost confidence because anomaly quality is noisier than expected.',
                progressLabel: 'One stream re-planned, one risk elevated',
                needsApproval: true,
                lastWorkedAt: '14 min ago'
            })
        ],
        strategies: [
            {
                goalId: 'goal-portfolio-foundation',
                thesis: 'Keep compounding on ingest proof; do not celebrate branch progress until holdings validation stays green.',
                reason: 'The system now has code changes and fixture evidence, so it is running a proof-first branch posture.',
                changedAt: '1 hr ago',
                confidenceDelta: '+0.18',
                focusAreas: [
                    'Fixture-backed import flow',
                    'Holdings validation',
                    'Branch promotion readiness'
                ],
                todayMoves: [
                    'Finish holdings validation proof',
                    'Prepare branch promotion packet',
                    'Defer non-critical analytics work'
                ],
                nextQuestions: [
                    'Does the proof need one more fixture before promotion?'
                ]
            },
            {
                goalId: 'goal-weekly-brief',
                thesis: 'Narrow the weekly brief to drift and freshness first; postpone anomaly storytelling until noise is lower.',
                reason: 'The prior anomaly-heavy brief shape generated too much uncertainty.',
                changedAt: '42 min ago',
                confidenceDelta: '-0.11',
                focusAreas: [
                    'Drift reporting',
                    'Freshness confidence',
                    'Scope reduction'
                ],
                todayMoves: [
                    'Trim anomaly scope',
                    'Ask for a direction change in the daily batch',
                    'Keep the goal active but lower ambition'
                ],
                nextQuestions: [
                    'Should anomaly sections be removed from the first weekly brief?'
                ]
            }
        ],
        streams: [
            {
                id: 'stream-ingest-contracts',
                goalId: 'goal-portfolio-foundation',
                title: 'Broker ingest contracts',
                summary: 'The contract stream is now proving parser confidence instead of merely mapping files.',
                status: 'ready-for-approval',
                progress: 84,
                whyNow: 'It is closest to generating a trustworthy branch promotion.',
                latestMove: 'The branch now passes the first meaningful validation path.',
                dependencyLabel: null,
                phaseIds: ['phase-ingest-1', 'phase-ingest-2']
            },
            {
                id: 'stream-holdings-normalization',
                goalId: 'goal-portfolio-foundation',
                title: 'Holdings normalization',
                summary: 'Normalization is now attached to proof-bearing fixtures, not generalized schema work.',
                status: 'running',
                progress: 58,
                whyNow: 'It is the gating proof before the branch can be promoted safely.',
                latestMove: 'Validation fixtures were tightened after the latest ingest branch changes.',
                dependencyLabel: 'Needs one more proof cycle before promotion',
                phaseIds: ['phase-ingest-2']
            },
            {
                id: 'stream-weekly-brief-outline',
                goalId: 'goal-weekly-brief',
                title: 'Weekly brief framing',
                summary: 'The brief stream was re-scoped after anomaly quality dropped.',
                status: 'blocked',
                progress: 32,
                whyNow: 'The system is trying to keep the goal alive without pretending the anomaly story is ready.',
                latestMove: 'A direction-change request is being prepared for the daily batch.',
                dependencyLabel: 'Blocked by signal quality and strategy drift',
                phaseIds: ['phase-brief-1', 'phase-brief-2']
            }
        ],
        digests: {
            today: {
                window: 'today',
                headline: 'One goal compounded into branch-ready progress; the other hit a quality wall and re-planned.',
                summary: 'This is the first checkpoint where the system meaningfully separated “real progress” from “busy work.”',
                highlights: [
                    'The ingest goal is close to branch promotion.',
                    'The weekly brief goal was narrowed instead of being forced through bad data.',
                    'The system created a direction-change approval instead of masking the risk.'
                ],
                decisions: [
                    'Prepare one branch promotion for the portfolio goal.',
                    'Ask for a strategic direction change on the weekly brief.'
                ],
                watchlist: [
                    'If the next holdings proof slips, the ready-for-approval posture should drop.',
                    'Weekly brief should not resume anomaly storytelling yet.'
                ]
            },
            yesterday: {
                window: 'yesterday',
                headline: 'Yesterday ended with strategy confidence but no branch-ready outputs.',
                summary: 'The system had not yet created proof-bearing changes.',
                highlights: [
                    'Streams were open.',
                    'No approvals yet.'
                ],
                decisions: [
                    'Use today for proof instead of more decomposition.'
                ],
                watchlist: [
                    'Yesterday risk posture was still mild.'
                ]
            },
            last24h: {
                window: 'last24h',
                headline: 'Over the last 24 hours, OMC separated a real winner from a goal that needed humility.',
                summary: 'The value was not just shipping code; it was letting one goal accelerate while pulling another back before it wasted a day.',
                highlights: [
                    'Ingest goal moved from strategy to approval-ready posture.',
                    'Weekly brief was re-scoped instead of force-finished.',
                    'Approval queue now reflects real operational tradeoffs.'
                ],
                decisions: [
                    'Promote one branch if the last proof holds.',
                    'Request direction change for the weekly brief.'
                ],
                watchlist: [
                    'The next digest should show whether the direction change was accepted.'
                ]
            }
        },
        approvalBatches: {
            today: {
                id: 'approval-execution-today',
                window: 'today',
                title: 'Today’s operating batch',
                summary: 'One branch promotion is nearly ready, and one goal needs a direction decision before OMC keeps spending cycles on it.',
                items: [
                    {
                        id: 'approval-branch-ingest',
                        goalId: 'goal-portfolio-foundation',
                        title: 'Promote the ingest proof branch once validation stays green',
                        kind: 'branch-promotion',
                        summary: 'The system believes the ingestion branch is close to a safe promotion to the mainline review queue.',
                        branchName: 'omc/portfolio-ingest-proof',
                        requestedAt: 'Day 1 · 09:05',
                        state: 'pending'
                    },
                    {
                        id: 'approval-direction-brief-replan',
                        goalId: 'goal-weekly-brief',
                        title: 'Reduce weekly brief scope to drift + freshness only',
                        kind: 'direction-change',
                        summary: 'The system wants permission to cut anomaly storytelling from the first version and protect signal quality.',
                        branchName: null,
                        requestedAt: 'Day 1 · 08:58',
                        state: 'pending'
                    }
                ]
            },
            yesterday: {
                id: 'approval-execution-yesterday',
                window: 'yesterday',
                title: 'No daily batch yesterday',
                summary: 'Yesterday had no branch or direction decisions worth surfacing.',
                items: []
            },
            last24h: {
                id: 'approval-execution-last24h',
                window: 'last24h',
                title: '24-hour operating batch',
                summary: 'This batch captures the first time the system both created promotable work and asked to reduce ambition on a weaker goal.',
                items: [
                    {
                        id: 'approval-branch-ingest',
                        goalId: 'goal-portfolio-foundation',
                        title: 'Promote the ingest proof branch once validation stays green',
                        kind: 'branch-promotion',
                        summary: 'The system believes the ingestion branch is close to a safe promotion to the mainline review queue.',
                        branchName: 'omc/portfolio-ingest-proof',
                        requestedAt: 'Day 1 · 09:05',
                        state: 'pending'
                    },
                    {
                        id: 'approval-direction-brief-replan',
                        goalId: 'goal-weekly-brief',
                        title: 'Reduce weekly brief scope to drift + freshness only',
                        kind: 'direction-change',
                        summary: 'The system wants permission to cut anomaly storytelling from the first version and protect signal quality.',
                        branchName: null,
                        requestedAt: 'Day 1 · 08:58',
                        state: 'pending'
                    }
                ]
            }
        },
        risks: [
            {
                id: 'risk-holdings-proof-slip',
                goalId: 'goal-portfolio-foundation',
                title: 'Last validation proof could still slip before promotion',
                severity: 'medium',
                state: 'open',
                summary: 'The branch is close to promotion but still depends on one more green proof cycle.',
                signal: 'Holdings normalization is not fully settled.',
                owner: 'Execution controller'
            },
            {
                id: 'risk-brief-noise',
                goalId: 'goal-weekly-brief',
                title: 'Anomaly quality is too noisy for investor-facing language',
                severity: 'high',
                state: 'open',
                summary: 'The brief will lose trust if anomaly sections are shipped in the current posture.',
                signal: 'The latest strategy pass reduced confidence instead of increasing it.',
                owner: 'Strategy engine'
            }
        ],
        phases: [
            {
                id: 'phase-ingest-1',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-ingest-contracts',
                title: 'Phase 01 · Ingest contract lock',
                status: 'Done',
                summary: 'The narrow ingest path is now defined.'
            },
            {
                id: 'phase-ingest-2',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-holdings-normalization',
                title: 'Phase 02 · Holdings proof',
                status: 'Running',
                summary: 'The branch is validating holdings stability before promotion.'
            },
            {
                id: 'phase-brief-1',
                goalId: 'goal-weekly-brief',
                streamId: 'stream-weekly-brief-outline',
                title: 'Phase 01 · Brief posture',
                status: 'Review',
                summary: 'The first brief direction is under reconsideration.'
            },
            {
                id: 'phase-brief-2',
                goalId: 'goal-weekly-brief',
                streamId: 'stream-weekly-brief-outline',
                title: 'Phase 02 · Scope reduction',
                status: 'Planned',
                summary: 'The replan lowers ambition to recover trust.'
            }
        ],
        planCards: [
            {
                id: 'plan-execution-1',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-ingest-contracts',
                phaseId: 'phase-ingest-1',
                title: 'Lock broker CSV contract',
                column: 'Done',
                summary: 'Parsing contract and sample fixture assumptions are locked.',
                signal: 'Execution no longer revisits this slice.',
                updatedAt: 'Day 1 · 07:42',
                badges: ['proof-complete']
            },
            {
                id: 'plan-execution-2',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-holdings-normalization',
                phaseId: 'phase-ingest-2',
                title: 'Validate holdings normalization branch',
                column: 'Running',
                summary: 'One final validation cycle is running before branch promotion.',
                signal: 'Branch promotion packet staged.',
                updatedAt: 'Day 1 · 09:06',
                badges: ['approval-near', 'critical-path']
            },
            {
                id: 'plan-execution-3',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-holdings-normalization',
                phaseId: 'phase-ingest-2',
                title: 'Prepare branch promotion packet',
                column: 'Review',
                summary: 'Promotion narrative, checks, and rationale are bundled for the daily batch.',
                signal: 'Waiting on your approval decision.',
                updatedAt: 'Day 1 · 09:04',
                badges: ['batch-ready']
            },
            {
                id: 'plan-execution-4',
                goalId: 'goal-weekly-brief',
                streamId: 'stream-weekly-brief-outline',
                phaseId: 'phase-brief-1',
                title: 'Review anomaly-heavy brief draft',
                column: 'Review',
                summary: 'The current brief shape is being challenged because confidence dropped.',
                signal: 'Direction change request created.',
                updatedAt: 'Day 1 · 08:57',
                badges: ['at-risk', 'direction-change']
            },
            {
                id: 'plan-execution-5',
                goalId: 'goal-weekly-brief',
                streamId: 'stream-weekly-brief-outline',
                phaseId: 'phase-brief-2',
                title: 'Re-scope brief to drift + freshness',
                column: 'Planning',
                summary: 'This work is intentionally paused behind your direction decision.',
                signal: 'Do not resume until the scope change is accepted.',
                updatedAt: 'Day 1 · 08:59',
                badges: ['blocked-on-approval']
            }
        ]
    },
    approval: {
        checkpoint: CHECKPOINTS[3],
        program: {
            id: 'personal-quant',
            name: 'PersonalQuant',
            repoRoot: '/Users/realizer/Code/PersonalQuant',
            primaryBranch: 'main',
            summary: 'Single-repo finance product used as the main demo for 24-hour autonomous goal execution.'
        },
        goals: [
            goalBase({
                status: 'ready-for-approval',
                confidence: 89,
                headline: 'The portfolio goal has a promotable branch and a crisp proof story ready for daily review.',
                progressLabel: 'Awaiting branch promotion decision',
                needsApproval: true,
                lastWorkedAt: '1 min ago'
            }),
            goalBBase({
                status: 'on-track',
                confidence: 61,
                headline: 'The weekly brief recovered after scope was reduced; it is no longer pretending to solve anomaly storytelling in v1.',
                progressLabel: 'Re-scoped and stable',
                lastWorkedAt: '18 min ago'
            })
        ],
        strategies: [
            {
                goalId: 'goal-portfolio-foundation',
                thesis: 'Promote the branch once the final proof packet remains clean; after that, rotate effort into automation hardening rather than new ingest breadth.',
                reason: 'The branch is ready to be treated as a real business result, not just active development.',
                changedAt: '15 min ago',
                confidenceDelta: '+0.13',
                focusAreas: [
                    'Branch promotion',
                    'Post-merge hardening',
                    'Avoid scope creep after success'
                ],
                todayMoves: [
                    'Hold branch steady for approval',
                    'Prepare post-promotion hardening stream',
                    'Avoid opening new broker breadth today'
                ],
                nextQuestions: [
                    'After approval, should effort shift to automation hardening or the next broker?'
                ]
            },
            {
                goalId: 'goal-weekly-brief',
                thesis: 'Recover trust by shipping a narrower brief sooner; expand anomaly language only after the weekly brief demonstrates signal discipline.',
                reason: 'The reduced-scope path restored enough confidence to keep the goal alive without forcing a bad first release.',
                changedAt: '21 min ago',
                confidenceDelta: '+0.09',
                focusAreas: [
                    'Drift narrative',
                    'Freshness monitoring',
                    'Future anomaly expansion'
                ],
                todayMoves: [
                    'Keep the brief narrow',
                    'Document the anomaly expansion trigger',
                    'Stay off the approval queue unless strategy drifts again'
                ],
                nextQuestions: [
                    'What concrete trigger should reopen anomaly work?'
                ]
            }
        ],
        streams: [
            {
                id: 'stream-ingest-contracts',
                goalId: 'goal-portfolio-foundation',
                title: 'Broker ingest contracts',
                summary: 'The contract stream is finished enough to move from execution into approval.',
                status: 'ready-for-approval',
                progress: 96,
                whyNow: 'This is the clearest revenue-quality improvement available to the repo today.',
                latestMove: 'Branch promotion packet was finalized for the digest batch.',
                dependencyLabel: null,
                phaseIds: ['phase-ingest-1', 'phase-ingest-2', 'phase-ingest-3']
            },
            {
                id: 'stream-holdings-normalization',
                goalId: 'goal-portfolio-foundation',
                title: 'Holdings normalization',
                summary: 'Normalization proof closed the last trust gap before promotion.',
                status: 'watching',
                progress: 82,
                whyNow: 'This stream is now mostly guarding the promotion instead of doing net-new work.',
                latestMove: 'Guardrail tasks were queued after branch promotion.',
                dependencyLabel: 'Depends on branch approval',
                phaseIds: ['phase-ingest-2', 'phase-ingest-3']
            },
            {
                id: 'stream-weekly-brief-outline',
                goalId: 'goal-weekly-brief',
                title: 'Weekly brief framing',
                summary: 'The brief stream recovered by narrowing scope and documenting future expansion triggers.',
                status: 'running',
                progress: 57,
                whyNow: 'This stream can now progress quietly without stealing attention from the portfolio goal.',
                latestMove: 'The scope change removed anomaly storytelling from v1.',
                dependencyLabel: null,
                phaseIds: ['phase-brief-2', 'phase-brief-3']
            }
        ],
        digests: {
            today: {
                window: 'today',
                headline: 'OMC spent the day compounding one goal to approval readiness while rescuing another through scope discipline.',
                summary: 'The day produced one promotable business result, one recovered strategy, and a clean batch of decisions instead of constant interruptions.',
                highlights: [
                    'Portfolio ingest is ready for branch promotion review.',
                    'Weekly brief is back on track after dropping noisy anomaly work.',
                    'No urgent hard-blocker remains open.'
                ],
                decisions: [
                    'Approve or defer the ingest branch promotion.',
                    'Keep the weekly brief narrow for the next cycle.'
                ],
                watchlist: [
                    'Post-promotion work should not immediately widen broker scope.',
                    'The brief goal still needs a future trigger for anomaly expansion.'
                ]
            },
            yesterday: {
                window: 'yesterday',
                headline: 'Yesterday locked strategy; today turned it into a real operating result.',
                summary: 'Use the contrast to judge whether the system is compounding or just churning.',
                highlights: [
                    'Yesterday had streams but not branch-ready outputs.',
                    'Today created an approval-worthy branch.'
                ],
                decisions: [
                    'Treat today as the first full operating day with a real result.'
                ],
                watchlist: [
                    'Yesterday’s weaker brief strategy should stay visible for context.'
                ]
            },
            last24h: {
                window: 'last24h',
                headline: 'Across the last 24 hours, the repo evolved from attached intent into a working operating cadence.',
                summary: 'The strongest sign is not the code alone; it is that the system now knows what to advance, what to narrow, and what to ask you only once per day.',
                highlights: [
                    'Goal portfolio remained stable.',
                    'One branch is promotable.',
                    'One weaker goal was rescued through strategy, not force.'
                ],
                decisions: [
                    'Review the batch once, then let the system continue overnight.'
                ],
                watchlist: [
                    'Next 24h should show whether batch approvals reduce interruptions in practice.'
                ]
            }
        },
        approvalBatches: {
            today: {
                id: 'approval-approval-today',
                window: 'today',
                title: 'Daily approval batch',
                summary: 'One branch promotion and one scope decision are bundled here so the system can keep running overnight with minimal interruptions.',
                items: [
                    {
                        id: 'approval-branch-ingest',
                        goalId: 'goal-portfolio-foundation',
                        title: 'Approve promotion of the ingest proof branch',
                        kind: 'branch-promotion',
                        summary: 'Promote `omc/portfolio-ingest-proof` into the mainline review lane and let OMC continue with post-merge hardening.',
                        branchName: 'omc/portfolio-ingest-proof',
                        requestedAt: 'Day 1 · 18:32',
                        state: 'pending'
                    },
                    {
                        id: 'approval-scope-brief',
                        goalId: 'goal-weekly-brief',
                        title: 'Accept the narrow v1 weekly brief scope',
                        kind: 'scope-change',
                        summary: 'Lock the brief to drift and freshness for now, and explicitly defer anomaly storytelling.',
                        branchName: null,
                        requestedAt: 'Day 1 · 18:18',
                        state: 'pending'
                    }
                ]
            },
            yesterday: {
                id: 'approval-approval-yesterday',
                window: 'yesterday',
                title: 'Yesterday had no batch',
                summary: 'The daily batch is only valuable once execution produces meaningful choices.',
                items: []
            },
            last24h: {
                id: 'approval-approval-last24h',
                window: 'last24h',
                title: '24-hour approval batch',
                summary: 'These are the only two things the system believes are worth your direct attention from the last 24 hours.',
                items: [
                    {
                        id: 'approval-branch-ingest',
                        goalId: 'goal-portfolio-foundation',
                        title: 'Approve promotion of the ingest proof branch',
                        kind: 'branch-promotion',
                        summary: 'Promote `omc/portfolio-ingest-proof` into the mainline review lane and let OMC continue with post-merge hardening.',
                        branchName: 'omc/portfolio-ingest-proof',
                        requestedAt: 'Day 1 · 18:32',
                        state: 'pending'
                    },
                    {
                        id: 'approval-scope-brief',
                        goalId: 'goal-weekly-brief',
                        title: 'Accept the narrow v1 weekly brief scope',
                        kind: 'scope-change',
                        summary: 'Lock the brief to drift and freshness for now, and explicitly defer anomaly storytelling.',
                        branchName: null,
                        requestedAt: 'Day 1 · 18:18',
                        state: 'pending'
                    }
                ]
            }
        },
        risks: [
            {
                id: 'risk-post-promo-creep',
                goalId: 'goal-portfolio-foundation',
                title: 'Success could trigger immediate scope creep',
                severity: 'medium',
                state: 'open',
                summary: 'After promotion, the system might widen broker breadth too fast unless the next stream is kept narrow.',
                signal: 'The strongest goal just became free to absorb more work.',
                owner: 'Portfolio controller'
            },
            {
                id: 'risk-brief-expansion-trigger',
                goalId: 'goal-weekly-brief',
                title: 'Future anomaly expansion trigger is not yet concrete',
                severity: 'low',
                state: 'open',
                summary: 'The goal is healthier, but its future expansion needs a hard trigger to avoid drift.',
                signal: 'Strategy recovered, but future scope rules remain soft.',
                owner: 'Strategy engine'
            }
        ],
        phases: [
            {
                id: 'phase-ingest-1',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-ingest-contracts',
                title: 'Phase 01 · Ingest contract lock',
                status: 'Done',
                summary: 'Execution spine is locked.'
            },
            {
                id: 'phase-ingest-2',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-holdings-normalization',
                title: 'Phase 02 · Holdings proof',
                status: 'Done',
                summary: 'Proof cycle complete.'
            },
            {
                id: 'phase-ingest-3',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-ingest-contracts',
                title: 'Phase 03 · Branch promotion',
                status: 'Review',
                summary: 'Waiting in the daily approval batch.'
            },
            {
                id: 'phase-brief-2',
                goalId: 'goal-weekly-brief',
                streamId: 'stream-weekly-brief-outline',
                title: 'Phase 02 · Scope reduction',
                status: 'Done',
                summary: 'Narrow v1 scope accepted internally.'
            },
            {
                id: 'phase-brief-3',
                goalId: 'goal-weekly-brief',
                streamId: 'stream-weekly-brief-outline',
                title: 'Phase 03 · Confidence-first execution',
                status: 'Running',
                summary: 'Continue quietly after the daily batch.'
            }
        ],
        planCards: [
            {
                id: 'plan-approval-1',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-ingest-contracts',
                phaseId: 'phase-ingest-3',
                title: 'Promote ingest proof branch',
                column: 'Review',
                summary: 'All proof-bearing work is bundled into today’s approval batch.',
                signal: 'Waiting for daily batch approval.',
                updatedAt: 'Day 1 · 18:33',
                badges: ['ready-for-approval', 'batch-item']
            },
            {
                id: 'plan-approval-2',
                goalId: 'goal-portfolio-foundation',
                streamId: 'stream-holdings-normalization',
                phaseId: 'phase-ingest-2',
                title: 'Holdings proof cycle',
                column: 'Done',
                summary: 'Proof cycle completed and archived behind the promotion packet.',
                signal: 'No further attention needed today.',
                updatedAt: 'Day 1 · 18:08',
                badges: ['done', 'proof-complete']
            },
            {
                id: 'plan-approval-3',
                goalId: 'goal-weekly-brief',
                streamId: 'stream-weekly-brief-outline',
                phaseId: 'phase-brief-2',
                title: 'Accept narrow brief scope',
                column: 'Review',
                summary: 'The scope reduction is ready for your daily approval batch.',
                signal: 'Batch decision unlocks quieter overnight execution.',
                updatedAt: 'Day 1 · 18:19',
                badges: ['scope-change', 'batch-item']
            },
            {
                id: 'plan-approval-4',
                goalId: 'goal-weekly-brief',
                streamId: 'stream-weekly-brief-outline',
                phaseId: 'phase-brief-3',
                title: 'Continue confidence-first brief implementation',
                column: 'Planning',
                summary: 'Queued behind the daily batch; not running yet because scope must be acknowledged first.',
                signal: 'Will activate after the batch decision.',
                updatedAt: 'Day 1 · 18:20',
                badges: ['next-up']
            }
        ]
    }
}

const PRIORITY_ORDER: PrototypeGoalPriority[] = ['highest', 'high', 'medium']
const DIRECTION_ORDER: PrototypeDirectionPosture[] = ['maintain', 'tighten-scope', 'accelerate']

function cycleValue<T extends string>(order: readonly T[], current: T): T {
    const index = order.indexOf(current)
    return order[(index + 1) % order.length] ?? order[0]!
}

export function cyclePriority(current: PrototypeGoalPriority): PrototypeGoalPriority {
    return cycleValue(PRIORITY_ORDER, current)
}

export function cycleDirection(current: PrototypeDirectionPosture): PrototypeDirectionPosture {
    return cycleValue(DIRECTION_ORDER, current)
}

export function getPrototypeSnapshot(checkpointId: PrototypeCheckpointId): PrototypeScenarioSnapshot {
    return prototypeScenario[checkpointId]
}

export function collectApprovalItems(snapshot: PrototypeScenarioSnapshot): PrototypeApprovalItem[] {
    const seen = new Set<string>()
    const orderedWindows: PrototypeTimeWindow[] = ['today', 'last24h', 'yesterday']
    const items: PrototypeApprovalItem[] = []

    for (const window of orderedWindows) {
        const batch = snapshot.approvalBatches[window]
        if (!batch) {
            continue
        }

        for (const item of batch.items) {
            if (seen.has(item.id)) {
                continue
            }
            seen.add(item.id)
            items.push(item)
        }
    }

    return items
}

function inferWorkOrderStateForStream(stream: PrototypeStream): WorkOrderState {
    switch (stream.status) {
        case 'mapping':
            return 'queued'
        case 'waiting-upstream':
            return 'queued'
        case 'running':
            return 'executing'
        case 'blocked':
            return 'blocked'
        case 'ready-for-approval':
            return 'reviewer_check'
        case 'watching':
            return 'queued'
    }
}

function findPrimaryPhase(phases: PrototypePhase[], streamId: string) {
    return phases.find((phase) => phase.streamId === streamId && phase.status !== 'Done')
        ?? phases.find((phase) => phase.streamId === streamId)
        ?? null
}

function findPrimaryPlan(planCards: PrototypePlanCard[], streamId: string, phaseId: string | null) {
    return planCards.find((card) => card.streamId === streamId && (!phaseId || card.phaseId === phaseId) && card.column !== 'Done')
        ?? planCards.find((card) => card.streamId === streamId && (!phaseId || card.phaseId === phaseId))
        ?? null
}

export function resolveApprovalSeedTarget(
    checkpointId: PrototypeCheckpointId,
    itemId: string,
): { streamId: string; phaseId: string | null; planId: string | null } {
    switch (checkpointId) {
        case 'strategy':
            switch (itemId) {
                case 'approval-direction-weekly-brief':
                    return {
                        streamId: 'stream-weekly-brief-outline',
                        phaseId: 'phase-brief-1',
                        planId: 'plan-strategy-3',
                    }
                default:
                    throw new Error(`resolveApprovalSeedTarget: unsupported strategy item ${itemId}`)
            }
        case 'approval':
            switch (itemId) {
                case 'approval-branch-ingest':
                    return {
                        streamId: 'stream-ingest-contracts',
                        phaseId: 'phase-ingest-3',
                        planId: 'plan-approval-1',
                    }
                case 'approval-scope-brief':
                    return {
                        streamId: 'stream-weekly-brief-outline',
                        phaseId: 'phase-brief-2',
                        planId: 'plan-approval-3',
                    }
                default:
                    throw new Error(`resolveApprovalSeedTarget: unsupported approval item ${itemId}`)
            }
        case 'execution':
            switch (itemId) {
                case 'approval-branch-ingest':
                    return {
                        streamId: 'stream-holdings-normalization',
                        phaseId: 'phase-ingest-2',
                        planId: 'plan-execution-3',
                    }
                case 'approval-direction-brief-replan':
                    return {
                        streamId: 'stream-weekly-brief-outline',
                        phaseId: 'phase-brief-2',
                        planId: 'plan-execution-5',
                    }
                default:
                    throw new Error(`resolveApprovalSeedTarget: unsupported execution item ${itemId}`)
            }
        default:
            throw new Error(`resolveApprovalSeedTarget: unsupported checkpoint ${checkpointId}`)
    }
}

export function createSeededWorldModel(checkpointId: PrototypeCheckpointId): WorldModel {
    const snapshot = getPrototypeSnapshot(checkpointId)
    const focusGoalId = snapshot.goals[0]?.id ?? null
    const focusStreamId = focusGoalId
        ? snapshot.streams.find((stream) => stream.goalId === focusGoalId)?.id ?? null
        : null

    const world = createInitialWorldModel({
        focusGoalId,
        focusStreamId,
    })

    const workOrders: Record<string, WorkOrder> = {}

    for (const stream of snapshot.streams) {
        const phase = findPrimaryPhase(snapshot.phases, stream.id)
        const plan = findPrimaryPlan(snapshot.planCards, stream.id, phase?.id ?? null)
        const order = createWorkOrder({
            id: `wo:${stream.id}`,
            goalId: stream.goalId,
            streamId: stream.id,
            phaseId: phase?.id ?? null,
            planId: plan?.id ?? null,
            summary: stream.summary,
            constraints: stream.dependencyLabel ? [stream.dependencyLabel] : [],
        })

        order.state = inferWorkOrderStateForStream(stream)
        order.loop.round = stream.progress > 0 ? 1 : 0
        order.loop.lastDriverSummary = stream.latestMove

        workOrders[order.id] = order
    }

    if (checkpointId === 'execution') {
        const executionTraceEvents = [
            {
                id: 'evt-execution-holdings-observation',
                kind: 'Observation',
                workOrderId: 'wo:stream-holdings-normalization',
                emittedBy: 'driver',
                createdAt: 'Day 1 · 09:01',
                payload: {
                    summary: 'Holdings normalization matched the latest broker sample without widening scope.',
                },
            },
            {
                id: 'evt-execution-holdings-proposal',
                kind: 'Proposal',
                workOrderId: 'wo:stream-holdings-normalization',
                emittedBy: 'driver',
                createdAt: 'Day 1 · 09:02',
                payload: {
                    summary: 'Promotion packet can be staged once the proof cycle remains green.',
                },
            },
            {
                id: 'evt-execution-holdings-verdict',
                kind: 'ReviewerVerdict',
                workOrderId: 'wo:stream-holdings-normalization',
                emittedBy: 'reviewer',
                createdAt: 'Day 1 · 09:03',
                payload: {
                    verdict: 'needs_decision',
                    summary: 'The branch is steady, but the batch boundary should decide promotion.',
                },
            },
        ] satisfies AgentEvent[]

        world.agentEvents.push(...executionTraceEvents)
    }

    for (const item of collectApprovalItems(snapshot)) {
        const target = resolveApprovalSeedTarget(checkpointId, item.id)
        const order = createWorkOrder({
            id: `work-order:${item.id}`,
            goalId: item.goalId,
            streamId: target.streamId,
            phaseId: target.phaseId,
            planId: target.planId,
            summary: item.title,
            constraints: [item.summary],
        })

        order.state = item.state === 'pending' ? 'waiting_user' : 'queued'
        order.waitingOnTopicId = `approval:${item.id}`
        order.loop.round = 1
        order.loop.lastReviewerSummary = item.summary
        order.loop.lastDecisionSummary = item.state === 'guided' ? item.summary : null

        workOrders[order.id] = order
    }

    if (checkpointId === 'approval') {
        const approvalTraceEvents = [
            {
                id: 'evt-approval-branch-observation',
                kind: 'Observation',
                workOrderId: 'work-order:approval-branch-ingest',
                emittedBy: 'driver',
                createdAt: 'Day 1 · 18:29',
                payload: {
                    summary: 'Driver finished the last proof pass on holdings normalization.',
                },
            },
            {
                id: 'evt-approval-branch-proposal',
                kind: 'Proposal',
                workOrderId: 'work-order:approval-branch-ingest',
                emittedBy: 'driver',
                createdAt: 'Day 1 · 18:30',
                payload: {
                    summary: 'Promotion packet is ready for batch review.',
                },
            },
            {
                id: 'evt-approval-branch-verdict',
                kind: 'ReviewerVerdict',
                workOrderId: 'work-order:approval-branch-ingest',
                emittedBy: 'reviewer',
                createdAt: 'Day 1 · 18:31',
                payload: {
                    verdict: 'needs_decision',
                    summary: 'Proof is green, but the branch should wait for user promotion approval.',
                },
            },
        ] satisfies AgentEvent[]

        world.agentEvents.push(...approvalTraceEvents)
    }

    return {
        ...world,
        workOrders,
    }
}

export function applyGoalOverrides(
    goals: PrototypeGoal[],
    overrides: {
        priorities: Record<string, PrototypeGoalPriority | undefined>
        directions: Record<string, PrototypeDirectionPosture | undefined>
    }
): PrototypeGoal[] {
    return goals.map((goal) => ({
        ...goal,
        priority: overrides.priorities[goal.id] ?? goal.priority,
        direction: overrides.directions[goal.id] ?? goal.direction
    }))
}

export function applyApprovalOverrides<
    T extends {
        items: Array<{
            id: string
            state: PrototypeApprovalState
        }>
    }
>(
    batch: T,
    overrides: Record<string, PrototypeApprovalState | undefined>
): T {
    return {
        ...batch,
        items: batch.items.map((item) => ({
            ...item,
            state: overrides[item.id] ?? item.state
        }))
    }
}

export function applyRiskOverrides<T extends { id: string; state: PrototypeRiskState }>(
    risks: T[],
    overrides: Record<string, PrototypeRiskState | undefined>
): T[] {
    return risks.map((risk) => ({
        ...risk,
        state: overrides[risk.id] ?? risk.state
    }))
}

export function applyWorldModelEffects(snapshot: PrototypeScenarioSnapshot, world: WorldModel): PrototypeScenarioSnapshot {
    if (snapshot.checkpoint.id !== 'approval') {
        return snapshot
    }

    const ordersByGoal = new Map<string, WorkOrder[]>()
    const relevantOrders = Object.values(world.workOrders).filter((order) => snapshot.goals.some((goal) => goal.id === order.goalId))

    for (const order of relevantOrders) {
        const list = ordersByGoal.get(order.goalId) ?? []
        list.push(order)
        ordersByGoal.set(order.goalId, list)
    }

    const chooseOrder = (orders: WorkOrder[] | undefined) => {
        if (!orders || orders.length === 0) {
            return null
        }

        return orders.find((order) => Boolean(order.loop.lastDecisionSummary))
            ?? orders.find((order) => order.state === 'waiting_user')
            ?? orders[0]
    }

    for (const goal of snapshot.goals) {
        const order = chooseOrder(ordersByGoal.get(goal.id))
        if (!order) {
            continue
        }

        if (order.state === 'waiting_user') {
            goal.needsApproval = true
        }

        if (order.loop.lastDecisionSummary) {
            goal.headline = `已按指令回到队列：${order.loop.lastDecisionSummary}`
            goal.progressLabel = '已按指令重新排队'
            goal.needsApproval = false
        }
    }

    for (const stream of snapshot.streams) {
        const order = relevantOrders.find((entry) => entry.streamId === stream.id)
        if (!order) {
            continue
        }

        if (order.loop.lastDecisionSummary) {
            stream.latestMove = `用户指令：${order.loop.lastDecisionSummary}`
        } else if (order.state === 'waiting_user') {
            stream.latestMove = `等待用户决定：${order.summary}`
        }
    }

    return snapshot
}

export function timeWindowLabel(window: PrototypeTimeWindow): string {
    switch (window) {
        case 'today':
            return 'Today'
        case 'yesterday':
            return 'Yesterday'
        case 'last24h':
            return 'Last 24h'
    }
}
