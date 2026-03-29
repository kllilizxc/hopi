import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useOmcApi } from '@/api/client'

export default function ProgramsIndexPage() {
    const api = useOmcApi()
    const navigate = useNavigate()
    const programsQuery = useQuery({
        queryKey: ['omc', 'programs'],
        queryFn: () => api.getPrograms()
    })

    useEffect(() => {
        const firstProgram = programsQuery.data?.programs[0]
        if (firstProgram) {
            void navigate({
                to: '/programs/$programId',
                params: { programId: firstProgram.id },
                replace: true
            })
        }
    }, [navigate, programsQuery.data?.programs])

    if (programsQuery.isLoading) {
        return <div className="omc-empty">Loading programs…</div>
    }

    if (programsQuery.error) {
        return <div className="omc-empty">Could not load programs.</div>
    }

    if (!programsQuery.data?.programs.length) {
        return <div className="omc-empty">No OMC program found yet.</div>
    }

    return (
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
    )
}
