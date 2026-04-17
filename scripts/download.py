"""Download DVF+ geocoded CSVs from Etalab for 2021-2025."""
from __future__ import annotations

import sys
from pathlib import Path

import requests
from tqdm import tqdm

YEARS = [2021, 2022, 2023, 2024, 2025]
URL_TEMPLATE = "https://files.data.gouv.fr/geo-dvf/latest/csv/{year}/full.csv.gz"
OUT_DIR = Path(__file__).resolve().parent.parent / "data" / "dvf_plus"


def download(year: int) -> Path:
    out = OUT_DIR / f"dvf-{year}.csv.gz"
    if out.exists():
        print(f"[{year}] already downloaded ({out.stat().st_size / 1e6:.1f} MB), skipping")
        return out

    url = URL_TEMPLATE.format(year=year)
    print(f"[{year}] downloading {url}")
    with requests.get(url, stream=True, timeout=60) as r:
        r.raise_for_status()
        total = int(r.headers.get("Content-Length", 0))
        tmp = out.with_suffix(".gz.part")
        with open(tmp, "wb") as f, tqdm(
            total=total, unit="B", unit_scale=True, desc=f"{year}"
        ) as bar:
            for chunk in r.iter_content(chunk_size=1 << 20):
                f.write(chunk)
                bar.update(len(chunk))
        tmp.rename(out)
    return out


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for year in YEARS:
        download(year)
    return 0


if __name__ == "__main__":
    sys.exit(main())
