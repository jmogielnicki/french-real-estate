"use client";

import {
  DEFAULT_FILTERS,
  MAX_BUILDING_SPECS,
  type BuildingSpec,
  type Filters,
  type Granularity,
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

// ─── YearRangeSlider ──────────────────────────────────────────────────────────

const YEAR_MIN = 2021;
const YEAR_MAX = 2025;
const YEAR_RANGE = YEAR_MAX - YEAR_MIN;

function YearRangeSlider({
  yearMin,
  yearMax,
  onMinChange,
  onMaxChange,
}: {
  yearMin: number;
  yearMax: number;
  onMinChange: (v: number) => void;
  onMaxChange: (v: number) => void;
}) {
  const pctMin = ((yearMin - YEAR_MIN) / YEAR_RANGE) * 100;
  const pctMax = ((yearMax - YEAR_MIN) / YEAR_RANGE) * 100;

  return (
    <div className="space-y-2">
      {/* Current values */}
      <div className="flex justify-between text-xs font-semibold text-slate-700">
        <span>{yearMin}</span>
        <span>{yearMax}</span>
      </div>

      {/* Slider track + thumbs */}
      <div className="relative" style={{ height: 20 }}>
        {/* Track background */}
        <div className="absolute top-1/2 left-0 right-0 -translate-y-1/2 h-1.5 rounded-full bg-slate-200">
          {/* Active segment */}
          <div
            className="absolute h-full rounded-full bg-blue-500"
            style={{ left: `${pctMin}%`, right: `${100 - pctMax}%` }}
          />
        </div>
        {/* Min handle (raise z-index when at max so it stays grabbable) */}
        <input
          type="range"
          className="dual-range-input"
          min={YEAR_MIN}
          max={YEAR_MAX}
          step={1}
          value={yearMin}
          style={{ zIndex: yearMin >= yearMax ? 5 : 3 }}
          onChange={(e) => onMinChange(Math.min(Number(e.target.value), yearMax))}
        />
        {/* Max handle */}
        <input
          type="range"
          className="dual-range-input"
          min={YEAR_MIN}
          max={YEAR_MAX}
          step={1}
          value={yearMax}
          style={{ zIndex: 4 }}
          onChange={(e) => onMaxChange(Math.max(Number(e.target.value), yearMin))}
        />
      </div>

      {/* Tick labels */}
      <div className="flex justify-between text-xs text-slate-400 select-none">
        {Array.from({ length: YEAR_RANGE + 1 }, (_, i) => YEAR_MIN + i).map((y) => (
          <span key={y}>{y}</span>
        ))}
      </div>
    </div>
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

const newSpecId = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const emptySpec = (): BuildingSpec => ({
  id: newSpecId(),
  type: "any",
  areaMin: null,
  areaMax: null,
  roomsMin: null,
  roomsMax: null,
});

// ─── BuildingCard ────────────────────────────────────────────────────────────

function BuildingCard({
  spec,
  index,
  onChange,
  onRemove,
}: {
  spec: BuildingSpec;
  index: number;
  onChange: (s: BuildingSpec) => void;
  onRemove: () => void;
}) {
  const set = <K extends keyof BuildingSpec>(k: K, v: BuildingSpec[K]) =>
    onChange({ ...spec, [k]: v });

  const numInput = (
    key: "areaMin" | "areaMax" | "roomsMin" | "roomsMax",
    placeholder: string
  ) => (
    <input
      type="number"
      min={0}
      placeholder={placeholder}
      className="border border-slate-300 rounded px-2 py-1 w-full text-sm"
      value={spec[key] ?? ""}
      onChange={(e) =>
        set(key, e.target.value === "" ? null : Number(e.target.value))
      }
    />
  );

  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2.5">
      {/* Card header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
          Building {index + 1}
        </span>
        <button
          onClick={onRemove}
          className="text-slate-300 hover:text-red-500 transition-colors text-base leading-none"
          aria-label="Remove building"
        >
          ×
        </button>
      </div>

      {/* Type */}
      <div>
        <label className="text-xs text-slate-500 block mb-1">Type</label>
        <select
          className="border border-slate-300 rounded px-2 py-1 w-full text-sm bg-white"
          value={spec.type}
          onChange={(e) => set("type", e.target.value as BuildingSpec["type"])}
        >
          <option value="any">Any type</option>
          <option value="Maison">Maison</option>
          <option value="Appartement">Appartement</option>
        </select>
      </div>

      {/* Area */}
      <div>
        <label className="text-xs text-slate-500 block mb-1">Area (m²)</label>
        <div className="flex gap-1.5 items-center">
          {numInput("areaMin", "min")}
          <span className="text-slate-300 text-xs">–</span>
          {numInput("areaMax", "max")}
        </div>
      </div>

      {/* Rooms */}
      <div>
        <label className="text-xs text-slate-500 block mb-1">
          Rooms (pièces principales)
        </label>
        <div className="flex gap-1.5 items-center">
          {numInput("roomsMin", "min")}
          <span className="text-slate-300 text-xs">–</span>
          {numInput("roomsMax", "max")}
        </div>
      </div>
    </div>
  );
}

// ─── FiltersPanel ─────────────────────────────────────────────────────────────

export default function FiltersPanel({
  filters,
  granularity,
  splitBy,
  onChange,
  onGranularityChange,
  onSplitByChange,
}: Props) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    onChange({ ...filters, [k]: v });

  // ── Building spec helpers ──────────────────────────────────────────────────
  const specs = filters.buildingSpecs;

  const addSpec = () => {
    if (specs.length < MAX_BUILDING_SPECS)
      set("buildingSpecs", [...specs, emptySpec()]);
  };

  const updateSpec = (i: number, updated: BuildingSpec) => {
    const next = [...specs];
    next[i] = updated;
    set("buildingSpecs", next);
  };

  const removeSpec = (i: number) =>
    set("buildingSpecs", specs.filter((_, j) => j !== i));

  return (
    <aside className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm space-y-4 text-sm">
      {/* Header */}
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
        <YearRangeSlider
          yearMin={filters.yearMin}
          yearMax={filters.yearMax}
          onMinChange={(v) => set("yearMin", v)}
          onMaxChange={(v) => set("yearMax", v)}
        />
      </div>

      {/* Price range */}
      <div className="space-y-1">
        <label className="block text-slate-600">Price (€)</label>
        <div className="flex gap-1.5 items-center">
          <input
            type="number"
            placeholder="min"
            className="border rounded px-2 py-1 w-1/2"
            value={filters.priceMin ?? ""}
            onChange={(e) =>
              set("priceMin", e.target.value === "" ? null : Number(e.target.value))
            }
          />
          <span className="text-slate-300 text-xs">–</span>
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

      {/* Total built area */}
      <div className="space-y-1">
        <label className="block text-slate-600">Total built area (m²)</label>
        <div className="flex gap-1.5 items-center">
          <input
            type="number"
            placeholder="min"
            className="border rounded px-2 py-1 w-1/2"
            value={filters.areaMin ?? ""}
            onChange={(e) =>
              set("areaMin", e.target.value === "" ? null : Number(e.target.value))
            }
          />
          <span className="text-slate-300 text-xs">–</span>
          <input
            type="number"
            placeholder="max"
            className="border rounded px-2 py-1 w-1/2"
            value={filters.areaMax ?? ""}
            onChange={(e) =>
              set("areaMax", e.target.value === "" ? null : Number(e.target.value))
            }
          />
        </div>
      </div>

      {/* Land area */}
      <div className="space-y-1">
        <label className="block text-slate-600">Land area (m²)</label>
        <div className="flex gap-1.5 items-center">
          <input
            type="number"
            placeholder="min"
            className="border rounded px-2 py-1 w-1/2"
            value={filters.landAreaMin ?? ""}
            onChange={(e) =>
              set("landAreaMin", e.target.value === "" ? null : Number(e.target.value))
            }
          />
          <span className="text-slate-300 text-xs">–</span>
          <input
            type="number"
            placeholder="max"
            className="border rounded px-2 py-1 w-1/2"
            value={filters.landAreaMax ?? ""}
            onChange={(e) =>
              set("landAreaMax", e.target.value === "" ? null : Number(e.target.value))
            }
          />
        </div>
      </div>

      {/* Buildings */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-slate-600">Buildings on the property</label>
          <button
            onClick={addSpec}
            disabled={specs.length >= MAX_BUILDING_SPECS}
            className="text-xs font-medium text-blue-600 hover:text-blue-800 disabled:text-slate-300 transition-colors"
          >
            + Add
          </button>
        </div>

        {specs.length === 0 ? (
          <p className="text-xs text-slate-400 leading-snug">
            No building constraints. Add one to filter by type, area, or rooms. Adding two requires the property to have one matching building per spec.
          </p>
        ) : (
          <div className="space-y-1">
            {specs.map((spec, i) => (
              <div key={spec.id}>
                {i > 0 && (
                  <div className="flex items-center gap-2 py-1">
                    <div className="flex-1 border-t border-slate-200" />
                    <span className="text-xs font-semibold text-slate-400">AND</span>
                    <div className="flex-1 border-t border-slate-200" />
                  </div>
                )}
                <BuildingCard
                  spec={spec}
                  index={i}
                  onChange={(updated) => updateSpec(i, updated)}
                  onRemove={() => removeSpec(i)}
                />
              </div>
            ))}
            {specs.length < MAX_BUILDING_SPECS && (
              <p className="text-xs text-slate-400 pt-1">
                {MAX_BUILDING_SPECS - specs.length} more building{MAX_BUILDING_SPECS - specs.length !== 1 ? "s" : ""} can be added.
              </p>
            )}
          </div>
        )}
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
