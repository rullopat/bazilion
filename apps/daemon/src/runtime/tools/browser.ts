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
      'PNG screenshot of the current page, returned as an image. Use it only when the visual layout matters; browser_snapshot is how you read and act on a page.',
      { full_page: { type: 'boolean', description: 'Capture the whole scrollable page.' } },
    ),
    tool('console', 'Recent browser console messages (logs, warnings, errors).'),
    tool('network', 'Recent network requests made by the page (method, status, URL).'),
  ]
}
