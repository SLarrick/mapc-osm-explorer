/**
 * Minimal WKB (Well-Known Binary) geometry parser.
 *
 * Our parquet files store geometries as WKB blobs. For Slice 1b we only
 * need POINT parsing (all playgrounds are nodes). LineString, Polygon, and
 * MultiPolygon support can land in later slices when we need them for
 * streets / parks / buildings.
 *
 * WKB wire format (per OGC):
 *   byte 0: endianness (0 = big, 1 = little)
 *   bytes 1-4: uint32 geometry type (1=POINT, 2=LINESTRING, 3=POLYGON, 6=MULTIPOLYGON, ...)
 *   rest: type-specific payload
 *
 * POINT payload: two float64s (X, then Y).
 */

export type LngLat = readonly [number, number];

export function parseWkbPointAsLngLat(wkb: Uint8Array): LngLat | null {
  if (wkb.length < 21) return null;
  const view = new DataView(wkb.buffer, wkb.byteOffset, wkb.byteLength);
  const littleEndian = view.getUint8(0) === 1;
  const type = view.getUint32(1, littleEndian);
  if (type !== 1) return null; // not a POINT — caller can fall back
  const x = view.getFloat64(5, littleEndian);
  const y = view.getFloat64(13, littleEndian);
  return [x, y];
}
