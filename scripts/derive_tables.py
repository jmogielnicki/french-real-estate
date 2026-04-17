"""Build derived sale-level tables.

Writes:
  data/parquet_derived/sales_residential.parquet
      One row per id_mutation. Residential filter applied:
        - n_rows <= 10             (drop portfolio/bulk)
        - valeur_fonciere >= 1000  (drop symbolic transfers)
        - n_communes = 1           (single-commune sales only)
        - nature_mutation = Vente  (straight sales, not exchanges/auctions)
        - at least 1 Maison or Appartement in the mutation

DEDUPLICATION NOTE
  In DVF, the same physical building can appear on multiple rows within a
  single mutation — once per cadastral parcel it touches.  Concretely, a
  130 m²/5-piece house that straddles two land parcels will generate two
  Maison rows with identical surface_reelle_bati and nombre_pieces_principales.

  To count and measure distinct *physical buildings*, we first deduplicate
  within each (id_mutation, type_local) group by
  (surface_reelle_bati, nombre_pieces_principales).  Rows with the same
  (surface, pieces) for the same type are collapsed into one; rows with
  different (surface, pieces) each contribute one distinct building.
"""
from __future__ import annotations

import time
from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
SRC = str(ROOT / "data" / "parquet" / "year=*" / "*.parquet")
OUT_DIR = ROOT / "data" / "parquet_derived"
OUT = OUT_DIR / "sales_residential.parquet"


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute(f"CREATE VIEW dvf AS SELECT * FROM read_parquet('{SRC}', hive_partitioning=true)")

    t0 = time.time()
    con.execute(f"""
        COPY (
          -- Step 1: deduplicate buildings within each sale.
          -- One row per distinct (id_mutation, type_local, surface, pieces) combo.
          -- This collapses same-building-multiple-parcels into a single row.
          WITH deduped_buildings AS (
            SELECT DISTINCT
              id_mutation,
              type_local,
              surface_reelle_bati,
              nombre_pieces_principales
            FROM dvf
            WHERE type_local IN ('Maison', 'Appartement')
              AND surface_reelle_bati IS NOT NULL
              AND surface_reelle_bati > 0
          ),

          -- Step 2: per-sale building metrics from deduplicated rows.
          -- `buildings` preserves the per-building detail (type + area + rooms)
          -- that the flat aggregates lose.  It's a LIST(STRUCT) so DuckDB can
          -- UNNEST it for building-level analytics without a second table.
          building_agg AS (
            SELECT
              id_mutation,
              SUM(type_local = 'Maison')::INT       AS n_maisons,
              SUM(type_local = 'Appartement')::INT  AS n_appartements,
              SUM(surface_reelle_bati)               AS built_area_m2,
              SUM(nombre_pieces_principales)::INT    AS rooms_total,
              MIN(nombre_pieces_principales)::INT    AS rooms_min,
              MAX(nombre_pieces_principales)::INT    AS rooms_max,
              LIST({{
                'type':    type_local,
                'area_m2': surface_reelle_bati::INT,
                'rooms':   nombre_pieces_principales::INT
              }} ORDER BY type_local, surface_reelle_bati DESC) AS buildings
            FROM deduped_buildings
            GROUP BY id_mutation
          ),

          -- Step 3: all other sale-level fields from the raw table.
          sale_agg AS (
            SELECT
              id_mutation,
              ANY_VALUE(date_mutation)    AS sale_date,
              ANY_VALUE(year)             AS year,
              ANY_VALUE(valeur_fonciere)  AS price_eur,
              ANY_VALUE(nature_mutation)  AS transaction_type,
              ANY_VALUE(code_departement) AS department_code,
              ANY_VALUE(code_commune)     AS commune_code,
              ANY_VALUE(nom_commune)      AS commune_name,
              ANY_VALUE(code_postal)      AS postal_code,
              COUNT(*)                             AS n_rows,
              COUNT(DISTINCT code_commune)         AS n_communes,
              -- Raw row counts (pre-dedup) kept for diagnostics
              SUM(type_local = 'Maison')::INT                                   AS n_maison_rows,
              SUM(type_local = 'Appartement')::INT                              AS n_appartement_rows,
              SUM(type_local = 'Dépendance')::INT                               AS n_dependances,
              SUM(type_local = 'Local industriel. commercial ou assimilé')::INT AS n_commercial,
              SUM(type_local IS NULL)::INT                                      AS n_parcel_rows,
              SUM(surface_terrain)                                              AS land_area_m2,
              -- Coordinates: prefer Maison > Appartement > any non-null
              COALESCE(
                ANY_VALUE(latitude)  FILTER (WHERE type_local = 'Maison'      AND latitude IS NOT NULL),
                ANY_VALUE(latitude)  FILTER (WHERE type_local = 'Appartement' AND latitude IS NOT NULL),
                ANY_VALUE(latitude)  FILTER (WHERE latitude IS NOT NULL)
              ) AS latitude,
              COALESCE(
                ANY_VALUE(longitude) FILTER (WHERE type_local = 'Maison'      AND longitude IS NOT NULL),
                ANY_VALUE(longitude) FILTER (WHERE type_local = 'Appartement' AND longitude IS NOT NULL),
                ANY_VALUE(longitude) FILTER (WHERE longitude IS NOT NULL)
              ) AS longitude
            FROM dvf
            GROUP BY id_mutation
          ),

          -- Step 4: join and compute derived fields.
          joined AS (
            SELECT
              s.id_mutation,
              s.sale_date,
              s.year,
              s.price_eur,
              s.transaction_type,
              s.department_code,
              s.commune_code,
              s.commune_name,
              s.postal_code,
              s.n_rows,
              s.n_communes,
              -- Deduplicated building counts (what matters for analysis)
              COALESCE(b.n_maisons,      0)::INT AS n_maisons,
              COALESCE(b.n_appartements, 0)::INT AS n_appartements,
              -- Raw row counts retained for transparency / audit
              s.n_maison_rows,
              s.n_appartement_rows,
              s.n_dependances,
              s.n_commercial,
              s.n_parcel_rows,
              COALESCE(b.built_area_m2, 0)       AS built_area_m2,
              b.rooms_total,
              b.rooms_min,
              b.rooms_max,
              b.buildings,
              s.land_area_m2,
              s.latitude,
              s.longitude
            FROM sale_agg s
            LEFT JOIN building_agg b USING (id_mutation)
          )

          SELECT
            *,
            CASE WHEN n_maisons > 0 AND n_appartements = 0 THEN 'Maison'
                 WHEN n_appartements > 0 AND n_maisons = 0 THEN 'Appartement'
                 WHEN n_maisons > 0 AND n_appartements > 0 THEN 'Mixed'
                 ELSE NULL END                                    AS primary_type,
            -- Short composition key like "1M", "2M", "1M+1A", "2A".
            -- Useful for split-by and for distinguishing "house + apartment"
            -- sales from pure multi-house sales.
            CASE
              WHEN n_maisons > 0 AND n_appartements > 0
                THEN CAST(n_maisons AS VARCHAR) || 'M+' || CAST(n_appartements AS VARCHAR) || 'A'
              WHEN n_maisons > 0      THEN CAST(n_maisons AS VARCHAR)      || 'M'
              WHEN n_appartements > 0 THEN CAST(n_appartements AS VARCHAR) || 'A'
              ELSE NULL
            END                                                   AS composition,
            CASE WHEN built_area_m2 > 10 AND price_eur > 0
                 THEN price_eur / built_area_m2 END               AS price_per_m2
          FROM joined
          WHERE n_rows <= 10
            AND price_eur >= 1000
            AND n_communes = 1
            AND transaction_type = 'Vente'
            AND (n_maisons > 0 OR n_appartements > 0)

        ) TO '{OUT.as_posix()}' (FORMAT PARQUET, COMPRESSION ZSTD)
    """)

    elapsed = time.time() - t0
    size_mb = OUT.stat().st_size / 1e6
    p = OUT.as_posix()
    n = con.execute(f"SELECT COUNT(*) FROM read_parquet('{p}')").fetchone()[0]
    print(f"wrote {OUT}  ({n:,} sales, {size_mb:.1f} MB, {elapsed:.1f}s)")

    print("\nBy year:")
    print(con.execute(f"""
        SELECT year,
               COUNT(*) AS sales,
               SUM(primary_type = 'Maison')::INT      AS maison_only,
               SUM(primary_type = 'Appartement')::INT AS appt_only,
               SUM(primary_type = 'Mixed')::INT       AS mixed,
               ROUND(MEDIAN(price_eur))               AS median_price,
               ROUND(MEDIAN(price_per_m2))            AS median_eur_per_m2
        FROM read_parquet('{p}')
        GROUP BY year ORDER BY year
    """).df().to_string(index=False))

    print("\n€/m² by n_maisons — should no longer halve at n=2:")
    print(con.execute(f"""
        SELECT n_maisons,
               COUNT(*)                                  AS n_sales,
               ROUND(MEDIAN(price_eur))                  AS med_price,
               ROUND(MEDIAN(built_area_m2))              AS med_built_m2,
               ROUND(MEDIAN(price_per_m2))               AS med_eur_per_m2,
               ROUND(MEDIAN(built_area_m2 / NULLIF(n_maisons,0))) AS med_m2_per_house
        FROM read_parquet('{p}')
        WHERE n_maisons BETWEEN 1 AND 5 AND n_appartements = 0
          AND price_per_m2 BETWEEN 100 AND 30000
        GROUP BY n_maisons ORDER BY n_maisons
    """).df().to_string(index=False))

    print("\nTop 15 compositions:")
    print(con.execute(f"""
        SELECT composition,
               COUNT(*) AS n_sales,
               ROUND(MEDIAN(price_eur))     AS med_price,
               ROUND(MEDIAN(price_per_m2))  AS med_eur_per_m2
        FROM read_parquet('{p}')
        GROUP BY composition
        ORDER BY n_sales DESC
        LIMIT 15
    """).df().to_string(index=False))

    print("\nSample building detail (mutation 2021-43, if present):")
    print(con.execute(f"""
        SELECT id_mutation, composition, buildings
        FROM read_parquet('{p}')
        WHERE id_mutation LIKE '2021-43' OR id_mutation LIKE '%2021-43%'
        LIMIT 3
    """).df().to_string(index=False))

    print("\nn_maisons vs n_maison_rows — dedup impact:")
    print(con.execute(f"""
        SELECT n_maison_rows AS raw_rows, n_maisons AS deduped,
               COUNT(*) AS n_sales
        FROM read_parquet('{p}')
        WHERE n_maison_rows BETWEEN 1 AND 5
        GROUP BY n_maison_rows, n_maisons
        ORDER BY n_maison_rows, n_maisons
        LIMIT 20
    """).df().to_string(index=False))


if __name__ == "__main__":
    main()
