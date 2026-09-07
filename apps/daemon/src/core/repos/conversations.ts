import type {
  Conversation,
  ConversationListResponse,
  ConversationSelection,
  NewConversationInput,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

const columns =
  'id, agent_id AS agentId, title, title_revision AS titleRevision, created_at AS createdAt, updated_at AS updatedAt'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export class ConversationRequestConflictError extends Error {
  readonly code = 'conversation_request_conflict'
  constructor() {
    super('Conversation request identity was reused with different input')
  }
}

export class ConversationConflictError extends Error {
  readonly code = 'conversation_conflict'
  constructor(readonly selection: ConversationSelection) {
    super('Conversation changed. Refresh and review your draft before sending again.')
  }
}

export function selection(db: BazilionDb, agentId: string): ConversationSelection {
  return (
    db.raw
      .query<ConversationSelection, [string]>(
        'SELECT conversation_id AS conversationId, revision FROM agent_conversation_selection WHERE agent_id = ?',
      )
      .get(agentId) ?? { conversationId: null, revision: 0 }
  )
}

export function assertSelection(
  db: BazilionDb,
  agentId: string,
  expected: ConversationSelection,
): void {
  const actual = selection(db, agentId)
  if (
    !expected ||
    expected.conversationId !== actual.conversationId ||
    expected.revision !== actual.revision
  )
    throw new ConversationConflictError(actual)
}

export function get(db: BazilionDb, agentId: string, id: string): Conversation | null {
  return db.raw
    .query<Conversation, [string, string]>(
      `SELECT ${columns} FROM agent_conversations WHERE agent_id = ? AND id = ?`,
    )
    .get(agentId, id)
}

export function filename(db: BazilionDb, agentId: string, id: string): string {
  const row = db.raw
    .query<{ filename: string }, [string, string]>(
      'SELECT filename FROM agent_conversations WHERE agent_id = ? AND id = ?',
    )
    .get(agentId, id)
  if (!row) throw new Error('Conversation not found')
  return row.filename
}

export function list(
  db: BazilionDb,
  agentId: string,
  limit = 20,
  offset = 0,
): ConversationListResponse {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new Error('Invalid conversation pagination')
  const conversations = db.raw
    .query<Conversation, [string, number, number]>(
      `SELECT ${columns} FROM agent_conversations WHERE agent_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?`,
    )
    .all(agentId, limit, offset)
  const total =
    db.raw
      .query<{ n: number }, [string]>(
        'SELECT COUNT(*) AS n FROM agent_conversations WHERE agent_id = ?',
      )
      .get(agentId)?.n ?? 0
  return { conversations, selection: selection(db, agentId), total, offset, limit }
}

function title(value: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 200 ||
    Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  )
    throw new Error('Conversation title must be 1–200 characters without control characters')
  return value.trim()
}

/** Creation holds the Agent lifecycle lease; an existing request only reconciles its receipt. */
export function create(
  db: BazilionDb,
  agentId: string,
  input: NewConversationInput,
  persistFile: (id: string) => string,
): { conversation: Conversation; selection: ConversationSelection } {
  if (!uuid.test(input.requestId)) throw new Error('Conversation requestId must be a UUID')
  if (
    !input.expectedSelection ||
    !Number.isSafeInteger(input.expectedSelection.revision) ||
    input.expectedSelection.revision < 0 ||
    (input.expectedSelection.conversationId !== null &&
      (typeof input.expectedSelection.conversationId !== 'string' ||
        !uuid.test(input.expectedSelection.conversationId)))
  )
    throw new Error('Invalid expected conversation selection')
  const initialTitle = input.title === undefined ? null : title(input.title)
  return db.raw.transaction(() => {
    const existing = db.raw
      .query<
        {
          agentId: string
          initialTitle: string | null
          revision: number
          conversationId: string | null
        },
        [string]
      >(
        'SELECT agent_id AS agentId, initial_title AS initialTitle, creation_revision AS revision, creation_conversation_id AS conversationId FROM agent_conversations WHERE id = ?',
      )
      .get(input.requestId)
    if (existing) {
      if (
        existing.agentId !== agentId ||
        existing.initialTitle !== initialTitle ||
        existing.revision !== input.expectedSelection.revision ||
        existing.conversationId !== input.expectedSelection.conversationId
      )
        throw new ConversationRequestConflictError()
      const conversation = get(db, agentId, input.requestId)
      if (!conversation) throw new Error('Conversation not found')
      // A retry after a later New conversation must never reselect the old one.
      return { conversation, selection: selection(db, agentId) }
    }
    assertSelection(db, agentId, input.expectedSelection)
    if (!db.raw.query<{ id: string }, [string]>('SELECT id FROM agents WHERE id = ?').get(agentId))
      throw new Error('Agent not found')
    const now = Date.now()
    const displayTitle = initialTitle ?? `Conversation ${list(db, agentId, 1).total + 1}`
    const file = persistFile(input.requestId)
    if (file !== `${input.requestId}.jsonl`)
      throw new Error('Invalid canonical conversation filename')
    db.raw.run(
      `INSERT INTO agent_conversations
      (id, agent_id, filename, title, initial_title, creation_revision, creation_conversation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.requestId,
        agentId,
        file,
        displayTitle,
        initialTitle,
        input.expectedSelection.revision,
        input.expectedSelection.conversationId,
        now,
        now,
      ],
    )
    db.raw.run(
      `INSERT INTO agent_conversation_selection (agent_id, conversation_id, revision)
      VALUES (?, ?, ?) ON CONFLICT(agent_id) DO UPDATE SET conversation_id = excluded.conversation_id, revision = excluded.revision`,
      [agentId, input.requestId, input.expectedSelection.revision + 1],
    )
    const conversation = get(db, agentId, input.requestId)
    if (!conversation) throw new Error('Conversation publication failed')
    return { conversation, selection: selection(db, agentId) }
  })()
}

export function rename(
  db: BazilionDb,
  agentId: string,
  id: string,
  value: string,
  expectedRevision: number,
): Conversation {
  const displayTitle = title(value)
  const changed = db.raw.run(
    `UPDATE agent_conversations SET title = ?, title_revision = title_revision + 1, updated_at = ?
    WHERE agent_id = ? AND id = ? AND title_revision = ?`,
    [displayTitle, Date.now(), agentId, id, expectedRevision],
  )
  if (!changed.changes)
    throw new Error('Conversation title changed or is unavailable; reload before renaming')
  const conversation = get(db, agentId, id)
  if (!conversation) throw new Error('Conversation not found')
  return conversation
}
