/**
 * WKB (Well-Known Binary) → GeoJSON geometry parser.
 *
 * Our parquet files store geometries as WKB blobs. Features are a mix of
 * POINTs (nodes), LINESTRINGs (un-closeable ways), and POLYGONs (closed
 * ways). MULTIPOLYGON and GEOMETRYCOLLECTION are possible once we add
 * relation support.
 *
 * `parseWkbGeometry` returns a full GeoJSON geometry object alongside its
 * bbox — the caller can render the real shape on the map, and use the
 * bbox center as a cheap "representative point" for muni filtering.
 *
 * WKB wire format (per OGC):
 *   byte 0:   endianness (0 = big, 1 = little)
 *   bytes 1-4: uint32 geometry type
 *     1=POINT, 2=LINESTRING, 3=POLYGON,
 *     4=MULTIPOINT, 5=MULTILINESTRING, 6=MULTIPOLYGON, 7=GEOMETRYCOLLECTION
 *   rest: type-specific payload (recursive for MULTI* / COLLECTION)
 */

export type LngLat = readonly [number, number];

interface Cursor {
  off: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Result of a successful WKB parse: a GeoJSON geometry + its bbox center. */
export interface WkbParseResult {
  geometry: GeoJSON.Geometry;
  center: LngLat;
  bbox: [number, number, number, number];
}

/**
 * Parse a WKB blob into a GeoJSON geometry. Supports POINT, LINESTRING,
 * POLYGON, MULTIPOINT, MULTILINESTRING, MULTIPOLYGON, GEOMETRYCOLLECTION.
 * Returns null for malformed input.
 */
export function parseWkbGeometry(wkb: Uint8Array): WkbParseResult | null {
  if (wkb.length < 5) return null;
  const view = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
  const c: Cursor = {
    off: 0,
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  let geom: GeoJSON.Geometry;
  try {
    geom = readGeom(view, c);
  } catch {
    return null;
  }
  if (c.minX === Infinity) return null;
  return {
    geometry: geom,
    center: [(c.minX + c.maxX) / 2, (c.minY + c.maxY) / 2],
    bbox: [c.minX, c.minY, c.maxX, c.maxY],
  };
}

function readGeom(view: DataView, c: Cursor): GeoJSON.Geometry {
  const endian = view.getUint8(c.off) === 1;
  c.off += 1;
  const rawType = view.getUint32(c.off, endian);
  c.off += 4;
  // Strip Z/M/SRID flags — base type lives in the low byte.
  const type = rawType & 0xff;

  switch (type) {
    case 1: {
      // POINT
      const [x, y] = readPoint(view, c, endian);
      return { type: "Point", coordinates: [x, y] };
    }
    case 2: {
      // LINESTRING
      const coords = readLineString(view, c, endian);
      return { type: "LineString", coordinates: coords };
    }
    case 3: {
      // POLYGON: numRings, each ring = numPoints + points
      const numRings = view.getUint32(c.off, endian);
      c.off += 4;
      const rings: number[][][] = [];
      for (let r = 0; r < numRings; r++) rings.push(readLineString(view, c, endian));
      return { type: "Polygon", coordinates: rings };
    }
    case 4: {
      // MULTIPOINT: each sub-geom has its own WKB header (type 1)
      const n = view.getUint32(c.off, endian);
      c.off += 4;
      const pts: number[][] = [];
      for (let i = 0; i < n; i++) {
        const g = readGeom(view, c);
        if (g.type === "Point") pts.push(g.coordinates as number[]);
      }
      return { type: "MultiPoint", coordinates: pts };
    }
    case 5: {
      // MULTILINESTRING
      const n = view.getUint32(c.off, endian);
      c.off += 4;
      const lines: number[][][] = [];
      for (let i = 0; i < n; i++) {
        const g = readGeom(view, c);
        if (g.type === "LineString") lines.push(g.coordinates as number[][]);
      }
      return { type: "MultiLineString", coordinates: lines };
    }
    case 6: {
      // MULTIPOLYGON
      const n = view.getUint32(c.off, endian);
      c.off += 4;
      const polys: number[][][][] = [];
      for (let i = 0; i < n; i++) {
        const g = readGeom(view, c);
        if (g.type === "Polygon") polys.push(g.coordinates as number[][][]);
      }
      return { type: "MultiPolygon", coordinates: polys };
    }
    case 7: {
      // GEOMETRYCOLLECTION
      const n = view.getUint32(c.off, endian);
      c.off += 4;
      const geoms: GeoJSON.Geometry[] = [];
      for (let i = 0; i < n; i++) geoms.push(readGeom(view, c));
      return { type: "GeometryCollection", geometries: geoms };
    }
    default:
      throw new Error(`Unsupported WKB type: ${type}`);
  }
}

function readPoint(view: DataView, c: Cursor, endian: boolean): [number, number] {
  const x = view.getFloat64(c.off, endian);
  c.off += 8;
  const y = view.getFloat64(c.off, endian);
  c.off += 8;
  if (x < c.minX) c.minX = x;
  if (x > c.maxX) c.maxX = x;
  if (y < c.minY) c.minY = y;
  if (y > c.maxY) c.maxY = y;
  return [x, y];
}

function readLineString(
  view: DataView,
  c: Cursor,
  endian: boolean,
): number[][] {
  const n = view.getUint32(c.off, endian);
  c.off += 4;
  const coords: number[][] = new Array(n);
  for (let i = 0; i < n; i++) coords[i] = readPoint(view, c, endian);
  return coords;
}
