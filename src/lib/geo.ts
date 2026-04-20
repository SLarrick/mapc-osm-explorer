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

export interface MuniSummary {
  slug: string;
  name: string;
  /** MAPC sub-region grouping (e.g. "North Shore") — used for optgroups. */
  subregion: string | null;
}

/**
 * Muni + its polygon geometry + precomputed bbox, for fast point-in-muni
 * binning. The bbox is the 95% cheap-reject path for the choropleth
 * count query (1M points × 101 munis); without it, every point pays
 * full ray-cast cost against every muni.
 */
export interface MuniIndexEntry {
  slug: string;
  name: string;
  geom: AreaLike;
  /** [minLng, minLat, maxLng, maxLat] in WGS84. */
  bbox: [number, number, number, number];
}

let muniIndexPromise: Promise<MuniIndexEntry[]> | null = null;

/**
 * Lazy-load every MAPC muni with geometry + bbox, cached for the session.
 * Used by the choropleth count query.
 */
export function loadMuniIndex(): Promise<MuniIndexEntry[]> {
  if (!muniIndexPromise) {
    muniIndexPromise = loadMunis().then((fc) => {
      const out: MuniIndexEntry[] = [];
      for (const f of fc.features) {
        const p = (f.properties ?? {}) as { slug?: string; name?: string };
        if (!p.slug || !p.name) continue;
        if (
          f.geometry.type !== "Polygon" &&
          f.geometry.type !== "MultiPolygon"
        )
          continue;
        const geom = f.geometry as AreaLike;
        out.push({
          slug: p.slug,
          name: p.name,
          geom,
          bbox: bboxOfGeometry(geom),
        });
      }
      return out;
    });
  }
  return muniIndexPromise;
}

/** List of all 101 MAPC munis, alphabetical. Used to populate the dropdown. */
export async function listMunicipalities(): Promise<MuniSummary[]> {
  const fc = await loadMunis();
  const out: MuniSummary[] = [];
  for (const f of fc.features) {
    const p = (f.properties ?? {}) as {
      slug?: string;
      name?: string;
      mapc_subregion?: string | null;
    };
    if (!p.slug || !p.name) continue;
    out.push({
      slug: p.slug,
      name: p.name,
      subregion: p.mapc_subregion ?? null,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
