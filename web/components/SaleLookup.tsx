"use client";

import { useEffect, useRef, useState } from "react";
import { query } from "@/lib/duckdb";
import { fmt, formatSaleDate, SaleCard, type Sale } from "@/components/SaleCard";

// Compact table for browsing
function BrowseTable({
  rows,
  onSelect,
}: {
  rows: Sale[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="bg-slate-50 border-b border-slate-200 text-left text-slate-600">
            {[
              "Mutation ID",
              "Date",
              "Commune",
              "Composition",
              "Price",
              "Area",
              "€/m²",
            ].map((h) => (
              <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.id_mutation}
              className="border-b border-slate-100 last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
              onClick={() => onSelect(r.id_mutation)}
            >
              <td className="px-3 py-2 font-mono text-slate-700">
                {r.id_mutation}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-slate-600">
                {formatSaleDate(r.sale_date, { iso: true })}
              </td>
              <td className="px-3 py-2 text-slate-700">
                {r.commune_name} ({r.department_code})
              </td>
              <td className="px-3 py-2 text-slate-600 font-mono">
                {r.composition ?? r.primary_type}
              </td>
              <td className="px-3 py-2 text-right text-slate-700 whitespace-nowrap">
                {fmt.eur(r.price_eur)}
              </td>
              <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">
                {fmt.m2(r.built_area_m2)}
              </td>
              <td className="px-3 py-2 text-right text-slate-600 whitespace-nowrap">
                {r.price_per_m2 != null
                  ? `€${Math.round(r.price_per_m2).toLocaleString("en-GB")}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SaleLookup() {
  const [input, setInput] = useState("");
  const [result, setResult] = useState<Sale | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [communeFilter, setCommuneFilter] = useState("");
  const [browseRows, setBrowseRows] = useState<Sale[]>([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const browseDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch browse rows whenever commune filter changes (debounced)
  useEffect(() => {
    if (browseDebounce.current) clearTimeout(browseDebounce.current);
    browseDebounce.current = setTimeout(() => {
      setBrowseLoading(true);
      const whereClause = communeFilter.trim()
        ? `WHERE LOWER(commune_name) LIKE LOWER('%${communeFilter.replace(/'/g, "''")}%')`
        : "";
      query<Sale>(`
        SELECT * FROM sales
        ${whereClause}
        ORDER BY sale_date DESC
        LIMIT 50
      `)
        .then(setBrowseRows)
        .catch((e) => console.error(e))
        .finally(() => setBrowseLoading(false));
    }, 350);
  }, [communeFilter]);

  const handleSearch = (id?: string) => {
    const searchTerm = (id ?? input).trim();
    if (!searchTerm) return;
    setSearching(true);
    setSearchError(null);
    setNotFound(false);
    setResult(null);
    setInput(searchTerm);

    query<Sale>(
      `SELECT * FROM sales WHERE id_mutation = '${searchTerm.replace(/'/g, "''")}' LIMIT 1`
    )
      .then((rows) => {
        if (rows.length === 0) setNotFound(true);
        else setResult(rows[0]);
      })
      .catch((e) => setSearchError(String(e)))
      .finally(() => setSearching(false));
  };

  return (
    <div className="space-y-6">
      {/* Search bar */}
      <div className="space-y-1">
        <label className="text-sm font-medium text-slate-700">
          Look up by mutation ID
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="e.g. 2023A12345"
            className="flex-1 border border-slate-300 rounded px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={() => handleSearch()}
            disabled={searching}
            className="px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            {searching ? "Searching…" : "Look up"}
          </button>
        </div>
      </div>

      {/* Search result */}
      {searchError && <p className="text-red-600 text-sm">{searchError}</p>}
      {notFound && (
        <p className="text-slate-500 text-sm">
          No sale found with ID &ldquo;{input}&rdquo;.
        </p>
      )}
      {result && (
        <SaleCard
          sale={result}
          onClose={() => {
            setResult(null);
            setInput("");
            setNotFound(false);
          }}
        />
      )}

      {/* Browse / discover */}
      <div className="space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h3 className="text-sm font-medium text-slate-700">
            Browse recent sales
            <span className="text-slate-400 font-normal ml-1">
              (click a row to look it up)
            </span>
          </h3>
          <input
            type="text"
            value={communeFilter}
            onChange={(e) => setCommuneFilter(e.target.value)}
            placeholder="Filter by commune…"
            className="border border-slate-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
          />
        </div>
        {browseLoading ? (
          <p className="text-slate-400 text-sm py-4">Loading…</p>
        ) : browseRows.length === 0 ? (
          <p className="text-slate-400 text-sm py-4">
            No sales match that commune name.
          </p>
        ) : (
          <BrowseTable rows={browseRows} onSelect={(id) => handleSearch(id)} />
        )}
      </div>
    </div>
  );
}
