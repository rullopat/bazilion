import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/profile-groups/$id')({
  beforeLoad: ({ params, search }) => {
    throw redirect({ to: '/templates/teams/$id', params, search })
  },
})
