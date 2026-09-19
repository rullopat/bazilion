import { createFileRoute, redirect } from '@tanstack/react-router'
import { RecoveryState } from '../../../components/RecoveryState'

export const Route = createFileRoute('/teams/$id/context')({
  errorComponent: ({ error, reset }) => <RecoveryState title="Team context unavailable" error={error} reset={reset} fallbackHref="/teams" />,
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/teams/$id', params: { id: params.id } })
  },
})
