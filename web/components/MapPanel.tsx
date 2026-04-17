"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { query } from "@/lib/duckdb";
import { buildWhere, type Bbox, type Filters } from "@/lib/filters";
import { normalizeBuildings } from "@/components/SaleCard";
import type { MapChange, MapPoint } from "@/components/MapView";

const MAX_MAP_POINTS = 5_000;

/** Metropolitan France + Corsica bounding box (generous 1° buffer).
 *  Used for the initial France-wide query and as the outer clamp. */
const FRANCE_BBOX: Bbox = { latMin: 40, latMax: 52, lonMin: -7, lonMax: 11 };

/** Raw row from DuckDB: buildings arrives as an Arrow List vector. */
type RawMapPoint = Omit<MapPoint, "buildings"> & { buildings: unknown };

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div
      className="rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center"
      style={{ height: 380 }}
    >
      <span className="text-slate-400 text-sm">Loading map…</span>
    </div>
  ),
});

interface Props {
  filters: Filters;
  /** Called when the user pans / zooms — lets the parent filter cards too. */
  onBboxChange?: (bbox: Bbox | null) => void;
  /** Called with map center + zoom on every user pan/zoom (for URL state). */
  onViewChange?: (center: [number, number], zoom: number) => void;
  /** If provided, the map opens at this saved position rather than France-wide. */
  initialView?: { center: [number, number]; zoom: number };
}

export default function MapPanel({ filters, onBboxChange, onViewChange, initialView }: Props) {
  const filterKey = JSON.stringify(filters); // changes only on filter edits

  const [points, setPoints]     = useState<MapPoint[]>([]);
  const [loading, setLoading]   = useState(false);
  const [capped, setCapped]     = useState(false);

  // Current viewport bbox — null means "not yet set by the map" → use France-wide
  const [viewBbox, setViewBbox] = useState<Bbox | null>(null);
  const viewBboxRef             = useRef<Bbox | null>(null);

  // ── Notify parent of bbox changes ──────────────────────────────────────────
  useEffect(() => {
    onBboxChange?.(viewBbox);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewBbox]);

  // ── Re-query whenever filters OR viewport changes ───────────────────────────
  useEffect(() => {
    const bbox    = viewBboxRef.current ?? FRANCE_BBOX;
    const where   = buildWhere(filters);
    const bboxSql = `latitude  BETWEEN ${bbox.latMin}  AND ${bbox.latMax} ` +
                    `AND longitude BETWEEN ${bbox.lonMin} AND ${bbox.lonMax}`;
    const fullWhere = where ? `${where} AND ${bboxSql}` : `WHERE ${bboxSql}`;

    setLoading(true);
    let cancelled = false;

    query<RawMapPoint>(`
      SELECT
        id_mutation, latitude, longitude,
        price_eur, price_per_m2,
        composition, primary_type,
        built_area_m2, land_area_m2,
        commune_name, department_code,
        sale_date, buildings
      FROM sales
      ${fullWhere}
      ORDER BY sale_date DESC
      LIMIT ${MAX_MAP_POINTS}
    `)
      .then((rows) => {
        if (cancelled) return;
        const pts: MapPoint[] = rows.map((r) => ({
          ...r,
          buildings: normalizeBuildings(r.buildings),
        }));
        setPoints(pts);
        setCapped(rows.length === MAX_MAP_POINTS);
      })
      .catch(() => { if (!cancelled) setPoints([]); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
    // viewBbox is accessed via ref so we don't need it in the dep array
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, viewBbox]);

  // ── Handle map move (pan / zoom by user) ───────────────────────────────────
  const handleMapChange = (change: MapChange) => {
    const { bbox, center, zoom } = change;
    // Clamp to France bbox so overseas drift doesn't break queries
    const clamped: Bbox = {
      latMin: Math.max(bbox.latMin, FRANCE_BBOX.latMin),
      latMax: Math.min(bbox.latMax, FRANCE_BBOX.latMax),
      lonMin: Math.max(bbox.lonMin, FRANCE_BBOX.lonMin),
      lonMax: Math.min(bbox.lonMax, FRANCE_BBOX.lonMax),
    };
    viewBboxRef.current = clamped;
    setViewBbox(clamped);
    onViewChange?.(center, zoom);
  };

  // Percentile price bounds for colour scale
  const prices = [...points].map((p) => p.price_eur).sort((a, b) => a - b);
  const p5  = prices[Math.floor(prices.length * 0.05)] ?? prices[0]             ?? 0;
  const p95 = prices[Math.floor(prices.length * 0.95)] ?? prices[prices.length - 1] ?? 1_000_000;

  return (
    <section className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-slate-800">Map</h2>
        <p className="text-sm text-slate-500">
          {loading ? (
            <span className="text-amber-600">Loading…</span>
          ) : points.length === 0 ? (
            <span className="text-slate-400">No geolocated properties match these filters.</span>
          ) : capped ? (
            <>Showing <span className="font-semibold">{MAX_MAP_POINTS.toLocaleString("en-GB")}</span> most recent (results capped — zoom in for more density)</>
          ) : (
            <><span className="font-semibold">{points.length.toLocaleString("en-GB")}</span> geolocated properties</>
          )}
        </p>
      </div>

      {/*
        CRITICAL: MapView must stay mounted across query loads. If we conditionally
        render it based on `loading`, it unmounts every time the user zooms (because
        moveend → query → setLoading(true) re-renders with no MapView). The next
        mount recreates the map at `initialView`, which both destroys the user's
        current zoom and triggers the canvas-RAF race that causes `_ctx.save()`.
        We render it once we have any points, and keep it mounted thereafter.
      */}
      {points.length > 0 ? (
        <MapView
          points={points}
          p5={p5}
          p95={p95}
          filterKey={filterKey}
          onMapChange={handleMapChange}
          initialView={initialView}
        />
      ) : !loading ? (
        <div
          className="rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center"
          style={{ height: 380 }}
        >
          <span className="text-slate-400 text-sm">No geolocated properties match these filters.</span>
        </div>
      ) : (
        <div
          className="rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center"
          style={{ height: 380 }}
        >
          <span className="text-slate-400 text-sm">Loading map…</span>
        </div>
      )}
    </section>
  );
}
