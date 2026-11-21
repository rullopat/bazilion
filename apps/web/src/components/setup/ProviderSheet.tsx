import type {
  ChatModelEntry,
  ImageRouteEntry,
  ProviderConfigEntry,
  SetProviderModelsResponse,
  TestProviderResponse,
} from '@bazilion/api-types'
import { Check, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { ago, modelName, usedByLine } from '../../lib/model-facts'
import { Button } from '../Button'
import { ConfirmDialog } from '../ConfirmDialog'
import { Dialog } from '../Dialog'
import { FieldRow } from '../FieldRow'
import { FailureBox, Switch, Waiting } from './parts'

const HEADING =
  'm-0 font-body text-[0.72rem] font-bold uppercase tracking-[0.08em] text-muted-foreground'

/**
 * One provider: whether it answers, its credentials, its models in Chat, and the rarer settings.
 * Every change here reloads the page behind it.
 */
export function ProviderSheet({
  provider,
  chat,
  imageRoutes,
  imageSelected,
  onClose,
  onChanged,
  onPickModels,
  onReconnect,
}: {
  provider: ProviderConfigEntry
  /** Its models in Chat. */
  chat: ChatModelEntry[]
  /** The image routes its account serves. */
  imageRoutes: ImageRouteEntry[]
  imageSelected: string
  onClose: () => void
  onChanged: () => Promise<void>
  onPickModels: () => void
  /** Open the connect form for it: a new key or address is tested before it replaces the old. */
  onReconnect: () => void
}) {
  const now = useMemo(() => Date.now(), [])
  const [busy, setBusy] = useState<'test' | 'switch' | 'signin' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showMore, setShowMore] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const path = `/api/config/providers/${encodeURIComponent(provider.id)}`
  const { state, check } = provider
  const signin = provider.connect === 'signin'
  const mainFields = provider.fields.filter((field) => !field.advanced)
  const advancedFields = provider.fields.filter((field) => field.advanced)
  const agents = chat.reduce((sum, model) => sum + model.usedBy.agents, 0)
  const drawing = imageRoutes.find((route) => route.id === imageSelected)

  async function run(kind: 'test' | 'switch' | 'signin', work: () => Promise<unknown>) {
    setBusy(kind)
    setError(null)
    try {
      await work()
      await onChanged()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }
  const test = () =>
    run('test', () => api<TestProviderResponse>(`${path}/test`, { method: 'POST' }))
  const setEnabled = (enabled: boolean) =>
    run('switch', () => api(`${path}/enabled`, { method: 'PUT', body: { enabled } }))
  const signIn = () => run('signin', () => api('/api/auth/openai/login', { method: 'POST' }))

  async function disconnect() {
    await api<SetProviderModelsResponse>(path, { method: 'DELETE' })
    await onChanged()
    onClose()
  }

  const canTest = provider.models.length > 0
  const testButton = (label: string, primary = false) => (
    <Button
      variant={primary ? 'primary' : 'ghost'}
      disabled={busy !== null}
      onClick={() => void test()}
    >
      {label}
    </Button>
  )

  return (
    <Dialog
      title={provider.displayName}
      description={provider.hint}
      onClose={onClose}
      busy={busy === 'signin'}
      className="top-[4dvh] max-h-[92dvh] max-w-2xl translate-y-0 content-start gap-5"
    >
      {busy === 'test' ? (
        <div className="rounded-2xl border border-border bg-muted/40 p-4">
          <Waiting>Asking for a short reply…</Waiting>
        </div>
      ) : busy === 'signin' ? (
        <div className="rounded-2xl border border-border bg-muted/40 p-4">
          <Waiting>Waiting for the ChatGPT sign-in in the browser…</Waiting>
        </div>
      ) : state === 'working' && check ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-success/30 bg-success/10 p-4 text-sm"
        >
          <Check className="size-5 shrink-0 text-success" aria-hidden="true" />
          <div className="min-w-0 flex-1 basis-48">
            <div className="font-semibold text-foreground">
              {check.modelName ?? check.model} answered in {((check.ms ?? 0) / 1000).toFixed(1)} s
            </div>
            <div className="text-muted-foreground">Tested {ago(check.at, now)}</div>
          </div>
          {testButton('Test again')}
        </div>
      ) : state === 'failing' && check?.failure ? (
        <FailureBox failure={check.failure}>
          <span className="mr-auto self-center text-xs text-muted-foreground">
            Tried {ago(check.at, now)}
          </span>
          {check.failure.kind === 'credentials' && (
            <Button variant="ghost" onClick={signin ? () => void signIn() : onReconnect}>
              {signin ? 'Sign in again' : 'Replace the key'}
            </Button>
          )}
          {testButton('Try again', true)}
        </FailureBox>
      ) : state === 'incomplete' ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-warning/35 bg-warning/10 p-4 text-sm"
        >
          <div className="min-w-0 flex-1 basis-48">
            <div className="font-semibold text-foreground">
              {signin ? 'Not signed in' : 'Switched on, but its credentials are missing'}
            </div>
            <div className="text-muted-foreground">
              Agents on its models are refused until it is connected again.
            </div>
          </div>
          <Button variant="primary" onClick={signin ? () => void signIn() : onReconnect}>
            {signin ? 'Sign in with ChatGPT' : 'Connect'}
          </Button>
        </div>
      ) : state === 'off' ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm"
        >
          <div className="min-w-0 flex-1 basis-48">
            <div className="font-semibold text-foreground">
              {provider.models.length === 0 ? 'Saved, not in use' : 'Turned off'}
            </div>
            <div className="text-muted-foreground">
              {provider.models.length === 0
                ? 'Connect it to choose its models and test it.'
                : 'Its models are out of Chat until you turn it on again. What is saved stays saved.'}
            </div>
          </div>
          {provider.models.length === 0 ? (
            <Button variant="primary" disabled={busy !== null} onClick={onReconnect}>
              Connect
            </Button>
          ) : (
            <Button
              variant="primary"
              disabled={busy !== null || !provider.configured}
              onClick={() => void setEnabled(true)}
            >
              Turn on
            </Button>
          )}
        </div>
      ) : (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm"
        >
          <div className="min-w-0 flex-1 basis-48">
            <div className="font-semibold text-foreground">Not tested yet</div>
            <div className="text-muted-foreground">
              {canTest
                ? 'A test sends one short message to its cheapest model in Chat.'
                : 'It has no model in Chat, so there is nothing to ask.'}
            </div>
          </div>
          {canTest && testButton('Test now', true)}
        </div>
      )}

      {error && (
        <p role="alert" className="m-0 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <section aria-label="Credentials">
        <h3 className={HEADING}>
          {signin ? 'Sign-in' : provider.connect === 'local' ? 'Address' : 'Credentials'}
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1 basis-56 text-sm">
            {signin ? (
              provider.configured ? (
                <>
                  Signed in with your ChatGPT account
                  {provider.account && (
                    <span className="text-muted-foreground"> ({provider.account})</span>
                  )}
                  . Bazilion renews the sign-in by itself.
                </>
              ) : (
                'Not signed in.'
              )
            ) : mainFields.length === 0 ? (
              <span className="text-muted-foreground">
                {provider.configured
                  ? 'Read from the environment of the machine Bazilion runs on.'
                  : 'Not found in the environment of the machine Bazilion runs on.'}
              </span>
            ) : (
              <dl className="m-0 grid gap-1">
                {mainFields.map((field) => (
                  <div key={field.envVar} className="flex flex-wrap gap-x-2">
                    <dt className="text-muted-foreground">{field.label}</dt>
                    <dd className="m-0 min-w-0 break-all font-mono text-[0.85em]">
                      {field.kind === 'secret'
                        ? field.set
                          ? `${field.preview ?? 'saved'}, stored encrypted`
                          : 'not saved'
                        : field.value || (provider.address ?? 'not set')}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
          {signin ? (
            <Button variant="ghost" disabled={busy !== null} onClick={() => void signIn()}>
              {provider.configured ? 'Sign in again' : 'Sign in with ChatGPT'}
            </Button>
          ) : (
            mainFields.length > 0 && (
              <Button variant="ghost" disabled={busy !== null} onClick={onReconnect}>
                {provider.connect === 'local'
                  ? 'Change the address'
                  : mainFields.some((field) => field.kind === 'secret' && !field.set)
                    ? 'Add the key'
                    : 'Replace the key'}
              </Button>
            )
          )}
        </div>
      </section>

      <section aria-label="Its models in Chat">
        <div className="flex items-center gap-3">
          <h3 className={`${HEADING} flex-1`}>Its models in Chat</h3>
          <button
            type="button"
            onClick={onPickModels}
            className="text-sm font-semibold text-primary"
          >
            Choose models
          </button>
        </div>
        <ul className="m-0 mt-2 list-none divide-y divide-border overflow-hidden rounded-xl border border-border p-0">
          {provider.models.length === 0 && (
            <li className="px-3 py-2.5 text-sm text-muted-foreground">
              None of its models is in Chat.
            </li>
          )}
          {provider.models.map((id) => {
            const model = chat.find((entry) => entry.id === id)
            return (
              <li key={id} className="flex flex-wrap items-center gap-x-3 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 basis-40 font-semibold text-foreground">
                  {model ? modelName(model) : id}
                </span>
                <span className="text-muted-foreground">
                  {model ? usedByLine(model.usedBy) : 'Out of Chat while this is turned off'}
                </span>
              </li>
            )
          })}
        </ul>
        {imageRoutes.length > 0 && (
          <p className="m-0 mt-2 text-sm text-muted-foreground">
            {drawing
              ? `Images are drawn by ${drawing.model} through this provider.`
              : `Can also draw images: ${[...new Set(imageRoutes.map((route) => route.model))].join(', ')}.`}
          </p>
        )}
      </section>

      <section aria-label="More settings">
        <button
          type="button"
          aria-expanded={showMore}
          onClick={() => setShowMore((open) => !open)}
          className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
        >
          <ChevronRight
            className={`size-4 text-muted-foreground transition-transform ${showMore ? 'rotate-90' : ''}`}
            aria-hidden="true"
          />
          More settings
        </button>
        {showMore && (
          <div className="mt-2 grid gap-3 rounded-xl border border-border bg-muted/40 p-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold text-foreground">Agents may use this provider</div>
                <div className="text-muted-foreground">
                  Turn off to pause it without removing what is saved.
                </div>
              </div>
              <Switch
                checked={provider.enabled}
                label="Agents may use this provider"
                disabled={busy !== null || (!provider.enabled && !provider.configured)}
                onChange={(enabled) => void setEnabled(enabled)}
              />
            </div>
            {advancedFields.map((field) => (
              <FieldRow key={field.envVar} field={field} />
            ))}
            {provider.fields.length > 0 && (
              <p className="m-0 text-xs text-muted-foreground">
                Setting names, for <code>bazilion config set</code> and the daemon’s environment:{' '}
                {provider.fields.map((field) => field.envVar).join(', ')}. A value set in the
                environment wins over the one saved here.
              </p>
            )}
          </div>
        )}
      </section>

      <section aria-label="Disconnect" className="border-t border-frost pt-4">
        <Button
          variant="danger"
          disabled={busy !== null}
          onClick={() => setConfirmDisconnect(true)}
        >
          Disconnect {provider.displayName}
        </Button>
        <p className="m-0 mt-2 text-sm text-muted-foreground">
          Removes{' '}
          {signin ? 'the sign-in' : provider.connect === 'local' ? 'the address' : 'the key'}, its
          models from Chat and its test.
        </p>
      </section>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title={`Disconnect ${provider.displayName}?`}
        description={
          <>
            <p className="m-0">
              This removes{' '}
              {signin
                ? 'the saved ChatGPT sign-in'
                : provider.connect === 'local'
                  ? 'the saved address'
                  : 'the saved credentials'}{' '}
              and takes its {provider.models.length === 1 ? 'model' : 'models'} out of Chat.
            </p>
            {agents > 0 && (
              <p className="m-0 mt-2">
                {agents === 1 ? '1 Agent runs' : `${agents} Agents run`} on its models and will be
                refused until given another model. Agent templates move to another model by
                themselves.
              </p>
            )}
            {drawing && (
              <p className="m-0 mt-2">Image generation stops until another route is chosen.</p>
            )}
          </>
        }
        confirmLabel={`Disconnect ${provider.displayName}`}
        onConfirm={disconnect}
      />
    </Dialog>
  )
}
