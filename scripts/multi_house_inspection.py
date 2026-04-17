"""Deep-dive on multi-house sales: why does €/m² halve at n_maisons=2?

Checks:
  1. Built area distribution by n_maisons (are 2-house sales just bigger?)
  2. Per-house surface distribution (are individual houses similar size?)
  3. Price per house vs price per m² comparison
  4. Rural vs urban split (commune density proxy via department)
  5. Raw row-level sample for a handful of 2-house sales
"""
from __future__ import annotations
from pathlib import Path
import duckdb

ROOT = Path(__file__).resolve().parent.parent
PARQUET     = str(ROOT / "data" / "parquet" / "year=*" / "*.parquet")
DERIVED     = str(ROOT / "data" / "parquet_derived" / "sales_residential.parquet")

def h(t): print(f"\n{'='*74}\n{t}\n{'='*74}")

con = duckdb.connect()
con.execute(f"CREATE VIEW dvf    AS SELECT * FROM read_parquet('{PARQUET}', hive_partitioning=true)")
con.execute(f"CREATE VIEW sales  AS SELECT * FROM read_parquet('{DERIVED}')")


# ── 1. Top-line: median price, built area, and €/m² by n_maisons ────────────
h("1. Price, built area, and €/m² by n_maisons (derived table)")
print(con.execute("""
SELECT
  n_maisons,
  COUNT(*)                               AS n_sales,
  ROUND(MEDIAN(price_eur))               AS med_price,
  ROUND(MEDIAN(built_area_m2))           AS med_built_area_m2,
  ROUND(MEDIAN(price_per_m2))            AS med_price_per_m2,
  -- per-house surface: total built / n_maisons
  ROUND(MEDIAN(built_area_m2 / n_maisons)) AS med_m2_per_house,
  -- price per house: total price / n_maisons
  ROUND(MEDIAN(price_eur / n_maisons))   AS med_price_per_house
FROM sales
WHERE n_maisons BETWEEN 1 AND 5
  AND n_appartements = 0
  AND built_area_m2 > 10
  AND price_per_m2 BETWEEN 100 AND 30000
GROUP BY n_maisons
ORDER BY n_maisons
""").df().to_string(index=False))


# ── 2. Is the built area jump proportional? ──────────────────────────────────
h("2. Built area distribution percentiles by n_maisons")
print(con.execute("""
SELECT
  n_maisons,
  ROUND(QUANTILE_CONT(built_area_m2, 0.10)) AS p10,
  ROUND(QUANTILE_CONT(built_area_m2, 0.25)) AS p25,
  ROUND(QUANTILE_CONT(built_area_m2, 0.50)) AS p50,
  ROUND(QUANTILE_CONT(built_area_m2, 0.75)) AS p75,
  ROUND(QUANTILE_CONT(built_area_m2, 0.90)) AS p90
FROM sales
WHERE n_maisons BETWEEN 1 AND 3
  AND n_appartements = 0
  AND built_area_m2 > 10
GROUP BY n_maisons
ORDER BY n_maisons
""").df().to_string(index=False))


# ── 3. Per-building surface in the RAW parquet: are the two houses big? ──────
h("3. Per-Maison surface distribution for sales with exactly 1 or 2 Maisons (raw DVF rows)")
print(con.execute("""
WITH target_sales AS (
  SELECT id_mutation, n_maisons
  FROM sales
  WHERE n_maisons IN (1, 2) AND n_appartements = 0
    AND built_area_m2 > 10
)
SELECT
  s.n_maisons,
  COUNT(*)                                           AS n_building_rows,
  ROUND(QUANTILE_CONT(d.surface_reelle_bati, 0.10)) AS p10_bati,
  ROUND(QUANTILE_CONT(d.surface_reelle_bati, 0.25)) AS p25_bati,
  ROUND(QUANTILE_CONT(d.surface_reelle_bati, 0.50)) AS p50_bati,
  ROUND(QUANTILE_CONT(d.surface_reelle_bati, 0.75)) AS p75_bati,
  ROUND(QUANTILE_CONT(d.surface_reelle_bati, 0.90)) AS p90_bati
FROM dvf d
JOIN target_sales s USING (id_mutation)
WHERE d.type_local = 'Maison'
  AND d.surface_reelle_bati > 0
GROUP BY s.n_maisons
ORDER BY s.n_maisons
""").df().to_string(index=False))


# ── 4. Geographic proxy: top departments for 1-house vs 2-house ──────────────
h("4. Top 10 departments by share of 2-house sales (more rural = higher share?)")
print(con.execute("""
WITH dept_stats AS (
  SELECT
    department_code,
    COUNT(*) FILTER (WHERE n_maisons = 1 AND n_appartements = 0) AS n_1house,
    COUNT(*) FILTER (WHERE n_maisons = 2 AND n_appartements = 0) AS n_2house
  FROM sales
  WHERE n_maisons IN (1,2) AND built_area_m2 > 10
  GROUP BY department_code
)
SELECT
  department_code,
  n_1house,
  n_2house,
  ROUND(100.0 * n_2house / (n_1house + n_2house), 1) AS pct_2house,
  -- urban depts tend to have low pct; rural ones high
  CASE WHEN department_code IN ('75','92','93','94','69','13','31','33','59','67','06')
       THEN 'urban' ELSE 'rural' END AS urban_rural_proxy
FROM dept_stats
WHERE n_1house + n_2house > 500
ORDER BY pct_2house DESC
LIMIT 15
""").df().to_string(index=False))


# ── 5. Same €/m² gap within one rural dept and one urban dept ────────────────
h("5. €/m² gap urban (75=Paris) vs rural (23=Creuse) by n_maisons")
print(con.execute("""
SELECT
  department_code,
  n_maisons,
  COUNT(*)                     AS n,
  ROUND(MEDIAN(price_eur))     AS med_price,
  ROUND(MEDIAN(built_area_m2)) AS med_built_m2,
  ROUND(MEDIAN(price_per_m2))  AS med_eur_per_m2
FROM sales
WHERE department_code IN ('75','23','33','13')
  AND n_maisons IN (1,2)
  AND n_appartements = 0
  AND built_area_m2 > 10
  AND price_per_m2 BETWEEN 100 AND 30000
GROUP BY department_code, n_maisons
ORDER BY department_code, n_maisons
""").df().to_string(index=False))


# ── 6. Raw row-level sample: show every row for 10 typical 2-Maison sales ────
h("6. Raw DVF rows for 10 typical 2-Maison sales (price €100k–€400k, Vente)")
# Pick 10 2-Maison sale IDs in the mid price range
sample_ids = con.execute("""
  SELECT id_mutation FROM sales
  WHERE n_maisons = 2 AND n_appartements = 0
    AND price_eur BETWEEN 100000 AND 400000
    AND built_area_m2 > 10
    AND rooms_min >= 3
  USING SAMPLE 10 ROWS
""").fetchall()

ids_str = ", ".join(f"'{r[0]}'" for r in sample_ids)
if ids_str:
    detail = con.execute(f"""
      SELECT
        id_mutation,
        type_local,
        surface_reelle_bati,
        nombre_pieces_principales AS pieces,
        nature_culture,
        surface_terrain,
        code_departement AS dept,
        nom_commune AS commune,
        valeur_fonciere AS price_total,
        latitude, longitude
      FROM dvf
      WHERE id_mutation IN ({ids_str})
      ORDER BY id_mutation, type_local
    """).df()
    print(detail.to_string(index=False))
else:
    print("(no sample IDs)")


# ── 7. Extreme outlier surface check: are some "Maisons" actually huge? ──────
h("7. Giant-surface outliers among 2-Maison sales (surface_reelle_bati > 500m² per building)")
print(con.execute("""
WITH two_maison_sales AS (
  SELECT id_mutation FROM sales
  WHERE n_maisons = 2 AND n_appartements = 0
    AND built_area_m2 > 10
)
SELECT
  d.id_mutation,
  d.type_local,
  d.surface_reelle_bati,
  d.nombre_pieces_principales AS pieces,
  d.valeur_fonciere,
  d.nom_commune,
  d.code_departement
FROM dvf d
JOIN two_maison_sales t USING (id_mutation)
WHERE d.type_local = 'Maison'
  AND d.surface_reelle_bati > 500
ORDER BY d.surface_reelle_bati DESC
LIMIT 15
""").df().to_string(index=False))
