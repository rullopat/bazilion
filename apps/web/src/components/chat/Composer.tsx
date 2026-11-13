import type { Attachment } from '@bazilion/api-types'
import { type RefObject, useLayoutEffect, useRef } from 'react'
import { Button } from '../Button'
import { isImageMime } from './entries'

const MAX_INPUT_HEIGHT = 200
export const MAX_ATTACHMENTS = 16

/** A file as a base64 attachment; the daemon sends images to the model and stores the rest. */
function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      resolve({
        name: file.name,
        data: url.slice(url.indexOf(',') + 1),
        mimeType: file.type || 'application/octet-stream',
      })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function encodeFiles(files: FileList | File[]): Promise<Attachment[]> {
  return Promise.all(Array.from(files).map(fileToAttachment))
}

/** The message box: text, attachments, the edit banner, Send and Stop. */
export function Composer({
  agentName,
  value,
  onChange,
  onSubmit,
  attachments,
  onAddFiles,
  onRemoveAttachment,
  editing,
  onCancelEdit,
  agentBusy,
  onStop,
  inputRef,
}: {
  agentName: string
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  attachments: Attachment[]
  onAddFiles: (files: FileList | File[]) => void
  onRemoveAttachment: (index: number) => void
  editing: boolean
  onCancelEdit: () => void
  /** The Agent runs a turn: Send queues a follow-up and Stop is offered. */
  agentBusy: boolean
  onStop: () => void
  inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  const fileInput = useRef<HTMLInputElement | null>(null)

  // biome-ignore lint/correctness/useExhaustiveDependencies: resize whenever the text changes.
  useLayoutEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_INPUT_HEIGHT)}px`
  }, [value])

  return (
    <>
      {editing && (
        <div className="flex items-center gap-2 border-t border-frost bg-sapphire-glow px-5 py-2 text-[0.85em] text-sapphire-deep">
          <span>editing last message — submit to replace, or</span>
          <button
            type="button"
            onClick={onCancelEdit}
            className="ml-auto rounded-sm border border-sapphire-light bg-transparent px-2 py-0.5 text-[0.92em] text-sapphire-deep hover:bg-snow"
          >
            cancel
          </button>
        </div>
      )}

      {attachments.length > 0 && (
        <div className="flex max-h-24 shrink-0 flex-wrap gap-2 overflow-y-auto border-t border-frost bg-ivory px-5 pt-3">
          {attachments.map((attachment, index) =>
            isImageMime(attachment.mimeType) ? (
              // biome-ignore lint/suspicious/noArrayIndexKey: removal is by position.
              <div key={index} className="relative">
                <img
                  src={`data:${attachment.mimeType};base64,${attachment.data}`}
                  alt="pending attachment"
                  className="h-16 w-16 rounded-md border border-frost object-cover"
                />
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(index)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-frost bg-snow text-[0.7em] text-mocha hover:border-sapphire hover:text-sapphire"
                  aria-label="remove attachment"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: removal is by position.
                key={index}
                className="flex items-center gap-1.5 rounded-md border border-frost bg-snow px-2 py-1 text-[0.82em] text-mocha"
              >
                <span>📄</span>
                <span className="max-w-[160px] truncate">{attachment.name ?? 'file'}</span>
                <button
                  type="button"
                  onClick={() => onRemoveAttachment(index)}
                  className="text-[0.85em] text-mocha hover:text-sapphire"
                  aria-label="remove attachment"
                >
                  ✕
                </button>
              </div>
            ),
          )}
        </div>
      )}

      <form
        className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-end gap-2 border-t border-frost bg-ivory px-3 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:px-5"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <input
          ref={fileInput}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            if (event.target.files) onAddFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <button
          type="button"
          onClick={() => fileInput.current?.click()}
          title="attach images or files"
          aria-label="attach files"
          className="flex h-11 items-center justify-center rounded-md border-[1.5px] border-frost bg-snow px-3 py-2 text-[1em] text-mocha transition-colors hover:border-sapphire hover:text-sapphire"
        >
          📎
        </button>
        <textarea
          ref={inputRef}
          rows={1}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              onSubmit()
            }
          }}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.some((file) => isImageMime(file.type))) {
              event.preventDefault()
              onAddFiles(files)
            }
          }}
          placeholder="Write a message…"
          title="Shift+Enter for a new line. Paste or attach files with the paperclip."
          autoComplete="off"
          aria-label={`Message ${agentName}`}
          className="max-h-[200px] min-h-11 min-w-0 flex-1 resize-none overflow-y-auto rounded-md border-[1.5px] border-frost bg-snow px-3 py-2 text-[0.93em] leading-[1.45] text-chocolate outline-none transition-colors focus:border-sapphire focus:shadow-[0_0_0_3px_var(--color-sapphire-glow)]"
        />
        <div className="col-span-2 flex flex-wrap justify-end gap-2 sm:col-span-1">
          <Button
            variant="primary"
            type="submit"
            className="min-h-11 whitespace-normal text-center"
            disabled={!value.trim() && attachments.length === 0}
          >
            {agentBusy ? 'Queue follow-up' : 'Send'}
          </Button>
          {agentBusy && (
            <Button
              variant="danger"
              className="min-h-11"
              onClick={onStop}
              aria-label="Stop response"
            >
              Stop
            </Button>
          )}
        </div>
      </form>
    </>
  )
}
