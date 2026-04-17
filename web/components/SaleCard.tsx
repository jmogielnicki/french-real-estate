"use client";

// Shared sale card component used by both SaleLookup and PropertiesPanel.

export interface Building {
  type: string;
  area_m2: number;
  rooms: number;
}

export interface Sale {
  id_mutation: string;
  /** DuckDB-WASM returns DATE columns as JS Date objects (midnight UTC). */
  sale_date: Date | string;
  year: number;
  price_eur: number;
  department_code: string;
  commune_code: string;
  commune_name: string;
  postal_code: string;
  latitude: number | null;
  longitude: number | null;
  n_maisons: number;
  n_appartements: number;
  built_area_m2: number | null;
  rooms_min: number | null;
  rooms_max: number | null;
  rooms_total: number | null;
  land_area_m2: number | null;
  primary_type: string;
  composition: string | null;
  price_per_m2: number | null;
  buildings: Building[] | null;
}

// DuckDB-WASM may hand back LIST(STRUCT) values as Arrow vectors that
// iterate but aren't plain arrays. Normalize to a flat array of plain objects.
export function normalizeBuildings(raw: unknown): Building[] {
  if (!raw) return [];
  const iter = Array.isArray(raw) ? raw : Array.from(raw as Iterable<unknown>);
  return iter.map((b) => {
    const obj = (
      b && typeof (b as { toJSON?: () => unknown }).toJSON === "function"
        ? (b as { toJSON: () => unknown }).toJSON()
        : b
    ) as Record<string, unknown>;
    return {
      type: String(obj.type ?? ""),
      area_m2: Number(obj.area_m2 ?? 0),
      rooms: Number(obj.rooms ?? 0),
    };
  });
}

/**
 * Safely format a sale date that may arrive as a JS Date object (DuckDB-WASM
 * returns DATE columns as midnight-UTC Date) or an ISO string.
 *
 * Pass `iso: true` to get a plain "YYYY-MM-DD" string (for table cells).
 * Otherwise returns a human-readable French locale string.
 */
export function formatSaleDate(raw: Date | string | null | undefined, opts?: { iso: true }): string {
  if (!raw) return "—";
  // If it's already a Date, use it; otherwise try to parse.
  const d: Date = raw instanceof Date ? raw : new Date(raw as string);
  if (isNaN(d.getTime())) return String(raw);
  if (opts?.iso) {
    // UTC year/month/day to avoid off-by-one in non-UTC timezones.
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC", // DATE values are midnight UTC — display in UTC to avoid off-by-one
  });
}

// "en-GB" uses commas as thousands separators (1,234,567) — used for all
// displayed numbers throughout the app.
const N = "en-GB";

export const fmt = {
  eur: (v: number) => `€${v.toLocaleString(N)}`,
  m2: (v: number | null) => (v != null ? `${v.toLocaleString(N)} m²` : "—"),
  num: (v: number | null) => (v != null ? v.toLocaleString(N) : "—"),
};

export function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-slate-500 text-xs">{label}: </span>
      <span className="font-medium text-slate-800">{value}</span>
    </div>
  );
}

interface SaleCardProps {
  sale: Sale;
  /** If provided, renders a close (×) button in the header. */
  onClose?: () => void;
}

export function SaleCard({ sale, onClose }: SaleCardProps) {
  const typeColor =
    sale.primary_type === "Maison"
      ? "bg-emerald-100 text-emerald-800"
      : sale.primary_type === "Appartement"
      ? "bg-blue-100 text-blue-800"
      : "bg-amber-100 text-amber-800";

  const mapsUrl =
    sale.latitude && sale.longitude
      ? `https://www.google.com/maps?q=${sale.latitude},${sale.longitude}`
      : null;

  const buildings = normalizeBuildings(sale.buildings);

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 bg-slate-50 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm font-semibold text-slate-800">
              {sale.id_mutation}
            </span>
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${typeColor}`}
            >
              {sale.primary_type}
            </span>
            {sale.composition && (
              <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-slate-200 text-slate-700">
                {sale.composition}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {sale.commune_name} ({sale.department_code}) · {sale.postal_code} ·{" "}
            {formatSaleDate(sale.sale_date)}
          </p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-lg leading-none ml-4"
            aria-label="Close"
          >
            ×
          </button>
        )}
      </div>

      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y sm:divide-y-0 divide-slate-100">
        {[
          { label: "Sale price", value: fmt.eur(sale.price_eur) },
          {
            label: "Price / m²",
            value:
              sale.price_per_m2 != null
                ? fmt.eur(Math.round(sale.price_per_m2)) + "/m²"
                : "—",
          },
          { label: "Built area", value: fmt.m2(sale.built_area_m2) },
          { label: "Land area", value: fmt.m2(sale.land_area_m2) },
        ].map(({ label, value }) => (
          <div key={label} className="px-4 py-3">
            <p className="text-xs text-slate-500">{label}</p>
            <p className="text-lg font-semibold text-slate-800 mt-0.5">
              {value}
            </p>
          </div>
        ))}
      </div>

      {/* Per-building breakdown */}
      {buildings.length > 0 && (
        <div className="px-4 py-3 border-t border-slate-100">
          <p className="text-xs text-slate-500 mb-2">
            Buildings ({buildings.length})
          </p>
          <table className="text-sm w-full">
            <thead>
              <tr className="text-slate-500 text-xs border-b border-slate-100">
                <th className="text-left font-normal pb-1">Type</th>
                <th className="text-right font-normal pb-1">Area</th>
                <th className="text-right font-normal pb-1">Rooms</th>
              </tr>
            </thead>
            <tbody>
              {buildings.map((b, i) => (
                <tr key={i} className="border-b border-slate-50 last:border-0">
                  <td className="py-1 text-slate-700">{b.type}</td>
                  <td className="py-1 text-right text-slate-700 tabular-nums">
                    {b.area_m2.toLocaleString("fr-FR")} m²
                  </td>
                  <td className="py-1 text-right text-slate-700 tabular-nums">
                    {b.rooms}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail grid */}
      <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 border-t border-slate-100 text-sm">
        <Field label="Maisons" value={fmt.num(sale.n_maisons)} />
        <Field label="Appartements" value={fmt.num(sale.n_appartements)} />
        <Field
          label="Rooms total"
          value={sale.rooms_total != null ? String(sale.rooms_total) : "—"}
        />
        <Field label="Commune code" value={sale.commune_code} />
        <Field label="Department" value={sale.department_code} />
        <Field label="Year" value={String(sale.year)} />
        {mapsUrl && (
          <div className="sm:col-span-3 pt-1">
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-blue-600 hover:underline text-xs"
            >
              📍 View on Google Maps ({sale.latitude?.toFixed(5)},{" "}
              {sale.longitude?.toFixed(5)})
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
