import type {
  ModelsResponse,
  ProviderConfigResponse,
  TestProviderResponse,
} from '@bazilion/api-types'
import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { ConfigPage } from '../../components/ConfigPage'
import { AddProviderDialog } from '../../components/setup/AddProviderDialog'
import { ModelPicker } from '../../components/setup/ModelPicker'
import {
  AudioCard,
  ChatModelsCard,
  CommandReviewCard,
  ImagesCard,
  ProvidersCard,
  SpeechCard,
  StatusLine,
  TranscriptionCard,
  VideoCard,
} from '../../components/setup/ModelsCards'
import { ProviderSheet } from '../../components/setup/ProviderSheet'
import { api } from '../../lib/api'
import { daemonClient } from '../../lib/daemon-client'

/** What is open over the page, in the address so that a link or the back button finds it. */
interface ModelsSearch {
  /** A provider's sheet. */
  provider?: string
  /** "Add a provider": `new` for the list, or a provider id to connect straight away. */
  add?: string
  /** The chat model picker. */
  pick?: true
}

const fetchModelsPage = createServerFn({ method: 'GET' }).handler(async () => {
  const daemon = daemonClient()
  const [{ providers }, models] = await Promise.all([
    daemon.get<ProviderConfigResponse>('/api/config/providers'),
    daemon.get<ModelsResponse>('/api/config/models'),
  ])
  // "Tested two minutes ago" is counted from one clock, on the server and in the browser.
  return { providers, models, now: Date.now() }
})

export const Route = createFileRoute('/config/')({
  validateSearch: (search: Record<string, unknown>): ModelsSearch => ({
    ...(typeof search.provider === 'string' && search.provider
      ? { provider: search.provider }
      : {}),
    ...(typeof search.add === 'string' && search.add ? { add: search.add } : {}),
    ...(search.pick === true || search.pick === 'true' ? { pick: true as const } : {}),
  }),
  loader: () => fetchModelsPage(),
  component: ModelsPage,
})

function ModelsPage() {
  const { providers, models, now } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const router = useRouter()
  const [testing, setTesting] = useState(false)

  const listed = providers.filter((provider) => provider.listed)
  const usable = listed.filter((provider) => provider.enabled)
  const open = (next: ModelsSearch) => void navigate({ search: next })
  const close = () => open({})
  const reload = () => router.invalidate({ sync: true })
  const sheet = providers.find((provider) => provider.id === search.provider && provider.listed)

  async function testAll() {
    setTesting(true)
    try {
      // One short request each; a failure is that provider's state, not an error of the page.
      await Promise.all(
        usable
          .filter((provider) => provider.models.length > 0)
          .map((provider) =>
            api<TestProviderResponse>(
              `/api/config/providers/${encodeURIComponent(provider.id)}/test`,
              { method: 'POST' },
            ).catch(() => undefined),
          ),
      )
      await reload()
    } finally {
      setTesting(false)
    }
  }

  return (
    <ConfigPage
      title="Models"
      description="What your Agents think and draw with, and the accounts behind it."
    >
      <StatusLine
        providers={listed}
        chat={models.chat}
        now={now}
        testing={testing}
        onOpen={(id) => open({ provider: id })}
        onTestAll={() => void testAll()}
      />
      <ChatModelsCard
        chat={models.chat}
        hasProviders={usable.length > 0}
        onPick={() => open({ pick: true })}
        onChanged={reload}
      />
      <ImagesCard images={models.images} onConnect={(id) => open({ add: id })} onChanged={reload} />
      <VideoCard video={models.video} onConnect={(id) => open({ add: id })} onChanged={reload} />
      <AudioCard audio={models.audio} onConnect={(id) => open({ add: id })} onChanged={reload} />
      <SpeechCard speech={models.speech} onConnect={(id) => open({ add: id })} onChanged={reload} />
      <TranscriptionCard
        transcription={models.transcription}
        onConnect={(id) => open({ add: id })}
        onChanged={reload}
      />
      <CommandReviewCard chat={models.chat} review={models.commandReview} onChanged={reload} />
      <ProvidersCard
        providers={listed}
        total={providers.length}
        images={models.images}
        now={now}
        onOpen={(id) => open({ provider: id })}
        onAdd={() => open({ add: 'new' })}
      />

      {search.add && (
        <AddProviderDialog
          key={search.add}
          providers={providers}
          imageRoutes={models.images.routes}
          start={search.add === 'new' ? undefined : search.add}
          onClose={close}
          onConnected={reload}
          onOpenProvider={(id) => open({ provider: id })}
        />
      )}
      {search.pick && (
        <ModelPicker
          providers={usable}
          chat={models.chat}
          onClose={close}
          onSaved={reload}
          onAddProvider={() => open({ add: 'new' })}
        />
      )}
      {sheet && (
        <ProviderSheet
          key={sheet.id}
          provider={sheet}
          chat={models.chat.filter((model) => model.provider === sheet.id)}
          imageRoutes={models.images.routes.filter((route) => route.provider === sheet.id)}
          imageSelected={models.images.selected}
          onClose={close}
          onChanged={reload}
          onPickModels={() => open({ pick: true })}
          onReconnect={() => open({ add: sheet.id })}
        />
      )}
    </ConfigPage>
  )
}
