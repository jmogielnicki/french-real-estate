# French Property Analysis — Claude instructions

## Project overview
DVF+ Explorer: 4.6M French residential property sales (2021–2025) queried
in-browser via DuckDB-WASM. Next.js 15 / React 19 / Leaflet / Recharts frontend,
Python data pipeline producing Parquet files served statically.

## Stack
- **Frontend**: `web/` — Next.js 15 App Router, React 19, Tailwind, DuckDB-WASM, Leaflet, Recharts
- **Data pipeline**: `scripts/derive_tables.py` — DuckDB Python, outputs `data/parquet_derived/sales.parquet`
- **Notebooks**: exploratory analysis in `notebooks/`

## Key conventions
- DuckDB-WASM requires cross-origin isolation; headers set in `web/next.config.mjs`
- Leaflet must be loaded client-side only via `next/dynamic({ ssr: false })`
- Leaflet CSS imported globally in `web/app/globals.css`
- All monetary/area numbers formatted with `en-GB` locale (comma thousands separator)
- Dates from DuckDB arrive as JS `Date` objects at midnight UTC — always use `formatSaleDate()` from `SaleCard.tsx`

## Git workflow
Follow the global git workflow instructions. Feature branches should be named
descriptively (e.g. `explorer-ui-improvements`, `data-pipeline-v2`).
