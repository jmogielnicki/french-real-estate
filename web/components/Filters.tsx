"use client";

import { useEffect, useState } from "react";
import { query } from "@/lib/duckdb";
import {
  DEFAULT_FILTERS,
  type Filters,
  type Granularity,
  type ResidentialType,
  type SplitBy,
} from "@/lib/filters";

interface Props {
  filters: Filters;
  granularity: Granularity;
  splitBy: SplitBy;
  onChange: (f: Filters) => void;
  onGranularityChange: (g: Granularity) => void;
  onSplitByChange: (s: SplitBy) => void;
}

interface DeptRow {
  department_code: string;
  n: number;
}

export default function FiltersPanel({
  filters,
  granularity,
  splitBy,
  onChange,
  onGranularityChange,
  onSplitByChange,
}: Props) {
  const [depts, setDepts] = useState<DeptRow[] | null>(null);

  useEffect(() => {
    query<DeptRow>(
      `SELECT department_code, COUNT(*)::INTEGER AS n
       FROM sales
       WHERE department_code IS NOT NULL
       GROUP BY department_code
       ORDER BY department_code`
    ).then(setDepts);
  }, []);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    onChange({ ...filters, [k]: v });

  return (
    <aside className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Filters</h2>
        <button
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="text-xs text-slate-500 hover:text-slate-900 underline"
        >
          Reset
        </button>
      </div>

      {/* Year range */}
      <div className="space-y-1">
        <label className="block text-slate-600">Year range</label>
        <div className="flex gap-2 items-center">
          <select
            className="border rounded px-2 py-1"
            value={filters.yearMin}
            onChange={(e) => set("yearMin", Number(e.target.value))}
          >
            {[2021, 2022, 2023, 2024, 2025].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
          <span className="text-slate-400">to</span>
          <select
            className="border rounded px-2 py-1"
            value={filters.yearMax}
            onChange={(e) => set("yearMax", Number(e.target.value))}
          >
            {[2021, 2022, 2023, 2024, 2025].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Property type */}
      <div className="space-y-1">
        <label className="block text-slate-600">Property type</label>
        <select
          className="border rounded px-2 py-1 w-full"
          value={filters.type}
          onChange={(e) => set("type", e.target.value as ResidentialType)}
        >
          <option value="all">All residential</option>
          <option value="maison">Maison only</option>
          <option value="appartement">Appartement only</option>
          <option value="mixed">Mixed (Maison + Appt)</option>
        </select>
      </div>

      {/* Department */}
      <div className="space-y-1">
        <label className="block text-slate-600">Department</label>
        <select
          className="border rounded px-2 py-1 w-full"
          value={filters.department}
          onChange={(e) => set("department", e.target.value)}
        >
          <option value="all">All of France</option>
          {depts?.map((d) => (
            <option key={d.department_code} value={d.department_code}>
              {d.department_code} ({d.n.toLocaleString()})
            </option>
          ))}
        </select>
      </div>

      {/* Price range */}
      <div className="space-y-1">
        <label className="block text-slate-600">Price range (€)</label>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="min"
            className="border rounded px-2 py-1 w-1/2"
            value={filters.priceMin ?? ""}
            onChange={(e) =>
              set("priceMin", e.target.value === "" ? null : Number(e.target.value))
            }
          />
          <input
            type="number"
            placeholder="max"
            className="border rounded px-2 py-1 w-1/2"
            value={filters.priceMax ?? ""}
            onChange={(e) =>
              set("priceMax", e.target.value === "" ? null : Number(e.target.value))
            }
          />
        </div>
      </div>

      {/* Rooms min */}
      <div className="space-y-1">
        <label className="block text-slate-600">
          Min rooms per unit (pieces principales)
        </label>
        <input
          type="number"
          min={0}
          placeholder="any"
          className="border rounded px-2 py-1 w-full"
          value={filters.roomsMin ?? ""}
          onChange={(e) =>
            set("roomsMin", e.target.value === "" ? null : Number(e.target.value))
          }
        />
      </div>

      {/* Exact n_maisons */}
      <div className="space-y-1">
        <label className="block text-slate-600">
          Exactly N houses on the property
        </label>
        <input
          type="number"
          min={0}
          placeholder="any"
          className="border rounded px-2 py-1 w-full"
          value={filters.exactNMaisons ?? ""}
          onChange={(e) =>
            set(
              "exactNMaisons",
              e.target.value === "" ? null : Number(e.target.value)
            )
          }
        />
        <p className="text-xs text-slate-400">
          Set to 2 + min rooms 5 + type=Maison only to recreate the test query
          (≥4 bedrooms in each of 2 houses).
        </p>
      </div>

      {/* Granularity + Split */}
      <div className="space-y-3 pt-2 border-t">
        <div className="space-y-1">
          <label className="block text-slate-600">Time granularity</label>
          <div className="inline-flex rounded border overflow-hidden">
            {(["year", "month", "week"] as Granularity[]).map((g) => (
              <button
                key={g}
                onClick={() => onGranularityChange(g)}
                className={`px-3 py-1 text-sm ${
                  granularity === g
                    ? "bg-slate-900 text-white"
                    : "bg-white text-slate-700 hover:bg-slate-100"
                }`}
              >
                {g}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <label className="block text-slate-600">Split by</label>
          <select
            className="border rounded px-2 py-1 w-full"
            value={splitBy}
            onChange={(e) => onSplitByChange(e.target.value as SplitBy)}
          >
            <option value="none">None (single series)</option>
            <option value="type">Property type (Maison / Appartement / Mixed)</option>
            <option value="n_houses">Number of houses (1–5)</option>
          </select>
        </div>
      </div>
    </aside>
  );
}
