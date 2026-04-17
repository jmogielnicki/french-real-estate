"""Build notebooks/01_shape_and_sanity.ipynb and 02_test_query.ipynb
from the sanity_checks.py and test_query.py scripts.
"""
from __future__ import annotations

from pathlib import Path

import nbformat as nbf

ROOT = Path(__file__).resolve().parent.parent
NOTEBOOKS = ROOT / "notebooks"
NOTEBOOKS.mkdir(exist_ok=True)

SETUP_CELL = '''\
import duckdb, pandas as pd
from pathlib import Path
PARQUET_GLOB = str(Path.cwd().parent / "data" / "parquet" / "year=*" / "*.parquet")
con = duckdb.connect()
con.execute(f"CREATE VIEW dvf AS SELECT * FROM read_parquet('{PARQUET_GLOB}', hive_partitioning=true)")
print("Row count:", con.execute("SELECT COUNT(*) FROM dvf").fetchone()[0])
'''


def md(text: str) -> nbf.NotebookNode:
    return nbf.v4.new_markdown_cell(text)


def code(text: str) -> nbf.NotebookNode:
    return nbf.v4.new_code_cell(text)


def build_sanity() -> None:
    nb = nbf.v4.new_notebook()
    nb.cells = [
        md("# 01 — Data shape and sanity checks\n\n"
           "DVF+ geocoded property sales, 2021–2025, loaded as partitioned Parquet."),
        code(SETUP_CELL),
        md("## 1. Rows, unique mutations, multi-row ratio\n"
           "DVF+ repeats sale data across rows when a sale includes multiple lots/parcels. "
           "`id_mutation` is the authoritative sale key."),
        code("con.execute('''\n"
             "SELECT year, COUNT(*) AS rows, COUNT(DISTINCT id_mutation) AS mutations,\n"
             "       ROUND(COUNT(*)::DOUBLE / COUNT(DISTINCT id_mutation), 3) AS rows_per_mutation\n"
             "FROM dvf GROUP BY year ORDER BY year\n"
             "''').df()"),
        md("## 2. How lumpy are sales? Distribution of rows-per-mutation"),
        code("con.execute('''\n"
             "WITH per_mut AS (SELECT id_mutation, COUNT(*) AS n FROM dvf GROUP BY id_mutation)\n"
             "SELECT n AS rows_per_mutation, COUNT(*) AS n_mutations\n"
             "FROM per_mut GROUP BY n ORDER BY n LIMIT 20\n"
             "''').df()"),
        md("## 2b. Extreme outliers: biggest multi-row mutations\n"
           "These are portfolio / bulk real-estate deals — NOT typical residential sales. "
           "Probably worth filtering out for most analyses."),
        code("con.execute('''\n"
             "SELECT id_mutation, COUNT(*) AS n_rows,\n"
             "       MIN(valeur_fonciere) AS valeur,\n"
             "       COUNT(DISTINCT code_commune) AS n_communes\n"
             "FROM dvf GROUP BY id_mutation ORDER BY n_rows DESC LIMIT 10\n"
             "''').df()"),
        md("## 3. Consistency within a mutation\n"
           "Does valeur / date / commune stay stable across rows of the same id_mutation?"),
        code("con.execute('''\n"
             "SELECT\n"
             "  (SELECT COUNT(*) FROM (SELECT id_mutation FROM dvf WHERE valeur_fonciere IS NOT NULL\n"
             "                         GROUP BY id_mutation HAVING COUNT(DISTINCT valeur_fonciere) > 1))\n"
             "    AS inconsistent_valeur,\n"
             "  (SELECT COUNT(*) FROM (SELECT id_mutation FROM dvf\n"
             "                         GROUP BY id_mutation HAVING COUNT(DISTINCT date_mutation) > 1))\n"
             "    AS inconsistent_date,\n"
             "  (SELECT COUNT(*) FROM (SELECT id_mutation FROM dvf\n"
             "                         GROUP BY id_mutation HAVING COUNT(DISTINCT code_commune) > 1))\n"
             "    AS multi_commune\n"
             "''').df()"),
        md("## 4. Nature mutation distribution"),
        code("con.execute('''\n"
             "SELECT nature_mutation, COUNT(DISTINCT id_mutation) AS mutations\n"
             "FROM dvf GROUP BY nature_mutation ORDER BY mutations DESC\n"
             "''').df()"),
        md("## 5. Type local distribution (row-level)\n"
           "NULL type_local = terrain/parcel-only rows (no building). These account for ~40% of rows."),
        code("con.execute('''\n"
             "SELECT COALESCE(type_local, '(null — terrain/parcel)') AS type_local, COUNT(*) AS rows\n"
             "FROM dvf GROUP BY type_local ORDER BY rows DESC\n"
             "''').df()"),
        md("## 6. Missingness on key columns"),
        code("con.execute('''\n"
             "SELECT COUNT(*) AS total_rows,\n"
             "  SUM(valeur_fonciere IS NULL)::BIGINT AS null_valeur,\n"
             "  SUM(latitude IS NULL)::BIGINT AS null_lat,\n"
             "  SUM(type_local IS NULL)::BIGINT AS null_type_local,\n"
             "  SUM(surface_reelle_bati IS NULL)::BIGINT AS null_bati\n"
             "FROM dvf\n"
             "''').df()"),
        md("## 7. Valeur fonciere distribution (sale-level)"),
        code("con.execute('''\n"
             "WITH sales AS (\n"
             "  SELECT id_mutation, ANY_VALUE(valeur_fonciere) AS valeur\n"
             "  FROM dvf WHERE valeur_fonciere IS NOT NULL GROUP BY id_mutation)\n"
             "SELECT COUNT(*) AS sales, MIN(valeur) AS min,\n"
             "       ROUND(QUANTILE_CONT(valeur, 0.01)) AS p01,\n"
             "       ROUND(QUANTILE_CONT(valeur, 0.50)) AS p50,\n"
             "       ROUND(QUANTILE_CONT(valeur, 0.99)) AS p99,\n"
             "       ROUND(QUANTILE_CONT(valeur, 0.999)) AS p999,\n"
             "       MAX(valeur) AS max\n"
             "FROM sales\n"
             "''').df()"),
        md("Biggest sales — sniff test for data errors:"),
        code("con.execute('''\n"
             "SELECT id_mutation, ANY_VALUE(valeur_fonciere) AS valeur,\n"
             "       ANY_VALUE(nom_commune) AS commune, ANY_VALUE(date_mutation) AS date\n"
             "FROM dvf GROUP BY id_mutation ORDER BY valeur DESC NULLS LAST LIMIT 10\n"
             "''').df()"),
        md("## 8. Geocoding completeness\n"
           "DVF+ is pre-geocoded but not all rows have lat/lon. ~2% missing. "
           "`lat_out_of_france` rows are DOM-TOM (French overseas territories)."),
        code("con.execute('''\n"
             "SELECT SUM(latitude IS NOT NULL)::BIGINT AS geocoded,\n"
             "       SUM(latitude IS NULL)::BIGINT AS missing,\n"
             "       SUM(latitude NOT BETWEEN 41 AND 52)::BIGINT AS lat_out_of_france\n"
             "FROM dvf\n"
             "''').df()"),
        md("## 9. Rooms vs bedrooms?\n"
           "`nombre_pieces_principales` peaks at 4 for Maisons (T4 is very common) — "
           "consistent with *rooms* (habitable rooms incl. living room), not bedrooms. "
           "`pieces >= 5` ≈ *at least 4 bedrooms*."),
        code("import matplotlib.pyplot as plt\n"
             "df = con.execute('''\n"
             "SELECT nombre_pieces_principales AS pieces, COUNT(*) AS rows\n"
             "FROM dvf WHERE type_local='Maison' AND nombre_pieces_principales BETWEEN 1 AND 12\n"
             "GROUP BY pieces ORDER BY pieces\n"
             "''').df()\n"
             "df.plot.bar(x='pieces', y='rows', legend=False, figsize=(8,3), title='Maison rooms distribution')\n"
             "plt.show()"),
    ]
    out = NOTEBOOKS / "01_shape_and_sanity.ipynb"
    nbf.write(nb, out)
    print(f"wrote {out}")


def build_test_query() -> None:
    nb = nbf.v4.new_notebook()
    nb.cells = [
        md("# 02 — Test query: 2-Maison, 5+ pieces each, avg sale price per year\n\n"
           "*\"A property that has exactly two homes on it with at least 4 bedrooms in each home\"* "
           "→ sales where EXACTLY two rows have `type_local='Maison'` AND `nombre_pieces_principales >= 5` on each.\n\n"
           "Assumption: \"home\" = Maison only (not Appartement). \"4 bedrooms\" ≈ 5 pieces principales."),
        code(SETUP_CELL),
        md("## Build the sale-level qualifying set"),
        code("con.execute('''\n"
             "CREATE OR REPLACE TABLE qualifying_sales AS\n"
             "WITH maisons_per_sale AS (\n"
             "  SELECT id_mutation,\n"
             "    COUNT(*) AS n_maisons,\n"
             "    MIN(nombre_pieces_principales) AS min_pieces,\n"
             "    MAX(nombre_pieces_principales) AS max_pieces,\n"
             "    SUM(surface_reelle_bati)       AS total_bati\n"
             "  FROM dvf WHERE type_local = 'Maison' GROUP BY id_mutation\n"
             "),\n"
             "sale_meta AS (\n"
             "  SELECT id_mutation,\n"
             "         ANY_VALUE(year) AS year,\n"
             "         ANY_VALUE(valeur_fonciere) AS valeur,\n"
             "         ANY_VALUE(nature_mutation) AS nature,\n"
             "         ANY_VALUE(nom_commune) AS commune,\n"
             "         ANY_VALUE(code_departement) AS dept\n"
             "  FROM dvf GROUP BY id_mutation\n"
             ")\n"
             "SELECT m.*, s.year, s.valeur, s.nature, s.commune, s.dept\n"
             "FROM maisons_per_sale m JOIN sale_meta s USING (id_mutation)\n"
             "WHERE m.n_maisons = 2 AND m.min_pieces >= 5\n"
             "  AND s.nature = 'Vente' AND s.valeur IS NOT NULL\n"
             "''')\n"
             "con.execute('SELECT COUNT(*) FROM qualifying_sales').fetchone()"),
        md("## Answer: raw (no outlier filtering)"),
        code("con.execute('''\n"
             "SELECT year, COUNT(*) AS n_sales,\n"
             "       ROUND(AVG(valeur))    AS avg_eur,\n"
             "       ROUND(MEDIAN(valeur)) AS median_eur,\n"
             "       ROUND(MIN(valeur))    AS min_eur,\n"
             "       ROUND(MAX(valeur))    AS max_eur\n"
             "FROM qualifying_sales GROUP BY year ORDER BY year\n"
             "''').df()"),
        md("## Why the means are noisy: €1 sales and €200M+ outliers\n"
           "There are ~80/year sales at valeur=€1 (nominal/symbolic transfers, gifts, divisions) "
           "and a handful of €10M+ outliers. Filtering to plausible residential range:"),
        code("con.execute('''\n"
             "SELECT year, COUNT(*) AS n_sales,\n"
             "       ROUND(AVG(valeur))    AS avg_eur,\n"
             "       ROUND(MEDIAN(valeur)) AS median_eur\n"
             "FROM qualifying_sales\n"
             "WHERE valeur BETWEEN 20000 AND 20000000\n"
             "GROUP BY year ORDER BY year\n"
             "''').df()"),
        md("## Most expensive qualifying sales (sniff test)"),
        code("con.execute('''\n"
             "SELECT year, commune, dept, ROUND(valeur) AS valeur,\n"
             "       min_pieces, max_pieces, total_bati\n"
             "FROM qualifying_sales ORDER BY valeur DESC LIMIT 10\n"
             "''').df()"),
    ]
    out = NOTEBOOKS / "02_test_query.ipynb"
    nbf.write(nb, out)
    print(f"wrote {out}")


VALUE_TRANSLATIONS_CELL = '''\
# English translations of DVF categorical values
VALUE_TRANSLATIONS = {
    "Vente": "Sale",
    "Vente en l'état futur d'achèvement": "Off-plan (VEFA, pre-construction)",
    "Echange": "Exchange / swap",
    "Vente terrain à bâtir": "Sale of building land",
    "Adjudication": "Auction",
    "Expropriation": "Expropriation",
    "Maison": "House",
    "Appartement": "Apartment",
    "Dépendance": "Outbuilding / annex",
    "Local industriel. commercial ou assimilé": "Commercial / industrial",
}
def tr(col):
    return col.map(VALUE_TRANSLATIONS).fillna("")
'''


def build_outlier_policy() -> None:
    nb = nbf.v4.new_notebook()
    nb.cells = [
        md("# 03 — Outlier policy & residential filter\n\n"
           "Define a default filter that isolates *residential-scale* sales from "
           "portfolio / bulk / symbolic-transfer noise.\n\n"
           "**Proposed baseline filter:**\n"
           "- `n_rows <= 10` — drop portfolio / bulk deals\n"
           "- `valeur_fonciere >= 1000` — drop symbolic transfers (gifts, divisions, €1 transfers)\n"
           "- `nature_mutation = 'Vente'` — plain sales only (keeps 93% of mutations)\n"
           "- `n_communes = 1` — a single sale should touch one commune"),
        code(SETUP_CELL),
        code(VALUE_TRANSLATIONS_CELL),

        md("## 1. Categorical rundown (columns with ≤10 distinct values)\n"
           "What flavors of transaction are in here?"),
        code("for col in ['nature_mutation', 'type_local', 'year']:\n"
             "    df = con.execute(f'''\n"
             "      SELECT COALESCE(CAST(\"{col}\" AS VARCHAR), '(null)') AS value,\n"
             "             COUNT(*) AS rows,\n"
             "             ROUND(100.0*COUNT(*)/(SELECT COUNT(*) FROM dvf), 3) AS pct\n"
             "      FROM dvf GROUP BY \"{col}\" ORDER BY rows DESC\n"
             "    ''').df()\n"
             "    df['english'] = tr(df['value'])\n"
             "    print(f'\\n=== {col} ===')\n"
             "    print(df.to_string(index=False))"),
        md("(`code_type_local` mirrors `type_local` 1:1, and `ancien_*` fields "
           "are >99.99% null — records of rare post-merge commune renames.)"),

        md("## 2. Build a sale-level view with filter flags"),
        code("con.execute('''\n"
             "CREATE OR REPLACE TABLE sales AS\n"
             "SELECT\n"
             "  id_mutation,\n"
             "  ANY_VALUE(date_mutation)     AS date,\n"
             "  ANY_VALUE(year)              AS year,\n"
             "  ANY_VALUE(valeur_fonciere)   AS valeur,\n"
             "  ANY_VALUE(nature_mutation)   AS nature,\n"
             "  ANY_VALUE(code_departement)  AS dept,\n"
             "  ANY_VALUE(nom_commune)       AS commune,\n"
             "  COUNT(*)                     AS n_rows,\n"
             "  COUNT(DISTINCT code_commune) AS n_communes\n"
             "FROM dvf GROUP BY id_mutation\n"
             "''')\n"
             "con.execute('SELECT COUNT(*) FROM sales').fetchone()"),

        md("## 3. Impact of each filter"),
        code("con.execute('''\n"
             "SELECT\n"
             "  COUNT(*)                                             AS all_sales,\n"
             "  SUM(n_rows > 10)::BIGINT                             AS drop_n_rows_gt_10,\n"
             "  SUM(valeur < 1000 OR valeur IS NULL)::BIGINT         AS drop_valeur_lt_1000,\n"
             "  SUM(n_communes > 1)::BIGINT                          AS drop_multi_commune,\n"
             "  SUM(nature != 'Vente')::BIGINT                       AS drop_not_vente,\n"
             "  SUM(n_rows<=10 AND valeur>=1000\n"
             "      AND n_communes=1 AND nature='Vente')::BIGINT     AS keep_residential_strict,\n"
             "  SUM(n_rows<=10 AND valeur>=1000)::BIGINT             AS keep_loose_filter\n"
             "FROM sales\n"
             "''').df()"),

        md("## 4. Sanity: what's at the n_rows = 11..15 border?\n"
           "If the filter is correct, borderline sales should be mostly non-residential "
           "(portfolio + outbuilding clusters, not family homes)."),
        code("con.execute('''\n"
             "WITH borderline AS (SELECT id_mutation FROM sales WHERE n_rows BETWEEN 11 AND 15)\n"
             "SELECT COALESCE(type_local, '(terrain/parcel)') AS type_local,\n"
             "       COUNT(*) AS rows\n"
             "FROM dvf JOIN borderline USING (id_mutation)\n"
             "GROUP BY type_local ORDER BY rows DESC\n"
             "''').df()"),

        md("## 5. Known data quality issue: €14.15B \"sale\"\n"
           "A single mutation recorded at €14.15 **billion** in Marseille 8e survives our filter "
           "(it's only 3 rows). Almost certainly a misplaced decimal at data entry time. "
           "For residential analyses we should either cap valeur or flag this specific `id_mutation`."),
        code("con.execute('''\n"
             "SELECT id_mutation, date, ROUND(valeur) AS valeur, nature, n_rows, commune, dept\n"
             "FROM sales\n"
             "WHERE n_rows <= 10 AND valeur >= 1000\n"
             "ORDER BY valeur DESC LIMIT 10\n"
             "''').df()"),

        md("## 6. Test query, before vs. after filter\n"
           "2-Maison, ≥5 pieces, Vente. Filter trims <3% of rows and the median barely moves — "
           "the filter cleans noise without warping the signal."),
        code("con.execute('''\n"
             "WITH q AS (\n"
             "  SELECT id_mutation, MIN(nombre_pieces_principales) AS min_pieces, COUNT(*) AS n_mais\n"
             "  FROM dvf WHERE type_local = 'Maison' GROUP BY id_mutation\n"
             ")\n"
             "SELECT s.year,\n"
             "  SUM(1)::BIGINT AS before_filter,\n"
             "  SUM(s.n_rows <= 10 AND s.valeur >= 1000)::BIGINT AS after_filter,\n"
             "  ROUND(AVG(s.valeur)) AS avg_before,\n"
             "  ROUND(AVG(CASE WHEN s.n_rows<=10 AND s.valeur>=1000 THEN s.valeur END)) AS avg_after,\n"
             "  ROUND(MEDIAN(s.valeur)) AS med_before,\n"
             "  ROUND(MEDIAN(CASE WHEN s.n_rows<=10 AND s.valeur>=1000 THEN s.valeur END)) AS med_after\n"
             "FROM sales s JOIN q USING (id_mutation)\n"
             "WHERE q.n_mais = 2 AND q.min_pieces >= 5 AND s.nature = 'Vente'\n"
             "GROUP BY s.year ORDER BY s.year\n"
             "''').df()"),

        md("## 7. Bonus — price per m² for single-Maison sales (default residential filter)\n"
           "Use this as a candidate metric for the webapp. Only Maison sales where the "
           "mutation contains exactly one Maison row, built surface reported."),
        code("con.execute('''\n"
             "WITH maison_only AS (\n"
             "  SELECT id_mutation,\n"
             "         ANY_VALUE(surface_reelle_bati)     AS surface,\n"
             "         ANY_VALUE(nombre_pieces_principales) AS pieces,\n"
             "         COUNT(*) AS n_mais\n"
             "  FROM dvf WHERE type_local = 'Maison' GROUP BY id_mutation\n"
             ")\n"
             "SELECT s.year,\n"
             "  COUNT(*) AS n_sales,\n"
             "  ROUND(MEDIAN(s.valeur / m.surface)) AS median_eur_per_m2,\n"
             "  ROUND(AVG(s.valeur / m.surface))    AS avg_eur_per_m2\n"
             "FROM sales s JOIN maison_only m USING (id_mutation)\n"
             "WHERE m.n_mais = 1 AND m.surface > 10\n"
             "  AND s.nature = 'Vente' AND s.valeur BETWEEN 1000 AND 20000000\n"
             "  AND s.n_rows <= 10\n"
             "GROUP BY s.year ORDER BY s.year\n"
             "''').df()"),
    ]
    out = NOTEBOOKS / "03_outlier_policy.ipynb"
    nbf.write(nb, out)
    print(f"wrote {out}")


SETUP_BOTH = '''\
import duckdb, pandas as pd
from pathlib import Path

ROOT = Path.cwd().parent
PARQUET_GLOB  = str(ROOT / "data" / "parquet" / "year=*" / "*.parquet")
DERIVED       = str(ROOT / "data" / "parquet_derived" / "sales_residential.parquet")

con = duckdb.connect()
con.execute(f"CREATE VIEW dvf   AS SELECT * FROM read_parquet('{PARQUET_GLOB}', hive_partitioning=true)")
con.execute(f"CREATE VIEW sales AS SELECT * FROM read_parquet('{DERIVED}')")
print("DVF rows:", con.execute("SELECT COUNT(*) FROM dvf").fetchone()[0])
print("Sales rows:", con.execute("SELECT COUNT(*) FROM sales").fetchone()[0])
'''


def build_multi_house_inspection() -> None:
    nb = nbf.v4.new_notebook()
    nb.cells = [
        md(
            "# 04 — Multi-house property inspection & deduplication bug\n\n"
            "**Question:** Why does median €/m² roughly halve when a sale contains two Maisons?\n\n"
            "**Answer:** It's mostly a data artifact. DVF records the same physical building once "
            "per cadastral parcel it touches — so a single house spanning two parcels generates "
            "two identical Maison rows, making us count it as two houses and double its built area.\n\n"
            "This notebook reproduces the investigation and documents the fix applied in "
            "`scripts/derive_tables.py`."
        ),
        code(SETUP_BOTH),

        md("## 1. The symptom — €/m² halves at n_maisons=2 (BEFORE fix)\n\n"
           "Before deduplication, `n_maisons` was a raw row count.\n"
           "The old derived table showed: n=1 → €2,135/m², n=2 → €1,076/m² (−50%)."),
        code(
            "# Reproduce the buggy counts from the raw parquet\n"
            "con.execute('''\n"
            "  SELECT\n"
            "    SUM(type_local = \\'Maison\\')::INT AS n_maisons_raw,\n"
            "    COUNT(*)                           AS n_sales,\n"
            "    ROUND(MEDIAN(valeur_fonciere))      AS med_price,\n"
            "    ROUND(MEDIAN(SUM(CASE WHEN type_local=\\'Maison\\' THEN surface_reelle_bati END)\n"
            "          OVER (PARTITION BY id_mutation)))  AS med_built_area\n"
            "  FROM dvf\n"
            "  GROUP BY id_mutation\n"
            "  HAVING n_maisons_raw BETWEEN 1 AND 5\n"
            "''').df()"
        ),

        md("## 2. The smoking gun — identical surfaces\n\n"
           "In 86% of sales where `n_maison_rows=2`, both rows have exactly the same "
           "`surface_reelle_bati`. A genuine pair of distinct houses would very rarely share "
           "the same exact size."),
        code(
            "con.execute('''\n"
            "  WITH two_mais AS (\n"
            "    SELECT id_mutation,\n"
            "           MIN(surface_reelle_bati) AS s_min,\n"
            "           MAX(surface_reelle_bati) AS s_max\n"
            "    FROM dvf\n"
            "    WHERE type_local = \\'Maison\\'\n"
            "    GROUP BY id_mutation\n"
            "    HAVING COUNT(*) = 2\n"
            "  )\n"
            "  SELECT\n"
            "    COUNT(*)                                      AS total_2row_sales,\n"
            "    SUM(s_min = s_max)::INT                       AS same_surface,\n"
            "    ROUND(100.0 * SUM(s_min = s_max) / COUNT(*), 1) AS pct_same\n"
            "  FROM two_mais\n"
            "''').df()"
        ),

        md("## 3. Concrete examples — raw DVF rows for 10 typical cases\n\n"
           "Each 'two-Maison' sale below is actually one house recorded on two "
           "parcels (one sols + one terrain d'agrément, or similar). "
           "Surface and pieces are identical on both rows."),
        code(
            "ids = [r[0] for r in con.execute('''\n"
            "  SELECT id_mutation FROM sales\n"
            "  WHERE n_maison_rows = 2 AND n_maisons = 1\n"
            "    AND price_eur BETWEEN 100000 AND 350000\n"
            "  LIMIT 10\n"
            "''').fetchall()]\n"
            "ids_sql = ', '.join(f\"'{i}'\" for i in ids)\n"
            "con.execute(f'''\n"
            "  SELECT id_mutation, type_local,\n"
            "         surface_reelle_bati AS bati_m2, nombre_pieces_principales AS pieces,\n"
            "         nature_culture, surface_terrain, valeur_fonciere, nom_commune\n"
            "  FROM dvf WHERE id_mutation IN ({ids_sql})\n"
            "  ORDER BY id_mutation, type_local NULLS LAST\n"
            "''').df()"
        ),

        md("## 4. The fix — deduplicate by (surface, pieces)\n\n"
           "Buildings are identified by their `(surface_reelle_bati, nombre_pieces_principales)` "
           "combination within a sale. Two rows with the same pair = same physical building "
           "on two parcels. Two rows with different pairs = genuinely different buildings.\n\n"
           "The fix is applied in `scripts/derive_tables.py` via a `SELECT DISTINCT` "
           "on `(id_mutation, type_local, surface_reelle_bati, nombre_pieces_principales)` "
           "before summing."),
        code(
            "# Impact of the dedup — how often did raw row count differ from deduped count?\n"
            "con.execute('''\n"
            "  SELECT n_maison_rows AS raw_rows, n_maisons AS deduped,\n"
            "         COUNT(*) AS n_sales\n"
            "  FROM sales\n"
            "  WHERE n_maison_rows BETWEEN 1 AND 4\n"
            "  GROUP BY raw_rows, deduped\n"
            "  ORDER BY raw_rows, deduped\n"
            "''').df()"
        ),

        md("## 5. Validation — €/m² by n_maisons AFTER fix\n\n"
           "The sharp halving is gone. The remaining gradient (n=1: ~€2,130 → n=2: ~€1,270) "
           "is real and economically sensible:\n\n"
           "- Genuine 2-house properties concentrate in rural areas (Normandy, Dordogne) "
           "where prices per m² are lower\n"
           "- The second structure is typically an older annexe or farmhouse sold as a package — "
           "worth less per m² than a standalone primary residence"),
        code(
            "con.execute('''\n"
            "  SELECT n_maisons,\n"
            "         COUNT(*)                         AS n_sales,\n"
            "         ROUND(MEDIAN(price_eur))          AS med_price,\n"
            "         ROUND(MEDIAN(built_area_m2))      AS med_built_m2,\n"
            "         ROUND(MEDIAN(price_per_m2))       AS med_eur_per_m2,\n"
            "         ROUND(MEDIAN(built_area_m2 / NULLIF(n_maisons,0))) AS med_m2_per_house\n"
            "  FROM sales\n"
            "  WHERE n_maisons BETWEEN 1 AND 5 AND n_appartements = 0\n"
            "    AND price_per_m2 BETWEEN 100 AND 30000\n"
            "  GROUP BY n_maisons ORDER BY n_maisons\n"
            "''').df()"
        ),

        md("## 6. Geographic check — are genuine 2-house sales more rural?\n\n"
           "Top departments by share of 2-house sales (using deduped `n_maisons`)."),
        code(
            "con.execute('''\n"
            "  WITH dept AS (\n"
            "    SELECT department_code,\n"
            "      COUNT(*) FILTER (WHERE n_maisons=1) AS n1,\n"
            "      COUNT(*) FILTER (WHERE n_maisons=2) AS n2\n"
            "    FROM sales\n"
            "    WHERE n_maisons IN (1,2) AND n_appartements=0\n"
            "    GROUP BY department_code\n"
            "  )\n"
            "  SELECT department_code, n1, n2,\n"
            "         ROUND(100.0*n2/(n1+n2),1) AS pct_2house\n"
            "  FROM dept WHERE n1+n2 > 500\n"
            "  ORDER BY pct_2house DESC LIMIT 15\n"
            "''').df()"
        ),

        md("## 7. €/m² gap within individual departments\n\n"
           "Even controlling for geography, 2-house properties sell for less per m². "
           "The gap is consistent across urban (Paris/Marseille) and rural (Creuse/Bordeaux) depts."),
        code(
            "con.execute('''\n"
            "  SELECT department_code, n_maisons,\n"
            "         COUNT(*)                     AS n,\n"
            "         ROUND(MEDIAN(price_eur))      AS med_price,\n"
            "         ROUND(MEDIAN(built_area_m2))  AS med_built_m2,\n"
            "         ROUND(MEDIAN(price_per_m2))   AS med_eur_per_m2\n"
            "  FROM sales\n"
            "  WHERE department_code IN (\\'75\\',\\'23\\',\\'33\\',\\'13\\')\n"
            "    AND n_maisons IN (1,2) AND n_appartements=0\n"
            "    AND price_per_m2 BETWEEN 100 AND 30000\n"
            "  GROUP BY department_code, n_maisons\n"
            "  ORDER BY department_code, n_maisons\n"
            "''').df()"
        ),

        md("## 8. Impact on overall median €/m² estimates\n\n"
           "Correcting the double-count raised the France-wide median €/m² by ~6%."),
        code(
            "con.execute('''\n"
            "  SELECT year,\n"
            "    ROUND(MEDIAN(price_per_m2)) AS med_eur_per_m2_corrected\n"
            "  FROM sales\n"
            "  WHERE price_per_m2 BETWEEN 100 AND 30000\n"
            "  GROUP BY year ORDER BY year\n"
            "''').df()\n"
            "# Note: old values were approx. 2021→€2,221, 2022→€2,436, 2023→€2,430\n"
            "# New (corrected) values are ~6% higher across all years."
        ),
    ]
    out = NOTEBOOKS / "04_multi_house_inspection.ipynb"
    nbf.write(nb, out)
    print(f"wrote {out}")


if __name__ == "__main__":
    build_sanity()
    build_test_query()
    build_outlier_policy()
    build_multi_house_inspection()
