import initSqlJs, { type Database, type SqlJsStatic, type SqlValue as SqlJsValue } from 'sql.js';
import type { PackDatabase, SqlValue } from './offline-locality-resolver';

let sqlPromise: Promise<SqlJsStatic> | null = null;

/** Loads the sql.js WebAssembly module once per worker. */
export function loadSqlJs(wasmUrl: string): Promise<SqlJsStatic> {
  sqlPromise ??= initSqlJs({ locateFile: () => wasmUrl }).catch((error: unknown) => {
    sqlPromise = null;
    throw error;
  });
  return sqlPromise;
}

export function wrapDatabase(db: Database): PackDatabase {
  return {
    query(sql: string, params?: readonly SqlValue[]): SqlValue[][] {
      const statement = db.prepare(sql);
      try {
        if (params) statement.bind(params as SqlJsValue[]);
        const rows: SqlValue[][] = [];
        while (statement.step()) rows.push(statement.get() as SqlValue[]);
        return rows;
      } finally {
        statement.free();
      }
    },
  };
}
