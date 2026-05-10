import type { ToolViewProps } from '@/components/ToolCard/views/_all'
import {
    parseRequestUserInputInput,
    parseRequestUserInputAnswers
} from '@/components/ToolCard/requestUserInput'
import { ToolAnswerOption } from '@/components/ToolCard/ToolAnswerOption'

function getSelectionMark(isSelected: boolean): string {
    return isSelected ? '●' : '○'
}

function parseResultAsAnswers(result: unknown): unknown {
    // tool.result from history may be a JSON string
    if (typeof result === 'string') {
        try {
            return JSON.parse(result)
        } catch {
            return undefined
        }
    }
    return result
}

export function RequestUserInputView(props: ToolViewProps) {
    const parsed = parseRequestUserInputInput(props.block.tool.input)
    const questions = parsed.questions
    // Try permission.answers first (live), fall back to tool.result (history)
    const rawAnswers = props.block.tool.permission?.answers ?? parseResultAsAnswers(props.block.tool.result) ?? undefined
    const parsedAnswers = rawAnswers ? parseRequestUserInputAnswers(rawAnswers) : null
    const hasAnswers = parsedAnswers && Object.keys(parsedAnswers).length > 0

    if (questions.length === 0) {
        return null
    }

    return (
        <div className="flex flex-col gap-3">
            {questions.map((q) => {
                const answer = parsedAnswers?.[q.id]
                const isPureTextQuestion = q.options.length === 0

                return (
                    <div key={q.id} className="rounded-md app-shadow-border bg-[var(--app-bg)] p-3">
                        {q.question ? (
                            <div className="text-sm text-[var(--app-fg)] break-words">
                                {q.question}
                            </div>
                        ) : null}

                        {isPureTextQuestion ? (
                            // Pure text question - show the answer directly
                            hasAnswers && answer?.userNote ? (
                                <div className="mt-3">
                                    <ToolAnswerOption
                                        tone="success"
                                        marker="●"
                                        label={answer.userNote}
                                    />
                                </div>
                            ) : null
                        ) : (
                            // Question with options
                            <div className="mt-3 flex flex-col gap-1">
                                {q.options.map((opt, optIdx) => {
                                    const isSelected = answer?.selected === opt.label

                                    return (
                                        <ToolAnswerOption
                                            key={optIdx}
                                            tone={isSelected ? 'success' : 'neutral'}
                                            marker={hasAnswers ? getSelectionMark(isSelected) : undefined}
                                            label={opt.label}
                                            description={opt.description}
                                        />
                                    )
                                })}

                                {/* Show user note if present */}
                                {hasAnswers && answer?.userNote ? (
                                    <ToolAnswerOption
                                        tone="info"
                                        marker="Note"
                                        label={answer.userNote}
                                        className="mt-2"
                                    />
                                ) : null}
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
