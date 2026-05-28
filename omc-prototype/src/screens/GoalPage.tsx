import { Navigate } from '@tanstack/react-router'

export default function GoalPage(props: { goalId: string }) {
    return <Navigate to="/" search={{ goal: props.goalId }} />
}
