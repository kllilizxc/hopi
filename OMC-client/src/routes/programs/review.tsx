import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams } from '@tanstack/react-router'
import ReviewCockpit from '@/components/ReviewCockpit'
import { useOmcApi } from '@/api/client'

export default function ReviewPage() {
    const api = useOmcApi()
    const queryClient = useQueryClient()
    const { programId, planKey } = useParams({ from: '/programs/$programId/plans/$planKey/review' })

    const invalidateReviewQueries = async (attemptId?: string | null) => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['omc', 'programs'] }),
            queryClient.invalidateQueries({ queryKey: ['omc', 'plan', programId, planKey] }),
            queryClient.invalidateQueries({ queryKey: ['omc', 'plan-runtimes', programId] }),
            queryClient.invalidateQueries({ queryKey: ['omc', 'planning-index', programId] }),
            queryClient.invalidateQueries({ queryKey: ['omc', 'merge-packet', programId, planKey] }),
            ...(attemptId ? [queryClient.invalidateQueries({ queryKey: ['omc', 'attempt', attemptId] })] : [])
        ])
    }

    const planQuery = useQuery({
        queryKey: ['omc', 'plan', programId, planKey],
        queryFn: () => api.getPlanDetail(programId, planKey)
    })

    const mergePacketQuery = useQuery({
        queryKey: ['omc', 'merge-packet', programId, planKey],
        queryFn: () => api.getMergePacket(programId, planKey)
    })

    const approveReviewMutation = useMutation({
        mutationFn: () => api.approveReview(programId, planKey),
        onSuccess: async (result) => {
            await invalidateReviewQueries(result.attempt?.id)
        }
    })

    const approveMergeMutation = useMutation({
        mutationFn: () => api.approveMerge(programId, planKey),
        onSuccess: async (result) => {
            await invalidateReviewQueries(result.attempt?.id ?? null)
        }
    })

    const resumeLoopMutation = useMutation({
        mutationFn: () => api.reopenReview(programId, planKey, 'resume_loop'),
        onSuccess: async (result) => {
            await invalidateReviewQueries(result.attempt?.id)
        }
    })

    const backToPlanningMutation = useMutation({
        mutationFn: () => api.reopenReview(programId, planKey, 'back_to_planning'),
        onSuccess: async (result) => {
            await invalidateReviewQueries(result.attempt?.id)
        }
    })

    const takeoverMutation = useMutation({
        mutationFn: () => api.takeoverPlan(programId, planKey),
        onSuccess: async (result) => {
            await invalidateReviewQueries(result.attempt?.id)
            const takeoverUrl = api.resolveAppUrl(result.sessionUrl) ?? api.createSessionUrl(result.sessionId)
            if (takeoverUrl) {
                window.location.assign(takeoverUrl)
            }
        }
    })

    if (planQuery.isLoading || mergePacketQuery.isLoading) {
        return <div className="omc-empty">Loading review cockpit…</div>
    }

    if (planQuery.error || mergePacketQuery.error || !planQuery.data || !mergePacketQuery.data) {
        return <div className="omc-empty">Could not load this review cockpit.</div>
    }

    const { plan, runtime, attempts, evidence } = planQuery.data
    const latestAttempt = attempts[0] ?? null
    const latestSessionUrl = api.resolveAppUrl(approveMergeMutation.data?.merge.sessionUrl)
        ?? api.createSessionUrl(latestAttempt?.sessionId)
        ?? null
    const actionError = approveReviewMutation.error
        ?? approveMergeMutation.error
        ?? resumeLoopMutation.error
        ?? backToPlanningMutation.error
        ?? takeoverMutation.error

    return (
        <ReviewCockpit
            programId={programId}
            plan={plan}
            runtime={runtime}
            packet={mergePacketQuery.data.packet}
            evidence={evidence}
            latestAttemptId={latestAttempt?.id ?? null}
            latestSessionUrl={latestSessionUrl}
            actionError={actionError instanceof Error ? actionError.message : null}
            isApproveReviewPending={approveReviewMutation.isPending}
            isApproveMergePending={approveMergeMutation.isPending}
            isResumePending={resumeLoopMutation.isPending}
            isBackToPlanningPending={backToPlanningMutation.isPending}
            isTakeoverPending={takeoverMutation.isPending}
            onApproveReview={() => approveReviewMutation.mutate()}
            onApproveMerge={() => approveMergeMutation.mutate()}
            onResumeLoop={() => resumeLoopMutation.mutate()}
            onBackToPlanning={() => backToPlanningMutation.mutate()}
            onTakeover={() => takeoverMutation.mutate()}
        />
    )
}
