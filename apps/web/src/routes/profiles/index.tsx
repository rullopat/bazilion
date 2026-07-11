import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/profiles/')({
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/templates/agents', search })
  },
})
