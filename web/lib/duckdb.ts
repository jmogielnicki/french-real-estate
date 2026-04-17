"use client";

import * as duckdb from "@duckdb/duckdb-wasm";

// Singleton: only initialize the database once per page load.
let dbPromise: Promise<duckdb.AsyncDuckDB> | null = null;

// In local dev, the parquet is symlinked into public/data/.
// For production, set NEXT_PUBLIC_PARQUET_URL to the R2/Blob URL.
const PARQUET_URL =
  process.env.NEXT_PUBLIC_PARQUET_URL ?? "/data/sales_residential.parquet";

export async function getDB(): Promise<duckdb.AsyncDuckDB> {
  if (dbPromise) return dbPromise;

  dbPromise = (async () => {
    // Ask duckdb-wasm to pick the right WASM bundle for this browser.
    const bundles = duckdb.getJsDelivrBundles();
    const bundle = await duckdb.selectBundle(bundles);

    // The worker URL is a CDN URL to the worker JS. We wrap it in a Blob
    // so the worker is same-origin (avoids CSP / cross-origin worker errors).
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker!}");`], {
        type: "text/javascript",
      })
    );
    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger();
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    // Register the parquet file URL so DuckDB can fetch byte ranges from it.
    const url = new URL(PARQUET_URL, window.location.href).toString();
    await db.registerFileURL(
      "sales.parquet",
      url,
      duckdb.DuckDBDataProtocol.HTTP,
      false
    );

    // Create a stable view over the parquet for cleaner queries.
    const conn = await db.connect();
    await conn.query(
      `CREATE OR REPLACE VIEW sales AS SELECT * FROM read_parquet('sales.parquet')`
    );
    await conn.close();
    return db;
  })();
  return dbPromise;
}

/**
 * Run a SQL query and return the result as an array of plain objects.
 * Convenient for charting libraries; not memory-efficient for huge results.
 */
export async function query<T = Record<string, unknown>>(
  sql: string
): Promise<T[]> {
  const db = await getDB();
  const conn = await db.connect();
  try {
    const result = await conn.query(sql);
    return result.toArray().map((row) => row.toJSON() as T);
  } finally {
    await conn.close();
  }
}
