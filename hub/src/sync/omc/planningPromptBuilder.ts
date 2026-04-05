import type { OmcGuidedPlanningBrief, OmcProgram } from '@hopi/protocol/types'

function quotePath(path: string): string {
    return `\`${path}\``
}

export function buildOmcGuidedPlanningPrompt(options: {
    program: OmcProgram
    brief: OmcGuidedPlanningBrief
}): string {
    const planningRoot = options.program.planningRoot

    return [
        'You are continuing OMC guided planning for a repo that already has a minimal markdown seed.',
        '',
        'Your job:',
        '- Read the seeded planning files.',
        '- Use the provided brief as the product intent source of truth.',
        '- Turn the current planning scaffold into the first executable GSD PLAN cards.',
        '- Stop once real `*-PLAN.md` files exist under `.planning/phases/`.',
        '',
        'Important rules:',
        '- Do not ask the user follow-up questions in-session.',
        '- Stay in planning mode. Do not start implementation work.',
        '- Keep planning markdown-first; update existing seed files if needed.',
        '- Produce standard GSD artifacts that OMC can parse, especially executable `*-PLAN.md` files.',
        '',
        'Repo context:',
        `- Repo root: ${quotePath(options.program.repoRoot)}`,
        `- Planning root: ${quotePath(planningRoot)}`,
        '',
        'Seed files to read first:',
        `- ${quotePath(`${planningRoot}/PROJECT.md`)}`,
        `- ${quotePath(`${planningRoot}/REQUIREMENTS.md`)}`,
        `- ${quotePath(`${planningRoot}/ROADMAP.md`)}`,
        `- ${quotePath(`${planningRoot}/STATE.md`)}`,
        `- ${quotePath(`${planningRoot}/phases/01-bootstrap/01-CONTEXT.md`)}`,
        '',
        'Planning brief:',
        `- Product intent: ${options.brief.productIntent}`,
        `- First working slice: ${options.brief.firstSlice}`,
        '',
        'Success condition:',
        '- At least one executable `*-PLAN.md` file exists under `.planning/phases/`.',
        '',
        'When you are done, end with exactly one structured outcome block using this marker:',
        '',
        'OMC_GUIDED_PLANNING_OUTCOME',
        '```json',
        '{',
        '  "status": "completed",',
        '  "summary": "Created the first executable planning cards.",',
        '  "generatedPlanPaths": [".planning/phases/01-something/01-01-PLAN.md"]',
        '}',
        '```',
        '',
        'If you cannot produce executable plan cards, emit:',
        '',
        'OMC_GUIDED_PLANNING_OUTCOME',
        '```json',
        '{',
        '  "status": "failed",',
        '  "summary": "Explain why guided planning could not produce executable plan cards.",',
        '  "error": "Concrete blocker or failure reason"',
        '}',
        '```'
    ].join('\n')
}
