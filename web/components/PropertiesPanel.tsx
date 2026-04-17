"use client";

import { useEffect, useRef, useState } from "react";
import { query } from "@/lib/duckdb";
import { SaleCard, type Sale } from "@/components/SaleCard";
import { bboxSql, buildWhere, type Bbox, type Filters } from "@/lib/filters";

const PAGE_SIZE = 10;

interface Props {
  filters: Filters;
  /** When set (user has panned/zoomed the map), cards are spatially filtered
   *  to the current map viewport. null = no spatial restriction. */
  bbox?: Bbox | null;
}

export default function PropertiesPanel({ filters, bbox = null }: Props) {
  const key     = JSON.stringify(filters) + JSON.stringify(bbox);
  const baseKey = JSON.stringify(filters) + JSON.stringify(bbox); // same — used for count dep

  const [page, setPage]             = useState(0);
  const [rows, setRows]             = useState<Sale[] | null>(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState<string | null>(null);
  const [total, setTotal]           = useState<number | null>(null);
  const [countLoading, setCountLoading] = useState(false);

  // Reset page synchronously when key changes so the data effect fires with page=0.
  const prevKey = useRef(key);
  if (prevKey.current !== key) {
    prevKey.current = key;
    if (page !== 0) setPage(0);
  }

  // ── Data query ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const where  = buildWhere(filters);
    const spatial = bboxSql(bbox);
    // spatial is either "" or " AND lat BETWEEN ... AND lon BETWEEN ..."
    const fullWhere = where
      ? `${where}${spatial}`
      : spatial ? `WHERE 1=1${spatial}` : "";

    const offset = page * PAGE_SIZE;
    const sql = `
      SELECT * FROM sales
      ${fullWhere}
      ORDER BY sale_date DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `;

    setLoading(true);
    setError(null);
    let cancelled = false;

    query<Sale>(sql)
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        if (r.length < PAGE_SIZE) {
          setTotal(offset + r.length);
          setCountLoading(false);
        }
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page]);

  // ── Count query (fires only on filter/bbox change, not page turns) ──────────
  useEffect(() => {
    setTotal(null);
    setCountLoading(true);

    const where   = buildWhere(filters);
    const spatial = bboxSql(bbox);
    const fullWhere = where
      ? `${where}${spatial}`
      : spatial ? `WHERE 1=1${spatial}` : "";

    let cancelled = false;

    query<{ n: number }>(`SELECT COUNT(*)::INTEGER AS n FROM sales ${fullWhere}`)
      .then((r) => { if (!cancelled) setTotal(r[0]?.n ?? 0); })
      .catch(() => { if (!cancelled) setTotal(null); })
      .finally(() => { if (!cancelled) setCountLoading(false); });

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseKey]);

  // ── Derived display values ──────────────────────────────────────────────────
  const totalPages = total != null ? Math.ceil(total / PAGE_SIZE) : null;
  const from       = page * PAGE_SIZE + 1;
  const to         = Math.min((page + 1) * PAGE_SIZE, total ?? (page + 1) * PAGE_SIZE);
  const hasNext    = rows != null && rows.length === PAGE_SIZE;

  const PaginationBar = () => (
    <div className="flex items-center justify-between flex-wrap gap-2">
      <div className="text-sm text-slate-600">
        {loading ? (
          <span className="text-amber-600">Loading…</span>
        ) : rows && rows.length > 0 ? (
          <>
            Showing {from.toLocaleString("en-GB")}–{to.toLocaleString("en-GB")}
            {total != null ? (
              <> of <span className="font-semibold">{total.toLocaleString("en-GB")}</span> properties
                {bbox ? " in view" : ""}
              </>
            ) : countLoading ? (
              <span className="text-slate-400"> (counting…)</span>
            ) : null}
          </>
        ) : !loading && total === 0 ? (
          <span className="text-slate-400">No properties match these filters{bbox ? " in the current map view" : ""}.</span>
        ) : null}
      </div>

      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => setPage((p) => p - 1)}
          disabled={page === 0 || loading}
          className="px-3 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← Prev
        </button>
        <span className="text-slate-500 tabular-nums">
          {totalPages != null
            ? `${(page + 1).toLocaleString("en-GB")} / ${totalPages.toLocaleString("en-GB")}`
            : `Page ${page + 1}`}
        </span>
        <button
          onClick={() => setPage((p) => p + 1)}
          disabled={!hasNext || loading}
          className="px-3 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next →
        </button>
      </div>
    </div>
  );

  return (
    <section className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 space-y-4">
      <PaginationBar />

      {error && (
        <div className="text-red-600 text-xs font-mono whitespace-pre-wrap">{error}</div>
      )}

      {rows && rows.length > 0 && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {rows.map((sale) => (
            <SaleCard key={sale.id_mutation} sale={sale} />
          ))}
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="pt-2 border-t border-slate-100">
          <PaginationBar />
        </div>
      )}
    </section>
  );
}
