# Data directory

All data files are excluded from git (too large, fully regeneratable from public sources).
Run the three commands below to populate everything needed for notebooks and the webapp.

## Pipeline

```
dvf_plus/dvf-YYYY.csv.gz          ← downloaded from Etalab (~540 MB total)
        │
        │  scripts/ingest.py
        ▼
parquet/year=YYYY/part.parquet    ← full cleaned dataset, 20.4M rows (~550 MB)
        │
        │  scripts/derive_tables.py
        ▼
parquet_derived/
  sales_residential.parquet       ← 4.6M residential sales, one row per sale (~173 MB)
```

## Setup

```bash
# 1. Download DVF+ geocoded CSVs from Etalab (2021–2025, ~540 MB total)
python scripts/download.py

# 2. Convert to year-partitioned Parquet (~30s)
python scripts/ingest.py

# 3. Build the derived residential sales table (~10s)
python scripts/derive_tables.py
```

Total disk: ~1.3 GB for all three tiers. Each step only needs to run once.

## Source

Data: **DVF+ (Demandes de Valeurs Foncières)** from Etalab  
URL: `https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/full.csv.gz`  
License: Licence Ouverte / Open Licence 2.0 (freely reusable)

## What's in parquet_derived/sales_residential.parquet

One row per sale (`id_mutation`), filtered to residential transactions:

| Filter | Effect |
|---|---|
| `nature_mutation = Vente` | Straight sales only (93% of DVF) |
| `n_rows ≤ 10` | Drops portfolio/bulk deals (~2%) |
| `price_eur ≥ €1,000` | Drops symbolic transfers (~4%) |
| `n_communes = 1` | Single-commune sales only (~1%) |
| ≥1 Maison or Appartement | Drops pure terrain/commercial (~22%) |

**Key columns:** `id_mutation`, `sale_date`, `year`, `price_eur`, `department_code`,
`commune_code`, `commune_name`, `postal_code`, `latitude`, `longitude`,
`n_maisons` (deduplicated), `n_appartements` (deduplicated), `built_area_m2`,
`rooms_min`, `rooms_max`, `rooms_total`, `land_area_m2`, `primary_type`,
`price_per_m2`.

**Deduplication note:** `n_maisons` and `built_area_m2` are computed from
`DISTINCT (surface_reelle_bati, nombre_pieces_principales)` pairs per sale.
This prevents double-counting buildings that span multiple cadastral parcels
(a single 130 m² house on two parcels would otherwise appear as two Maisons).

## For the webapp (local dev)

The webapp (`web/`) reads the parquet via a symlink at `web/public/data/`.
After running the pipeline above, the symlink already points to the right place:

```
web/public/data/sales_residential.parquet → ../../../data/parquet_derived/sales_residential.parquet
```

For **production deployment** (Vercel), host the parquet on Cloudflare R2 or
Vercel Blob, then set:

```bash
NEXT_PUBLIC_PARQUET_URL=https://your-bucket.r2.dev/sales_residential.parquet
```

and update `PARQUET_URL` in `web/lib/duckdb.ts` to read from that env var.
