import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

const CANONICAL_MIGRATION = '0001_init'
const CANONICAL_SCHEMA_HASH = 'b92632c61dae6d7b885ddfc7b19d814caa32a61571f9cd42dab2531007f206e3'

// Explicit objects created by migrate.ts + 0001_init.sql. SQLite's implicit
// auto-indexes have `sql = NULL` and are deliberately represented through the
// table SQL that creates their UNIQUE/PRIMARY KEY constraints.
const CANONICAL_OBJECTS = [
  ['index', 'agent_triggers_agent'],
  ['index', 'agent_triggers_enabled'],
  ['index', 'agent_loop_break_events_agent_time'],
  ['index', 'agent_loop_break_events_team_time'],
  ['index', 'agent_lesson_proposals_agent_status_time'],
  ['index', 'agent_lesson_proposals_review'],
  ['index', 'agent_reviews_agent_time'],
  ['index', 'agent_reviews_claimable'],
  ['index', 'agent_reviews_one_open_per_agent'],
  ['index', 'communication_approval_events_attempt'],
  ['index', 'communication_approvals_queue'],
  ['index', 'communication_approvals_teams'],
  ['index', 'idx_agents_telegram_topic_id'],
  ['index', 'idx_provider_models_provider'],
  ['index', 'messages_policy_delivery_queue'],
  ['index', 'messages_causal_chain'],
  ['index', 'messages_to_unread'],
  ['index', 'team_policy_baseline_owner'],
  ['index', 'team_policy_blocks_team_time'],
  ['index', 'team_template_active_position'],
  ['index', 'trigger_dispatches_claimable'],
  ['index', 'trigger_dispatches_trigger_time'],
  ['index', 'web_tokens_active'],
  ['table', 'agent_skills'],
  ['table', 'agent_loop_break_events'],
  ['table', 'agent_lesson_proposals'],
  ['table', 'agent_reviews'],
  ['table', 'agent_triggers'],
  ['table', 'agents'],
  ['table', 'attention_acknowledgements'],
  ['table', 'communication_approval_events'],
  ['table', 'communication_approval_message_grants'],
  ['table', 'communication_approvals'],
  ['table', 'config'],
  ['table', 'mcp_servers'],
  ['table', 'messages'],
  ['table', 'profile_communication_defaults'],
  ['table', 'profile_default_skills'],
  ['table', 'profiles'],
  ['table', 'provider_models'],
  ['table', 'provider_state'],
  ['table', 'schema_migrations'],
  ['table', 'secrets'],
  ['table', 'skill_meta'],
  ['table', 'source_slot_bindings'],
  ['table', 'team_agent_state'],
  ['table', 'team_policies'],
  ['table', 'team_policy_block_events'],
  ['table', 'team_policy_edges'],
  ['table', 'team_template_edges'],
  ['table', 'team_template_revision_edges'],
  ['table', 'team_template_revision_slots'],
  ['table', 'team_template_revisions'],
  ['table', 'team_template_slots'],
  ['table', 'team_templates'],
  ['table', 'teams'],
  ['table', 'telegram_allowed_users'],
  ['table', 'telegram_pairing_challenge'],
  ['table', 'template_instantiations'],
  ['table', 'trigger_dispatches'],
  ['table', 'web_tokens'],
  ['trigger', 'create_team_policy'],
  ['trigger', 'prevent_detached_team_policy_delete'],
  ['trigger', 'validate_source_binding_insert'],
  ['trigger', 'validate_team_agent_state_insert'],
  ['trigger', 'validate_team_policy_baseline_update'],
  ['trigger', 'validate_team_policy_edge_insert'],
  ['trigger', 'validate_team_template_edge_insert'],
] as const

interface SchemaRow {
  type: string
  name: string
  tbl_name: string
  sql: string
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim()
}

/** Prove the restored DB implements the complete current clean-install schema. */
export function assertCanonicalBackupSchema(db: DatabaseSync): void {
  const migrations = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: string }>
  if (migrations.length !== 1 || migrations[0]?.version !== CANONICAL_MIGRATION) {
    throw new Error(
      `schema_migrations must contain exactly ${CANONICAL_MIGRATION}; found ` +
        (migrations.map((row) => row.version).join(', ') || 'none'),
    )
  }

  const rows = db
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_schema
       WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'`,
    )
    .all() as unknown as SchemaRow[]
  const byKey = new Map(rows.map((row) => [`${row.type}\0${row.name}`, row]))
  const canonicalKeys = new Set(CANONICAL_OBJECTS.map(([type, name]) => `${type}\0${name}`))
  for (const row of rows) {
    if (!canonicalKeys.has(`${row.type}\0${row.name}`)) {
      throw new Error(`unexpected schema ${row.type} is not canonical: ${row.name}`)
    }
  }
  const canonicalRows: SchemaRow[] = []

  for (const [type, name] of CANONICAL_OBJECTS) {
    const row = byKey.get(`${type}\0${name}`)
    if (!row) throw new Error(`required canonical schema ${type} is missing: ${name}`)
    canonicalRows.push(row)
  }

  const payload = canonicalRows
    .map((row) => [row.type, row.name, row.tbl_name, normalizeSql(row.sql)].join('\0'))
    .join('\n')
  const actualHash = createHash('sha256').update(payload).digest('hex')
  if (actualHash !== CANONICAL_SCHEMA_HASH) {
    throw new Error(
      'canonical schema fingerprint does not match this Bazilion release; ' +
        'restore a backup created from the current clean-install schema',
    )
  }
}
