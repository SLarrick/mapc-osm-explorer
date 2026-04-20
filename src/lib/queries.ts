/**
 * Category queries. Each function returns a FeatureCollection with real
 * geometries (Point / LineString / Polygon / Multi*) ready to render on
 * the map, with OSM tags preserved as properties.
 */
import { runSql } from "./duckdb";
import { parseWkbGeometry } from "./wkb";
import {
  getMunicipalityBySlug,
  loadMuniIndex,
  pointInArea,
  type MuniIndexEntry,
} from "./geo";
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
    /** MAPC muni slug the feature's centroid falls in. Always set for
     *  focused queries (it's the query muni). For region queries, set
     *  by the PIP binning pass; null if the centroid fell outside every
     *  MAPC muni (shouldn't happen because the parquet is clipped to
     *  MAPC, but we tolerate it). */
    muni_slug: string | null;
    muni_name: string | null;
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
 * Focused-mode render threshold. A single muni with more features than
 * this (Boston with ~180k buildings is the canonical case) is not
 * useful to draw as individual points OR to load as table rows — the
 * browser chokes and the human can't scroll through 180k anyway.
 *
 * Higher than the region threshold (25k) because single-muni context
 * is more meaningful. Callers above the threshold get count-only
 * metadata with no feature payload.
 */
export const FOCUSED_RENDER_THRESHOLD = 50_000;

/**
 * Result of a focused (single-muni) query. Mirrors RegionResult's
 * two-phase shape: COUNT always, feature payload only when below the
 * render threshold.
 */
export interface FocusedResult {
  fc: GeoJSON.FeatureCollection<GeoJSON.Geometry>;
  /** Total features in the muni matching the filter. Always accurate. */
  totalCount: number;
  /** True when we fetched features. False when count exceeded the
   *  threshold and we skipped the geometry fetch — UI should lean on
   *  totalCount in that case. */
  renderable: boolean;
  /** Threshold used. Surfaced so the UI can tell the user "more than
   *  50k of X in this muni." */
  threshold: number;
}

/**
 * Find all OSM features matching a curated subtype ("playgrounds",
 * "libraries", …) inside a municipality, using bbox-centroid as a cheap
 * point-in-polygon proxy. Good enough for most small features; we'll
 * swap in DuckDB ST_Intersects when we pull in the spatial extension.
 *
 * Two-phase (same as findFeaturesInRegion):
 *   1. COUNT(*) WHERE filter — cheap, always runs.
 *   2. Feature fetch + per-feature PIP — only if count ≤ threshold.
 *      Above threshold, skip entirely and let the UI show count only.
 */
export async function findFeaturesInMuni(
  subtypeSlug: string,
  muniSlug: string,
  threshold: number = FOCUSED_RENDER_THRESHOLD,
): Promise<FocusedResult> {
  const subtype = getSubtypeBySlug(subtypeSlug);
  if (!subtype) throw new Error(`Unknown feature type: ${subtypeSlug}`);
  return findFeaturesInMuniBy(subtype, muniSlug, threshold);
}

async function findFeaturesInMuniBy(
  subtype: Subtype,
  muniSlug: string,
  threshold: number,
): Promise<FocusedResult> {
  const muni = await getMunicipalityBySlug(muniSlug);
  if (!muni) throw new Error(`Unknown municipality slug: ${muniSlug}`);

  // Parquet URL — always same-origin, served by Vercel with range support.
  // The category slug names the file per _manifest.json.
  const parquetUrl = new URL(
    `/data/${subtype.categorySlug}.parquet`,
    window.location.origin,
  ).toString();

  const where = filterToSql(subtype.filter);

  // Phase 1: cheap count of all features matching the filter in the
  // parquet. Note this is region-wide count, not muni-scoped — the
  // parquet doesn't know about munis. We use it as an upper bound:
  // if the region-wide count is already below threshold, the muni
  // count must be too. Above threshold we fall back to the more
  // expensive muni-scoped count path (not yet implemented; for v1
  // we cheat with the region count, which is a safe over-estimate).
  //
  // In practice the threshold (50k) is high enough that only the
  // mass-tag subtypes (all-buildings, residential-streets, footpaths)
  // trip it — and all of those are genuinely too dense to render
  // for any muni, even small ones. False-trips are rare in practice.
  const countRows = await runSql<{ n: bigint | number }>(`
    SELECT COUNT(*) AS n
    FROM '${parquetUrl}'
    WHERE ${where}
  `);
  const regionTotal = Number(countRows[0]?.n ?? 0);

  if (regionTotal > threshold) {
    // eslint-disable-next-line no-console
    console.log(
      `[focused-query] ${subtype.slug} in ${muniSlug}: region count ${regionTotal} > threshold ${threshold}, skipping geometry fetch`,
    );
    return {
      fc: { type: "FeatureCollection", features: [] },
      totalCount: regionTotal,
      renderable: false,
      threshold,
    };
  }

  const rows = await runSql<RawRow>(`
    SELECT osm_id, osm_type, name, CAST(tags AS VARCHAR) AS tags, geometry_wkb
    FROM '${parquetUrl}'
    WHERE ${where}
  `);

  const features: ResultFeature[] = [];
  const muniGeom = muni.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon;
  const muniName = (muni.properties as { name?: string } | null)?.name ?? null;

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
        muni_slug: muniSlug,
        muni_name: muniName,
      },
    });
  }

  return {
    fc: { type: "FeatureCollection", features },
    totalCount: features.length,
    renderable: true,
    threshold,
  };
}

/** Back-compat shim used by old tests / call sites from Slice 1. */
export async function findPlaygroundsInMuni(
  muniSlug: string,
): Promise<GeoJSON.FeatureCollection<GeoJSON.Geometry>> {
  const res = await findFeaturesInMuni("playgrounds", muniSlug);
  return res.fc;
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
  /** Feature count per MAPC muni slug, derived from feature centroids.
   *  Always present for region queries — this drives the choropleth
   *  layer, which is the honest regional view for high-N features
   *  where a raw point render is noise (Slice 4A). Munis with zero
   *  features are absent from the map (consumers should treat
   *  missing as 0). */
  countsByMuni: Map<string, number>;
  /** True when we had to fall back to parsing WKB for centroids because
   *  the parquet didn't ship centroid_lon/centroid_lat. Indicates the
   *  ETL is on an older snapshot; functional but slower and more bandwidth. */
  centroidsWereSlow: boolean;
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

  // Phase 2: per-muni counts from centroids. This runs for every region
  // query so the choropleth is always available; it's cheap because the
  // centroid_lon/centroid_lat scalar columns are tiny (two doubles per
  // row) compared to the WKB payload.
  const { countsByMuni, centroidsWereSlow } = await countCentroidsByMuni(
    parquetUrl,
    where,
  );

  // Phase 3: feature-geometry fetch. Skipped entirely above the render
  // threshold — the choropleth is the answer at that scale; a raw point
  // render would be noise. Below threshold we still fetch shapes (up
  // to cap) and layer them on top of the choropleth.
  if (totalCount > threshold) {
    // eslint-disable-next-line no-console
    console.log(
      `[region-query] ${subtypeSlug}: ${totalCount} features — above render threshold (${threshold}), skipping geometry fetch (choropleth only)`,
    );
    return {
      fc: { type: "FeatureCollection", features: [] },
      totalCount,
      renderable: false,
      truncated: false,
      cap,
      countsByMuni,
      centroidsWereSlow,
    };
  }

  const rows = await runSql<RawRow>(`
    SELECT osm_id, osm_type, name, CAST(tags AS VARCHAR) AS tags, geometry_wkb
    FROM '${parquetUrl}'
    WHERE ${where}
    LIMIT ${cap}
  `);
  const truncated = totalCount > cap;

  // Same muni index we used for centroid counts — reuse for per-feature
  // stamping. PIP pass over ≤25k features × 101 munis with bbox
  // pre-filter completes in ~50-200ms.
  const muniIndex = await loadMuniIndex();

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

    const hit = assignMuni(parsed.center, muniIndex);

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
        muni_slug: hit?.slug ?? null,
        muni_name: hit?.name ?? null,
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
    countsByMuni,
    centroidsWereSlow,
  };
}

/**
 * Run a centroid-only query and bin every feature into its containing
 * MAPC muni. Returns a count map keyed by muni slug.
 *
 * Two paths:
 *   - Fast path: the parquet has centroid_lon / centroid_lat scalar
 *     columns (ETL ≥ 2026-04-b). We SELECT just those two doubles per
 *     row — no WKB in the payload.
 *   - Fallback: older parquet without centroid columns. We re-select
 *     geometry_wkb and compute the centroid client-side. Slower and
 *     heavier, but keeps the app functional on stale data. Logged.
 *
 * Binning is O(N × M) with bbox pre-filtering (M ≈ 101 munis). For
 * 1M buildings this completes in ~1-2s on an M-series Mac.
 */
async function countCentroidsByMuni(
  parquetUrl: string,
  where: string,
): Promise<{
  countsByMuni: Map<string, number>;
  centroidsWereSlow: boolean;
}> {
  const munis = await loadMuniIndex();
  const counts = new Map<string, number>();
  for (const m of munis) counts.set(m.slug, 0);

  let centroidsWereSlow = false;
  let centroids: Array<[number, number]>;
  try {
    const rows = await runSql<{ lon: number; lat: number }>(`
      SELECT centroid_lon AS lon, centroid_lat AS lat
      FROM '${parquetUrl}'
      WHERE ${where}
    `);
    centroids = rows.map((r) => [r.lon, r.lat]);
  } catch (err) {
    // Assume the failure is "column not found" from a pre-centroid
    // parquet. Fall back to WKB + client-side centroid.
    // eslint-disable-next-line no-console
    console.warn(
      "[region-query] centroid columns not available, falling back to WKB parse:",
      err,
    );
    centroidsWereSlow = true;
    const rows = await runSql<{ geometry_wkb: Uint8Array }>(`
      SELECT geometry_wkb
      FROM '${parquetUrl}'
      WHERE ${where}
    `);
    centroids = [];
    for (const r of rows) {
      const parsed = parseWkbGeometry(r.geometry_wkb);
      if (!parsed) continue;
      centroids.push([parsed.center[0], parsed.center[1]]);
    }
  }

  binCentroidsIntoMunis(centroids, munis, counts);
  return { countsByMuni: counts, centroidsWereSlow };
}

/**
 * Per-feature muni assignment using the same bbox-prefilter + ray-cast
 * PIP as the choropleth binning. Returns the matching muni index entry
 * or null if the centroid fell outside every MAPC muni (rare — the
 * parquet is clipped to MAPC, but edge-touching features can fall
 * narrowly outside).
 */
function assignMuni(
  center: readonly [number, number],
  munis: MuniIndexEntry[],
): MuniIndexEntry | null {
  const [lon, lat] = center;
  for (const m of munis) {
    if (
      lon < m.bbox[0] ||
      lon > m.bbox[2] ||
      lat < m.bbox[1] ||
      lat > m.bbox[3]
    )
      continue;
    if (pointInArea([lon, lat], m.geom)) return m;
  }
  return null;
}

function binCentroidsIntoMunis(
  centroids: Array<[number, number]>,
  munis: MuniIndexEntry[],
  counts: Map<string, number>,
): void {
  for (const [lon, lat] of centroids) {
    for (const muni of munis) {
      // bbox pre-filter: cheap reject for ~95% of (point, muni) pairs.
      if (
        lon < muni.bbox[0] ||
        lon > muni.bbox[2] ||
        lat < muni.bbox[1] ||
        lat > muni.bbox[3]
      )
        continue;
      if (pointInArea([lon, lat], muni.geom)) {
        counts.set(muni.slug, (counts.get(muni.slug) ?? 0) + 1);
        break; // points belong to at most one muni
      }
    }
  }
}
