"use client";

// Loaded via next/dynamic({ ssr: false }) — window is guaranteed to exist.
// Leaflet CSS is imported globally in app/globals.css.
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import { useEffect, useRef } from "react";
import { formatSaleDate, type Building } from "@/components/SaleCard";
import type { Bbox } from "@/lib/filters";

// ── Public types ──────────────────────────────────────────────────────────────

export type MapMode = "department" | "commune" | "points";

export interface MapPoint {
  id_mutation: string;
  latitude: number;
  longitude: number;
  price_eur: number;
  price_per_m2: number | null;
  composition: string | null;
  primary_type: string;
  built_area_m2: number | null;
  land_area_m2: number | null;
  commune_name: string;
  department_code: string;
  sale_date: Date | string;
  buildings: Building[];
}

export interface ChoroplethRow {
  code: string;           // department_code or commune_code
  name: string;           // display name
  n_sales: number;
  median_price: number | null;
  median_per_m2: number | null;
}

export interface MapChange {
  bbox: Bbox;
  center: [number, number];
  zoom: number;
}

interface Props {
  mode: MapMode;
  // Points mode
  points: MapPoint[];
  p5: number;
  p95: number;
  // Choropleth mode
  choroplethRows: ChoroplethRow[];
  geojson: FeatureCollection | null;
  // Common
  filterKey: string;
  onMapChange: (change: MapChange) => void;
  initialView?: { center: [number, number]; zoom: number };
}

// ── colour helpers ────────────────────────────────────────────────────────────

function priceToColor(price: number, p5: number, p95: number): string {
  const t = Math.max(0, Math.min(1, (price - p5) / Math.max(1, p95 - p5)));
  return `hsl(${Math.round(120 * (1 - t))}, 80%, 42%)`;
}

// ── popup / tooltip HTML ──────────────────────────────────────────────────────

const N = "en-GB";

function buildPopupHtml(pt: MapPoint): string {
  const badgeStyle =
    pt.primary_type === "Maison"
      ? "background:#d1fae5;color:#065f46"
      : pt.primary_type === "Appartement"
      ? "background:#dbeafe;color:#1e40af"
      : "background:#fef3c7;color:#92400e";

  const priceStr = `€${pt.price_eur.toLocaleString(N)}`;
  const perM2Str = pt.price_per_m2 != null ? `€${Math.round(pt.price_per_m2).toLocaleString(N)}/m²` : null;
  const areaStr  = pt.built_area_m2 != null ? `${pt.built_area_m2.toLocaleString(N)} m² built` : null;
  const landStr  = pt.land_area_m2  != null ? `${pt.land_area_m2.toLocaleString(N)} m² land`  : null;
  const metaLine = [areaStr, perM2Str].filter(Boolean).join(" · ");
  const dateStr  = formatSaleDate(pt.sale_date, { iso: true });
  const mapsUrl  = `https://www.google.com/maps?q=${pt.latitude},${pt.longitude}`;

  const buildingsHtml =
    pt.buildings.length > 0
      ? `<div style="margin-top:8px">
           <div style="font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:4px">Buildings</div>
           ${pt.buildings.map((b) =>
             `<div style="font-size:11px;color:#475569;padding:1px 0">` +
             `${b.type} · ${b.area_m2.toLocaleString(N)} m²` +
             (b.rooms ? ` · ${b.rooms} room${b.rooms !== 1 ? "s" : ""}` : "") +
             `</div>`
           ).join("")}
         </div>`
      : "";

  return `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif;width:max-content;max-width:290px">
      <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:6px">
        <span style="font-family:monospace;font-size:11px;font-weight:600;color:#1e293b">${pt.id_mutation}</span>
        <span style="font-size:10px;padding:1px 7px;border-radius:999px;${badgeStyle}">${pt.primary_type}</span>
        ${pt.composition ? `<span style="font-size:10px;font-family:monospace;padding:1px 7px;border-radius:999px;background:#e2e8f0;color:#475569">${pt.composition}</span>` : ""}
      </div>
      <div style="font-size:22px;font-weight:700;color:#0f172a;letter-spacing:-0.5px">${priceStr}</div>
      ${metaLine ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${metaLine}</div>` : ""}
      ${landStr   ? `<div style="font-size:12px;color:#64748b;margin-top:1px">${landStr}</div>`  : ""}
      ${buildingsHtml}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:8px 0">
      <div style="font-size:12px;color:#475569;font-weight:500">${pt.commune_name} <span style="color:#94a3b8;font-weight:400">(${pt.department_code})</span></div>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px">${dateStr}</div>
      <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer"
         style="display:inline-block;margin-top:8px;font-size:11px;color:#2563eb;text-decoration:none">
        📍 View on Google Maps
      </a>
    </div>
  `;
}

function buildChoroplethTooltip(nom: string, stats: ChoroplethRow | undefined): string {
  if (!stats) {
    return `<div style="font-family:ui-sans-serif,system-ui,sans-serif;padding:2px 4px">
      <strong>${nom}</strong><br><span style="color:#94a3b8">No data</span>
    </div>`;
  }
  return `
    <div style="font-family:ui-sans-serif,system-ui,sans-serif;min-width:160px">
      <div style="font-weight:600;color:#0f172a;margin-bottom:4px">${nom}</div>
      ${stats.median_price  != null ? `<div style="font-size:12px;color:#475569">Median price: <strong>€${stats.median_price.toLocaleString(N)}</strong></div>` : ""}
      ${stats.median_per_m2 != null ? `<div style="font-size:12px;color:#475569">Median €/m²: <strong>€${stats.median_per_m2.toLocaleString(N)}</strong></div>` : ""}
      <div style="font-size:11px;color:#94a3b8;margin-top:3px">${stats.n_sales.toLocaleString(N)} sales</div>
    </div>
  `;
}

// ── component ─────────────────────────────────────────────────────────────────

export default function MapView({
  mode, points, p5, p95, choroplethRows, geojson, filterKey, onMapChange, initialView,
}: Props) {
  const containerRef     = useRef<HTMLDivElement>(null);
  const mapRef           = useRef<L.Map | null>(null);
  // Canvas renderer + feature group — created once, used for point markers.
  const rendererRef      = useRef<L.Canvas | null>(null);
  const pointLayerRef    = useRef<L.FeatureGroup | null>(null);
  // GeoJSON choropleth layer — created/removed as needed (SVG, no canvas teardown risk).
  const choroplethRef    = useRef<L.GeoJSON | null>(null);
  // Track previous filterKey to distinguish filter changes from bbox/zoom changes.
  const prevFilterKeyRef = useRef<string | null>(null);
  // True while a programmatic fitBounds/setView is in flight.
  const suppressMoveRef  = useRef(false);
  const onMapChangeRef   = useRef(onMapChange);
  useEffect(() => { onMapChangeRef.current = onMapChange; }, [onMapChange]);

  // ── Destroy on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      try {
        const frame = (rendererRef.current as unknown as { _frame?: number })?._frame;
        if (typeof frame === "number") cancelAnimationFrame(frame);
        mapRef.current?.remove();
      } catch { /* StrictMode cleanup race — safe to ignore */ }
      mapRef.current      = null;
      rendererRef.current = null;
      pointLayerRef.current   = null;
      choroplethRef.current   = null;
    };
  }, []);

  // ── Init map, canvas renderer, and point layer — all once ───────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const center = initialView?.center ?? [46.5, 2.5] as [number, number];
    const zoom   = initialView?.zoom   ?? 6;

    let map: L.Map;
    try {
      suppressMoveRef.current = true;
      map = L.map(container, { zoomControl: true }).setView(center, zoom);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      const renderer = L.canvas({ padding: 0.5 });
      rendererRef.current = renderer;

      type CanvasInternal = { _update: () => void; _ctx: unknown };
      const ri = renderer as unknown as CanvasInternal;
      const origUpdate = ri._update.bind(renderer);
      ri._update = function () { if (ri._ctx) origUpdate(); };

      pointLayerRef.current = L.featureGroup().addTo(map);
      mapRef.current = map;
    } catch {
      return;
    }

    map.on("moveend", () => {
      if (suppressMoveRef.current) { suppressMoveRef.current = false; return; }
      const b = map.getBounds();
      const c = map.getCenter();
      onMapChangeRef.current({
        bbox:   { latMin: b.getSouth(), latMax: b.getNorth(), lonMin: b.getWest(), lonMax: b.getEast() },
        center: [c.lat, c.lng],
        zoom:   map.getZoom(),
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Update point markers ────────────────────────────────────────────────────
  useEffect(() => {
    const map      = mapRef.current;
    const renderer = rendererRef.current;
    const layer    = pointLayerRef.current;
    if (!map || !renderer || !layer) return;

    // Always clear; in choropleth mode we leave the layer empty.
    layer.clearLayers();
    if (mode !== "points" || points.length === 0) return;

    const filterChanged = filterKey !== prevFilterKeyRef.current;
    prevFilterKeyRef.current = filterKey;

    for (const pt of points) {
      L.circleMarker([pt.latitude, pt.longitude], {
        renderer,
        radius: 5,
        fillColor: priceToColor(pt.price_eur, p5, p95),
        color: "rgba(0,0,0,0.15)",
        weight: 0.5,
        fillOpacity: 0.8,
      })
        .bindPopup(buildPopupHtml(pt), { maxWidth: 320 })
        .addTo(layer);
    }

    if (filterChanged) {
      const lats = points.map((p) => p.latitude);
      const lngs = points.map((p) => p.longitude);
      suppressMoveRef.current = true;
      map.fitBounds(
        [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
        { padding: [30, 30], maxZoom: 12 }
      );
    }
  }, [mode, points, p5, p95, filterKey]);

  // ── Update choropleth layer ─────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Tear down the previous choropleth layer before rebuilding.
    if (choroplethRef.current) {
      choroplethRef.current.remove();
      choroplethRef.current = null;
    }

    if (mode === "points" || !geojson || choroplethRows.length === 0) return;

    const filterChanged = filterKey !== prevFilterKeyRef.current;
    prevFilterKeyRef.current = filterKey;

    const statsMap = new Map(choroplethRows.map((r) => [r.code, r]));

    // p5/p95 of visible median prices for the colour scale.
    const prices = choroplethRows
      .map((r) => r.median_price)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    const cp5  = prices[Math.floor(prices.length * 0.05)] ?? prices[0]             ?? 0;
    const cp95 = prices[Math.floor(prices.length * 0.95)] ?? prices[prices.length - 1] ?? 1_000_000;

    // Only render features that have DuckDB data — avoids drawing all 36k communes.
    const visible = geojson.features.filter((f) => statsMap.has(f.properties?.code));
    if (visible.length === 0) return;

    const layer = L.geoJSON(({ ...geojson, features: visible }) as GeoJSON.GeoJsonObject, {
      style: (feature) => {
        const stats = statsMap.get(feature?.properties?.code);
        if (!stats?.median_price) {
          return { fillColor: "#cbd5e1", fillOpacity: 0.5, weight: 0.8, color: "#fff" };
        }
        return {
          fillColor: priceToColor(stats.median_price, cp5, cp95),
          fillOpacity: 0.75,
          weight: 0.8,
          color: "#fff",
        };
      },
      onEachFeature: (feature, lyr) => {
        const nom   = feature.properties?.nom ?? feature.properties?.code ?? "?";
        const stats = statsMap.get(feature.properties?.code);
        lyr.bindTooltip(buildChoroplethTooltip(nom, stats), { sticky: true });
        lyr.on("mouseover", function (this: L.Layer) {
          (this as L.Path).setStyle({ fillOpacity: 0.95, weight: 1.5 });
        });
        lyr.on("mouseout", function (this: L.Layer) {
          layer.resetStyle(this as L.Path);
        });
      },
    }).addTo(map);

    choroplethRef.current = layer;

    if (filterChanged) {
      suppressMoveRef.current = true;
      map.fitBounds(layer.getBounds(), { padding: [30, 30] });
    }
  }, [mode, choroplethRows, geojson, filterKey]);

  // ── Legend ──────────────────────────────────────────────────────────────────

  // Compute legend bounds from whichever dataset is active.
  let legendP5 = p5, legendP95 = p95;
  if (mode !== "points" && choroplethRows.length > 0) {
    const prices = choroplethRows
      .map((r) => r.median_price)
      .filter((v): v is number => v != null)
      .sort((a, b) => a - b);
    legendP5  = prices[Math.floor(prices.length * 0.05)] ?? 0;
    legendP95 = prices[Math.floor(prices.length * 0.95)] ?? 1_000_000;
  }

  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) =>
    `€${Math.round(legendP5 + t * (legendP95 - legendP5)).toLocaleString(N)}`
  );

  const legendLabel =
    mode === "department" ? "Colour: median sale price by department"
    : mode === "commune"  ? "Colour: median sale price by commune"
    : "Colour: 5th–95th percentile of displayed prices";

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="w-full rounded-lg overflow-hidden border border-slate-200"
        style={{ height: 380 }}
      />
      <div className="px-1 space-y-1">
        <div
          className="h-3 rounded"
          style={{
            background:
              "linear-gradient(to right,hsl(120,80%,42%),hsl(90,80%,42%),hsl(60,80%,42%),hsl(30,80%,42%),hsl(0,80%,42%))",
          }}
        />
        <div className="flex justify-between text-xs text-slate-500">
          {stops.map((label, i) => <span key={i}>{label}</span>)}
        </div>
        <p className="text-xs text-slate-400 text-center">{legendLabel}</p>
      </div>
    </div>
  );
}
