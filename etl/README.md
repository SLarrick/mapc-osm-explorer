# ETL — Build MAPC OSM parquet files

One-time (per data refresh) transform from a clipped MAPC OpenStreetMap PBF
into per-category GeoParquet files consumed by the browser app.

## Prerequisites

- Python 3.9+
- DuckDB (`pip3 install duckdb`)
- `osmium-tool` (only if you need to re-clip from a fresh Massachusetts extract)

## Input

A clipped MAPC PBF at `~/Documents/OSM as a data portal/data/mapc-latest.osm.pbf`
(produced earlier via `osmium extract --polygon MAPC_boundary.geojson`).

## Running

From the repo root:

```bash
python3 etl/build_parquet.py
```

Optional flags:

```bash
python3 etl/build_parquet.py \
  --pbf /path/to/mapc-latest.osm.pbf \
  --out public/data \
  --snapshot 2026-04
```

Expect ~2–5 minutes on an M-series Mac.

## Output

Writes to `public/data/`:

```
public/data/
  parks-and-recreation.parquet
  active-transportation.parquet
  transit.parquet
  community-facilities.parquet
  public-safety-and-health.parquet
  food-access.parquet
  civic-and-government.parquet
  streetscape.parquet
  streets-and-roadways.parquet
  buildings-and-addresses.parquet
  housing-and-land-use.parquet
  natural-features-and-green-infrastructure.parquet
  _manifest.json
```

Each parquet has columns:

- `osm_id` — OSM element id.
- `osm_type` — `node`, `way`, or `relation`. Relations are typically
  multipolygons (parks with holes, water bodies with islands, town
  halls with courtyards); the ETL assembles their geometries from
  member ways with outer/inner roles.
- `category` — parquet-level tag, duplicated on every row for convenience.
- `name` — OSM `name` tag (nullable).
- `tags` — full tag map as a JSON string.
- `geometry_wkb` — full geometry as OGC WKB (POINT / LINESTRING /
  POLYGON / MULTIPOLYGON).
- `centroid_lon`, `centroid_lat` — bbox-centroid scalars. Used by the
  region choropleth query so it doesn't need to fetch/parse the WKB
  payload just to locate each feature. ~16 bytes/row ≈ 16MB for 1M
  buildings, well worth it vs the WKB-parse alternative.

## MA state boundary asset

The map renders a thin MA state boundary outside the MAPC region for
geographic context. It's a separate one-time asset:

```bash
python3 etl/fetch_ma_boundary.py
```

This downloads TIGER/Line 2023 (US Census Bureau, public domain),
simplifies to ~100m tolerance, and writes `public/data/ma-boundary.geojson`
(~8KB). Commit the output. Re-run only if you want a newer vintage;
the shape doesn't change perceptibly year-over-year at MAPC-region zoom.

## Refresh cadence

Target: every ~3 months. To refresh:

1. Download fresh MA extract from Geofabrik.
2. Re-clip to MAPC boundary with `osmium extract`.
3. Run `python3 etl/build_parquet.py --snapshot YYYY-MM`.
4. Commit the updated parquet files and push. Vercel redeploys.

## Category rules

See [`categories.py`](./categories.py). Each feature gets exactly one
primary category based on a priority-ordered rule list — specific amenities
(school, hospital) beat generic ones (building, landuse).
