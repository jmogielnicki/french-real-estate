"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { query } from "@/lib/duckdb";
import {
  buildWhere,
  filterKey,
  PALETTE,
  splitConstraints,
  splitSQL,
  SPLIT_CATEGORIES,
  type Bbox,
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
  /** When set, queries are restricted to the current map viewport. */
  bbox?: Bbox | null;
}

const METRICS = [
  {
    key: "median_price",
    label: "Median sale price",
    format: (v: number) => `€${v.toLocaleString("fr-FR")}`,
    yFmt: (v: number) => `${(v / 1000).toFixed(0)}k`,
  },
  {
    key: "median_eur_per_m2",
    label: "Median €/m²",
    format: (v: number) => `€${v.toLocaleString("fr-FR")}/m²`,
    yFmt: (v: number) => `${v.toLocaleString("fr-FR")}`,
  },
  {
    key: "n_sales",
    label: "Number of sales",
    format: (v: number) => v.toLocaleString("fr-FR"),
    yFmt: (v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v),
  },
] as const;

export default function TrendChart({ filters, granularity, splitBy, bbox = null }: Props) {
  const [rows, setRows] = useState<LongRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const where = buildWhere(filters);
    const bucket = timeBucketSQL(granularity);
    const splitExpr = splitSQL(splitBy);
    const extras = splitConstraints(splitBy);

    const fullWhere = (() => {
      const parts: string[] = [];
      if (where) parts.push(where.replace(/^WHERE\s+/, ""));
      parts.push(...extras);
      // Spatial filter from map viewport
      if (bbox) {
        parts.push(`latitude  BETWEEN ${bbox.latMin}  AND ${bbox.latMax}`);
        parts.push(`longitude BETWEEN ${bbox.lonMin} AND ${bbox.lonMax}`);
      }
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

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey(filters, granularity, splitBy), JSON.stringify(bbox)]);

  const categories: string[] = useMemo(() => {
    if (splitBy === "none") return ["__all__"];
    const present = new Set(
      rows?.map((r) => r.category).filter(Boolean) as string[]
    );
    return SPLIT_CATEGORIES[splitBy].filter((c) => present.has(c));
  }, [rows, splitBy]);

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

  const isBar = granularity === "year";
  const Plot = isBar ? BarChart : LineChart;

  // For narrow sparkline columns, show far fewer X-axis ticks.
  const tickInterval = isBar
    ? 0
    : Math.max(0, Math.floor(data.length / 6));

  const totalSales = rows?.reduce((s, r) => s + (r.n_sales ?? 0), 0) ?? 0;

  const renderSeries = (metricKey: string) =>
    categories.map((cat, i) => {
      const dataKey = `${cat}__${metricKey}`;
      const name = cat === "__all__" ? "All" : cat;
      const color = PALETTE[i % PALETTE.length];
      return isBar ? (
        <Bar key={cat} dataKey={dataKey} name={name} fill={color} radius={[2, 2, 0, 0]} />
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
    <div className="space-y-3">
      {/* Status line */}
      <div className="text-xs text-slate-500 flex items-center gap-3">
        {running && <span className="text-amber-600">running…</span>}
        {rows && (
          <span>
            {data.length.toLocaleString()} {granularity} buckets
            {splitBy !== "none" && ` × ${categories.length} series`}
            {" · "}last query {elapsed?.toFixed(0)} ms
            {" · "}{totalSales.toLocaleString()} sales
            {bbox && <span className="text-blue-500 ml-1">· map view</span>}
          </span>
        )}
      </div>

      {!rows ? (
        <div className="text-slate-500 p-4">Loading…</div>
      ) : data.length === 0 ? (
        <div className="text-slate-500 p-4">No sales match these filters.</div>
      ) : (
        /* ── Sparkline grid: 1 column on mobile, 3 side-by-side on lg+ ── */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-6 gap-y-4">
          {METRICS.map((m) => (
            <div key={m.key} className="min-w-0">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                {m.label}
              </p>
              {/* aspect 2.0 → height ≈ width / 2 → compact sparkline */}
              <ResponsiveContainer width="100%" aspect={2.0}>
                <Plot
                  data={data}
                  margin={{ top: 4, right: 4, left: 0, bottom: isBar ? 4 : 20 }}
                >
                  {/* No CartesianGrid — sparkline style */}
                  <XAxis
                    dataKey="bucket"
                    interval={tickInterval}
                    angle={isBar ? 0 : -40}
                    textAnchor={isBar ? "middle" : "end"}
                    height={isBar ? 24 : 40}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={{ stroke: "#e2e8f0" }}
                    tickLine={false}
                  />
                  <YAxis
                    tickFormatter={m.yFmt}
                    width={46}
                    tick={{ fontSize: 10, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(v: number) => m.format(v)}
                    contentStyle={{
                      fontSize: 12,
                      borderRadius: 8,
                      border: "1px solid #e2e8f0",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                    }}
                    labelStyle={{ color: "#475569", marginBottom: 4 }}
                  />
                  {splitBy !== "none" && (
                    <Legend
                      wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                    />
                  )}
                  {renderSeries(m.key)}
                </Plot>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
