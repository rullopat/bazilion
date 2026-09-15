import type {
  CodingCommandInput,
  CodingCommandLogPage,
  CodingCommandLogSearchResult,
  CodingCommandLogView,
  CodingCommandOutcome,
  CodingCommandReceipt,
  CodingEnvironmentSnapshot,
  CodingReceiptView,
  SourceSnapshotCaptureResult,
} from '@bazilion/api-types'
export type CodingRequest =
  | { action: 'environment'; target: string }
  | { action: 'start'; toolCallId: string; input: CodingCommandInput }
  | { action: 'finish'; id: string; outcome: CodingCommandOutcome }
  | { action: 'read'; id: string; messageId?: string }
  | { action: 'log'; id: string; messageId?: string; offset?: number; limit?: number }
  | { action: 'log-search'; id: string; messageId?: string; query: string }
  /** BAZ-042: capture the source state the Agent is about to work from. */
  | { action: 'snapshot'; toolCallId: string; includeUntracked?: string[] }
export type CodingResponse =
  | CodingEnvironmentSnapshot
  | CodingCommandReceipt
  | CodingReceiptView
  | CodingCommandLogView
  | CodingCommandLogPage
  | CodingCommandLogSearchResult
  | SourceSnapshotCaptureResult
export interface CodingHost {
  invoke(request: CodingRequest): Promise<CodingResponse>
}
