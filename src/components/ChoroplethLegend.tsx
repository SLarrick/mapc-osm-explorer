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
}

export function ChoroplethLegend({ bins, subtypeLabel }: Props) {
  return (
    <div
      className="absolute left-4 bottom-4 bg-white/95 backdrop-blur rounded-md border border-slate-200 shadow-sm px-3 py-2 text-xs text-slate-700 max-w-[220px]"
      role="region"
      aria-label="Choropleth legend"
    >
      <div className="font-medium text-slate-800 mb-1">
        {subtypeLabel} per municipality
      </div>

      {bins.empty ? (
        <div className="text-slate-500 italic">
          No features found in any MAPC muni.
        </div>
      ) : (
        <>
          <ul className="space-y-0.5 leading-snug">
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
