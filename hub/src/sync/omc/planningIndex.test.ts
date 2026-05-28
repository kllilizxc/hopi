import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPlanningIndex } from './planningIndex'

const createdPaths: string[] = []

function createProgramFixture() {
    const root = mkdtempSync(join(tmpdir(), 'hopi-omc-planning-index-'))
    createdPaths.push(root)

    const repoRoot = join(root, 'cardgame')
    const planningRoot = join(repoRoot, '.planning')
    const phaseDir = join(planningRoot, 'phases', '01-first-playable-expedition')

    mkdirSync(phaseDir, { recursive: true })
    writeFileSync(join(planningRoot, 'PROJECT.md'), '# CardGame\n')
    writeFileSync(join(planningRoot, 'ROADMAP.md'), '# Roadmap\n')

    writeFileSync(join(phaseDir, '01-01-PLAN.md'), `---
phase: "01-first-playable-expedition"
plan: "01"
depends_on: []
---

<objective>
Establish the expedition domain.
Purpose: Give the next plan a stable base.
</objective>

<tasks>
<task type="auto">
  <name>Define the foundation</name>
</task>
</tasks>
`)

    writeFileSync(join(phaseDir, '01-02-PLAN.md'), `---
phase: "01-first-playable-expedition"
plan: "02"
depends_on: ["01-01"]
---

<objective>
Build the expedition scene.
Purpose: Start only after foundation is ready.
</objective>

<tasks>
<task type="auto">
  <name>Wire the scene</name>
</task>
</tasks>
`)

    writeFileSync(join(phaseDir, '01-03-PLAN.md'), `---
phase: "01-first-playable-expedition"
plan: "03"
depends_on: ["01-02"]
must_haves:
  key_links:
    - from: "src/game/scenes/expedition/ExpeditionScene.ts"
      to: "src/game/scenes/battle/BattleScene.ts"
      via: "scene launch payload for combat nodes"
      pattern: "this\\.scene\\.(launch|start)\\('BattleScene'"
---

<objective>
Connect battle nodes.
Purpose: Start only after the scene plan is ready.
</objective>

<tasks>
<task type="auto">
  <name>Wire combat handoff</name>
</task>
</tasks>
`)

    return {
        id: 'omc-cardgame',
        namespace: 'default',
        name: 'CardGame',
        repoRoot,
        planningRoot,
        createdAt: 1,
        updatedAt: 1,
        primaryBranch: 'main',
        targetBranch: 'main',
    }
}

afterEach(() => {
    while (createdPaths.length > 0) {
        const path = createdPaths.pop()
        if (!path) {
            continue
        }
        rmSync(path, { recursive: true, force: true })
    }
})

describe('buildPlanningIndex', () => {
    it('includes plan dependencies from plan frontmatter', () => {
        const program = createProgramFixture()

        const index = buildPlanningIndex(program)

        expect(index.phases).toHaveLength(1)
        expect(index.phases[0]?.plans).toEqual([
            expect.objectContaining({
                planKey: '01-01',
                dependsOn: [],
            }),
            expect.objectContaining({
                planKey: '01-02',
                dependsOn: ['01-01'],
            }),
            expect.objectContaining({
                planKey: '01-03',
                dependsOn: ['01-02'],
            }),
        ])
    })
})
