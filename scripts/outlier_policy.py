"""Quantify the impact of the proposed residential filter:
  - n_rows <= 10  (drop portfolio / bulk deals)
  - valeur_fonciere >= 1000  (drop symbolic / €1 transfers)
  - (optional) single-commune (drop multi-commune portfolio estates)
  - (optional) nature_mutation = 'Vente' only
"""
from __future__ import annotations

from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
P = str(ROOT / "data" / "parquet" / "year=*" / "*.parquet")


def h(t: str) -> None:
    print(f"\n{'=' * 74}\n{t}\n{'=' * 74}")


def main() -> None:
    con = duckdb.connect()
    con.execute(f"CREATE VIEW dvf AS SELECT * FROM read_parquet('{P}', hive_partitioning=true)")

    # Build a sale-level table once.
    con.execute("""
        CREATE TABLE sales AS
        SELECT
          id_mutation,
          ANY_VALUE(date_mutation)   AS date,
          ANY_VALUE(year)            AS year,
          ANY_VALUE(valeur_fonciere) AS valeur,
          ANY_VALUE(nature_mutation) AS nature,
          ANY_VALUE(code_departement) AS dept,
          COUNT(*)                   AS n_rows,
          COUNT(DISTINCT code_commune) AS n_communes
        FROM dvf GROUP BY id_mutation
    """)

    h("1. Impact of each filter, individually and combined")
    print(
        con.execute("""
        WITH base AS (SELECT * FROM sales)
        SELECT
          COUNT(*)                                                       AS all_sales,
          SUM(n_rows > 10)::BIGINT                                       AS drop_n_rows_gt_10,
          SUM(valeur < 1000 OR valeur IS NULL)::BIGINT                   AS drop_valeur_lt_1000,
          SUM(n_communes > 1)::BIGINT                                    AS drop_multi_commune,
          SUM(nature != 'Vente')::BIGINT                                 AS drop_not_vente,
          -- combined (our proposed policy)
          SUM(n_rows <= 10 AND valeur >= 1000
              AND n_communes = 1 AND nature = 'Vente')::BIGINT           AS keep_all_filters,
          -- looser (just the two you proposed)
          SUM(n_rows <= 10 AND valeur >= 1000)::BIGINT                   AS keep_rows_and_price_only
        FROM base
        """).df().to_string(index=False)
    )

    h("2. What does n_rows > 10 actually catch? Random 10 samples of filtered-out sales")
    print(
        con.execute("""
        SELECT id_mutation, date, ROUND(valeur) AS valeur, nature, n_rows, n_communes, dept
        FROM sales
        WHERE n_rows > 10 AND valeur IS NOT NULL
        USING SAMPLE 10 ROWS
        """).df().to_string(index=False)
    )

    h("3. What's JUST above the threshold (n_rows = 11..15)? Are these residential?")
    # Peek by joining back to dvf to see the types involved.
    print(
        con.execute("""
        WITH borderline AS (
          SELECT id_mutation FROM sales WHERE n_rows BETWEEN 11 AND 15
        )
        SELECT type_local, COUNT(*) AS rows_in_borderline_sales
        FROM dvf JOIN borderline USING (id_mutation)
        GROUP BY type_local ORDER BY rows_in_borderline_sales DESC
        """).df().to_string(index=False)
    )

    h("4. What's JUST BELOW the threshold (n_rows = 6..10)? Sanity check we keep residential")
    print(
        con.execute("""
        WITH kept AS (
          SELECT id_mutation FROM sales WHERE n_rows BETWEEN 6 AND 10
        )
        SELECT type_local, COUNT(*) AS rows
        FROM dvf JOIN kept USING (id_mutation)
        GROUP BY type_local ORDER BY rows DESC
        """).df().to_string(index=False)
    )

    h("5. Impact on the test query (2 Maisons, >=5 pieces, Vente)")
    print(
        con.execute("""
        WITH q AS (
          SELECT id_mutation, MIN(nombre_pieces_principales) AS min_pieces, COUNT(*) AS n_mais
          FROM dvf WHERE type_local = 'Maison' GROUP BY id_mutation
        )
        SELECT
          s.year,
          SUM(1)::BIGINT AS before_filter,
          SUM(s.n_rows <= 10 AND s.valeur >= 1000)::BIGINT AS after_filter,
          ROUND(AVG(s.valeur))                                           AS avg_before,
          ROUND(AVG(CASE WHEN s.n_rows <= 10 AND s.valeur >= 1000
                         THEN s.valeur END))                             AS avg_after,
          ROUND(MEDIAN(s.valeur))                                        AS med_before,
          ROUND(MEDIAN(CASE WHEN s.n_rows <= 10 AND s.valeur >= 1000
                            THEN s.valeur END))                          AS med_after
        FROM sales s JOIN q USING (id_mutation)
        WHERE q.n_mais = 2 AND q.min_pieces >= 5 AND s.nature = 'Vente'
        GROUP BY s.year ORDER BY s.year
        """).df().to_string(index=False)
    )

    h("6. With the proposed filter applied, what's the biggest sale left?")
    print(
        con.execute("""
        SELECT id_mutation, date, ROUND(valeur) AS valeur, nature, n_rows, dept
        FROM sales
        WHERE n_rows <= 10 AND valeur >= 1000
        ORDER BY valeur DESC LIMIT 10
        """).df().to_string(index=False)
    )


if __name__ == "__main__":
    main()
