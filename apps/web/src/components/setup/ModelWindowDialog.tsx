import type {
  ChatModelEntry,
  SetModelWindowRequest,
  SetModelWindowResponse,
} from '@bazilion/api-types'
import { useEffect, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { modelName } from '../../lib/model-facts'
import { Button } from '../Button'
import { Dialog, DialogActions } from '../Dialog'
import { TextField } from '../ui/form'

/** The digits of a window as typed (`32,768`, `32 768`), or null when it is not a whole number. */
function parseTokens(text: string): number | null {
  const digits = text.replace(/[\s,._']/g, '')
  if (!/^\d+$/.test(digits)) return null
  const tokens = Number(digits)
  return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : null
}

/** Set by hand the context window of a model the catalog does not know, or forget it. */
export function ModelWindowDialog({
  model,
  onClose,
  onSaved,
}: {
  model: ChatModelEntry | null
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setText(model?.window.set ? String(model.window.set) : '')
    setBusy(false)
    setError(null)
  }, [model])

  const tokens = parseTokens(text)
  const typed = text.trim() !== ''

  async function save(value: number | null) {
    if (!model) return
    setBusy(true)
    setError(null)
    try {
      await api<SetModelWindowResponse>('/api/config/models/window', {
        method: 'PUT',
        body: { model: model.value, tokens: value } satisfies SetModelWindowRequest,
      })
      await onSaved()
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
      setBusy(false)
    }
  }

  const name = model ? modelName(model) : ''
  const server = model?.window.source === 'server' ? model.window.tokens : null
  return (
    <Dialog
      open={model !== null}
      busy={busy}
      onClose={onClose}
      title={`Context window of ${name}`}
      description={
        server ? (
          <p className="m-0">
            {model?.providerName} says it reads {server.toLocaleString()} tokens, and that is what
            turns use. The value set here is for when it does not say, such as before the model is
            loaded.
          </p>
        ) : (
          <p className="m-0">
            {model?.providerName} does not say how many tokens {name} reads in one request. Give the
            context window it runs with: summaries and replies are sized to it, and turns on the
            model are refused until it is known.
          </p>
        )
      }
      className="max-w-md"
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          if (tokens) void save(tokens)
        }}
      >
        <TextField
          label="Tokens"
          value={text}
          onChange={setText}
          inputMode="numeric"
          placeholder="For example 32768"
          hint="The context length the model was loaded with, in tokens."
          problem={typed && !tokens ? 'A whole number of tokens, above 0.' : undefined}
          className="w-48"
        />
        {error && (
          <p role="alert" className="m-0 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <DialogActions>
          {model?.window.set && (
            <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>
              Forget it
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy || !tokens}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  )
}
