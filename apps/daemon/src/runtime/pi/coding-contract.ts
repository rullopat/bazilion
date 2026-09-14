import type {
  CodingCommandInput,
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
export type CodingResponse = CodingEnvironmentSnapshot | CodingCommandReceipt | CodingReceiptView
export interface CodingHost {
  invoke(request: CodingRequest): Promise<CodingResponse>
}
