import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/teams/$id/context')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/teams/$id', params: { id: params.id } })
  },
})
