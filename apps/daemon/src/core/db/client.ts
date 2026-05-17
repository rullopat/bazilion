import { DatabaseSync, type SQLInputValue } from 'node:sqlite'

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
  close(): void
}

function wrap(rawDb: DatabaseSync): QueryableDatabase {
  const cache = new Map<string, ReturnType<DatabaseSync['prepare']>>()
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
        rawDb.exec('BEGIN')
        try {
          const result = fn()
          rawDb.exec('COMMIT')
          return result
        } catch (err) {
          rawDb.exec('ROLLBACK')
          throw err
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
  const raw = new DatabaseSync(path)
  applyPragmas(raw, true)
  return {
    raw: wrap(raw),
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
    close() {
      raw.close()
    },
  }
}

export function inTx<T>(db: BazilionDb, fn: () => T): T {
  return db.raw.transaction(fn)()
}
