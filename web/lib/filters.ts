// Filter state + SQL builders shared across charts.

export type ResidentialType = "all" | "maison" | "appartement" | "mixed";
export type Granularity = "year" | "month" | "week";
export type SplitBy = "none" | "type" | "n_houses";

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
  type: ResidentialType;
  /** INSEE department code, or 'all' */
  department: string;
  /** € lower bound, null = no bound */
  priceMin: number | null;
  /** € upper bound, null = no bound */
  priceMax: number | null;
  /** Min rooms in any single residential unit, null = no bound. */
  roomsMin: number | null;
  /** Exact n_maisons, null = no constraint. Useful for "exactly 2 houses". */
  exactNMaisons: number | null;
}

export const DEFAULT_FILTERS: Filters = {
  yearMin: 2021,
  yearMax: 2025,
  type: "all",
  department: "all",
  priceMin: null,
  priceMax: null,
  roomsMin: null,
  exactNMaisons: null,
};

/** A SQL fragment that evaluates to the time-bucket label for the chart's X axis. */
export function timeBucketSQL(g: Granularity): string {
  switch (g) {
    case "year":
      return `CAST(year AS VARCHAR)`;
    case "month":
      return `STRFTIME(sale_date, '%Y-%m')`;
    case "week":
      // ISO week start (Monday). Format as the date string for that Monday.
      return `STRFTIME(DATE_TRUNC('week', sale_date), '%Y-%m-%d')`;
  }
}

/** Build a SQL WHERE clause (including the WHERE keyword, or empty string). */
export function buildWhere(f: Filters): string {
  const parts: string[] = [];

  parts.push(`year BETWEEN ${f.yearMin} AND ${f.yearMax}`);

  switch (f.type) {
    case "maison":
      parts.push(`n_maisons > 0 AND n_appartements = 0`);
      break;
    case "appartement":
      parts.push(`n_appartements > 0 AND n_maisons = 0`);
      break;
    case "mixed":
      parts.push(`n_maisons > 0 AND n_appartements > 0`);
      break;
  }

  if (f.department !== "all") {
    // Dept codes are well-formed strings ('01'..'95', '2A','2B', '971'..'976').
    // Escape single quotes defensively.
    const safe = f.department.replace(/'/g, "''");
    parts.push(`department_code = '${safe}'`);
  }

  if (f.priceMin !== null) parts.push(`price_eur >= ${f.priceMin}`);
  if (f.priceMax !== null) parts.push(`price_eur <= ${f.priceMax}`);
  if (f.roomsMin !== null) parts.push(`rooms_min >= ${f.roomsMin}`);
  if (f.exactNMaisons !== null) parts.push(`n_maisons = ${f.exactNMaisons}`);

  return parts.length ? `WHERE ${parts.join(" AND ")}` : "";
}

/** Stable hash for a filter set — used to memoize/refetch chart queries. */
export function filterKey(f: Filters, g: Granularity, s: SplitBy = "none"): string {
  return JSON.stringify({ ...f, g, s });
}
