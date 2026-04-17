"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import FiltersPanel from "@/components/Filters";
import TrendChart from "@/components/TrendChart";
import PropertiesPanel from "@/components/PropertiesPanel";
import MapPanel from "@/components/MapPanel";
import SaleLookup from "@/components/SaleLookup";
import {
  DEFAULT_FILTERS,
  type Bbox,
  type BuildingSpec,
  type Filters,
  type Granularity,
  type SplitBy,
} from "@/lib/filters";

// ── URL serialisation helpers ─────────────────────────────────────────────────

const newId = () => Math.random().toString(36).slice(2);

function encodeBuildingSpecs(specs: BuildingSpec[]): string {
  if (!specs.length) return "";
  return specs
    .map((s) =>
      [s.type, s.areaMin ?? "", s.areaMax ?? "", s.roomsMin ?? "", s.roomsMax ?? ""].join(":")
    )
    .join(";");
}

function decodeBuildingSpecs(raw: string): BuildingSpec[] {
  if (!raw) return [];
  return raw.split(";").map((part) => {
    const [type, areaMin, areaMax, roomsMin, roomsMax] = part.split(":");
    return {
      id: newId(),
      type: (["Maison", "Appartement", "any"].includes(type)
        ? type
        : "any") as BuildingSpec["type"],
      areaMin:  areaMin  ? Number(areaMin)  : null,
      areaMax:  areaMax  ? Number(areaMax)  : null,
      roomsMin: roomsMin ? Number(roomsMin) : null,
      roomsMax: roomsMax ? Number(roomsMax) : null,
    };
  });
}

function filtersFromParams(sp: URLSearchParams): Filters {
  return {
    yearMin:      sp.has("ymin") ? Number(sp.get("ymin")) : DEFAULT_FILTERS.yearMin,
    yearMax:      sp.has("ymax") ? Number(sp.get("ymax")) : DEFAULT_FILTERS.yearMax,
    department:   sp.get("dept") ?? DEFAULT_FILTERS.department,
    priceMin:     sp.has("pmin") ? Number(sp.get("pmin")) : null,
    priceMax:     sp.has("pmax") ? Number(sp.get("pmax")) : null,
    areaMin:      sp.has("amin") ? Number(sp.get("amin")) : null,
    areaMax:      sp.has("amax") ? Number(sp.get("amax")) : null,
    landAreaMin:  sp.has("lamin") ? Number(sp.get("lamin")) : null,
    landAreaMax:  sp.has("lamax") ? Number(sp.get("lamax")) : null,
    buildingSpecs: decodeBuildingSpecs(sp.get("bs") ?? ""),
  };
}

function granularityFromParams(sp: URLSearchParams): Granularity {
  const g = sp.get("gran");
  return (["year", "month", "week"] as Granularity[]).includes(g as Granularity)
    ? (g as Granularity)
    : "month";
}

function splitByFromParams(sp: URLSearchParams): SplitBy {
  const s = sp.get("split");
  return (["none", "type", "n_houses"] as SplitBy[]).includes(s as SplitBy)
    ? (s as SplitBy)
    : "none";
}

function mapViewFromParams(sp: URLSearchParams): { center: [number, number]; zoom: number } | undefined {
  if (sp.has("mlat") && sp.has("mlng") && sp.has("mz")) {
    return {
      center: [Number(sp.get("mlat")), Number(sp.get("mlng"))],
      zoom:   Number(sp.get("mz")),
    };
  }
  return undefined;
}

function buildUrl(
  filters: Filters,
  granularity: Granularity,
  splitBy: SplitBy,
  mapCenter: [number, number] | null,
  mapZoom: number | null,
): string {
  const sp = new URLSearchParams();

  if (filters.yearMin !== DEFAULT_FILTERS.yearMin) sp.set("ymin", String(filters.yearMin));
  if (filters.yearMax !== DEFAULT_FILTERS.yearMax) sp.set("ymax", String(filters.yearMax));
  if (filters.department !== DEFAULT_FILTERS.department) sp.set("dept", filters.department);
  if (filters.priceMin    != null) sp.set("pmin",  String(filters.priceMin));
  if (filters.priceMax    != null) sp.set("pmax",  String(filters.priceMax));
  if (filters.areaMin     != null) sp.set("amin",  String(filters.areaMin));
  if (filters.areaMax     != null) sp.set("amax",  String(filters.areaMax));
  if (filters.landAreaMin != null) sp.set("lamin", String(filters.landAreaMin));
  if (filters.landAreaMax != null) sp.set("lamax", String(filters.landAreaMax));
  const bs = encodeBuildingSpecs(filters.buildingSpecs);
  if (bs) sp.set("bs", bs);
  if (granularity !== "month") sp.set("gran",  granularity);
  if (splitBy     !== "none")  sp.set("split", splitBy);
  if (mapCenter && mapZoom != null) {
    sp.set("mlat", mapCenter[0].toFixed(5));
    sp.set("mlng", mapCenter[1].toFixed(5));
    sp.set("mz",   String(mapZoom));
  }

  const qs = sp.toString();
  return qs ? `?${qs}` : "?";
}

// ── tabs ──────────────────────────────────────────────────────────────────────

type Tab = "trends" | "lookup";
const TABS: { id: Tab; label: string }[] = [
  { id: "trends", label: "Trends" },
  { id: "lookup", label: "Sale Lookup" },
];

// ── component ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const searchParams = useSearchParams();
  const router       = useRouter();

  // ── Initialise state from URL ───────────────────────────────────────────────
  const [activeTab,   setActiveTab]   = useState<Tab>("trends");
  const [filters,     setFilters]     = useState<Filters>(() => filtersFromParams(searchParams));
  const [granularity, setGranularity] = useState<Granularity>(() => granularityFromParams(searchParams));
  const [splitBy,     setSplitBy]     = useState<SplitBy>(() => splitByFromParams(searchParams));
  const [initialMapView]              = useState(() => mapViewFromParams(searchParams));
  const [mapCenter,   setMapCenter]   = useState<[number, number] | null>(
    () => initialMapView?.center ?? null
  );
  const [mapZoom, setMapZoom]         = useState<number | null>(
    () => initialMapView?.zoom ?? null
  );

  // Current map viewport bbox — drives both map re-queries and the cards panel.
  const [bbox, setBbox] = useState<Bbox | null>(null);

  // ── Debounced URL update ────────────────────────────────────────────────────
  const urlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (urlTimer.current) clearTimeout(urlTimer.current);
    urlTimer.current = setTimeout(() => {
      const url = buildUrl(filters, granularity, splitBy, mapCenter, mapZoom);
      router.replace(url, { scroll: false });
    }, 600);
    return () => { if (urlTimer.current) clearTimeout(urlTimer.current); };
  }, [filters, granularity, splitBy, mapCenter, mapZoom, router]);

  // ── Callbacks ──────────────────────────────────────────────────────────────
  const handleBboxChange = useCallback((b: Bbox | null) => setBbox(b), []);

  const handleViewChange = useCallback((center: [number, number], zoom: number) => {
    setMapCenter(center);
    setMapZoom(zoom);
  }, []);

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              activeTab === tab.id
                ? "bg-white border border-b-white border-slate-200 text-blue-600 -mb-px"
                : "text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Trends tab */}
      {activeTab === "trends" && (
        <div className="space-y-6">
          {/* Filters (left) + Map then Charts (right) */}
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">
            <FiltersPanel
              filters={filters}
              granularity={granularity}
              splitBy={splitBy}
              onChange={setFilters}
              onGranularityChange={setGranularity}
              onSplitByChange={setSplitBy}
            />
            <div className="space-y-4 min-w-0">
              <MapPanel
                filters={filters}
                onBboxChange={handleBboxChange}
                onViewChange={handleViewChange}
                initialView={initialMapView}
              />
              <section className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
                <TrendChart
                  filters={filters}
                  granularity={granularity}
                  splitBy={splitBy}
                  bbox={bbox}
                />
              </section>
            </div>
          </div>

          {/* Properties panel — filtered by both Filters and current map viewport */}
          <PropertiesPanel filters={filters} bbox={bbox} />
        </div>
      )}

      {/* Sale Lookup tab */}
      {activeTab === "lookup" && (
        <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-sm">
          <SaleLookup />
        </div>
      )}
    </div>
  );
}
