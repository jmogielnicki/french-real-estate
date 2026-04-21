"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { query } from "@/lib/duckdb";
import { buildWhere, type Bbox, type Filters } from "@/lib/filters";
import { fetchDeptGeoJson, fetchCommuneGeoJson } from "@/lib/geo";
import { normalizeBuildings } from "@/components/SaleCard";
import type { MapChange, MapMode, MapPoint, ChoroplethRow } from "@/components/MapView";
import type { FeatureCollection } from "geojson";

// ── Zoom thresholds ───────────────────────────────────────────────────────────
const ZOOM_DEPT    = 8;   // below → department choropleth
const ZOOM_COMMUNE = 12;  // below → commune choropleth; at/above → individual points

const MAX_MAP_POINTS = 5_000;

/** Metropolitan France + Corsica bounding box (generous 1° buffer). */
const FRANCE_BBOX: Bbox = { latMin: 40, latMax: 52, lonMin: -7, lonMax: 11 };

function modeFromZoom(zoom: number): MapMode {
  if (zoom < ZOOM_DEPT)    return "department";
  if (zoom < ZOOM_COMMUNE) return "commune";
  return "points";
}

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
  onBboxChange?: (bbox: Bbox | null) => void;
  onViewChange?: (center: [number, number], zoom: number) => void;
  initialView?: { center: [number, number]; zoom: number };
}

export default function MapPanel({ filters, onBboxChange, onViewChange, initialView }: Props) {
  const filterKey = JSON.stringify(filters);

  // ── Map viewport state ─────────────────────────────────────────────────────
  const [viewBbox, setViewBbox] = useState<Bbox | null>(null);
  const viewBboxRef             = useRef<Bbox | null>(null);
  const [zoom, setZoom]         = useState(initialView?.zoom ?? 6);

  const mapMode = modeFromZoom(zoom);

  // ── Points state ───────────────────────────────────────────────────────────
  const [points, setPoints]         = useState<MapPoint[]>([]);
  const [loadingPts, setLoadingPts] = useState(false);
  const [capped, setCapped]         = useState(false);

  const prices = points.map((p) => p.price_eur).sort((a, b) => a - b);
  const p5  = prices[Math.floor(prices.length * 0.05)] ?? prices[0]             ?? 0;
  const p95 = prices[Math.floor(prices.length * 0.95)] ?? prices[prices.length - 1] ?? 1_000_000;

  // ── Choropleth state ───────────────────────────────────────────────────────
  const [choroplethRows, setChoroplethRows] = useState<ChoroplethRow[]>([]);
  const [geojson, setGeojson]               = useState<FeatureCollection | null>(null);
  const [loadingCh, setLoadingCh]           = useState(false);

  // ── Notify parent of bbox changes ──────────────────────────────────────────
  useEffect(() => {
    onBboxChange?.(viewBbox);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewBbox]);

  // ── Points query (only in points mode) ────────────────────────────────────
  useEffect(() => {
    if (mapMode !== "points") {
      setPoints([]);
      return;
    }

    const bbox    = viewBboxRef.current ?? FRANCE_BBOX;
    const where   = buildWhere(filters);
    const bboxSql = `latitude  BETWEEN ${bbox.latMin}  AND ${bbox.latMax} ` +
                    `AND longitude BETWEEN ${bbox.lonMin} AND ${bbox.lonMax}`;
    const fullWhere = where ? `${where} AND ${bboxSql}` : `WHERE ${bboxSql}`;

    setLoadingPts(true);
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
        setPoints(rows.map((r) => ({ ...r, buildings: normalizeBuildings(r.buildings) })));
        setCapped(rows.length === MAX_MAP_POINTS);
      })
      .catch(() => { if (!cancelled) setPoints([]); })
      .finally(() => { if (!cancelled) setLoadingPts(false); });

    return () => { cancelled = true; };
  // viewBbox accessed via ref; mapMode in deps to re-run on mode switch
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, viewBbox, mapMode]);

  // ── Choropleth query (dept or commune mode) ────────────────────────────────
  useEffect(() => {
    if (mapMode === "points") {
      setChoroplethRows([]);
      return;
    }

    const bbox    = viewBboxRef.current ?? FRANCE_BBOX;
    const where   = buildWhere(filters);
    const bboxSql = `latitude  BETWEEN ${bbox.latMin}  AND ${bbox.latMax} ` +
                    `AND longitude BETWEEN ${bbox.lonMin} AND ${bbox.lonMax}`;
    const fullWhere = where ? `${where} AND ${bboxSql}` : `WHERE ${bboxSql}`;

    const isDept  = mapMode === "department";
    const codeCol = isDept ? "department_code" : "commune_code";
    const nameCol = isDept ? "department_code" : "commune_name";

    setLoadingCh(true);
    let cancelled = false;

    Promise.all([
      query<ChoroplethRow>(`
        SELECT
          ${codeCol}                                                     AS code,
          ${nameCol}                                                     AS name,
          COUNT(*)::INTEGER                                              AS n_sales,
          ROUND(MEDIAN(price_eur))::INTEGER                             AS median_price,
          ROUND(MEDIAN(CASE WHEN price_per_m2 BETWEEN 100 AND 30000
                            THEN price_per_m2 END))::INTEGER            AS median_per_m2
        FROM sales
        ${fullWhere}
        GROUP BY ${codeCol}, ${nameCol}
      `),
      isDept ? fetchDeptGeoJson() : fetchCommuneGeoJson(),
    ])
      .then(([rows, geo]) => {
        if (cancelled) return;
        setChoroplethRows(rows);
        setGeojson(geo);
      })
      .catch(() => { if (!cancelled) setChoroplethRows([]); })
      .finally(() => { if (!cancelled) setLoadingCh(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, viewBbox, mapMode]);

  // ── Handle map move / zoom ─────────────────────────────────────────────────
  const handleMapChange = (change: MapChange) => {
    const { bbox, center, zoom: newZoom } = change;
    const clamped: Bbox = {
      latMin: Math.max(bbox.latMin, FRANCE_BBOX.latMin),
      latMax: Math.min(bbox.latMax, FRANCE_BBOX.latMax),
      lonMin: Math.max(bbox.lonMin, FRANCE_BBOX.lonMin),
      lonMax: Math.min(bbox.lonMax, FRANCE_BBOX.lonMax),
    };
    viewBboxRef.current = clamped;
    setViewBbox(clamped);
    setZoom(newZoom);
    onViewChange?.(center, newZoom);
  };

  const loading    = loadingPts || loadingCh;
  const hasContent = points.length > 0 || choroplethRows.length > 0;

  // ── Status text ────────────────────────────────────────────────────────────
  const statusText = loading ? (
    <span className="text-amber-600">Loading…</span>
  ) : mapMode === "department" ? (
    <span>{choroplethRows.length} departments</span>
  ) : mapMode === "commune" ? (
    <span>{choroplethRows.length} communes in view</span>
  ) : points.length === 0 ? (
    <span className="text-slate-400">No geolocated properties match these filters.</span>
  ) : capped ? (
    <>Showing <span className="font-semibold">{MAX_MAP_POINTS.toLocaleString("en-GB")}</span> most recent (results capped — zoom in for more density)</>
  ) : (
    <><span className="font-semibold">{points.length.toLocaleString("en-GB")}</span> geolocated properties</>
  );

  return (
    <section className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-slate-800">Map</h2>
          <span className="text-xs text-slate-400 bg-slate-100 rounded px-1.5 py-0.5">
            {mapMode === "department" ? "dept" : mapMode === "commune" ? "commune" : "points"}
          </span>
        </div>
        <p className="text-sm text-slate-500">{statusText}</p>
      </div>

      {/*
        CRITICAL: MapView must stay mounted across query loads. If we conditionally
        render it based on `loading`, it unmounts every time the user zooms (because
        moveend → query → loading → re-renders with no MapView). The next mount
        recreates the map at `initialView`, destroying the user's zoom position and
        triggering the canvas-RAF race that causes `_ctx.save()` errors.
        We render once we have any content, and keep it mounted thereafter.
      */}
      {hasContent ? (
        <MapView
          mode={mapMode}
          points={points}
          p5={p5}
          p95={p95}
          choroplethRows={choroplethRows}
          geojson={geojson}
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
