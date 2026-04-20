/**
 * Overlay legend for the Slice 4A muni-count choropleth.
 *
 * Floats in the bottom-left of the map container. Reads the same bins
 * the paint expression uses so the swatches always match what's on the
 * map. Degenerate cases (every muni = 0) collapse to a single "no data
 * across region" note rather than a misleading ramp.
 */
import {
  binRangeLabel,
  type ChoroplethBins,
} from "../lib/choropleth";

interface Props {
  bins: ChoroplethBins;
  /** Feature label (e.g. "Playgrounds") — used in the header. */
  subtypeLabel: string;
  /** Whether the choropleth layer is currently drawn on the map. */
  enabled: boolean;
  /** Toggle handler. Turning choropleth off on a region-wide query with
   *  high N results in an empty-ish map (no points either) — that's
   *  intentional: it lets the user commit to the feature-level view
   *  (including the Table tab) rather than the muni-aggregate one. */
  onToggle: (enabled: boolean) => void;
}

export function ChoroplethLegend({
  bins,
  subtypeLabel,
  enabled,
  onToggle,
}: Props) {
  return (
    <div
      className="absolute left-4 bottom-4 bg-white/95 backdrop-blur rounded-md border border-slate-200 shadow-sm px-3 py-2 text-xs text-slate-700 max-w-[240px]"
      role="region"
      aria-label="Choropleth legend"
    >
      <label className="flex items-start gap-2 mb-1 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggle(e.target.checked)}
          className="mt-0.5"
        />
        <span className="font-medium text-slate-800">
          Shade munis by {subtypeLabel.toLowerCase()} count
        </span>
      </label>

      {bins.empty ? (
        <div className="text-slate-500 italic">
          No features found in any MAPC muni.
        </div>
      ) : (
        <>
          <ul
            className={
              "space-y-0.5 leading-snug " +
              (enabled ? "" : "opacity-40")
            }
          >
            {bins.colors.map((color, i) => (
              <li key={i} className="flex items-center gap-2">
                <span
                  className="inline-block w-4 h-3 rounded-sm border border-slate-300/60"
                  style={{ backgroundColor: color, opacity: 0.7 }}
                />
                <span className="tabular-nums">
                  {binRangeLabel(i, bins)}
                </span>
              </li>
            ))}
            <li className="flex items-center gap-2 pt-0.5">
              <span
                className="inline-block w-4 h-3 rounded-sm border border-slate-300/60"
                style={{ backgroundColor: bins.zeroColor, opacity: 0.35 }}
              />
              <span className="text-slate-500">0</span>
            </li>
          </ul>
        </>
      )}
    </div>
  );
}
