"""Rundown of every column with <=10 distinct values: counts + percentages.
Also an English translation table for French column names and categorical values.
"""
from __future__ import annotations

from pathlib import Path

import duckdb

ROOT = Path(__file__).resolve().parent.parent
P = str(ROOT / "data" / "parquet" / "year=*" / "*.parquet")

# Columns with <=10 distinct values, identified by prior query.
LOW_CARD_COLS = [
    "nature_mutation",
    "type_local",
    "code_type_local",
    "ancien_nom_commune",
    "ancien_code_commune",
    "ancien_id_parcelle",  # 11 — close enough to include
    "year",
]

# English translations of French DVF value-strings.
VALUE_TRANSLATIONS: dict[str, str] = {
    # nature_mutation
    "Vente": "Sale",
    "Vente en l'état futur d'achèvement": "Off-plan sale (VEFA, pre-construction)",
    "Echange": "Exchange / swap",
    "Vente terrain à bâtir": "Sale of building land",
    "Adjudication": "Auction",
    "Expropriation": "Expropriation (eminent domain)",
    # type_local
    "Maison": "House",
    "Appartement": "Apartment",
    "Dépendance": "Outbuilding / annex",
    "Local industriel. commercial ou assimilé": "Commercial / industrial premises",
}


def main() -> None:
    con = duckdb.connect()
    con.execute(
        f"CREATE VIEW dvf AS SELECT * FROM read_parquet('{P}', hive_partitioning=true)"
    )
    total = con.execute("SELECT COUNT(*) FROM dvf").fetchone()[0]

    for col in LOW_CARD_COLS:
        print(f"\n{'=' * 80}")
        print(f"  {col}   (rows: {total:,})")
        print("=" * 80)
        df = con.execute(f"""
            SELECT
              COALESCE(CAST("{col}" AS VARCHAR), '(null)') AS value,
              COUNT(*) AS rows,
              ROUND(100.0 * COUNT(*) / {total}, 3) AS pct
            FROM dvf
            GROUP BY "{col}"
            ORDER BY rows DESC
        """).df()
        df["english"] = df["value"].map(VALUE_TRANSLATIONS).fillna("")
        print(df.to_string(index=False))


if __name__ == "__main__":
    main()
