/**
 * Category queries. Each function returns a FeatureCollection with real
 * geometries (Point / LineString / Polygon / Multi*) ready to render on
 * the map, with OSM tags preserved as properties.
 */
import { runSql } from "./duckdb";
import { parseWkbGeometry } from "./wkb";
import { getMunicipalityBySlug, pointInArea } from "./geo";
import {
  filterToSql,
  getSubtypeBySlug,
  type Subtype,
} from "./taxonomy";

export interface ResultFeature extends GeoJSON.Feature<GeoJSON.Geometry> {
  /** Stable per-feature id: "${osm_type}/${osm_id}" (e.g. "way/12345"). Used
   *  by MapLibre feature-state for selection styling + by callers to look up
   *  a feature by click. Set as the top-level GeoJSON id so no promoteId
   *  is needed on the source. */
  id: string;
  properties: {
    uid: string;
    osm_id: number;
    osm_type: string;
    name: string | null;
    tags: Record<string, string>;
  };
}

type RawRow = {
  osm_id: bigint | number;
  osm_type: string;
  name: string | null;
  tags: string; // JSON string from parquet
  geometry_wkb: Uint8Array;
};

/**
 * Find all OSM features matching a curated subtype ("playgrounds",
 * "libraries", …) inside a municipality, using bbox-centroid as a cheap
 * point-in-polygon proxy. Good enough for most small features; we'll
 * swap in DuckDB ST_Intersects when we pull in the spatial extension.
 */
export async function findFeaturesInMuni(
  subtypeSlug: string,
  muniSlug: string,
): Promise<GeoJSON.FeatureCollection<GeoJSON.Geometry>> {
  const subtype = getSubtypeBySlug(subtypeSlug);
  if (!subtype) throw new Error(`Unknown feature type: ${subtypeSlug}`);
  return findFeaturesInMuniBy(subtype, muniSlug);
}

async function findFeaturesInMuniBy(
  subtype: Subtype,
  muniSlug: string,
): Promise<GeoJSON.FeatureCollection<GeoJSON.Geometry>> {
  const muni = await getMunicipalityBySlug(muniSlug);
  if (!muni) throw new Error(`Unknown municipality slug: ${muniSlug}`);

  // Parquet URL — always same-origin, served by Vercel with range support.
  // The category slug names the file per _manifest.json.
  const parquetUrl = new URL(
    `/data/${subtype.categorySlug}.parquet`,
    window.location.origin,
  ).toString();

  const where = filterToSql(subtype.filter);
  const rows = await runSql<RawRow>(`
    SELECT osm_id, osm_type, name, CAST(tags AS VARCHAR) AS tags, geometry_wkb
    FROM '${parquetUrl}'
    WHERE ${where}
  `);

  const features: ResultFeature[] = [];
  const muniGeom = muni.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;

  for (const row of rows) {
    const parsed = parseWkbGeometry(row.geometry_wkb);
    if (!parsed) continue;
    if (!pointInArea(parsed.center, muniGeom)) continue;

    let parsedTags: Record<string, string> = {};
    try {
      parsedTags = JSON.parse(row.tags) as Record<string, string>;
    } catch {
      /* tolerate bad JSON */
    }

    const osmId = Number(row.osm_id);
    const uid = `${row.osm_type}/${osmId}`;
    features.push({
      id: uid,
      type: "Feature",
      geometry: parsed.geometry,
      properties: {
        uid,
        osm_id: osmId,
        osm_type: row.osm_type,
        name: row.name,
        tags: parsedTags,
      },
    });
  }

  return { type: "FeatureCollection", features };
}

/** Back-compat shim used by old tests / call sites from Slice 1. */
export async function findPlaygroundsInMuni(
  muniSlug: string,
): Promise<GeoJSON.FeatureCollection<GeoJSON.Geometry>> {
  return findFeaturesInMuni("playgrounds", muniSlug);
}

/**
 * Region-wide query result. Includes the total feature count (before the
 * render cap) so the UI can honestly report "showing N of M" when the cap
 * kicks in.
 */
export interface RegionResult {
  fc: GeoJSON.FeatureCollection<GeoJSON.Geometry>;
  /** Total rows the SQL filter matched, pre-cap. */
  totalCount: number;
  /** True when totalCount > cap and we're only rendering a subset. */
  truncated: boolean;
  /** Render cap used for this call. */
  cap: number;
}

/**
 * Default render cap for region-wide queries. Tuned for MapLibre rendering
 * headroom, not for DuckDB's query cost (which can handle much more).
 * When we add muni-choropleth / hex-density rendering in Slice 4, high-N
 * feature types will go through an aggregation path instead of hitting
 * this cap.
 */
export const REGION_RENDER_CAP = 5000;

/**
 * Find all OSM features matching a curated subtype across the entire
 * MAPC region. No point-in-polygon filter — the parquet itself is clipped
 * to MAPC at ETL time, so every row is already "in region."
 *
 * We cap the render payload at `cap` (default 5000) to keep MapLibre
 * responsive; the true total is returned separately so the UI can say
 * "Showing 5,000 of 34,812." We also log the ratio to the console so we
 * collect real numbers to drive Slice 4 rendering decisions.
 */
export async function findFeaturesInRegion(
  subtypeSlug: string,
  cap: number = REGION_RENDER_CAP,
): Promise<RegionResult> {
  const subtype = getSubtypeBySlug(subtypeSlug);
  if (!subtype) throw new Error(`Unknown feature type: ${subtypeSlug}`);

  const parquetUrl = new URL(
    `/data/${subtype.categorySlug}.parquet`,
    window.location.origin,
  ).toString();

  const where = filterToSql(subtype.filter);

  // Two queries: one for the true total, one for the capped rows.
  // DuckDB's lazy parquet reads make the COUNT(*) almost free — it only
  // touches the column(s) referenced in the filter via predicate
  // pushdown. The cost difference vs. a single query is negligible and
  // the honesty win (accurate "N of M" messaging) is worth it.
  const [countRows, rows] = await Promise.all([
    runSql<{ n: bigint | number }>(`
      SELECT COUNT(*) AS n
      FROM '${parquetUrl}'
      WHERE ${where}
    `),
    runSql<RawRow>(`
      SELECT osm_id, osm_type, name, CAST(tags AS VARCHAR) AS tags, geometry_wkb
      FROM '${parquetUrl}'
      WHERE ${where}
      LIMIT ${cap}
    `),
  ]);

  const totalCount = Number(countRows[0]?.n ?? 0);
  const truncated = totalCount > cap;

  const features: ResultFeature[] = [];
  for (const row of rows) {
    const parsed = parseWkbGeometry(row.geometry_wkb);
    if (!parsed) continue;

    let parsedTags: Record<string, string> = {};
    try {
      parsedTags = JSON.parse(row.tags) as Record<string, string>;
    } catch {
      /* tolerate bad JSON */
    }

    const osmId = Number(row.osm_id);
    const uid = `${row.osm_type}/${osmId}`;
    features.push({
      id: uid,
      type: "Feature",
      geometry: parsed.geometry,
      properties: {
        uid,
        osm_id: osmId,
        osm_type: row.osm_type,
        name: row.name,
        tags: parsedTags,
      },
    });
  }

  // Instrumentation for Slice 4 rendering decisions: we want real
  // N numbers for each subtype, not theoretical estimates.
  // eslint-disable-next-line no-console
  console.log(
    `[region-query] ${subtypeSlug}: rendering ${features.length} of ${totalCount}` +
      (truncated ? ` (capped at ${cap})` : ""),
  );

  return {
    fc: { type: "FeatureCollection", features },
    totalCount,
    truncated,
    cap,
  };
}
