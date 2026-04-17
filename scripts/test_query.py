"""Answer the test question:
Average sale price per year for sales of a property that has
EXACTLY TWO Maisons on it, each with nombre_pieces_principales >= 5
(>=5 rooms = ~>=4 bedrooms).
"""
from __future__ import annotations

from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
PARQUET_GLOB = str(ROOT / "data" / "parquet" / "year=*" / "*.parquet")


def h(title: str) -> None:
    print(f"\n{'=' * 70}\n{title}\n{'=' * 70}")


def main() -> None:
    con = duckdb.connect()
    con.execute(
        f"CREATE VIEW dvf AS SELECT * FROM read_parquet('{PARQUET_GLOB}', hive_partitioning=true)"
    )

    # A "qualifying sale" has EXACTLY two rows of type_local='Maison'
    # AND the minimum pieces across those maisons is >= 5.
    # (Other rows within the mutation — Dépendance, terrain, etc. — are fine.)
    # We restrict to 'Vente' to exclude exchanges/adjudications.
    # We take valeur_fonciere per sale once (it's duplicated across rows).
    con.execute("""
        CREATE TABLE qualifying_sales AS
        WITH maisons_per_sale AS (
          SELECT
            id_mutation,
            COUNT(*)                              AS n_maisons,
            MIN(nombre_pieces_principales)        AS min_pieces,
            MAX(nombre_pieces_principales)        AS max_pieces,
            SUM(surface_reelle_bati)              AS total_bati
          FROM dvf
          WHERE type_local = 'Maison'
          GROUP BY id_mutation
        ),
        sale_meta AS (
          SELECT
            id_mutation,
            ANY_VALUE(year)             AS year,
            ANY_VALUE(valeur_fonciere)  AS valeur,
            ANY_VALUE(nature_mutation)  AS nature,
            ANY_VALUE(nom_commune)      AS commune,
            ANY_VALUE(code_departement) AS dept
          FROM dvf
          GROUP BY id_mutation
        )
        SELECT m.*, s.year, s.valeur, s.nature, s.commune, s.dept
        FROM maisons_per_sale m
        JOIN sale_meta s USING (id_mutation)
        WHERE m.n_maisons = 2
          AND m.min_pieces >= 5
          AND s.nature = 'Vente'
          AND s.valeur IS NOT NULL
    """)

    h("Answer: average sale price per year, 2 Maisons @ >=5 pieces each, Vente only")
    print(
        con.execute("""
        SELECT
          year,
          COUNT(*)                    AS n_sales,
          ROUND(AVG(valeur))          AS avg_price_eur,
          ROUND(MEDIAN(valeur))       AS median_price_eur,
          ROUND(MIN(valeur))          AS min_price_eur,
          ROUND(MAX(valeur))          AS max_price_eur
        FROM qualifying_sales
        GROUP BY year
        ORDER BY year
        """).df().to_string(index=False)
    )

    h("Sanity: outlier check — top 10 most expensive qualifying sales")
    print(
        con.execute("""
        SELECT year, commune, dept, ROUND(valeur) AS valeur,
               min_pieces, max_pieces, total_bati
        FROM qualifying_sales
        ORDER BY valeur DESC
        LIMIT 10
        """).df().to_string(index=False)
    )

    h("Sanity: cheapest 10 — filter garbage?")
    print(
        con.execute("""
        SELECT year, commune, dept, ROUND(valeur) AS valeur,
               min_pieces, max_pieces, total_bati
        FROM qualifying_sales
        ORDER BY valeur ASC
        LIMIT 10
        """).df().to_string(index=False)
    )

    h("Same answer after trimming the extremes (€20k <= valeur <= €20M)")
    print(
        con.execute("""
        SELECT
          year,
          COUNT(*)              AS n_sales,
          ROUND(AVG(valeur))    AS avg_price_eur,
          ROUND(MEDIAN(valeur)) AS median_price_eur
        FROM qualifying_sales
        WHERE valeur BETWEEN 20000 AND 20000000
        GROUP BY year
        ORDER BY year
        """).df().to_string(index=False)
    )


if __name__ == "__main__":
    main()
