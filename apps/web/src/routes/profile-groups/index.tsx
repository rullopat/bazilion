import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/profile-groups/')({
  beforeLoad: ({ search }) => {
    throw redirect({ to: '/templates/teams', search })
  },
})
