/**
 * Lightweight geo helpers: point-in-polygon (ray casting) + municipality
 * lookup from the static boundaries file.
 *
 * For Slice 1b this is all we need. If we grow to require buffer/union/etc.
 * we'll reach for Turf.js; until then, 40 lines of ray casting keeps the
 * bundle small.
 */

import type { LngLat } from "./wkb";

type AreaLike = GeoJSON.Polygon | GeoJSON.MultiPolygon;

export function pointInArea(p: LngLat, area: AreaLike): boolean {
  if (area.type === "Polygon") return pointInRings(p, area.coordinates);
  return area.coordinates.some((rings) => pointInRings(p, rings));
}

function pointInRings(p: LngLat, rings: number[][][]): boolean {
  if (rings.length === 0) return false;
  const [outer, ...holes] = rings;
  if (!rayCast(p, outer)) return false;
  return !holes.some((h) => rayCast(p, h));
}

function rayCast(p: LngLat, ring: number[][]): boolean {
  let inside = false;
  const [px, py] = p;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Bounding box [minLng, minLat, maxLng, maxLat] of a GeoJSON geometry. */
export function bboxOfGeometry(
  geom: GeoJSON.Geometry,
): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      const [x, y] = c as number[];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else if (Array.isArray(c)) {
      for (const child of c) visit(child);
    }
  };
  if ("coordinates" in geom) visit(geom.coordinates);
  return [minX, minY, maxX, maxY];
}

export function bboxOfPoints(
  points: LngLat[],
): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

// Cache the munis geojson so we only fetch once per session
let munisPromise: Promise<GeoJSON.FeatureCollection> | null = null;

function loadMunis(): Promise<GeoJSON.FeatureCollection> {
  if (!munisPromise) {
    munisPromise = fetch("/data/mapc-municipalities.geojson").then((r) =>
      r.json(),
    );
  }
  return munisPromise;
}

export async function getMunicipalityBySlug(
  slug: string,
): Promise<GeoJSON.Feature<AreaLike> | null> {
  const fc = await loadMunis();
  const feat = fc.features.find(
    (f) =>
      (f.properties as { slug?: string } | null)?.slug?.toLowerCase() ===
      slug.toLowerCase(),
  );
  if (!feat) return null;
  if (feat.geometry.type !== "Polygon" && feat.geometry.type !== "MultiPolygon")
    return null;
  return feat as GeoJSON.Feature<AreaLike>;
}
