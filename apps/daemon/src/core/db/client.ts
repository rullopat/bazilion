import { backup, DatabaseSync, type SQLInputValue } from 'node:sqlite'

export interface QueryStmt<RowType, ParamsType extends unknown[]> {
  get(...params: ParamsType): RowType | null
  all(...params: ParamsType): RowType[]
  run(...params: ParamsType): { changes: number; lastInsertRowid: number | bigint }
}

export interface QueryableDatabase {
  query<RowType, ParamsType extends unknown[]>(sql: string): QueryStmt<RowType, ParamsType>
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid: number | bigint }
  exec(sql: string): void
  transaction<T>(fn: () => T): () => T
}

export interface BazilionDb {
  raw: QueryableDatabase
  /**
   * Copy a transactionally-consistent image of the live database to `path`.
   * SQLite's online-backup API includes committed WAL contents without
   * requiring the daemon to close its connection or checkpoint the WAL.
   */
  backupTo(path: string): Promise<number>
  close(): void
}

function wrap(rawDb: DatabaseSync): QueryableDatabase {
  const cache = new Map<string, ReturnType<DatabaseSync['prepare']>>()
  let transactionDepth = 0
  let savepointSequence = 0
  function getStmt(sql: string) {
    let s = cache.get(sql)
    if (!s) {
      s = rawDb.prepare(sql)
      cache.set(sql, s)
    }
    return s
  }

  return {
    query<R, P extends unknown[]>(sql: string): QueryStmt<R, P> {
      const stmt = getStmt(sql)
      return {
        get(...params: P): R | null {
          const result = stmt.get(...(params as SQLInputValue[]))
          return (result as R | undefined) ?? null
        },
        all(...params: P): R[] {
          return stmt.all(...(params as SQLInputValue[])) as R[]
        },
        run(...params: P) {
          return stmt.run(...(params as SQLInputValue[])) as {
            changes: number
            lastInsertRowid: number | bigint
          }
        },
      }
    },
    run(sql, params) {
      const stmt = getStmt(sql)
      return stmt.run(...((params ?? []) as SQLInputValue[])) as {
        changes: number
        lastInsertRowid: number | bigint
      }
    },
    exec(sql) {
      rawDb.exec(sql)
    },
    // node:sqlite has no callable `transaction` wrapper; use manual BEGIN/COMMIT/ROLLBACK.
    transaction<T>(fn: () => T): () => T {
      return () => {
        const outermost = transactionDepth === 0
        const savepoint = outermost ? null : `bazilion_nested_${++savepointSequence}`
        if (outermost) rawDb.exec('BEGIN')
        else rawDb.exec(`SAVEPOINT ${savepoint}`)
        transactionDepth++
        try {
          const result = fn()
          if (outermost) rawDb.exec('COMMIT')
          else rawDb.exec(`RELEASE SAVEPOINT ${savepoint}`)
          return result
        } catch (err) {
          if (outermost) rawDb.exec('ROLLBACK')
          else {
            rawDb.exec(`ROLLBACK TO SAVEPOINT ${savepoint}`)
            rawDb.exec(`RELEASE SAVEPOINT ${savepoint}`)
          }
          throw err
        } finally {
          transactionDepth--
        }
      }
    },
  }
}

function applyPragmas(rawDb: DatabaseSync, includeWal: boolean): void {
  if (includeWal) {
    try {
      rawDb.exec('PRAGMA journal_mode = WAL')
    } catch {
      // some sqlite builds reject WAL on :memory: — ignore
    }
  }
  rawDb.exec('PRAGMA foreign_keys = ON')
}

export function openDb(path: string): BazilionDb {
  // Bazilion is the normal sole writer, but online backups and operator-side
  // diagnostics can briefly overlap another WAL connection. Wait for those
  // transient locks instead of turning unrelated reads/writes (including
  // token usage telemetry) into immediate SQLITE_BUSY failures.
  const raw = new DatabaseSync(path, { timeout: 5_000 })
  applyPragmas(raw, true)
  return {
    raw: wrap(raw),
    backupTo(path) {
      return backup(raw, path)
    },
    close() {
      raw.close()
    },
  }
}

export function openInMemoryDb(): BazilionDb {
  const raw = new DatabaseSync(':memory:')
  applyPragmas(raw, false)
  return {
    raw: wrap(raw),
    backupTo(path) {
      return backup(raw, path)
    },
    close() {
      raw.close()
    },
  }
}

export function inTx<T>(db: BazilionDb, fn: () => T): T {
  return db.raw.transaction(fn)()
}
