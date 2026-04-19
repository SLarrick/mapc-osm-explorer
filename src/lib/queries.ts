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
