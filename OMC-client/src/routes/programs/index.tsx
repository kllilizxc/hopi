import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useOmcApi } from '@/api/client'
import ProgramAttachPanel from '@/components/ProgramAttachPanel'

export default function ProgramsIndexPage(props?: {
    autoRedirect?: boolean
}) {
    const api = useOmcApi()
    const navigate = useNavigate()
    const autoRedirect = props?.autoRedirect ?? true
    const programsQuery = useQuery({
        queryKey: ['omc', 'programs'],
        queryFn: () => api.getPrograms()
    })

    useEffect(() => {
        const firstProgram = programsQuery.data?.programs[0]
        if (autoRedirect && programsQuery.data?.programs.length === 1 && firstProgram) {
            void navigate({
                to: '/programs/$programId',
                params: { programId: firstProgram.id },
                replace: true
            })
        }
    }, [autoRedirect, navigate, programsQuery.data?.programs, programsQuery.data?.programs.length])

    if (programsQuery.isLoading) {
        return <div className="omc-empty">Loading programs…</div>
    }

    if (programsQuery.error) {
        return <div className="omc-empty">Could not load programs.</div>
    }

    return (
        <div className="omc-programs-page">
            <section className="omc-board-page__hero">
                <p className="omc-phase__eyebrow">Program Registry</p>
                <h2>Attach local repos and pick the next control plane</h2>
                <p>
                    OMC now supports more than one repo-backed program. Attach a concrete local git repo, then let the
                    program itself tell you whether it is ready for loops or still needs planning.
                </p>
            </section>

            <ProgramAttachPanel existingProgramCount={programsQuery.data?.programs.length ?? 0} />

            {programsQuery.data?.programs.length ? (
                <div className="omc-program-list">
                    {programsQuery.data.programs.map((program) => (
                        <Link
                            key={program.id}
                            to="/programs/$programId"
                            params={{ programId: program.id }}
                            className="omc-program-list__item"
                        >
                            <div>
                                <p className="omc-phase__eyebrow">{program.repoRoot}</p>
                                <h2>{program.name}</h2>
                            </div>
                            <div className="omc-program-list__stats">
                                <span>{program.counts.Running} running</span>
                                <span>{program.counts.Review} review</span>
                            </div>
                        </Link>
                    ))}
                </div>
            ) : (
                <section className="omc-panel omc-empty-panel">
                    <h2>No attached programs yet</h2>
                    <p>Start by attaching a local git repo. OMC will keep the repo root and planning root visible from there.</p>
                </section>
            )}
        </div>
    )
}
