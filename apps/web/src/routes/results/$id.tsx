import { createFileRoute } from '@tanstack/react-router'
import { PageShell } from '../../components/Page'
import { ResultCard } from '../../components/ResultCard'

export const Route = createFileRoute('/results/$id')({ component: SavedResultPage })
function SavedResultPage() {
  const { id } = Route.useParams()
  return (
    <PageShell size="narrow">
      <h1>Saved file</h1>
      <ResultCard resultId={id} showPreview />
    </PageShell>
  )
}
