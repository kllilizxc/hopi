import { describe, expect, it } from 'bun:test'
import type { DecryptedMessage } from '@hopi/protocol/types'
import { parseOmcAttemptOutcome, parseOmcFallbackTerminationMessage } from './attemptOutcome'

describe('parseOmcAttemptOutcome', () => {
    it('parses a structured completion JSON block from an assistant message', () => {
        const outcome = parseOmcAttemptOutcome({
            role: 'assistant',
            content: `Finished the smallest step.\n\nOMC_ATTEMPT_OUTCOME\n\`\`\`json
{
  "status": "progressed",
  "summary": "Added the runtime adapter seam.",
  "changedFiles": ["hub/src/sync/omc/runtimeAdapter.ts"],
  "checks": [{ "label": "bun run typecheck:hub", "result": "passed", "detail": "tsc clean" }],
  "nextSuggestedStep": "Wire the loop automation subscriber."
}
\`\`\``
        })

        expect(outcome).not.toBeNull()
        expect(outcome?.status).toBe('progressed')
        expect(outcome?.terminationReason).toBe('structured-completion')
        expect(outcome?.changedFiles).toEqual(['hub/src/sync/omc/runtimeAdapter.ts'])
        expect(outcome?.checks[0]?.label).toBe('bun run typecheck:hub')
    })

    it('does not treat a webapp user prompt example as an attempt outcome', () => {
        const outcome = parseOmcAttemptOutcome({
            role: 'user',
            content: `Output contract:
- End your final message with the marker \`OMC_ATTEMPT_OUTCOME\` followed by one JSON object or one fenced JSON block.
\`\`\`json
{
  "status": "progressed",
  "summary": "What changed in this attempt",
  "changedFiles": ["path/to/file"],
  "checks": [{ "label": "bun run typecheck", "result": "passed", "detail": "short note" }],
  "nextSuggestedStep": "Smallest next step or null"
}
\`\`\``
        })

        expect(outcome).toBeNull()
    })
})

describe('parseOmcFallbackTerminationMessage', () => {
    it('classifies assistant error events into a system fallback outcome', () => {
        const outcome = parseOmcFallbackTerminationMessage({
            id: 'msg-1',
            seq: 1,
            localId: null,
            createdAt: Date.now(),
            content: {
                role: 'assistant',
                content: {
                    type: 'event',
                    data: {
                        type: 'error',
                        reason: 'process exited unexpectedly',
                        message: 'process exited unexpectedly with code 1'
                    }
                }
            }
        } satisfies DecryptedMessage)

        expect(outcome).not.toBeNull()
        expect(outcome?.status).toBe('failed')
        expect(outcome?.terminationReason).toBe('session-error')
        expect(outcome?.failureFingerprint).toBe('process-exited-unexpectedly')
    })
})
