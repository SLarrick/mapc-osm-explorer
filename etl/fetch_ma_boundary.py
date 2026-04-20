#!/usr/bin/env python3
"""
Fetch the Massachusetts state boundary from US Census TIGER/Line,
simplify it, and emit public/data/ma-boundary.geojson.

Why TIGER: authoritative, stable URL, public domain, and the state
shape is close enough to the OSM admin_level=4 boundary for our
purposes (a thin reference line outside the MAPC region).

Run once and commit the output — it doesn't change year-to-year in
any way the eye can see at MAPC-region zoom. Re-run if you want a
newer vintage.

Usage:
    python3 etl/fetch_ma_boundary.py
"""
from __future__ import annotations

import io
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

import duckdb

# TIGER 2023 state boundaries (all 50 states + territories, ~100MB zipped).
# We extract just MA and simplify aggressively — the output is a ~20-30KB
# GeoJSON, which at MAPC-region zoom looks identical to the full-res shape.
TIGER_URL = (
    "https://www2.census.gov/geo/tiger/TIGER2023/STATE/tl_2023_us_state.zip"
)

# ~100m tolerance in degrees. MA coastline has detail well below this
# (harbors, islands) but none of it's visible at z ≤ 10 where this layer
# is doing its job.
SIMPLIFY_TOLERANCE = 0.001

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "public" / "data" / "ma-boundary.geojson"
TMP_DIR = Path(__file__).resolve().parent / "_tmp_tiger"


def main() -> None:
    print(f"Downloading {TIGER_URL}...")
    try:
        with urllib.request.urlopen(TIGER_URL, timeout=60) as resp:
            data = resp.read()
    except Exception as e:  # noqa: BLE001
        sys.exit(f"Download failed: {e}")
    print(f"  {len(data):,} bytes")

    TMP_DIR.mkdir(exist_ok=True)
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            z.extractall(TMP_DIR)
        shp = TMP_DIR / "tl_2023_us_state.shp"
        if not shp.exists():
            sys.exit(f"Expected shapefile not found: {shp}")

        con = duckdb.connect(":memory:")
        con.execute("INSTALL spatial; LOAD spatial;")
        # STUSPS is the USPS two-letter code; "MA" selects Massachusetts.
        row = con.execute(
            f"""
            SELECT ST_AsGeoJSON(
                     ST_SimplifyPreserveTopology(geom, {SIMPLIFY_TOLERANCE})
                   ) AS geojson
            FROM ST_Read('{shp}')
            WHERE STUSPS = 'MA'
            """
        ).fetchone()
        if not row or not row[0]:
            sys.exit("MA geometry not found in TIGER shapefile")

        geom = json.loads(row[0])
        fc = {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": geom,
                    "properties": {
                        "name": "Massachusetts",
                        "source": "US Census Bureau TIGER/Line 2023",
                        "simplify_tolerance_deg": SIMPLIFY_TOLERANCE,
                    },
                }
            ],
        }
        OUT_PATH.write_text(json.dumps(fc))
        print(f"Wrote {OUT_PATH} ({OUT_PATH.stat().st_size:,} bytes)")
    finally:
        shutil.rmtree(TMP_DIR, ignore_errors=True)


if __name__ == "__main__":
    main()
