/**
 * Region-layers legend — floats bottom-left of the map in region mode.
 *
 * Holds two toggles for what's drawn on the map:
 *   - "Show <subtype> as points" — toggles the results overlay.
 *   - "Shade munis by count"     — toggles the muni-choropleth fill.
 * Plus the bin legend itself. Clicking a bin row expands it to a
 * scrollable list of munis in that bin (sorted alphabetically), and
 * highlights those munis on the map via `onBinSelect`.
 *
 * Design notes:
 *   - The two checkboxes are deliberately co-located in one card so
 *     "what am I looking at on the map" lives in a single place.
 *   - The per-bin muni count ("(8 munis)") is trivially derived from
 *     the counts map. Clicking a bin is the discoverable extension:
 *     expand + highlight, click again to collapse/clear.
 */
import { useMemo } from "react";
import {
  binRangeLabel,
  countZeroMunis,
  groupMunisByBin,
  type ChoroplethBins,
} from "../lib/choropleth";

interface Props {
  bins: ChoroplethBins;
  /** Feature label (e.g. "Playgrounds") — used in the header. */
  subtypeLabel: string;
  /** Per-muni counts. Drives the "N munis" per bin + expanded list. */
  counts: Map<string, number>;
  /** Muni slug → name. For display in the expanded list + highlighted
   *  tooltips. */
  muniNameBySlug: Map<string, string>;
  /** Feature-points overlay (the pins/shapes) state. */
  pointsEnabled: boolean;
  onTogglePoints: (enabled: boolean) => void;
  /** Choropleth fill state. */
  choroplethEnabled: boolean;
  onToggleChoropleth: (enabled: boolean) => void;
  /** Which bin index (0-5) is currently expanded, or null. */
  activeBin: number | null;
  onBinSelect: (bin: number | null) => void;
  /** Click a muni name in the expanded list. */
  onSelectMuni: (slug: string) => void;
}

export function ChoroplethLegend(props: Props) {
  const {
    bins,
    subtypeLabel,
    counts,
    muniNameBySlug,
    pointsEnabled,
    onTogglePoints,
    choroplethEnabled,
    onToggleChoropleth,
    activeBin,
    onBinSelect,
    onSelectMuni,
  } = props;

  const munisByBin = useMemo(
    () => groupMunisByBin(counts, muniNameBySlug, bins),
    [counts, muniNameBySlug, bins],
  );
  const zeroCount = countZeroMunis(counts);

  return (
    <div
      className="absolute left-4 bottom-4 bg-white/95 backdrop-blur rounded-md border border-slate-200 shadow-sm px-3 py-2 text-xs text-slate-700 w-[260px]"
      role="region"
      aria-label="Region layers legend"
    >
      <div className="font-medium text-slate-800 text-[11px] uppercase tracking-wider mb-1.5">
        Region layers — {subtypeLabel}
      </div>

      <label className="flex items-center gap-2 cursor-pointer py-0.5">
        <input
          type="checkbox"
          checked={pointsEnabled}
          onChange={(e) => onTogglePoints(e.target.checked)}
        />
        <span className="text-slate-700">
          Show as points
        </span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer py-0.5 mb-1">
        <input
          type="checkbox"
          checked={choroplethEnabled}
          onChange={(e) => onToggleChoropleth(e.target.checked)}
        />
        <span className="text-slate-700">Shade munis by count</span>
      </label>

      {bins.empty ? (
        <div className="text-slate-500 italic pt-1 border-t border-slate-100">
          No features found in any MAPC muni.
        </div>
      ) : (
        <ul
          className={
            "pt-1 border-t border-slate-100 leading-snug " +
            (choroplethEnabled ? "" : "opacity-40")
          }
        >
          {bins.colors.map((color, i) => {
            const munis = munisByBin[i];
            const isActive = activeBin === i;
            return (
              <li key={i}>
                <button
                  onClick={() => onBinSelect(isActive ? null : i)}
                  className={
                    "w-full flex items-center gap-2 py-0.5 px-1 -mx-1 rounded cursor-pointer text-left " +
                    (isActive
                      ? "bg-sky-50"
                      : "hover:bg-slate-50")
                  }
                  disabled={munis.length === 0}
                >
                  <span
                    className="inline-block w-4 h-3 rounded-sm border border-slate-300/60 shrink-0"
                    style={{ backgroundColor: color, opacity: 0.7 }}
                  />
                  <span className="tabular-nums flex-1">
                    {binRangeLabel(i, bins)}
                  </span>
                  <span
                    className={
                      "text-[10px] tabular-nums " +
                      (munis.length === 0
                        ? "text-slate-300"
                        : "text-slate-500")
                    }
                  >
                    {munis.length} muni{munis.length === 1 ? "" : "s"}
                  </span>
                </button>
                {isActive && munis.length > 0 && (
                  <ul className="ml-6 mt-0.5 mb-1 max-h-32 overflow-auto pr-1 text-[11px] space-y-0.5">
                    {munis.map((m) => (
                      <li key={m.slug}>
                        <button
                          onClick={() => onSelectMuni(m.slug)}
                          className="text-sky-700 hover:text-sky-900 hover:underline cursor-pointer text-left"
                        >
                          {m.name}
                        </button>
                        <span className="text-slate-400 tabular-nums ml-1">
                          ({m.count.toLocaleString()})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
          <li className="flex items-center gap-2 py-0.5 pt-1 border-t border-slate-100 mt-0.5">
            <span
              className="inline-block w-4 h-3 rounded-sm border border-slate-300/60"
              style={{ backgroundColor: bins.zeroColor, opacity: 0.35 }}
            />
            <span className="text-slate-500 flex-1">0</span>
            <span className="text-[10px] tabular-nums text-slate-400">
              {zeroCount} muni{zeroCount === 1 ? "" : "s"}
            </span>
          </li>
        </ul>
      )}
    </div>
  );
}
