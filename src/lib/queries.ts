/**
 * Category queries. Each function returns a FeatureCollection of points
 * ready to render on the map (with tags preserved as properties).
 */
import { runSql } from "./duckdb";
import { parseWkbPointAsLngLat } from "./wkb";
import { getMunicipalityBySlug, pointInArea } from "./geo";

export interface ResultFeature extends GeoJSON.Feature<GeoJSON.Point> {
  properties: {
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
 * Finds all OSM features whose `leisure=playground` AND whose geometry
 * falls within the given municipality.
 *
 * SQL side: pulls candidate rows (only the 1,868 playgrounds in MAPC).
 * JS side: parses WKB, filters by polygon. Swap to DuckDB-spatial
 * server-side once we load the extension (v1.5).
 */
export async function findPlaygroundsInMuni(
  muniSlug: string,
): Promise<GeoJSON.FeatureCollection<GeoJSON.Point>> {
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
    const lngLat = parseWkbPointAsLngLat(row.geometry_wkb);
    if (!lngLat) continue; // not a point (way-based playground) — TODO: handle polygons
    if (!pointInArea(lngLat, muniGeom)) continue;

    let parsedTags: Record<string, string> = {};
    try {
      parsedTags = JSON.parse(row.tags) as Record<string, string>;
    } catch {
      /* tolerate bad JSON */
    }

    features.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lngLat[0], lngLat[1]] },
      properties: {
        osm_id: Number(row.osm_id),
        osm_type: row.osm_type,
        name: row.name,
        tags: parsedTags,
      },
    });
  }

  return { type: "FeatureCollection", features };
}
