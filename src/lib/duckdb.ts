/**
 * DuckDB-WASM lazy-loader + query helper.
 *
 * The WASM runtime is ~7MB. We only instantiate it on first use (first
 * query), not on page load — this keeps time-to-first-paint fast.
 *
 * The `?url` imports below are Vite-specific: they emit the WASM/worker
 * files as static assets and hand us back URLs we can pass to DuckDB-WASM's
 * manual bundle selector.
 */
import * as duckdb from "@duckdb/duckdb-wasm";
import duckdb_wasm_mvp from "@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url";
import duckdb_wasm_eh from "@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url";
import worker_mvp from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";
import worker_eh from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: duckdb_wasm_mvp, mainWorker: worker_mvp },
  eh: { mainModule: duckdb_wasm_eh, mainWorker: worker_eh },
};

let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

export function getDuckDB(): Promise<duckdb.AsyncDuckDB> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
      const worker = new Worker(bundle.mainWorker!);
      const logger = new duckdb.ConsoleLogger();
      const db = new duckdb.AsyncDuckDB(logger, worker);
      await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      return db;
    })();
  }
  return dbPromise;
}

/**
 * Runs a SQL query and returns each row as a plain object. For typical query
 * sizes (< 100k rows) this is fine; for bigger we'd stream instead.
 */
export async function runSql<T = Record<string, unknown>>(
  sql: string,
): Promise<T[]> {
  const db = await getDuckDB();
  const conn = await db.connect();
  try {
    const table = await conn.query(sql);
    return table.toArray().map((r) => r.toJSON() as T);
  } finally {
    await conn.close();
  }
}
