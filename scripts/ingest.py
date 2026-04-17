"""Convert DVF+ CSVs to year-partitioned Parquet.

Reads from data/dvf_plus/dvf-YYYY.csv.gz, writes to data/parquet/year=YYYY/part.parquet.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import polars as pl

ROOT = Path(__file__).resolve().parent.parent
SRC_DIR = ROOT / "data" / "dvf_plus"
OUT_DIR = ROOT / "data" / "parquet"
YEARS = [2021, 2022, 2023, 2024, 2025]

# Columns we want to KEEP as strings with leading zeros preserved.
STRING_CODE_COLS = [
    "id_mutation",
    "numero_disposition",
    "adresse_numero",
    "adresse_suffixe",
    "adresse_code_voie",
    "code_postal",
    "code_commune",
    "ancien_code_commune",
    "code_departement",
    "id_parcelle",
    "ancien_id_parcelle",
    "numero_volume",
    "lot1_numero",
    "lot2_numero",
    "lot3_numero",
    "lot4_numero",
    "lot5_numero",
    "code_type_local",
    "code_nature_culture",
    "code_nature_culture_speciale",
]


def ingest_year(year: int) -> None:
    src = SRC_DIR / f"dvf-{year}.csv.gz"
    out_dir = OUT_DIR / f"year={year}"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / "part.parquet"

    t0 = time.time()
    # Tell polars to treat code-like fields as strings (leading zeros matter)
    # and float fields as floats (polars can mis-infer as int from early rows).
    schema_overrides: dict[str, pl.DataType] = {c: pl.Utf8 for c in STRING_CODE_COLS}
    for c in [
        "valeur_fonciere",
        "lot1_surface_carrez",
        "lot2_surface_carrez",
        "lot3_surface_carrez",
        "lot4_surface_carrez",
        "lot5_surface_carrez",
        "surface_reelle_bati",
        "surface_terrain",
        "longitude",
        "latitude",
    ]:
        schema_overrides[c] = pl.Float64

    df = pl.read_csv(
        src,
        schema_overrides=schema_overrides,
        try_parse_dates=True,
        null_values=[""],
        low_memory=False,
    )

    # Sanity: ensure date parsed and year matches (DVF+ is year-bucketed, but worth checking)
    # `date_mutation` should already parse as pl.Date via try_parse_dates.
    if df.schema["date_mutation"] != pl.Date:
        df = df.with_columns(pl.col("date_mutation").str.to_date("%Y-%m-%d"))

    # Add a convenience year column so we don't have to reparse.
    df = df.with_columns(pl.col("date_mutation").dt.year().alias("year"))

    df.write_parquet(out, compression="zstd", statistics=True, row_group_size=200_000)

    elapsed = time.time() - t0
    size_mb = out.stat().st_size / 1e6
    print(
        f"[{year}] rows={len(df):>9,}  cols={len(df.columns)}  "
        f"out={size_mb:>6.1f} MB  elapsed={elapsed:.1f}s"
    )


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for year in YEARS:
        ingest_year(year)
    return 0


if __name__ == "__main__":
    sys.exit(main())
