// The daemon side of a turn's `browser_*` tools. Calls always drive the turn's
// own agent's browser, whatever agent id the worker sends.
//
// Which browser (BAZ-102): the setting is the default; a conversation can switch with
// `browser_use`, and its next turns start where it left off (`chosen`). Moving to the operator's
// running Chrome waits for their approval unless that is already the default.

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Paths } from '../../core/index.ts'
import { branchOf } from '../../runtime/pi/history.ts'
import { readSessionFile } from '../../runtime/pi/session-file.ts'
import { browserChoiceIn } from '../../runtime/tools/browser.ts'
import type {
  BashApprovalHandle,
  BrowserChoice,
  BrowserHost,
} from '../../runtime/worker/ipc-protocol.ts'
import type { BrowserConfig } from './config.ts'
import { invokeBrowserAction } from './pool.ts'

/** Asks the operator to let the Agent work in their Chrome; settles allowed or not. */
export type YourBrowserGate = (request: {
  toolCallId: string
  signal?: AbortSignal
}) => BashApprovalHandle

const NOW_YOURS =
  "Your browser_* tools now work in the user's running Chrome, signed in to their accounts, for the rest of this conversation. You see and drive only the tabs you open. On every site they are signed in to you act as them: post, send, buy, delete or change settings only when they asked for exactly that. Downloads are refused there."
const NOW_OWN =
  'Your browser_* tools now work in your own browser, with logins of its own, for the rest of this conversation.'

export function createBrowserHost(
  config: BrowserConfig,
  turn: {
    agentId: string
    paths: Paths
    signal?: AbortSignal
    /** How the Agent sees its uploads folder, where PDFs and downloads are saved. */
    uploadsShown?: string
    /** The browser the conversation works in (`conversationBrowserChoice`); absent, the default. */
    chosen?: BrowserChoice
    /** Asks before the Agent moves to the operator's Chrome; absent, the move is refused. */
    askYours?: YourBrowserGate
  },
): BrowserHost {
  const byDefault: BrowserChoice = config.attach ? 'yours' : 'own'
  let choice: BrowserChoice = turn.chosen ?? byDefault
  const configOf = (browser: BrowserChoice): BrowserConfig => ({
    ...config,
    attach: browser === 'yours',
  })
  const run = (browser: BrowserChoice, action: string, args: Record<string, unknown>) =>
    invokeBrowserAction(
      turn.agentId,
      action,
      args,
      configOf(browser),
      turn.paths,
      turn.signal,
      turn.uploadsShown,
    )
  return {
    invoke: (_workerAgentId, action, args) => run(choice, action, args),
    async use(browser, options) {
      if (browser === choice) {
        return {
          text:
            browser === 'yours'
              ? "You already work in the user's running Chrome in this conversation."
              : 'You already work in your own browser in this conversation.',
          switched: false,
          approved: false,
        }
      }
      const asks = browser === 'yours' && byDefault !== 'yours'
      if (asks) {
        if (!turn.askYours) throw new Error("Working in the user's Chrome needs their approval")
        const handle = turn.askYours({
          toolCallId: options?.toolCallId ?? 'browser_use',
          ...(options?.signal ? { signal: options.signal } : {}),
        })
        options?.onApproval?.(handle.approval)
        const settled = await handle.settled
        if (handle.approval.status === 'pending') options?.onApproval?.(settled)
        if (settled.status !== 'allowed') {
          throw new Error(
            "The user did not allow working in their Chrome: keep using your own browser. In a turn nobody is watching (a schedule, a teammate's message), ask them in a conversation instead.",
          )
        }
      }
      if (browser === 'yours') {
        // Reach it now, so a Chrome that does not allow it says so here and not on the next page.
        await run('yours', 'tabs', { op: 'list' })
      }
      choice = browser
      return { text: browser === 'yours' ? NOW_YOURS : NOW_OWN, switched: true, approved: asks }
    },
  }
}

/** The browser a conversation works in, read from its file (`browserChoiceIn`). */
export function conversationBrowserChoice(
  paths: Paths,
  agentId: string,
  conversationId: string,
  byDefault: BrowserChoice,
): BrowserChoice {
  const dir = join(paths.agentDir(agentId), 'sessions')
  if (!existsSync(join(dir, `${conversationId}.jsonl`))) return byDefault
  try {
    const messages = branchOf(readSessionFile(dir, conversationId)).flatMap((entry) =>
      entry.type === 'message'
        ? [entry.message as Parameters<typeof browserChoiceIn>[0][number]]
        : [],
    )
    return browserChoiceIn(messages, byDefault)
  } catch {
    return byDefault
  }
}
