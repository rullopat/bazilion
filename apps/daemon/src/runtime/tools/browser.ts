// Browser automation tools (worker-side definitions).
//
// These are thin proxies: each tool's `invoke` forwards to the daemon-side
// Playwright pool over IPC via the injected `BrowserHost`. The browser session
// (stateful, persistent across turns) lives entirely in the daemon — see
// `lib/browser/pool.ts`. Results are multimodal: snapshots/console/network come
// back as text, `browser_take_screenshot` as a base64 image.
//
// Perception is accessibility-tree-first. `browser_snapshot` returns an aria
// tree with [ref=eN] element refs and an observationId. Every ref action must
// supply both values from the same current snapshot. No vision model is needed
// for routine automation — screenshots are the exception, not the rule.

import { BROWSER_SNAPSHOT_SCOPES } from '@bazilion/api-types'
import type { BrowserHost } from '../worker/ipc-protocol.ts'
import type { ToolHandler } from './types.ts'

const REF_DESC = 'Element ref from the latest browser_snapshot, e.g. "e5".'
const OBSERVATION_ID_DESC = 'observationId from the same current browser_snapshot.'

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

  const observedRef = {
    ref: { type: 'string', description: REF_DESC },
    observationId: { type: 'string', description: OBSERVATION_ID_DESC },
  }

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
      'Capture the current page as an accessibility tree (YAML) with [ref=eN] element references and an observationId. Use refs with that observationId for browser_click/type/etc. Choose only one: cursor for frozen paging, ref plus observationId, or scope (dialog/main/search) to read one accessible semantic region without an old ref. Semantic scopes are partial page views, never consent or action authorization.',
      {
        observationId: { type: 'string', description: OBSERVATION_ID_DESC },
        ref: { type: 'string', description: REF_DESC },
        cursor: {
          type: 'string',
          description: 'Single-use continuation cursor from the current snapshot.',
        },
        scope: {
          type: 'string',
          enum: BROWSER_SNAPSHOT_SCOPES,
          description:
            'Read exactly one accessible dialog, main or search region. Missing, ambiguous or oversized regions refuse; never an arbitrary selector.',
        },
      },
    ),
    proxy(
      'browser_click',
      'click',
      'Click an element identified by its snapshot ref and matching observationId. Returns a fresh snapshot.',
      observedRef,
      ['ref', 'observationId'],
    ),
    proxy(
      'browser_type',
      'type',
      'Type text into an input/textarea identified by its ref and matching observationId. Set submit=true to press Enter afterwards. Returns a fresh snapshot.',
      {
        ...observedRef,
        text: { type: 'string', description: 'Text to type into the field.' },
        submit: { type: 'boolean', description: 'Press Enter after typing.' },
      },
      ['ref', 'text', 'observationId'],
    ),
    proxy(
      'browser_hover',
      'hover',
      'Hover the pointer over an element identified by its ref and matching observationId.',
      observedRef,
      ['ref', 'observationId'],
    ),
    proxy(
      'browser_select',
      'select',
      'Select option(s) in a <select> element identified by its ref and matching observationId.',
      {
        ...observedRef,
        values: {
          type: 'array',
          items: { type: 'string' },
          description: 'Option values to select.',
        },
      },
      ['ref', 'values', 'observationId'],
    ),
    proxy(
      'browser_fill_form',
      'fill_form',
      'Fill multiple form fields from one current snapshot. Pass its observationId and fields as { ref, value } entries.',
      {
        observationId: { type: 'string', description: OBSERVATION_ID_DESC },
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
      ['fields', 'observationId'],
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
      'Manage tabs. op="list" lists open tabs with stable tab ids; "new" opens a tab (optional url); "select" focuses a tab by tabId; "close" closes a tab by tabId (from op="list").',
      {
        op: { type: 'string', enum: ['list', 'new', 'select', 'close'] },
        tabId: { type: 'string', description: 'Stable tab id from browser_tabs op=list.' },
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
    proxy(
      'browser_status',
      'status',
      "Read-only status of this agent's managed browser: whether the browser service is enabled, whether a usable browser is available (configured), the session lifecycle state, whether a persistent profile exists, and the selected browser (name, source, mode). Never starts a browser.",
      {},
    ),
  ]
}
