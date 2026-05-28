import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useOmcApi } from '@/api/client'

type ProgramAttachPanelProps = {
    existingProgramCount: number
}

const PERSONAL_QUANT_EXAMPLE = '/Users/realizer/Code/PersonalQuant'

export default function ProgramAttachPanel(props: ProgramAttachPanelProps) {
    const api = useOmcApi()
    const navigate = useNavigate()
    const queryClient = useQueryClient()
    const [repoRoot, setRepoRoot] = useState(PERSONAL_QUANT_EXAMPLE)
    const [name, setName] = useState('')

    const attachMutation = useMutation({
        mutationFn: async () => await api.attachLocalRepo({
            repoRoot,
            ...(name.trim() ? { name: name.trim() } : {})
        }),
        onSuccess: async (result) => {
            await queryClient.invalidateQueries({ queryKey: ['omc', 'programs'] })
            await queryClient.invalidateQueries({ queryKey: ['omc', 'program', result.program.id] })
            await queryClient.invalidateQueries({ queryKey: ['omc', 'planning-index', result.program.id] })
            await navigate({
                to: '/programs/$programId',
                params: { programId: result.program.id }
            })
        }
    })

    return (
        <section className="omc-panel omc-program-attach">
            <div className="omc-panel__header">
                <div>
                    <p className="omc-phase__eyebrow">
                        {props.existingProgramCount > 0 ? 'Attach Another Repo' : 'Attach Local Repo'}
                    </p>
                    <h2>Bring a repo into OMC</h2>
                </div>
                <span className="omc-badge omc-badge--accent">local git only</span>
            </div>

            <p>
                Attach a concrete absolute path like <code>{PERSONAL_QUANT_EXAMPLE}</code>. OMC will inspect the repo,
                detect planning if it exists, and drop you into the right next step.
            </p>

            <form
                className="omc-form"
                onSubmit={(event) => {
                    event.preventDefault()
                    attachMutation.mutate()
                }}
            >
                <label className="omc-form__field">
                    <span>Repo path</span>
                    <input
                        className="omc-input"
                        value={repoRoot}
                        onChange={(event) => setRepoRoot(event.target.value)}
                        placeholder={PERSONAL_QUANT_EXAMPLE}
                        autoCapitalize="off"
                        autoCorrect="off"
                        spellCheck={false}
                    />
                </label>

                <label className="omc-form__field">
                    <span>Program name</span>
                    <input
                        className="omc-input"
                        value={name}
                        onChange={(event) => setName(event.target.value)}
                        placeholder="Optional. Defaults to repo name."
                    />
                </label>

                <div className="omc-action-row">
                    <button type="submit" className="omc-primary-button" disabled={attachMutation.isPending}>
                        {attachMutation.isPending ? 'Attaching…' : 'Attach local repo'}
                    </button>
                </div>

                <p className="omc-empty-copy">
                    OMC expects an absolute local repo path. Relative paths and non-git folders are rejected before
                    anything is created.
                </p>

                {attachMutation.error ? (
                    <p className="omc-error-copy">{attachMutation.error instanceof Error ? attachMutation.error.message : 'Could not attach repo.'}</p>
                ) : null}
            </form>
        </section>
    )
}
