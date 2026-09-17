import { createHash } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { assertSchemaMatchesCanonicalChain } from '../../daemon/src/core/db/migrate.ts'

// BAZ-047/055: schema validation is delegated to the daemon's canonical
// migration chain — the ledger must list the complete chain and the schema
// objects must match the canonical replay. No hard-coded object list or
// fingerprint: a new forward migration cannot silently break backup restore,
// and there is nothing to recompute when the chain grows.

/** Prove the restored DB implements the complete current clean-install schema. */
export function assertCanonicalBackupSchema(db: DatabaseSync): void {
  assertSchemaMatchesCanonicalChain(db)
  // Result bytes are in the same SQLite snapshot as the provenance manifest.
  // Validate before restore publishes the staged home; read at most one file at a time.
  for (const row of db
    .prepare('SELECT id, bytes, byte_length, sha256 FROM agent_results WHERE deleted_at IS NULL')
    .iterate()) {
    const bytes = row.bytes
    if (
      !(bytes instanceof Uint8Array) ||
      bytes.byteLength !== row.byte_length ||
      createHash('sha256').update(bytes).digest('hex') !== row.sha256
    ) {
      throw new Error(`Result snapshot integrity verification failed: ${row.id}`)
    }
  }
}
