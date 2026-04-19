/**
 * Minimal WKB (Well-Known Binary) geometry parser.
 *
 * Our parquet files store geometries as WKB blobs. Playgrounds (and most
 * OSM features) are a mix of POINTs (nodes) and POLYGONs (closed ways).
 * For rendering as map pins we just need a representative point per
 * feature, so `parseWkbBboxCenter` walks any geometry and returns the
 * midpoint of its bounding box — adequate for small features, cheap, and
 * supports every WKB type we emit (POINT, LINESTRING, POLYGON,
 * MULTI*, GEOMETRYCOLLECTION).
 *
 * WKB wire format (per OGC):
 *   byte 0:   endianness (0 = big, 1 = little)
 *   bytes 1-4: uint32 geometry type
 *     1=POINT, 2=LINESTRING, 3=POLYGON,
 *     4=MULTIPOINT, 5=MULTILINESTRING, 6=MULTIPOLYGON, 7=GEOMETRYCOLLECTION
 *   rest: type-specific payload (recursive for MULTI* / COLLECTION)
 */

export type LngLat = readonly [number, number];

interface BboxCursor {
  off: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Strict POINT parser — returns the coordinates only if the WKB is a
 * plain POINT. For mixed geometry sources, prefer `parseWkbBboxCenter`.
 */
export function parseWkbPointAsLngLat(wkb: Uint8Array): LngLat | null {
  if (wkb.length < 21) return null;
  const view = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
  const littleEndian = view.getUint8(0) === 1;
  const type = view.getUint32(1, littleEndian);
  if (type !== 1) return null;
  const x = view.getFloat64(5, littleEndian);
  const y = view.getFloat64(13, littleEndian);
  return [x, y];
}

/**
 * Return the midpoint of the bounding box of any WKB geometry. Null if
 * the WKB is malformed or contains no coordinates.
 */
export function parseWkbBboxCenter(wkb: Uint8Array): LngLat | null {
  if (wkb.length < 5) return null;
  const view = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
  const b: BboxCursor = {
    off: 0,
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  try {
    walkGeom(view, b);
  } catch {
    return null;
  }
  if (b.minX === Infinity) return null;
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

function walkGeom(view: DataView, b: BboxCursor): void {
  const endian = view.getUint8(b.off) === 1;
  b.off += 1;
  const rawType = view.getUint32(b.off, endian);
  b.off += 4;
  // Strip Z/M/SRID flags — base type lives in the low byte.
  const type = rawType & 0xff;

  switch (type) {
    case 1: // POINT
      readPoints(view, b, endian, 1);
      return;
    case 2: {
      // LINESTRING
      const n = view.getUint32(b.off, endian);
      b.off += 4;
      readPoints(view, b, endian, n);
      return;
    }
    case 3: {
      // POLYGON: numRings, then each ring = numPoints + points
      const numRings = view.getUint32(b.off, endian);
      b.off += 4;
      for (let r = 0; r < numRings; r++) {
        const n = view.getUint32(b.off, endian);
        b.off += 4;
        readPoints(view, b, endian, n);
      }
      return;
    }
    case 4: // MULTIPOINT
    case 5: // MULTILINESTRING
    case 6: // MULTIPOLYGON
    case 7: {
      // GEOMETRYCOLLECTION — each sub-geom carries its own header
      const numGeoms = view.getUint32(b.off, endian);
      b.off += 4;
      for (let i = 0; i < numGeoms; i++) walkGeom(view, b);
      return;
    }
    default:
      throw new Error(`Unsupported WKB type: ${type}`);
  }
}

function readPoints(
  view: DataView,
  b: BboxCursor,
  endian: boolean,
  n: number,
): void {
  for (let i = 0; i < n; i++) {
    const x = view.getFloat64(b.off, endian);
    b.off += 8;
    const y = view.getFloat64(b.off, endian);
    b.off += 8;
    if (x < b.minX) b.minX = x;
    if (x > b.maxX) b.maxX = x;
    if (y < b.minY) b.minY = y;
    if (y > b.maxY) b.maxY = y;
  }
}
