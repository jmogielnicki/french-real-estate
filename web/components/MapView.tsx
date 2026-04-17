"use client";

// Loaded via next/dynamic({ ssr: false }) — window is guaranteed to exist.
// Leaflet CSS is imported globally in app/globals.css.
import L from "leaflet";
import { useEffect, useRef } from "react";
import { formatSaleDate, type Building } from "@/components/SaleCard";
import type { Bbox } from "@/lib/filters";

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

export interface MapChange {
  bbox: Bbox;
  center: [number, number];
  zoom: number;
}

interface Props {
  points: MapPoint[];
  p5: number;
  p95: number;
  /** Passed down from the filter key — changes only when the user's filters
   *  change (not when the map viewport changes). When this changes MapView
   *  auto-fits bounds to the new result set. */
  filterKey: string;
  /** Called once per user-initiated map move (pan / zoom). NOT called for
   *  programmatic moves such as fitBounds. */
  onMapChange: (change: MapChange) => void;
  /** If supplied, the map opens at this position rather than default France. */
  initialView?: { center: [number, number]; zoom: number };
}

// ── colour helpers ────────────────────────────────────────────────────────────

function priceToColor(price: number, p5: number, p95: number): string {
  const t = Math.max(0, Math.min(1, (price - p5) / Math.max(1, p95 - p5)));
  return `hsl(${Math.round(120 * (1 - t))}, 80%, 42%)`;
}

// ── popup HTML ────────────────────────────────────────────────────────────────

const N = "en-GB"; // comma thousands separator

function buildPopupHtml(pt: MapPoint): string {
  const badgeStyle =
    pt.primary_type === "Maison"
      ? "background:#d1fae5;color:#065f46"
      : pt.primary_type === "Appartement"
      ? "background:#dbeafe;color:#1e40af"
      : "background:#fef3c7;color:#92400e";

  const priceStr   = `€${pt.price_eur.toLocaleString(N)}`;
  const perM2Str   = pt.price_per_m2 != null ? `€${Math.round(pt.price_per_m2).toLocaleString(N)}/m²` : null;
  const areaStr    = pt.built_area_m2  != null ? `${pt.built_area_m2.toLocaleString(N)} m² built`   : null;
  const landStr    = pt.land_area_m2   != null ? `${pt.land_area_m2.toLocaleString(N)} m² land`     : null;
  const metaLine   = [areaStr, perM2Str].filter(Boolean).join(" · ");
  const landLine   = landStr ?? "";
  const dateStr    = formatSaleDate(pt.sale_date, { iso: true });
  const mapsUrl    = `https://www.google.com/maps?q=${pt.latitude},${pt.longitude}`;

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
      ${landLine  ? `<div style="font-size:12px;color:#64748b;margin-top:1px">${landLine}</div>`  : ""}
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

// ── component ─────────────────────────────────────────────────────────────────

export default function MapView({ points, p5, p95, filterKey, onMapChange, initialView }: Props) {
  const containerRef     = useRef<HTMLDivElement>(null);
  const mapRef           = useRef<L.Map | null>(null);
  // The canvas renderer and feature group are created ONCE and reused;
  // we call clearLayers() on updates instead of removing/recreating to
  // avoid mid-zoom canvas teardown errors.
  const rendererRef      = useRef<L.Canvas | null>(null);
  const layerRef         = useRef<L.FeatureGroup | null>(null);
  const prevFilterKeyRef = useRef<string | null>(null);
  // True while a programmatic fitBounds / setView is in flight so we can
  // ignore the resulting moveend (it's not a user gesture).
  const suppressMoveRef  = useRef(false);
  const onMapChangeRef   = useRef(onMapChange);
  useEffect(() => { onMapChangeRef.current = onMapChange; }, [onMapChange]);

  // ── Destroy on unmount ──────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      try {
        // Cancel any pending canvas RAF before removing the map. Leaflet's
        // Canvas renderer stores its RAF id in _frame and deletes _ctx when
        // removed. If the RAF fires after _ctx is deleted we get
        // "Cannot read properties of undefined (reading 'save')".
        const frame = (rendererRef.current as unknown as { _frame?: number })?._frame;
        if (typeof frame === "number") cancelAnimationFrame(frame);
        mapRef.current?.remove();
      } catch { /* StrictMode cleanup race — safe to ignore */ }
      mapRef.current      = null;
      rendererRef.current = null;
      layerRef.current    = null;
    };
  }, []);

  // ── Init Leaflet map, canvas renderer, and feature group — all once ─────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;

    const center = initialView?.center ?? [46.5, 2.5] as [number, number];
    const zoom   = initialView?.zoom   ?? 6;

    let map: L.Map;
    try {
      suppressMoveRef.current = true; // suppress the initial setView moveend
      map = L.map(container, { zoomControl: true }).setView(center, zoom);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(map);

      // One shared canvas renderer — stays alive for the life of the map.
      const renderer = L.canvas({ padding: 0.5 });
      rendererRef.current = renderer;

      // Belt-and-suspenders: patch _update so it's a no-op when _ctx has been
      // deleted (Leaflet does `delete this._ctx` in Canvas.onRemove, but a
      // queued RAF may still fire afterward).
      type CanvasInternal = { _update: () => void; _ctx: unknown };
      const ri = renderer as unknown as CanvasInternal;
      const origUpdate = ri._update.bind(renderer);
      ri._update = function () { if (ri._ctx) origUpdate(); };

      // One shared feature group — we clearLayers() it on each update instead
      // of removing and recreating, so the canvas is never torn down mid-zoom.
      layerRef.current = L.featureGroup().addTo(map);

      mapRef.current = map;
    } catch {
      return; // container still dirty from StrictMode; next cycle will succeed
    }

    map.on("moveend", () => {
      if (suppressMoveRef.current) {
        suppressMoveRef.current = false;
        return;
      }
      const b = map.getBounds();
      const c = map.getCenter();
      onMapChangeRef.current({
        bbox: { latMin: b.getSouth(), latMax: b.getNorth(), lonMin: b.getWest(), lonMax: b.getEast() },
        center: [c.lat, c.lng],
        zoom: map.getZoom(),
      });
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // runs once

  // ── Update markers whenever points / colour scale / filterKey change ────────
  useEffect(() => {
    const map      = mapRef.current;
    const renderer = rendererRef.current;
    const layer    = layerRef.current;
    if (!map || !renderer || !layer) return;

    // Detect filter (not bbox) changes — only these trigger auto-fit.
    const filterChanged = filterKey !== prevFilterKeyRef.current;
    prevFilterKeyRef.current = filterKey;

    // Clear existing markers without removing the layer or renderer from the
    // map — this is the key fix. The canvas element stays alive and attached.
    layer.clearLayers();

    if (points.length === 0) return;

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

    // Fit to results only when the user's filters changed (not on pan/zoom re-queries).
    if (filterChanged) {
      const lats = points.map((p) => p.latitude);
      const lngs = points.map((p) => p.longitude);
      suppressMoveRef.current = true; // don't treat fitBounds as user interaction
      map.fitBounds(
        [[Math.min(...lats), Math.min(...lngs)], [Math.max(...lats), Math.max(...lngs)]],
        { padding: [30, 30], maxZoom: 12 }
      );
    }
  }, [points, p5, p95, filterKey]);

  // ── Legend ──────────────────────────────────────────────────────────────────
  const stops = [0, 0.25, 0.5, 0.75, 1].map((t) =>
    `€${Math.round(p5 + t * (p95 - p5)).toLocaleString(N)}`
  );

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
        <p className="text-xs text-slate-400 text-center">
          Colour: 5th–95th percentile of displayed prices
        </p>
      </div>
    </div>
  );
}
