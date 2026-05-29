// Browser automation tools (worker-side definitions).
//
// These are thin proxies: each tool's `invoke` forwards to the daemon-side
// Playwright pool over IPC via the injected `BrowserHost`. The browser session
// (stateful, persistent across turns) lives entirely in the daemon — see
// `lib/browser/pool.ts`. Results are multimodal: snapshots/console/network come
// back as text, `browser_take_screenshot` as a base64 image.
//
// Perception is accessibility-tree-first. `browser_snapshot` returns an aria
// tree with `[ref=eN]` element refs; every interaction targets an element by
// that `ref`. No vision model is needed for routine automation — screenshots
// are the exception, not the rule.

import type { BrowserHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

const REF_DESC = 'Element ref from the latest browser_snapshot, e.g. "e5".'

/**
 * Build the `browser_*` tool suite bound to one agent's session. Each tool
 * forwards to `host.invoke(agentId, <action>, args)`.
 */
export function browserTools(host: BrowserHost, agentId: string): ToolHandler[] {
  const proxy = (
    name: string,
    action: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[] = [],
  ): ToolHandler => ({
    def: {
      name,
      description,
      parameters: { type: 'object', properties, required, additionalProperties: false },
    },
    invoke: (args) => host.invoke(agentId, action, args),
  })

  return [
    proxy(
      'browser_navigate',
      'navigate',
      'Open a URL in the browser and return an accessibility snapshot of the loaded page. Starts a persistent browser session that survives across turns (cookies/logins carry over).',
      { url: { type: 'string', description: 'Absolute URL to navigate to.' } },
      ['url'],
    ),
    proxy(
      'browser_snapshot',
      'snapshot',
      'Capture the current page as an accessibility tree (YAML) with [ref=eN] element references. This is the primary way to "see" the page — prefer it over screenshots. Use the refs with browser_click/type/etc.',
      {},
    ),
    proxy(
      'browser_click',
      'click',
      'Click an element identified by its snapshot ref. Returns a fresh snapshot.',
      { ref: { type: 'string', description: REF_DESC } },
      ['ref'],
    ),
    proxy(
      'browser_type',
      'type',
      'Type text into an input/textarea identified by its ref. Set submit=true to press Enter afterwards. Returns a fresh snapshot.',
      {
        ref: { type: 'string', description: REF_DESC },
        text: { type: 'string', description: 'Text to type into the field.' },
        submit: { type: 'boolean', description: 'Press Enter after typing.' },
      },
      ['ref', 'text'],
    ),
    proxy(
      'browser_hover',
      'hover',
      'Hover the pointer over an element identified by its ref. Returns a fresh snapshot.',
      { ref: { type: 'string', description: REF_DESC } },
      ['ref'],
    ),
    proxy(
      'browser_select',
      'select',
      'Select option(s) in a <select> element identified by its ref.',
      {
        ref: { type: 'string', description: REF_DESC },
        values: {
          type: 'array',
          items: { type: 'string' },
          description: 'Option values to select.',
        },
      },
      ['ref', 'values'],
    ),
    proxy(
      'browser_fill_form',
      'fill_form',
      'Fill multiple form fields in one call. Each field is { ref, value }.',
      {
        fields: {
          type: 'array',
          description: 'Fields to fill.',
          items: {
            type: 'object',
            properties: {
              ref: { type: 'string', description: REF_DESC },
              value: { type: 'string' },
            },
            required: ['ref', 'value'],
          },
        },
      },
      ['fields'],
    ),
    proxy(
      'browser_press_key',
      'press_key',
      'Press a keyboard key (e.g. "Enter", "Escape", "ArrowDown", "Control+A").',
      { key: { type: 'string', description: 'Key or chord to press.' } },
      ['key'],
    ),
    proxy(
      'browser_go_back',
      'go_back',
      'Navigate back to the previous page in history. Returns a fresh snapshot.',
      {},
    ),
    proxy(
      'browser_tabs',
      'tabs',
      'Manage tabs. op="list" lists open tabs; "new" opens a tab (optional url); "select" focuses tab at index; "close" closes tab at index (defaults to active).',
      {
        op: { type: 'string', enum: ['list', 'new', 'select', 'close'] },
        index: { type: 'number', description: 'Tab index for select/close.' },
        url: { type: 'string', description: 'URL to open for op=new.' },
      },
      ['op'],
    ),
    proxy(
      'browser_take_screenshot',
      'take_screenshot',
      'Take a PNG screenshot of the current page (returned as an image). Use only for visual verification or canvas/pixel content the accessibility snapshot cannot represent — prefer browser_snapshot for interaction.',
      { full_page: { type: 'boolean', description: 'Capture the full scrollable page.' } },
    ),
    proxy(
      'browser_console',
      'console',
      'Return recent browser console messages (logs, warnings, errors).',
      {},
    ),
    proxy(
      'browser_network',
      'network',
      'Return recent network requests issued by the page (method, status, URL).',
      {},
    ),
  ]
}
