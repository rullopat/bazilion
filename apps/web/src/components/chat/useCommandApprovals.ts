// Shell command approvals in one Agent's chat: Allow or Deny on a pending command, checked with
// the daemon when the answer is lost, and a turn's pending ones shown again after a navigation.

import type {
  CommandApproval,
  CommandApprovalDecisionResponse,
  ListCommandApprovalsResponse,
} from '@bazilion/api-types'
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from 'react'
import { api, errorMessage } from '../../lib/api'
import { type RenderEntry, shellApprovalsUrl, upsertCommandApprovalEntry } from './entries'

export function useCommandApprovals({
  agentId,
  setLive,
}: {
  agentId: string
  /** Sets the live turn's entries, where the approvals show. */
  setLive: Dispatch<SetStateAction<RenderEntry[]>>
}) {
  // A turn this tab is not streaming but still holds a pending shell approval.
  const [recoveredTurn, setRecoveredTurn] = useState(false)
  const [approvalBusy, setApprovalBusy] = useState<Record<string, boolean>>({})
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({})
  // The turn on screen holds a shell approval: a stream that ends early leaves it running.
  const approvalTurnRef = useRef(false)

  // A navigation cannot reopen the stream, but the daemon keeps the turn and its pending shell
  // approvals alive: show them again.
  useEffect(() => {
    const controller = new AbortController()
    api<ListCommandApprovalsResponse>(shellApprovalsUrl(agentId), { signal: controller.signal })
      .then(({ approvals }) => {
        const pending = approvals.filter(
          (approval) => approval.agentId === agentId && approval.status === 'pending',
        )
        if (pending.length === 0) return
        approvalTurnRef.current = true
        setLive((entries) => pending.reduce(upsertCommandApprovalEntry, entries))
        setRecoveredTurn(true)
      })
      .catch(() => {
        // Best effort: a live stream delivers the same approvals.
      })
    return () => controller.abort()
  }, [agentId, setLive])

  async function reconcileApproval(id: string): Promise<CommandApproval | null> {
    try {
      const { approvals } = await api<ListCommandApprovalsResponse>(shellApprovalsUrl(agentId))
      const approval = approvals.find((item) => item.id === id && item.agentId === agentId)
      if (approval) setLive((entries) => upsertCommandApprovalEntry(entries, approval))
      return approval ?? null
    } catch {
      return null
    }
  }

  async function decide(
    approval: CommandApproval,
    decision: 'allow' | 'deny',
    remember?: { prefix: string },
  ) {
    if (approval.agentId !== agentId || approval.status !== 'pending') return
    setApprovalBusy((current) => ({ ...current, [approval.id]: true }))
    setApprovalErrors(({ [approval.id]: _cleared, ...rest }) => rest)
    try {
      const body = await api<CommandApprovalDecisionResponse>(
        `/api/shell-approvals/${encodeURIComponent(approval.id)}`,
        { body: remember ? { decision, remember } : { decision } },
      )
      if (body.approval.agentId === agentId) {
        setLive((entries) => upsertCommandApprovalEntry(entries, body.approval))
      }
    } catch (error) {
      // The one-shot decision may have been applied before the response was lost: look before
      // offering it again, so Allow never looks pending after the command started.
      const current = await reconcileApproval(approval.id)
      if (!current || current.status === 'pending') {
        setApprovalErrors((errors) => ({ ...errors, [approval.id]: errorMessage(error) }))
      }
    } finally {
      setApprovalBusy((current) => ({ ...current, [approval.id]: false }))
    }
  }

  return {
    recoveredTurn,
    setRecoveredTurn,
    approvalTurnRef,
    approvalBusy,
    approvalErrors,
    decide,
    /** A turn starts or ends: no approval is being decided or failed any more. */
    resetApprovals: () => {
      setApprovalBusy({})
      setApprovalErrors({})
    },
  }
}
