import { createFileRoute, redirect } from '@tanstack/react-router'
import { RecoveryState } from '../../components/RecoveryState'

export const Route = createFileRoute('/templates/')({
  errorComponent: ({ error, reset }) => <RecoveryState title="Templates unavailable" error={error} reset={reset} fallbackHref="/" />,
  beforeLoad: () => {
    throw redirect({ to: '/templates/agents' })
  },
})
