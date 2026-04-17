"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { query } from "@/lib/duckdb";
import {
  buildWhere,
  filterKey,
  PALETTE,
  splitConstraints,
  splitSQL,
  SPLIT_CATEGORIES,
  type Filters,
  type Granularity,
  type SplitBy,
  timeBucketSQL,
} from "@/lib/filters";

interface LongRow {
  bucket: string;
  category: string | null;
  n_sales: number;
  median_price: number | null;
  median_eur_per_m2: number | null;
}

type WideRow = { bucket: string } & Record<string, number | string | null>;

interface Props {
  filters: Filters;
  granularity: Granularity;
  splitBy: SplitBy;
}

const METRICS = [
  { key: "median_price", label: "Median sale price", format: (v: number) => `€${v.toLocaleString()}`, yFmt: (v: number) => `${(v / 1000).toFixed(0)}k` },
  { key: "median_eur_per_m2", label: "Median €/m²", format: (v: number) => `€${v.toLocaleString()}/m²`, yFmt: (v: number) => `${v}` },
  { key: "n_sales", label: "Number of sales", format: (v: number) => v.toLocaleString(), yFmt: (v: number) => v.toLocaleString() },
] as const;

export default function TrendChart({ filters, granularity, splitBy }: Props) {
  const [rows, setRows] = useState<LongRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const where = buildWhere(filters);
    const bucket = timeBucketSQL(granularity);
    const splitExpr = splitSQL(splitBy);
    const extras = splitConstraints(splitBy);

    // Fold splitConstraints into the WHERE clause.
    const fullWhere = (() => {
      const parts: string[] = [];
      if (where) parts.push(where.replace(/^WHERE\s+/, ""));
      parts.push(...extras);
      return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
    })();

    const sql = splitExpr
      ? `
        SELECT
          ${bucket}                                                    AS bucket,
          ${splitExpr}                                                 AS category,
          COUNT(*)::INTEGER                                            AS n_sales,
          ROUND(MEDIAN(price_eur))::INTEGER                            AS median_price,
          ROUND(MEDIAN(CASE WHEN price_per_m2 BETWEEN 100 AND 30000
                            THEN price_per_m2 END))::INTEGER           AS median_eur_per_m2
        FROM sales
        ${fullWhere}
        GROUP BY bucket, category
        HAVING category IS NOT NULL
        ORDER BY bucket, category
      `
      : `
        SELECT
          ${bucket}                                                    AS bucket,
          NULL                                                         AS category,
          COUNT(*)::INTEGER                                            AS n_sales,
          ROUND(MEDIAN(price_eur))::INTEGER                            AS median_price,
          ROUND(MEDIAN(CASE WHEN price_per_m2 BETWEEN 100 AND 30000
                            THEN price_per_m2 END))::INTEGER           AS median_eur_per_m2
        FROM sales
        ${fullWhere}
        GROUP BY bucket
        ORDER BY bucket
      `;

    setRunning(true);
    setError(null);
    const t0 = performance.now();
    let cancelled = false;

    query<LongRow>(sql)
      .then((r) => {
        if (cancelled) return;
        setRows(r);
        setElapsed(performance.now() - t0);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setRunning(false));

    return () => {
      cancelled = true;
    };
  }, [filterKey(filters, granularity, splitBy)]);

  // Categories actually present in the data (in stable display order).
  const categories: string[] = useMemo(() => {
    if (splitBy === "none") return ["__all__"];
    const present = new Set(rows?.map((r) => r.category).filter(Boolean) as string[]);
    return SPLIT_CATEGORIES[splitBy].filter((c) => present.has(c));
  }, [rows, splitBy]);

  // Pivot long → wide for Recharts.
  const data: WideRow[] = useMemo(() => {
    if (!rows) return [];
    const byBucket = new Map<string, WideRow>();
    for (const r of rows) {
      if (!byBucket.has(r.bucket)) byBucket.set(r.bucket, { bucket: r.bucket });
      const w = byBucket.get(r.bucket)!;
      const cat = splitBy === "none" ? "__all__" : r.category ?? "__null__";
      for (const m of METRICS) {
        w[`${cat}__${m.key}`] = (r as unknown as Record<string, number | null>)[m.key];
      }
    }
    return [...byBucket.values()].sort((a, b) =>
      String(a.bucket).localeCompare(String(b.bucket))
    );
  }, [rows, splitBy]);

  if (error) {
    return (
      <div className="text-red-600 p-4 font-mono text-xs whitespace-pre-wrap">
        {error}
      </div>
    );
  }

  const Plot = granularity === "year" ? BarChart : LineChart;
  const tickInterval =
    granularity === "year" ? 0 : Math.max(0, Math.floor(data.length / 12));
  const totalSales = rows?.reduce((s, r) => s + (r.n_sales ?? 0), 0) ?? 0;

  const renderSeries = (metricKey: string) =>
    categories.map((cat, i) => {
      const dataKey = `${cat}__${metricKey}`;
      const name = cat === "__all__" ? "All" : cat;
      const color = PALETTE[i % PALETTE.length];
      return granularity === "year" ? (
        <Bar key={cat} dataKey={dataKey} name={name} fill={color} />
      ) : (
        <Line
          key={cat}
          dataKey={dataKey}
          name={name}
          stroke={color}
          dot={false}
          strokeWidth={2}
        />
      );
    });

  return (
    <div className="space-y-4">
      <div className="text-xs text-slate-500 flex items-center gap-3">
        {running && <span className="text-amber-600">running…</span>}
        {rows && (
          <span>
            {data.length.toLocaleString()} {granularity} buckets
            {splitBy !== "none" && ` × ${categories.length} series`} · last query{" "}
            {elapsed?.toFixed(0)} ms · {totalSales.toLocaleString()} sales
          </span>
        )}
      </div>

      {!rows ? (
        <div className="text-slate-500 p-4">Loading…</div>
      ) : data.length === 0 ? (
        <div className="text-slate-500 p-4">No sales match these filters.</div>
      ) : (
        METRICS.map((m) => (
          <div key={m.key}>
            <h3 className="font-medium mb-1 text-sm">{m.label}</h3>
            <ResponsiveContainer width="100%" height={220}>
              <Plot data={data} margin={{ top: 5, right: 10, left: 0, bottom: granularity === "year" ? 5 : 25 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="bucket"
                  interval={tickInterval}
                  angle={granularity === "year" ? 0 : -45}
                  textAnchor={granularity === "year" ? "middle" : "end"}
                  height={granularity === "year" ? 30 : 50}
                  tick={{ fontSize: 11 }}
                />
                <YAxis tickFormatter={m.yFmt} />
                <Tooltip formatter={(v: number) => m.format(v)} />
                {splitBy !== "none" && <Legend wrapperStyle={{ fontSize: 12 }} />}
                {renderSeries(m.key)}
              </Plot>
            </ResponsiveContainer>
          </div>
        ))
      )}
    </div>
  );
}
