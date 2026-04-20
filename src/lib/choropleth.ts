/**
 * Choropleth bin + color helpers for Slice 4A.
 *
 * Design:
 *   - 5 quantile bins over *non-zero* muni counts, so a few giant
 *     municipalities (Boston with 500k buildings) don't collapse
 *     everything else into bin 1. A muni with 0 features gets its own
 *     neutral "no data" color — visually distinct from "a little data"
 *     so the eye can separate "mapping hasn't reached here" from
 *     "mapped and counted zero."
 *   - 6 colors total (bin 0 → bin 5, lightest → darkest) + 1 zero color.
 *   - Sky-blue ramp matches the rest of the app's primary palette.
 *
 * The bin breakpoints + colors are exposed so the legend renders
 * identical swatches + labels to what's on the map.
 */

export interface ChoroplethBins {
  /** Upper bounds of bins 0-4. Values > stops[4] fall in bin 5. */
  stops: [number, number, number, number, number];
  /** Fill color per bin. Index 0-5 (lightest → darkest). */
  colors: [string, string, string, string, string, string];
  /** Paint for muni count === 0. Visually set apart from bin 0 — "no
   *  data" vs "a little data" are different answers. */
  zeroColor: string;
  /** True when every muni had count 0 (degenerate: no data at all). */
  empty: boolean;
}

/** Sky-blue 6-step sequential ramp. Matches Tailwind sky-100…sky-900. */
const RAMP: [string, string, string, string, string, string] = [
  "#e0f2fe", // sky-100
  "#bae6fd", // sky-200
  "#7dd3fc", // sky-300
  "#38bdf8", // sky-400
  "#0284c7", // sky-600
  "#0c4a6e", // sky-900
];

const ZERO_COLOR = "#f1f5f9"; // slate-100 — reads as "empty" against the ramp.

/**
 * Compute 5-quantile breakpoints over the positive counts.
 *
 * Ties at the boundary are possible (e.g. if 40% of munis have count=1,
 * stops[0] and stops[1] may both be 1). MapLibre's step expression
 * handles that fine — bins can be empty. We do coerce stops to be
 * monotonically non-decreasing and add a 1-unit floor between equal
 * adjacent stops so the expression itself stays well-formed.
 */
export function computeChoropleth(
  counts: Map<string, number>,
): ChoroplethBins {
  const positives: number[] = [];
  for (const v of counts.values()) if (v > 0) positives.push(v);
  positives.sort((a, b) => a - b);

  if (positives.length === 0) {
    return {
      stops: [1, 1, 1, 1, 1],
      colors: RAMP,
      zeroColor: ZERO_COLOR,
      empty: true,
    };
  }

  const q = (p: number): number => {
    const idx = Math.min(
      positives.length - 1,
      Math.max(0, Math.floor(p * positives.length)),
    );
    return positives[idx];
  };
  const raw: [number, number, number, number, number] = [
    q(0.2),
    q(0.4),
    q(0.6),
    q(0.8),
    positives[positives.length - 1],
  ];
  // Enforce strictly-increasing stops so MapLibre's ["step", …] input is
  // well-formed even when quantiles collide.
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] <= raw[i - 1]) raw[i] = raw[i - 1] + 1;
  }

  return {
    stops: raw,
    colors: RAMP,
    zeroColor: ZERO_COLOR,
    empty: false,
  };
}

/**
 * Human-readable range label for a bin, used in the legend.
 * Bin 0:  "1 – stops[0]"
 * Bin 1:  "stops[0]+1 – stops[1]"
 * ...
 * Bin 5:  "stops[4]+ "  (capped upper)
 */
export function binRangeLabel(
  bin: number,
  bins: ChoroplethBins,
): string {
  const fmt = (n: number) => n.toLocaleString();
  if (bin === 0) return `1 – ${fmt(bins.stops[0])}`;
  if (bin === 5) return `${fmt(bins.stops[4] + 1)}+`;
  const lo = bins.stops[bin - 1] + 1;
  const hi = bins.stops[bin];
  if (lo >= hi) return fmt(hi);
  return `${fmt(lo)} – ${fmt(hi)}`;
}

/**
 * Which bin a given count falls in — matches the MapLibre step
 * expression. Bin -1 means count === 0 (gets the zero color).
 */
export function binForCount(count: number, bins: ChoroplethBins): number {
  if (count === 0) return -1;
  for (let i = 0; i < 5; i++) {
    if (count <= bins.stops[i]) return i;
  }
  return 5;
}

/**
 * Group muni slugs by their bin index (0-5). Does not include bin -1
 * (zero-count munis); callers usually show "0" as a separate row.
 * Returns an array indexed by bin, each entry sorted by count descending
 * (alphabetical tie-break) — within a bin, the user usually wants to see
 * the biggest contributors first rather than scan an alphabetical list.
 */
export function groupMunisByBin(
  counts: Map<string, number>,
  muniNameBySlug: Map<string, string>,
  bins: ChoroplethBins,
): Array<Array<{ slug: string; name: string; count: number }>> {
  const out: Array<Array<{ slug: string; name: string; count: number }>> = [
    [], [], [], [], [], [],
  ];
  for (const [slug, count] of counts) {
    const b = binForCount(count, bins);
    if (b < 0) continue;
    out[b].push({
      slug,
      name: muniNameBySlug.get(slug) ?? slug,
      count,
    });
  }
  for (const group of out) {
    group.sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });
  }
  return out;
}

/** Count of zero-count munis in a choropleth. */
export function countZeroMunis(counts: Map<string, number>): number {
  let n = 0;
  for (const v of counts.values()) if (v === 0) n++;
  return n;
}

