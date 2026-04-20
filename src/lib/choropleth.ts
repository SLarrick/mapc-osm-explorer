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
