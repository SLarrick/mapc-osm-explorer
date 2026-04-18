#!/usr/bin/env python3
"""
MAPC OSM Explorer — ETL

Reads a clipped MAPC OpenStreetMap PBF extract and emits one GeoParquet
file per category into `public/data/`, plus a `_manifest.json`.

Runtime: ~2-5 min on an M-series Mac for the ~112MB MAPC PBF.

Usage:
    python3 etl/build_parquet.py
    python3 etl/build_parquet.py --pbf /custom/path.pbf --snapshot 2026-04

The output parquets are consumed client-side by DuckDB-WASM.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import duckdb

# Make categories.py importable regardless of where script is invoked from
sys.path.insert(0, str(Path(__file__).resolve().parent))
from categories import CATEGORIES, CATEGORY_RULES, build_category_case_sql

# ---- Defaults ------------------------------------------------------------
REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PBF = Path.home() / "Documents/OSM as a data portal/data/mapc-latest.osm.pbf"
DEFAULT_OUT = REPO_ROOT / "public" / "data"
DEFAULT_SNAPSHOT = "2026-04"

# Buildings are polygons with 5-20 vertices each, ~1M of them.
# A ~1m tolerance removes collinear vertices without visible fidelity loss
# at typical zoom levels. Degrees — roughly 1e-5 ≈ 1.1m at Boston latitude.
BUILDING_SIMPLIFY_TOLERANCE = 0.00001


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def main() -> None:
    parser = argparse.ArgumentParser(description="Build MAPC OSM parquet files.")
    parser.add_argument("--pbf", type=Path, default=DEFAULT_PBF,
                        help=f"Input PBF file (default: {DEFAULT_PBF})")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT,
                        help=f"Output directory (default: {DEFAULT_OUT})")
    parser.add_argument("--snapshot", default=DEFAULT_SNAPSHOT,
                        help="Snapshot label (e.g. 2026-04)")
    args = parser.parse_args()

    pbf = args.pbf.resolve()
    out_dir = args.out.resolve()

    if not pbf.exists():
        sys.exit(f"PBF not found: {pbf}")
    out_dir.mkdir(parents=True, exist_ok=True)

    log(f"Input PBF: {pbf} ({human_bytes(pbf.stat().st_size)})")
    log(f"Output dir: {out_dir}")
    log(f"Snapshot: {args.snapshot}")

    # Use an on-disk scratch database so DuckDB can spill large intermediates.
    # 13M nodes × 1.5M ways produces an intermediate JOIN that overflows RAM.
    scratch = out_dir / "_etl_scratch.duckdb"
    if scratch.exists():
        scratch.unlink()
    con = duckdb.connect(str(scratch))
    con.execute("INSTALL spatial; LOAD spatial;")
    # Keep memory bounded; spill the rest to disk. Fewer threads => fewer
    # concurrent allocations, which matters more than parallelism here.
    # temp_directory must be set explicitly for hash-join/aggregate spilling.
    spill_dir = out_dir / "_etl_spill"
    spill_dir.mkdir(exist_ok=True)
    con.execute(f"""
        SET memory_limit='4GB';
        SET threads=3;
        SET preserve_insertion_order=false;
        SET temp_directory='{spill_dir}';
        SET max_temp_directory_size='80GB';
    """)

    pbf_str = str(pbf).replace("'", "''")
    category_case = build_category_case_sql()

    # ---- Step 1: Read ways and build the set of referenced node ids ----
    log("Step 1/4: reading ways...")
    con.execute(f"""
        CREATE TABLE ways_raw AS
        SELECT id, tags, refs
        FROM ST_ReadOSM('{pbf_str}')
        WHERE kind = 'way' AND refs IS NOT NULL AND len(refs) >= 2;
    """)
    n_ways = con.execute("SELECT count(*) FROM ways_raw").fetchone()[0]
    log(f"  ways: {n_ways:,}")

    log("  collecting referenced node ids...")
    con.execute("""
        CREATE TABLE ref_ids AS
        SELECT DISTINCT unnest(refs) AS id FROM ways_raw;
    """)

    # ---- Step 2: Read only nodes we need (referenced by ways OR tagged) --
    log("Step 2/4: reading nodes (only referenced or tagged)...")
    con.execute(f"""
        CREATE TABLE all_nodes AS
        SELECT n.id, n.lon, n.lat, n.tags
        FROM ST_ReadOSM('{pbf_str}') n
        WHERE n.kind = 'node'
          AND (
            n.id IN (SELECT id FROM ref_ids)
            OR (n.tags IS NOT NULL AND cardinality(n.tags) > 0)
          );
    """)
    n_nodes = con.execute("SELECT count(*) FROM all_nodes").fetchone()[0]
    log(f"  nodes kept: {n_nodes:,}")
    con.execute("DROP TABLE ref_ids;")

    # ---- Step 2: Build way geometries ----------------------------------
    # The join of ~15M (way, ref) rows with ~13M nodes, plus the ordered
    # list() aggregation, overflows memory as a single query even with
    # spill-to-disk. Solution: pre-explode way refs into a table, then
    # build line geometries in N batches partitioned by way_id modulo N.
    log("Step 3/4: constructing way geometries...")

    log("  exploding way refs into (way_id, node_id, idx) table...")
    con.execute("""
        CREATE OR REPLACE TABLE way_nodes AS
        SELECT id AS way_id, t.ref AS node_id, t.idx
        FROM ways_raw, UNNEST(refs) WITH ORDINALITY AS t(ref, idx);
    """)
    n_way_nodes = con.execute("SELECT count(*) FROM way_nodes").fetchone()[0]
    log(f"  way→node rows: {n_way_nodes:,}")

    # Index-style helper: build a table of line geometries per way in batches
    con.execute("""
        CREATE OR REPLACE TABLE way_lines (way_id BIGINT, line GEOMETRY);
    """)

    NUM_BATCHES = 16
    for i in range(NUM_BATCHES):
        log(f"  building lines batch {i + 1}/{NUM_BATCHES}...")
        con.execute(f"""
            INSERT INTO way_lines
            SELECT wn.way_id,
                   ST_MakeLine(list(ST_Point(n.lon, n.lat) ORDER BY wn.idx)) AS line
            FROM way_nodes wn
            JOIN all_nodes n ON n.id = wn.node_id
            WHERE wn.way_id % {NUM_BATCHES} = {i}
            GROUP BY wn.way_id
            HAVING count(*) >= 2;
        """)

    n_lines = con.execute("SELECT count(*) FROM way_lines").fetchone()[0]
    log(f"  way lines built: {n_lines:,}")

    # way_nodes no longer needed
    con.execute("DROP TABLE way_nodes;")

    # Final: apply polygon-vs-line logic (closed ways with area-like tags → polygon)
    log("  applying polygon/line rules...")
    con.execute("""
        CREATE OR REPLACE TABLE way_geoms AS
        SELECT
            w.id,
            w.tags,
            CASE
                WHEN w.refs[1] = w.refs[len(w.refs)]
                     AND w.tags['highway'] IS NULL
                     AND (w.tags['building'] IS NOT NULL
                          OR w.tags['landuse'] IS NOT NULL
                          OR w.tags['leisure'] IS NOT NULL
                          OR w.tags['natural'] IS NOT NULL
                          OR w.tags['amenity'] IS NOT NULL
                          OR w.tags['tourism'] IS NOT NULL
                          OR w.tags['shop'] IS NOT NULL
                          OR w.tags['place'] IS NOT NULL
                          OR w.tags['water'] IS NOT NULL
                          OR w.tags['area'] = 'yes')
                THEN COALESCE(TRY(ST_MakePolygon(wl.line)), wl.line)
                ELSE wl.line
            END AS geom
        FROM ways_raw w
        JOIN way_lines wl ON wl.way_id = w.id;
    """)
    n_way_geoms = con.execute("SELECT count(*) FROM way_geoms").fetchone()[0]
    log(f"  way geometries built: {n_way_geoms:,}")
    con.execute("DROP TABLE way_lines;")
    con.execute("DROP TABLE ways_raw;")

    # ---- Step 3: Unified features table with category ------------------
    log("Step 4/4: categorizing and writing per-category parquets...")
    con.execute(f"""
        CREATE OR REPLACE TABLE features AS
        SELECT
            id AS osm_id,
            'node' AS osm_type,
            tags['name'] AS name,
            tags,
            ST_Point(lon, lat) AS geom,
            ({category_case}) AS category
        FROM all_nodes
        WHERE tags IS NOT NULL AND cardinality(tags) > 0

        UNION ALL BY NAME

        SELECT
            id AS osm_id,
            'way' AS osm_type,
            tags['name'] AS name,
            tags,
            geom,
            ({category_case}) AS category
        FROM way_geoms;
    """)
    n_features = con.execute(
        "SELECT count(*) FROM features WHERE category IS NOT NULL"
    ).fetchone()[0]
    log(f"  categorized features: {n_features:,}")

    # ---- Step 4: Per-category parquet writes ---------------------------
    manifest_entries = []

    for slug, label in [(c["slug"], c["label"]) for c in CATEGORIES]:
        out_path = out_dir / f"{slug}.parquet"

        # Buildings get simplified; others keep full fidelity.
        if slug == "buildings-and-addresses":
            simplify_sql = f"""
                CASE
                    WHEN ST_GeometryType(geom) IN ('POLYGON','MULTIPOLYGON')
                    THEN ST_SimplifyPreserveTopology(geom, {BUILDING_SIMPLIFY_TOLERANCE})
                    ELSE geom
                END
            """
        else:
            simplify_sql = "geom"

        con.execute(f"""
            COPY (
                SELECT
                    osm_id,
                    osm_type,
                    '{slug}' AS category,
                    name,
                    -- serialize tag map as JSON for portable client-side consumption
                    to_json(tags) AS tags,
                    ST_AsWKB({simplify_sql}) AS geometry_wkb
                FROM features
                WHERE category = '{slug}' AND geom IS NOT NULL
            ) TO '{out_path}' (FORMAT PARQUET, COMPRESSION ZSTD);
        """)

        # Stats
        count = con.execute(
            f"SELECT count(*) FROM features WHERE category = '{slug}' AND geom IS NOT NULL"
        ).fetchone()[0]
        size_bytes = out_path.stat().st_size
        log(f"  {slug}: {count:,} features → {human_bytes(size_bytes)}")

        manifest_entries.append({
            "slug": slug,
            "label": label,
            "file": f"{slug}.parquet",
            "feature_count": count,
            "file_size_bytes": size_bytes,
            "simplified": slug == "buildings-and-addresses",
        })

    # ---- Manifest ------------------------------------------------------
    manifest = {
        "snapshot": args.snapshot,
        "source": "Geofabrik Massachusetts extract, clipped to MAPC boundary",
        "license": "Data © OpenStreetMap contributors (ODbL)",
        "categories": manifest_entries,
        "total_features": sum(e["feature_count"] for e in manifest_entries),
        "total_bytes": sum(e["file_size_bytes"] for e in manifest_entries),
    }
    manifest_path = out_dir / "_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2))
    log(f"Manifest written: {manifest_path}")
    log(f"Total output: {human_bytes(manifest['total_bytes'])} "
        f"across {len(manifest_entries)} categories, "
        f"{manifest['total_features']:,} features")

    # Cleanup scratch artifacts (don't commit these)
    con.close()
    scratch.unlink(missing_ok=True)
    scratch_wal = scratch.with_suffix(scratch.suffix + ".wal")
    scratch_wal.unlink(missing_ok=True)
    import shutil
    shutil.rmtree(spill_dir, ignore_errors=True)
    log("Cleaned up scratch files.")


if __name__ == "__main__":
    main()
