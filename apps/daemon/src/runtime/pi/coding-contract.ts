import type {
  CodingCommandInput,
  CodingCommandLogPage,
  CodingCommandLogSearchResult,
  CodingCommandLogView,
  CodingCommandOutcome,
  CodingCommandReceipt,
  CodingEnvironmentSnapshot,
  CodingReceiptView,
} from '@bazilion/api-types'
export type CodingRequest =
  | { action: 'environment'; target: string }
  | { action: 'start'; toolCallId: string; input: CodingCommandInput }
  | { action: 'finish'; id: string; outcome: CodingCommandOutcome }
  | { action: 'read'; id: string; messageId?: string }
  | { action: 'log'; id: string; messageId?: string; offset?: number; limit?: number }
  | { action: 'log-search'; id: string; messageId?: string; query: string }
export type CodingResponse =
  | CodingEnvironmentSnapshot
  | CodingCommandReceipt
  | CodingReceiptView
  | CodingCommandLogView
  | CodingCommandLogPage
  | CodingCommandLogSearchResult
export interface CodingHost {
  invoke(request: CodingRequest): Promise<CodingResponse>
}
