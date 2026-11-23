import { describe, expect, test, vi } from 'vitest'
import { getDialogFocusRestoreTarget, restoreDialogFocus } from '../src/components/Dialog.tsx'

function focusFixture(options: { connected?: boolean } = {}) {
  const focus = vi.fn()
  const target = {
    focus,
    isConnected: options.connected ?? true,
  } as unknown as HTMLElement
  const doc = {
    activeElement: target,
    body: {},
    documentElement: {},
  } as unknown as Document
  Object.defineProperty(target, 'ownerDocument', { value: doc })
  return { doc, focus, target }
}

describe('dialog focus restoration', () => {
  test('captures and restores the element focused before the dialog opens', () => {
    const { doc, focus, target } = focusFixture()

    const captured = getDialogFocusRestoreTarget(doc)
    expect(captured).toBe(target)

    restoreDialogFocus(captured, doc)
    expect(focus).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  test('does not restore focus when the opening element was removed', () => {
    const { doc, focus, target } = focusFixture({ connected: false })

    restoreDialogFocus(target, doc)
    expect(focus).not.toHaveBeenCalled()
  })

  test('does not capture the document body when there is no focused trigger', () => {
    const { doc, focus } = focusFixture()
    Object.defineProperty(doc, 'activeElement', { value: doc.body })

    const captured = getDialogFocusRestoreTarget(doc)
    expect(captured).toBeNull()

    restoreDialogFocus(captured, doc)
    expect(focus).not.toHaveBeenCalled()
  })

  test('leaves the focus with a dialog opened meanwhile', () => {
    const { doc, focus, target } = focusFixture()
    // ⌘K pressed straight after Escape: Jump to has the focus when the closed dialog gives it back.
    const paletteInput = {
      closest: (selector: string) => (selector.includes('dialog') ? {} : null),
    }
    Object.defineProperty(doc, 'activeElement', { value: paletteInput })

    restoreDialogFocus(target, doc)
    expect(focus).not.toHaveBeenCalled()
  })

  test('does not focus an element owned by another document', () => {
    const { focus, target } = focusFixture()
    const otherDocument = { body: {}, documentElement: {} } as unknown as Document

    restoreDialogFocus(target, otherDocument)
    expect(focus).not.toHaveBeenCalled()
  })
})
