import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    appendPlannerMail,
    archiveGoalPreference,
    readGoalOperatorDocs,
    setGoalPreference,
    updatePlannerMailStatus
} from './operatorDocs'
import { getGoalOperatorDir, getGoalPlannerMailPath, getGoalPreferencesPath } from './operatorDocPaths'

function workspace() {
    return mkdtempSync(join(tmpdir(), 'hopi-operator-docs-'))
}

describe('operator docs', () => {
    it('resolves goal-scoped operator paths', () => {
        const root = '/repo'

        expect(getGoalOperatorDir(root, 'ship-ui')).toBe('/repo/.hopi/docs/goals/ship-ui/operator')
        expect(getGoalPreferencesPath(root, 'ship-ui')).toBe('/repo/.hopi/docs/goals/ship-ui/operator/preferences.yml')
        expect(getGoalPlannerMailPath(root, 'ship-ui')).toBe('/repo/.hopi/docs/goals/ship-ui/operator/planner-mail.yml')
    })

    it('writes planner mail without waking planner', () => {
        const root = workspace()
        const mail = appendPlannerMail({
            workspacePath: root,
            goalKey: 'ship-ui',
            kind: 'idea',
            body: 'Try a denser mobile task list.',
            source: { sessionId: 'session-a', messageId: 'message-a' },
            now: 1778570000000
        })

        expect(mail.id).toStartWith('mail-1778570000000-')
        const docs = readGoalOperatorDocs({ workspacePath: root, goalKey: 'ship-ui' })
        expect(docs.mail.mail).toHaveLength(1)
        expect(docs.mail.mail[0]).toMatchObject({
            kind: 'idea',
            body: 'Try a denser mobile task list.',
            status: 'unread'
        })
    })

    it('sets and archives goal preferences as the source of truth', () => {
        const root = workspace()
        const preference = setGoalPreference({
            workspacePath: root,
            goalKey: 'ship-ui',
            category: 'ui_product_choice',
            autonomy: 'auto_decide_and_report',
            instruction: 'Let the agent decide lightweight UI copy.',
            source: { sessionId: 'session-a', messageId: 'message-b', quote: '以后文案你自己决定' },
            now: 1778570000000
        })

        expect(preference.id).toStartWith('pref-1778570000000-')
        expect(archiveGoalPreference({
            workspacePath: root,
            goalKey: 'ship-ui',
            preferenceId: preference.id,
            now: 1778570000500
        })).toBe(true)

        const raw = readFileSync(getGoalPreferencesPath(root, 'ship-ui'), 'utf8')
        expect(raw).toContain('archivedAt: 1778570000500')
    })

    it('updates planner mail status without deleting the original message', () => {
        const root = workspace()
        const mail = appendPlannerMail({
            workspacePath: root,
            goalKey: 'ship-ui',
            kind: 'request',
            body: 'Schedule a small accessibility pass.',
            source: { sessionId: 'session-a', messageId: 'message-c' },
            now: 1778570000000
        })

        expect(updatePlannerMailStatus({
            workspacePath: root,
            goalKey: 'ship-ui',
            mailId: mail.id,
            status: 'included',
            now: 1778570001000
        })).toBe(true)

        const docs = readGoalOperatorDocs({ workspacePath: root, goalKey: 'ship-ui' })
        expect(docs.mail.mail[0]).toMatchObject({
            id: mail.id,
            status: 'included',
            includedAt: 1778570001000,
            resolvedAt: null
        })
    })

    it('marks planner mail as superseded without deleting the original message', () => {
        const root = workspace()
        const mail = appendPlannerMail({
            workspacePath: root,
            goalKey: 'ship-ui',
            kind: 'request',
            body: 'Try a different queue model.',
            source: { sessionId: 'session-a', messageId: 'message-d' },
            now: 1778570000000
        })

        expect(updatePlannerMailStatus({
            workspacePath: root,
            goalKey: 'ship-ui',
            mailId: mail.id,
            status: 'superseded',
            now: 1778570002000
        })).toBe(true)

        const docs = readGoalOperatorDocs({ workspacePath: root, goalKey: 'ship-ui' })
        expect(docs.mail.mail[0]).toMatchObject({
            id: mail.id,
            status: 'superseded',
            resolvedAt: 1778570002000
        })
    })
})
