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
 * Region-wide query result. Includes the total feature count (the thing
 * we are most sure of) alongside an optional feature collection for map
 * render.
 *
 * The two-tier model:
 *   - `totalCount` is always real. `fc` is non-empty only when the total is
 *     small enough to be meaningful as a point map.
 *   - When `renderable` is false, we skipped the feature fetch entirely
 *     (saves bandwidth + DuckDB work) and the UI should lean into the
 *     count as the primary answer.
 *
 * This matches the design principle in PRD §9: descriptive counts are
 * cheap and trustworthy; rendered points are a richer but rougher artifact
 * that shouldn't be shown when they'd mislead.
 */
export interface RegionResult {
  fc: GeoJSON.FeatureCollection<GeoJSON.Geometry>;
  /** Total rows the SQL filter matched. Always accurate. */
  totalCount: number;
  /** True when we fetched features (and maybe hit the cap). When false, we
   *  skipped the feature query because totalCount was above the render
   *  threshold — show count-only UI. */
  renderable: boolean;
  /** True when totalCount > cap and the fetched features are a subset.
   *  Only meaningful when renderable is true. */
  truncated: boolean;
  /** Render cap used if the feature query ran. */
  cap: number;
}

/**
 * Maximum total count at which we'll render the raw geometries on the
 * map. Above this, a full render is too dense to be informative at
 * MAPC-region zoom — Somerville + Cambridge become a blob — so we show
 * the count only and point the user at a muni for the map view. Slice
 * 4A (muni-choropleth) and 4B (hex density) will replace this hard
 * cutoff with real aggregated renders for high-N features.
 *
 * 25k was chosen after measuring real counts per subtype (see ETL audit
 * 2026-04): it covers every subtype the user flagged as "useful at
 * region scale" — bus-stops (~8.5k), parks (~5k), sports-fields
 * (~6.3k), bike-paths (~3.7k), water-bodies (~5.6k), forests (~2.4k),
 * wetlands (~14.4k), trails (~24.3k) — while keeping noisy high-N
 * types (trees 34k, residential-streets 59k, footpaths 123k,
 * all-buildings 1M) on the count-only path.
 */
export const REGION_RENDER_THRESHOLD = 25_000;

/**
 * Per-call cap on the number of features fetched when we *do* render.
 * Set just above REGION_RENDER_THRESHOLD so it only kicks in for edge
 * cases where COUNT slightly underestimates post-filter row count.
 * The threshold is the primary gate.
 */
export const REGION_RENDER_CAP = 30_000;

/**
 * Find all OSM features matching a curated subtype across the entire
 * MAPC region. No point-in-polygon filter — the parquet itself is clipped
 * to MAPC at ETL time, so every row is already "in region."
 *
 * Two-phase:
 *   1. Always run COUNT(*). Cheap, precise, and the only honest answer
 *      when N is huge (1M buildings).
 *   2. Fetch geometries (up to `cap`) only if totalCount ≤ `threshold`.
 *      Above the threshold, a raw point map at MAPC zoom is noise, not
 *      signal, so we short-circuit and let the UI say "there are X, pick
 *      a muni to see them."
 *
 * We also log the ratio so Slice 4 has real numbers for every subtype.
 */
export async function findFeaturesInRegion(
  subtypeSlug: string,
  cap: number = REGION_RENDER_CAP,
  threshold: number = REGION_RENDER_THRESHOLD,
): Promise<RegionResult> {
  const subtype = getSubtypeBySlug(subtypeSlug);
  if (!subtype) throw new Error(`Unknown feature type: ${subtypeSlug}`);

  const parquetUrl = new URL(
    `/data/${subtype.categorySlug}.parquet`,
    window.location.origin,
  ).toString();

  const where = filterToSql(subtype.filter);

  // Phase 1: count only. DuckDB's predicate pushdown makes this almost
  // free — it only touches the column(s) referenced in the filter.
  const countRows = await runSql<{ n: bigint | number }>(`
    SELECT COUNT(*) AS n
    FROM '${parquetUrl}'
    WHERE ${where}
  `);
  const totalCount = Number(countRows[0]?.n ?? 0);

  // Count above the render threshold — skip phase 2 entirely. This saves
  // both bandwidth (no WKB payload) and render time (no GeoJSON source
  // update). The UI will lean on the count alone.
  if (totalCount > threshold) {
    // eslint-disable-next-line no-console
    console.log(
      `[region-query] ${subtypeSlug}: ${totalCount} features — above render threshold (${threshold}), skipping geometry fetch`,
    );
    return {
      fc: { type: "FeatureCollection", features: [] },
      totalCount,
      renderable: false,
      truncated: false,
      cap,
    };
  }

  // Phase 2: fetch capped rows and parse geometries.
  const rows = await runSql<RawRow>(`
    SELECT osm_id, osm_type, name, CAST(tags AS VARCHAR) AS tags, geometry_wkb
    FROM '${parquetUrl}'
    WHERE ${where}
    LIMIT ${cap}
  `);
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
    renderable: true,
    truncated,
    cap,
  };
}
