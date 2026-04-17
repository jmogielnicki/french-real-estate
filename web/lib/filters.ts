// Filter state + SQL builders shared across charts.

export type Granularity = "year" | "month" | "week";
export type SplitBy = "none" | "type" | "n_houses";

/** Geographic bounding box — used to spatially restrict map + card queries. */
export interface Bbox {
  latMin: number;
  latMax: number;
  lonMin: number;
  lonMax: number;
}

/**
 * Returns the AND fragment (no leading WHERE) for a bbox, or "" when null.
 * Caller must ensure the main WHERE clause already exists before appending.
 */
export function bboxSql(bbox: Bbox | null): string {
  if (!bbox) return "";
  return (
    ` AND latitude  BETWEEN ${bbox.latMin}  AND ${bbox.latMax}` +
    ` AND longitude BETWEEN ${bbox.lonMin} AND ${bbox.lonMax}`
  );
}

/** A single building constraint in the building spec filter. */
export interface BuildingSpec {
  /** Unique ID for React key management — never included in SQL. */
  id: string;
  type: "Maison" | "Appartement" | "any";
  areaMin: number | null;
  areaMax: number | null;
  roomsMin: number | null;
  roomsMax: number | null;
}

/** Maximum number of building specs a user can add. */
export const MAX_BUILDING_SPECS = 5;

/** Maximum n_houses category we display when splitting by N houses. */
export const N_HOUSES_CAP = 5;

/** Category labels per SplitBy mode (in render order). */
export const SPLIT_CATEGORIES: Record<Exclude<SplitBy, "none">, string[]> = {
  type: ["Maison", "Appartement", "Mixed"],
  n_houses: ["1", "2", "3", "4", "5"],
};

/** Stable color palette for split series. */
export const PALETTE = [
  "#3b82f6", // blue
  "#10b981", // green
  "#f59e0b", // amber
  "#ef4444", // red
  "#8b5cf6", // violet
];

/** SQL expression that produces the split label, or null if no split. */
export function splitSQL(split: SplitBy): string | null {
  switch (split) {
    case "none":
      return null;
    case "type":
      return `CASE
        WHEN n_maisons > 0 AND n_appartements = 0 THEN 'Maison'
        WHEN n_appartements > 0 AND n_maisons = 0 THEN 'Appartement'
        WHEN n_maisons > 0 AND n_appartements > 0 THEN 'Mixed'
      END`;
    case "n_houses":
      return `CAST(n_maisons AS VARCHAR)`;
  }
}

/**
 * Extra WHERE constraints implied by the split (e.g. cap n_houses at 5).
 * Returned as plain SQL fragments to AND together.
 */
export function splitConstraints(split: SplitBy): string[] {
  switch (split) {
    case "n_houses":
      return [`n_maisons BETWEEN 1 AND ${N_HOUSES_CAP}`];
    default:
      return [];
  }
}

export interface Filters {
  yearMin: number;
  yearMax: number;
  /** INSEE department code, or 'all' */
  department: string;
  /** € lower bound, null = no bound */
  priceMin: number | null;
  /** € upper bound, null = no bound */
  priceMax: number | null;
  /** Total built area lower bound (m²), null = no bound */
  areaMin: number | null;
  /** Total built area upper bound (m²), null = no bound */
  areaMax: number | null;
  /** Land area lower bound (m²), null = no bound */
  landAreaMin: number | null;
  /** Land area upper bound (m²), null = no bound */
  landAreaMax: number | null;
  /**
   * Per-building constraints. Each spec must be matched by at least one
   * building in the sale. Identical specs require that many distinct
   * buildings (e.g. two "Maison ≥ 5 rooms" specs → at least 2 such Maisons).
   */
  buildingSpecs: BuildingSpec[];
}

export const DEFAULT_FILTERS: Filters = {
  yearMin: 2021,
  yearMax: 2025,
  department: "all",
  priceMin: null,
  priceMax: null,
  areaMin: null,
  areaMax: null,
  landAreaMin: null,
  landAreaMax: null,
  buildingSpecs: [],
};

/** Build the lambda condition string for a single building spec. */
function buildSpecLambda(spec: BuildingSpec): string {
  const parts: string[] = [];
  if (spec.type !== "any") parts.push(`b.type = '${spec.type}'`);
  if (spec.areaMin !== null) parts.push(`b.area_m2 >= ${spec.areaMin}`);
  if (spec.areaMax !== null) parts.push(`b.area_m2 <= ${spec.areaMax}`);
  if (spec.roomsMin !== null) parts.push(`b.rooms >= ${spec.roomsMin}`);
  if (spec.roomsMax !== null) parts.push(`b.rooms <= ${spec.roomsMax}`);
  return parts.length > 0 ? parts.join(" AND ") : "TRUE";
}

/** Build a SQL WHERE clause (including the WHERE keyword, or empty string). */
export function buildWhere(f: Filters): string {
  const parts: string[] = [];

  parts.push(`year BETWEEN ${f.yearMin} AND ${f.yearMax}`);

  if (f.department !== "all") {
    const safe = f.department.replace(/'/g, "''");
    parts.push(`department_code = '${safe}'`);
  }

  if (f.priceMin !== null) parts.push(`price_eur >= ${f.priceMin}`);
  if (f.priceMax !== null) parts.push(`price_eur <= ${f.priceMax}`);
  if (f.areaMin !== null) parts.push(`built_area_m2 >= ${f.areaMin}`);
  if (f.areaMax !== null) parts.push(`built_area_m2 <= ${f.areaMax}`);
  if (f.landAreaMin !== null) parts.push(`land_area_m2 >= ${f.landAreaMin}`);
  if (f.landAreaMax !== null) parts.push(`land_area_m2 <= ${f.landAreaMax}`);

  // Building specs: group by fingerprint so duplicates become a count requirement.
  // e.g. two "Maison ≥ 5 rooms" specs → len(list_filter(...)) >= 2
  if (f.buildingSpecs.length > 0) {
    const specCounts = new Map<string, number>();
    for (const spec of f.buildingSpecs) {
      const lambda = buildSpecLambda(spec);
      specCounts.set(lambda, (specCounts.get(lambda) ?? 0) + 1);
    }
    for (const [lambda, count] of specCounts.entries()) {
      parts.push(`len(list_filter(buildings, b -> ${lambda})) >= ${count}`);
    }
  }

  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}

/** A SQL fragment that evaluates to the time-bucket label for the chart's X axis. */
export function timeBucketSQL(g: Granularity): string {
  switch (g) {
    case "year":
      return `CAST(year AS VARCHAR)`;
    case "month":
      return `STRFTIME(sale_date, '%Y-%m')`;
    case "week":
      return `STRFTIME(DATE_TRUNC('week', sale_date), '%Y-%m-%d')`;
  }
}

/** Stable hash for a filter set — used to memoize/refetch chart queries. */
export function filterKey(f: Filters, g: Granularity, s: SplitBy = "none"): string {
  return JSON.stringify({ ...f, g, s });
}
