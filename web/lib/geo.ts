import type { FeatureCollection } from "geojson";

// Module-level promise cache — each file is fetched at most once per page load.
// Using promises (not just the resolved value) prevents duplicate in-flight requests.

let deptPromise:    Promise<FeatureCollection> | null = null;
let communePromise: Promise<FeatureCollection> | null = null;

export function fetchDeptGeoJson(): Promise<FeatureCollection> {
  if (!deptPromise) {
    deptPromise = fetch("/geo/departements.geojson").then((r) => {
      if (!r.ok) throw new Error(`Failed to load departements.geojson: ${r.status}`);
      return r.json() as Promise<FeatureCollection>;
    });
  }
  return deptPromise;
}

export function fetchCommuneGeoJson(): Promise<FeatureCollection> {
  if (!communePromise) {
    communePromise = fetch("/geo/communes.geojson").then((r) => {
      if (!r.ok) throw new Error(`Failed to load communes.geojson: ${r.status}`);
      return r.json() as Promise<FeatureCollection>;
    });
  }
  return communePromise;
}
