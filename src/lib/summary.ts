/**
 * Stats helpers for the Summary view (Slice 7).
 *
 * Everything here is a pure function over the current result set.
 * Summary is read-only — no filtering or drill-in yet — so we can
 * recompute cheaply on each render.
 *
 * Design choices worth calling out:
 *
 *   - Fill rates are scoped to the current result set, matching the
 *     table view. "62% of Salem's playgrounds have a surface tag" is
 *     the shape of the question.
 *
 *   - "Top values" only runs on tag keys with bounded cardinality
 *     (default <= 50 unique values). For a key like `name` or `osm_id`,
 *     a top-N breakdown is noise; we skip those.
 *
 *   - Geometry mix groups Multi* variants with their simple siblings
 *     because the distinction is rarely useful to a planner.
 */
import type { ResultFeature } from "./queries";

export interface FillRateEntry {
  key: string;
  /** 0–100. */
  pct: number;
  /** How many rows have a non-empty value for this key. */
  filled: number;
}

/** Sorted list of all tag keys in the result, each with its fill rate. */
export function computeFillRates(
  features: ResultFeature[],
): FillRateEntry[] {
  if (features.length === 0) return [];
  const counts = new Map<string, number>();
  for (const f of features) {
    const tags = f.properties.tags ?? {};
    for (const [k, v] of Object.entries(tags)) {
      if (v === undefined || v === null || v === "") continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const total = features.length;
  const out: FillRateEntry[] = [];
  for (const [key, filled] of counts) {
    out.push({ key, filled, pct: (filled / total) * 100 });
  }
  out.sort((a, b) => b.filled - a.filled);
  return out;
}

export interface TopValueEntry {
  value: string;
  count: number;
  /** 0–100 of the result set. */
  pct: number;
}

export interface TopValuesForKey {
  key: string;
  /** How many rows have a value at all (same as fillRate.filled). */
  filled: number;
  /** How many distinct values the key takes. */
  distinct: number;
  /** Top entries, sorted desc. Length <= N (caller-supplied). */
  entries: TopValueEntry[];
  /** True when the breakdown was omitted because cardinality was too
   *  high (unique IDs, free-text names, etc.) */
  skippedHighCardinality?: boolean;
}

/**
 * Compute top-N values for each key in `keys`. Skips keys whose
 * distinct-value count exceeds `maxDistinct` — those are free-form
 * (names, phone numbers, wikidata ids) and a top-N is noise.
 */
export function computeTopValues(
  features: ResultFeature[],
  keys: string[],
  opts: { topN?: number; maxDistinct?: number } = {},
): TopValuesForKey[] {
  const topN = opts.topN ?? 5;
  const maxDistinct = opts.maxDistinct ?? 50;
  const out: TopValuesForKey[] = [];
  const total = features.length || 1;
  for (const key of keys) {
    const counts = new Map<string, number>();
    let filled = 0;
    for (const f of features) {
      const v = f.properties.tags?.[key];
      if (v === undefined || v === null || v === "") continue;
      filled++;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    if (filled === 0) continue;
    if (counts.size > maxDistinct) {
      out.push({
        key,
        filled,
        distinct: counts.size,
        entries: [],
        skippedHighCardinality: true,
      });
      continue;
    }
    const sorted = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map<TopValueEntry>(([value, count]) => ({
        value,
        count,
        pct: (count / total) * 100,
      }));
    out.push({ key, filled, distinct: counts.size, entries: sorted });
  }
  return out;
}

export interface GeometryMix {
  point: number;
  line: number;
  polygon: number;
  other: number;
}

/** Point / LineString / Polygon rollup (Multi* folded in). */
export function computeGeometryMix(features: ResultFeature[]): GeometryMix {
  const mix: GeometryMix = { point: 0, line: 0, polygon: 0, other: 0 };
  for (const f of features) {
    switch (f.geometry?.type) {
      case "Point":
      case "MultiPoint":
        mix.point++;
        break;
      case "LineString":
      case "MultiLineString":
        mix.line++;
        break;
      case "Polygon":
      case "MultiPolygon":
        mix.polygon++;
        break;
      default:
        mix.other++;
    }
  }
  return mix;
}

export interface MuniCountEntry {
  slug: string;
  name: string;
  count: number;
}

/** Top-N muni counts from the regional per-muni count map. */
export function topMunisByCount(
  counts: Map<string, number>,
  muniNameBySlug: Map<string, string>,
  n = 5,
): MuniCountEntry[] {
  const out: MuniCountEntry[] = [];
  for (const [slug, count] of counts) {
    if (count <= 0) continue;
    out.push({ slug, name: muniNameBySlug.get(slug) ?? slug, count });
  }
  out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return out.slice(0, n);
}

/** How many munis are represented (count > 0) vs. zero. */
export function muniCoverage(counts: Map<string, number>): {
  withFeatures: number;
  withoutFeatures: number;
  total: number;
} {
  let withFeatures = 0;
  let withoutFeatures = 0;
  for (const v of counts.values()) {
    if (v > 0) withFeatures++;
    else withoutFeatures++;
  }
  return {
    withFeatures,
    withoutFeatures,
    total: withFeatures + withoutFeatures,
  };
}
