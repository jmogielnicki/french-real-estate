"""Phase 1 sanity checks on the DVF+ parquet store.

Prints a structured report. Later converted into notebooks/01_shape_and_sanity.ipynb.
"""
from __future__ import annotations

from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
PARQUET_GLOB = str(ROOT / "data" / "parquet" / "year=*" / "*.parquet")


def h(title: str) -> None:
    bar = "=" * 70
    print(f"\n{bar}\n{title}\n{bar}")


def main() -> None:
    con = duckdb.connect()
    con.execute(f"CREATE VIEW dvf AS SELECT * FROM read_parquet('{PARQUET_GLOB}', hive_partitioning=true)")

    h("1. Row counts, unique mutations, and the multi-row ratio")
    print(
        con.execute("""
        SELECT
          year,
          COUNT(*)                             AS rows,
          COUNT(DISTINCT id_mutation)          AS mutations,
          ROUND(COUNT(*)::DOUBLE / COUNT(DISTINCT id_mutation), 3) AS rows_per_mutation
        FROM dvf
        GROUP BY year
        ORDER BY year
        """).df().to_string(index=False)
    )

    h("2. Distribution of rows-per-mutation (how lumpy are sales?)")
    print(
        con.execute("""
        WITH per_mut AS (
          SELECT id_mutation, COUNT(*) AS n
          FROM dvf
          GROUP BY id_mutation
        )
        SELECT
          n AS rows_per_mutation,
          COUNT(*) AS n_mutations
        FROM per_mut
        GROUP BY n
        ORDER BY n
        LIMIT 15
        """).df().to_string(index=False)
    )

    h("2b. Extreme multi-row outliers (top 10 most-row mutations)")
    print(
        con.execute("""
        SELECT id_mutation, COUNT(*) AS n_rows,
               MIN(date_mutation) AS date_min, MAX(date_mutation) AS date_max,
               MIN(valeur_fonciere) AS valeur_min, MAX(valeur_fonciere) AS valeur_max,
               COUNT(DISTINCT code_commune) AS n_communes
        FROM dvf
        GROUP BY id_mutation
        ORDER BY n_rows DESC
        LIMIT 10
        """).df().to_string(index=False)
    )

    h("3. Within a mutation: do key fields stay consistent?")
    print("Mutations where valeur_fonciere varies across rows of the same id_mutation:")
    print(
        con.execute("""
        SELECT COUNT(*) AS mutations_with_inconsistent_valeur
        FROM (
          SELECT id_mutation
          FROM dvf
          WHERE valeur_fonciere IS NOT NULL
          GROUP BY id_mutation
          HAVING COUNT(DISTINCT valeur_fonciere) > 1
        )
        """).df().to_string(index=False)
    )
    print()
    print("Mutations where date_mutation varies across rows:")
    print(
        con.execute("""
        SELECT COUNT(*) AS mutations_with_inconsistent_date
        FROM (
          SELECT id_mutation
          FROM dvf
          GROUP BY id_mutation
          HAVING COUNT(DISTINCT date_mutation) > 1
        )
        """).df().to_string(index=False)
    )
    print()
    print("Mutations spanning multiple communes:")
    print(
        con.execute("""
        SELECT COUNT(*) AS mutations_spanning_multiple_communes
        FROM (
          SELECT id_mutation
          FROM dvf
          GROUP BY id_mutation
          HAVING COUNT(DISTINCT code_commune) > 1
        )
        """).df().to_string(index=False)
    )

    h("4. Nature mutation distribution")
    print(
        con.execute("""
        SELECT nature_mutation, COUNT(DISTINCT id_mutation) AS mutations
        FROM dvf
        GROUP BY nature_mutation
        ORDER BY mutations DESC
        """).df().to_string(index=False)
    )

    h("5. Type local distribution (row-level)")
    print(
        con.execute("""
        SELECT COALESCE(type_local, '(null — terrain/parcel)') AS type_local,
               COUNT(*) AS rows
        FROM dvf
        GROUP BY type_local
        ORDER BY rows DESC
        """).df().to_string(index=False)
    )

    h("6. Missingness on key columns")
    print(
        con.execute("""
        SELECT
          COUNT(*) AS total_rows,
          SUM(CASE WHEN valeur_fonciere   IS NULL THEN 1 ELSE 0 END) AS null_valeur,
          SUM(CASE WHEN latitude          IS NULL THEN 1 ELSE 0 END) AS null_lat,
          SUM(CASE WHEN longitude         IS NULL THEN 1 ELSE 0 END) AS null_lon,
          SUM(CASE WHEN code_commune      IS NULL THEN 1 ELSE 0 END) AS null_commune,
          SUM(CASE WHEN surface_reelle_bati IS NULL THEN 1 ELSE 0 END) AS null_surface_bati,
          SUM(CASE WHEN type_local        IS NULL THEN 1 ELSE 0 END) AS null_type_local,
          SUM(CASE WHEN nombre_pieces_principales IS NULL OR nombre_pieces_principales = 0
                   THEN 1 ELSE 0 END) AS null_or_zero_pieces
        FROM dvf
        """).df().to_string(index=False)
    )

    h("7. Valeur fonciere: distribution and outliers (sale-level)")
    # Sale-level = one row per id_mutation. DVF+ repeats valeur_fonciere on every row,
    # so take the first one.
    print("Percentiles (€):")
    print(
        con.execute("""
        WITH sales AS (
          SELECT id_mutation, ANY_VALUE(valeur_fonciere) AS valeur
          FROM dvf
          WHERE valeur_fonciere IS NOT NULL
          GROUP BY id_mutation
        )
        SELECT
          COUNT(*)                                 AS sales,
          MIN(valeur)                              AS min,
          ROUND(QUANTILE_CONT(valeur, 0.01))       AS p01,
          ROUND(QUANTILE_CONT(valeur, 0.50))       AS p50,
          ROUND(QUANTILE_CONT(valeur, 0.99))       AS p99,
          ROUND(QUANTILE_CONT(valeur, 0.999))      AS p999,
          MAX(valeur)                              AS max
        FROM sales
        """).df().to_string(index=False)
    )
    print()
    print("Top 5 biggest sales (sanity check for plausibility):")
    print(
        con.execute("""
        WITH sales AS (
          SELECT id_mutation,
                 ANY_VALUE(valeur_fonciere) AS valeur,
                 ANY_VALUE(nom_commune)     AS commune,
                 ANY_VALUE(date_mutation)   AS date,
                 ANY_VALUE(nature_mutation) AS nature
          FROM dvf
          GROUP BY id_mutation
        )
        SELECT * FROM sales ORDER BY valeur DESC NULLS LAST LIMIT 5
        """).df().to_string(index=False)
    )

    h("8. Geocoding completeness and null-island check")
    print(
        con.execute("""
        SELECT
          SUM(CASE WHEN latitude IS NOT NULL AND longitude IS NOT NULL THEN 1 ELSE 0 END) AS geocoded_rows,
          SUM(CASE WHEN latitude IS NULL OR longitude IS NULL THEN 1 ELSE 0 END)          AS missing_coords,
          SUM(CASE WHEN latitude = 0 AND longitude = 0 THEN 1 ELSE 0 END)                 AS null_island,
          SUM(CASE WHEN latitude NOT BETWEEN 41 AND 52 THEN 1 ELSE 0 END)                 AS lat_out_of_france,
          SUM(CASE WHEN longitude NOT BETWEEN -5.5 AND 10 THEN 1 ELSE 0 END)              AS lon_out_of_france
        FROM dvf
        """).df().to_string(index=False)
    )

    h("9. id_mutation collisions across years (should be zero)")
    print(
        con.execute("""
        SELECT COUNT(*) AS id_mutations_in_multiple_years
        FROM (
          SELECT id_mutation
          FROM dvf
          GROUP BY id_mutation
          HAVING COUNT(DISTINCT year) > 1
        )
        """).df().to_string(index=False)
    )

    h("10. Rooms vs bedrooms: is nombre_pieces_principales plausibly 'rooms'?")
    # If it's rooms (incl. living room), we expect most Maisons to have 3-6 pieces.
    # If it's bedrooms, we'd expect 1-4 more commonly. Look at distribution.
    print(
        con.execute("""
        SELECT
          nombre_pieces_principales AS pieces,
          COUNT(*) AS rows
        FROM dvf
        WHERE type_local = 'Maison' AND nombre_pieces_principales IS NOT NULL
        GROUP BY pieces
        ORDER BY pieces
        LIMIT 20
        """).df().to_string(index=False)
    )


if __name__ == "__main__":
    main()
