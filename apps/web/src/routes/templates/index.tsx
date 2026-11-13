import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/templates/')({
  beforeLoad: () => {
    throw redirect({ to: '/templates/agents' })
  },
})
