"use client";

import { useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { query } from "@/lib/duckdb";

type Row = {
  year: number;
  n_sales: number;
  median_price: number;
  median_eur_per_m2: number;
};

export default function PriceByYearChart() {
  const [data, setData] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState<number | null>(null);

  useEffect(() => {
    const t0 = performance.now();
    query<Row>(`
      SELECT
        year,
        COUNT(*)::INTEGER                   AS n_sales,
        ROUND(MEDIAN(price_eur))::INTEGER   AS median_price,
        ROUND(MEDIAN(price_per_m2))::INTEGER AS median_eur_per_m2
      FROM sales
      WHERE price_per_m2 BETWEEN 100 AND 30000
      GROUP BY year
      ORDER BY year
    `)
      .then((rows) => {
        setData(rows);
        setElapsed(performance.now() - t0);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="text-red-600 p-4">Error: {error}</div>;
  if (!data) return <div className="p-4 text-slate-500">Loading DuckDB + Parquet…</div>;

  return (
    <div className="space-y-4">
      <div className="text-sm text-slate-500">
        Query returned {data.length} rows in {elapsed?.toFixed(0)} ms (cold load
        includes WASM init + Parquet metadata fetch).
      </div>

      <div>
        <h3 className="font-medium mb-2">Median sale price by year (€)</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" />
            <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip
              formatter={(v: number) => `€${v.toLocaleString()}`}
            />
            <Bar dataKey="median_price" fill="#3b82f6" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="font-medium mb-2">Median €/m² by year</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" />
            <YAxis />
            <Tooltip formatter={(v: number) => `€${v.toLocaleString()}/m²`} />
            <Bar dataKey="median_eur_per_m2" fill="#10b981" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h3 className="font-medium mb-2">Number of sales by year</h3>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" />
            <YAxis tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v: number) => v.toLocaleString()} />
            <Bar dataKey="n_sales" fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
