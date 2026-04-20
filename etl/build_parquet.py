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
# A ~3m tolerance keeps shape fidelity at typical zoom levels and holds
# the parquet comfortably under GitHub's 100MB per-file limit after the
# centroid columns are added. Degrees — 3e-5 ≈ 3.3m at Boston latitude.
BUILDING_SIMPLIFY_TOLERANCE = 0.00003


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
    log("Step 1/5: reading ways...")
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
    log("Step 2/5: reading nodes (only referenced or tagged)...")
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

    # ---- Step 2.5: Read multipolygon + boundary relations --------------
    # OSM relations of type=multipolygon are the canonical representation
    # for features with holes (parks with ponds), islands in water bodies,
    # and disjoint shapes (town halls with courtyards). Without this pass
    # they're silently dropped — e.g. North Reading Town Hall is OSM
    # relation 2855405. type=boundary is included because some admin
    # features (civic parcels) use it.
    #
    # We restrict to tagged relations with type IN ('multipolygon',
    # 'boundary'); untagged relations carry their identity on an outer
    # member way and are already captured in the ways path.
    log("Step 3/5: reading multipolygon relations...")
    con.execute(f"""
        CREATE TABLE relations_raw AS
        SELECT id, tags, refs, ref_types, ref_roles
        FROM ST_ReadOSM('{pbf_str}')
        WHERE kind = 'relation'
          AND tags IS NOT NULL
          AND cardinality(tags) > 0
          AND tags['type'] IN ('multipolygon', 'boundary')
          AND refs IS NOT NULL
          AND len(refs) >= 1;
    """)
    n_rels = con.execute("SELECT count(*) FROM relations_raw").fetchone()[0]
    log(f"  relations: {n_rels:,}")

    # Explode (relation_id, member_way_id, role). We only care about way
    # members; node members in multipolygons are rare and decorative
    # (admin centre markers etc.).
    log("  exploding relation members...")
    con.execute("""
        CREATE OR REPLACE TABLE rel_members AS
        SELECT r.id AS rel_id,
               r.refs[t.idx] AS member_id,
               r.ref_roles[t.idx] AS role
        FROM relations_raw r, UNNEST(generate_series(1, len(r.refs))) AS t(idx)
        WHERE r.ref_types[t.idx] = 'way';
    """)
    n_rel_members = con.execute("SELECT count(*) FROM rel_members").fetchone()[0]
    log(f"  relation→way members: {n_rel_members:,}")

    # ---- Step 3: Build way geometries ----------------------------------
    # The join of ~15M (way, ref) rows with ~13M nodes, plus the ordered
    # list() aggregation, overflows memory as a single query even with
    # spill-to-disk. Solution: pre-explode way refs into a table, then
    # build line geometries in N batches partitioned by way_id modulo N.
    log("Step 4/5: constructing way + relation geometries...")

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

    # ---- Build relation geometries (multipolygon assembly) -------------
    # Strategy per relation:
    #   1. Collect outer-role member lines into a MultiLineString.
    #   2. ST_LineMerge stitches way fragments end-to-end into rings
    #      (ways inside a multipolygon often split at node shared with
    #      other features, so one "logical" outer boundary can be N ways).
    #   3. ST_Polygonize turns merged rings into a MULTIPOLYGON.
    #   4. Same for inner rings. ST_Difference cuts holes.
    #
    # TRY(...) absorbs bad rings (dangling ways, unclosed outers) — those
    # relations just emit NULL geom and get dropped by the final WHERE.
    # Empty-string role counts as outer (older relations).
    log("  assembling relation multipolygons...")
    con.execute("""
        CREATE OR REPLACE TABLE rel_geoms AS
        WITH outer_agg AS (
            SELECT rm.rel_id, ST_Collect(list(wl.line)) AS line_coll
            FROM rel_members rm
            JOIN way_lines wl ON wl.way_id = rm.member_id
            WHERE rm.role = 'outer' OR rm.role IS NULL OR rm.role = ''
            GROUP BY rm.rel_id
        ),
        inner_agg AS (
            SELECT rm.rel_id, ST_Collect(list(wl.line)) AS line_coll
            FROM rel_members rm
            JOIN way_lines wl ON wl.way_id = rm.member_id
            WHERE rm.role = 'inner'
            GROUP BY rm.rel_id
        ),
        built AS (
            SELECT r.id,
                   r.tags,
                   TRY(ST_Polygonize([ST_LineMerge(o.line_coll)])) AS outer_poly,
                   TRY(ST_Polygonize([ST_LineMerge(i.line_coll)])) AS inner_poly
            FROM relations_raw r
            JOIN outer_agg o ON o.rel_id = r.id
            LEFT JOIN inner_agg i ON i.rel_id = r.id
        )
        SELECT id, tags,
               CASE
                   WHEN outer_poly IS NULL THEN NULL
                   WHEN inner_poly IS NULL THEN outer_poly
                   ELSE COALESCE(TRY(ST_Difference(outer_poly, inner_poly)), outer_poly)
               END AS geom
        FROM built
        WHERE outer_poly IS NOT NULL;
    """)
    n_rel_geoms = con.execute(
        "SELECT count(*) FROM rel_geoms WHERE geom IS NOT NULL"
    ).fetchone()[0]
    log(f"  relation geometries built: {n_rel_geoms:,} (of {n_rels:,} raw)")

    # Dedupe: drop ways that are an outer member of a relation whose
    # geometry we successfully built — otherwise we get both the relation
    # polygon and its outer way as separate features. OSM convention:
    # when the relation has feature tags (which ours do, by the type=
    # filter), the relation is authoritative and the outer-way geometry
    # is a subordinate artifact of the multipolygon assembly.
    con.execute("""
        CREATE OR REPLACE TABLE outer_way_ids AS
        SELECT DISTINCT rm.member_id AS way_id
        FROM rel_members rm
        JOIN rel_geoms rg ON rg.id = rm.rel_id
        WHERE (rm.role = 'outer' OR rm.role IS NULL OR rm.role = '')
          AND rg.geom IS NOT NULL;
    """)
    n_dupe_ways = con.execute(
        "SELECT count(*) FROM outer_way_ids"
    ).fetchone()[0]
    log(f"  outer-way de-dupes queued: {n_dupe_ways:,}")

    con.execute("DROP TABLE way_lines;")
    con.execute("DROP TABLE ways_raw;")
    con.execute("DROP TABLE rel_members;")
    con.execute("DROP TABLE relations_raw;")

    # ---- Step 5: Unified features table with category ------------------
    log("Step 5/5: categorizing and writing per-category parquets...")
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
        FROM way_geoms
        WHERE id NOT IN (SELECT way_id FROM outer_way_ids)

        UNION ALL BY NAME

        SELECT
            id AS osm_id,
            'relation' AS osm_type,
            tags['name'] AS name,
            tags,
            geom,
            ({category_case}) AS category
        FROM rel_geoms
        WHERE geom IS NOT NULL;
    """)
    n_features = con.execute(
        "SELECT count(*) FROM features WHERE category IS NOT NULL"
    ).fetchone()[0]
    log(f"  categorized features: {n_features:,}")

    # ---- Per-category parquet writes -----------------------------------
    # Each parquet gains two light-weight scalar columns — centroid_lon /
    # centroid_lat — computed in DuckDB from the (possibly simplified)
    # geometry. They exist so the choropleth query (and any future "just
    # give me points" pass) doesn't have to pay the WKB payload cost
    # just to locate features. ~16 bytes per row for 1M buildings ≈ 16MB,
    # which we eat once in the parquet and cheap-read on the client.
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
                WITH g AS (
                    SELECT
                        osm_id,
                        osm_type,
                        name,
                        tags,
                        {simplify_sql} AS geom
                    FROM features
                    WHERE category = '{slug}' AND geom IS NOT NULL
                )
                SELECT
                    osm_id,
                    osm_type,
                    '{slug}' AS category,
                    name,
                    -- serialize tag map as JSON for portable client-side consumption
                    to_json(tags) AS tags,
                    ST_AsWKB(geom) AS geometry_wkb,
                    ST_X(ST_Centroid(geom)) AS centroid_lon,
                    ST_Y(ST_Centroid(geom)) AS centroid_lat
                FROM g
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
