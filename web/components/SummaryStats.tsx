"use client";

import { useEffect, useState } from "react";
import { query } from "@/lib/duckdb";
import { buildWhere, bboxSql, type Bbox, type Filters } from "@/lib/filters";

interface Props {
  filters: Filters;
  bbox?: Bbox | null;
}

interface StatsRow {
  n_sales: number;
  median_price: number | null;
  median_per_m2: number | null;
}

const N = "en-GB";

function Stat({ label, value, loading }: { label: string; value: string; loading: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-3 min-w-0">
      <span className={`text-2xl font-bold tracking-tight ${loading ? "text-slate-300" : "text-slate-800"}`}>
        {loading ? "—" : value}
      </span>
      <span className="text-xs text-slate-400 mt-0.5 whitespace-nowrap">{label}</span>
    </div>
  );
}

export default function SummaryStats({ filters, bbox = null }: Props) {
  const [stats, setStats] = useState<StatsRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const where   = buildWhere(filters);
    const spatial = bboxSql(bbox);
    const fullWhere = where ? `${where}${spatial}` : spatial ? `WHERE 1=1${spatial}` : "";

    setLoading(true);
    let cancelled = false;

    query<StatsRow>(`
      SELECT
        COUNT(*)::INTEGER                                             AS n_sales,
        ROUND(MEDIAN(price_eur))::INTEGER                            AS median_price,
        ROUND(MEDIAN(CASE WHEN price_per_m2 BETWEEN 100 AND 30000
                          THEN price_per_m2 END))::INTEGER           AS median_per_m2
      FROM sales
      ${fullWhere}
    `)
      .then((rows) => { if (!cancelled) setStats(rows[0] ?? null); })
      .catch(() => { if (!cancelled) setStats(null); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [JSON.stringify(filters), JSON.stringify(bbox)]); // eslint-disable-line react-hooks/exhaustive-deps

  const s = stats;

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex divide-x divide-slate-100">
      <Stat
        label="median sale price"
        value={s?.median_price != null ? `€${s.median_price.toLocaleString(N)}` : "—"}
        loading={loading}
      />
      <Stat
        label="median €/m²"
        value={s?.median_per_m2 != null ? `€${s.median_per_m2.toLocaleString(N)}` : "—"}
        loading={loading}
      />
      <Stat
        label="sales"
        value={s?.n_sales != null ? s.n_sales.toLocaleString(N) : "—"}
        loading={loading}
      />
    </div>
  );
}
