/**
 * Category queries. Each function returns a FeatureCollection with real
 * geometries (Point / LineString / Polygon / Multi*) ready to render on
 * the map, with OSM tags preserved as properties.
 */
import { runSql } from "./duckdb";
import { parseWkbGeometry } from "./wkb";
import { getMunicipalityBySlug, pointInArea } from "./geo";

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
 * Finds all OSM features with `leisure=playground` whose geometry is
 * (roughly) within the given municipality.
 *
 * SQL side: pulls candidate rows (only the 1,868 playgrounds in MAPC).
 * JS side: parses WKB into full GeoJSON, filters by bbox-center inside
 * the muni polygon. Good enough for small features; swap to DuckDB
 * `ST_Intersects` server-side once we load the spatial extension (v1.5).
 */
export async function findPlaygroundsInMuni(
  muniSlug: string,
): Promise<GeoJSON.FeatureCollection<GeoJSON.Geometry>> {
  const muni = await getMunicipalityBySlug(muniSlug);
  if (!muni) throw new Error(`Unknown municipality slug: ${muniSlug}`);

  // Parquet URL — always same-origin, served by Vercel with range support
  const parquetUrl = new URL(
    "/data/parks-and-recreation.parquet",
    window.location.origin,
  ).toString();

  const rows = await runSql<RawRow>(`
    SELECT osm_id, osm_type, name, CAST(tags AS VARCHAR) AS tags, geometry_wkb
    FROM '${parquetUrl}'
    WHERE json_extract_string(tags, '$.leisure') = 'playground'
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
