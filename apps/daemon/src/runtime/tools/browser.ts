// Worker-side `browser_*` tools. Each one forwards its arguments over IPC to the
// agent's persistent browser in the daemon (`lib/browser/pool.ts`), which answers
// with text (snapshots, tab lists, logs) or, for screenshots, an image.

import type { BrowserHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

const REF = { type: 'string', description: 'Element ref from the latest snapshot, e.g. "e5".' }

export function browserTools(host: BrowserHost, agentId: string): ToolHandler[] {
  const tool = (
    action: string,
    description: string,
    properties: Record<string, unknown> = {},
    required: string[] = [],
  ): ToolHandler => ({
    def: {
      name: `browser_${action}`,
      description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    },
    invoke: (args) => host.invoke(agentId, action, args),
  })

  return [
    tool(
      'navigate',
      'Open a URL and return a snapshot of the page. The browser and its cookies/logins persist across turns.',
      { url: { type: 'string', description: 'Absolute URL to open.' } },
      ['url'],
    ),
    tool(
      'snapshot',
      'Accessibility snapshot of the current page with [ref=eN] element refs. A long snapshot comes in pages: pass page to read the next one. Pass ref to snapshot a single element.',
      {
        ref: REF,
        page: {
          type: 'integer',
          minimum: 1,
          description: 'Page of the latest snapshot to read (the first page is 1).',
        },
      },
    ),
    tool('click', 'Click an element. Returns a fresh snapshot.', { ref: REF }, ['ref']),
    tool(
      'type',
      'Type text into an input or textarea; submit=true presses Enter afterwards. Returns a fresh snapshot.',
      {
        ref: REF,
        text: { type: 'string', description: 'Text to type into the field.' },
        submit: { type: 'boolean', description: 'Press Enter after typing.' },
      },
      ['ref', 'text'],
    ),
    tool('hover', 'Hover the pointer over an element.', { ref: REF }, ['ref']),
    tool(
      'select',
      'Select option(s) in a <select> element.',
      {
        ref: REF,
        values: { type: 'array', items: { type: 'string' }, description: 'Option values.' },
      },
      ['ref', 'values'],
    ),
    tool(
      'fill_form',
      'Fill several form fields at once.',
      {
        fields: {
          type: 'array',
          description: 'Fields to fill.',
          items: {
            type: 'object',
            properties: { ref: REF, value: { type: 'string' } },
            required: ['ref', 'value'],
          },
        },
      },
      ['fields'],
    ),
    tool(
      'press_key',
      'Press a keyboard key (e.g. "Enter", "Escape", "ArrowDown", "Control+A").',
      { key: { type: 'string', description: 'Key or chord to press.' } },
      ['key'],
    ),
    tool('go_back', 'Go back to the previous page. Returns a fresh snapshot.'),
    tool(
      'tabs',
      'Manage tabs: op "list" shows open tabs with their ids; "new" opens a tab (optional url); "select" switches to a tab; "close" closes one.',
      {
        op: { type: 'string', enum: ['list', 'new', 'select', 'close'] },
        tabId: { type: 'string', description: 'Tab id from op "list", for select and close.' },
        url: { type: 'string', description: 'URL to open, for op "new".' },
      },
      ['op'],
    ),
    tool(
      'take_screenshot',
      'PNG screenshot of the current page, or of one element (ref), returned as an image. Use it only when the visual layout matters; browser_snapshot is how you read and act on a page.',
      {
        full_page: { type: 'boolean', description: 'Capture the whole scrollable page.' },
        ref: { ...REF, description: 'Capture only this element, a ref from the latest snapshot.' },
      },
    ),
    tool('console', 'Recent browser console messages (logs, warnings, errors).'),
    tool(
      'errors',
      'Console errors and warnings and uncaught page errors since you last asked: the first thing to look at when a page of an app you are building misbehaves.',
    ),
    tool(
      'network',
      'Recent network requests made by the page: method, status (or why it failed) and URL.',
      {
        filter: {
          type: 'string',
          description: 'Only requests whose URL contains this text, or with this method (POST).',
        },
      },
    ),
    tool(
      'text',
      'The readable text of the page (as Markdown), or of one element with ref: for reading an article or a document, where a snapshot is noisy.',
      { ref: { ...REF, description: 'Only this element, a ref from the latest snapshot.' } },
    ),
    tool(
      'wait',
      'Wait until something happens on the page, up to `seconds`: a text or an element (ref) shows, the address contains a text, the page settles (no requests for a moment), or its downloads finish. Returns a fresh snapshot, or what did not happen.',
      {
        seconds: { type: 'number', description: 'How long to wait at most.' },
        text: { type: 'string', description: 'Text that should appear.' },
        ref: { ...REF, description: 'An element that should appear.' },
        url: { type: 'string', description: 'Text the page address should come to contain.' },
        settled: { type: 'boolean', description: 'Wait until the page has no requests going.' },
        download: { type: 'boolean', description: 'Wait for its downloads to finish.' },
      },
      ['seconds'],
    ),
    tool(
      'pdf',
      'Save the page as a PDF with your uploads, and say where. Needs your own browser running headless.',
    ),
    tool(
      'emulate',
      'Show this tab as a device would: a device by name ("iPhone 15", "Pixel 7", "iPad Pro 11"), or a width and height, with or without touch; light or dark colour scheme; a locale; a time zone. reset: true goes back. Lasts for the tab until reset.',
      {
        device: { type: 'string', description: 'A device name, e.g. "iPhone 15".' },
        width: { type: 'number' },
        height: { type: 'number' },
        touch: { type: 'boolean' },
        color_scheme: { type: 'string', enum: ['light', 'dark', 'no-preference'] },
        locale: { type: 'string', description: 'e.g. "it-IT"' },
        timezone: { type: 'string', description: 'e.g. "Europe/Rome"' },
        reset: { type: 'boolean', description: 'Go back to the browser’s own settings.' },
      },
    ),
  ]
}
