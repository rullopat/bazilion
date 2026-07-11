import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/profiles/$id')({
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/templates/agents/$id', params, search })
  },
})
