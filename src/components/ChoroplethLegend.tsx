/**
 * Region-layers legend — floats bottom-left of the map in region /
 * subregion modes.
 *
 * Holds three controls for what's drawn on the map:
 *   - "Show features"              — toggles the results overlay (works
 *                                    regardless of whether the subtype's
 *                                    geometry is points, lines, or polygons).
 *   - "Shade munis by feature count" — toggles the muni-choropleth fill.
 *   - Bin by: Muni / Subregion     — only in region mode. Flips the
 *                                    legend + map between 101-muni and
 *                                    8-subregion aggregation.
 * Plus the bin legend itself. Clicking a bin row expands it to a list
 * of entities (munis or subregions) in that bin, and highlights the
 * underlying muni polygons on the map via `onBinSelect`.
 *
 * Design notes:
 *   - The toggles are deliberately co-located in one card so "what am
 *     I looking at on the map" lives in a single place.
 *   - The legend is polymorphic over entity kind (muni vs subregion).
 *     The map always draws muni polygons — it's App.tsx that derives
 *     per-muni paint counts from a subregion total when binBy=subregion.
 */
import { useMemo } from "react";
import {
  binRangeLabel,
  groupMunisByBin,
  type ChoroplethBins,
} from "../lib/choropleth";

interface Props {
  bins: ChoroplethBins;
  /** Feature label (e.g. "Playgrounds") — used in the header. */
  subtypeLabel: string;
  /** Counts keyed by entity slug (muni slug when entityKind=muni,
   *  subregion slug when entityKind=subregion). Drives the bin rows
   *  and the expanded list. */
  entityCounts: Map<string, number>;
  /** Entity slug → display name. Used in the expanded list. */
  entityNameBySlug: Map<string, string>;
  /** Whether each bin row is aggregated at muni or subregion granularity.
   *  Only affects labels ("N munis" vs "N subregions"). */
  entityKind: "muni" | "subregion";
  /** Current bin-by setting — mirrors entityKind but is passed separately
   *  because the setter belongs to App state. */
  binBy: "muni" | "subregion";
  /** When provided, renders a Muni / Subregion segmented control at the
   *  top of the legend. Omit (undefined) to hide the control — e.g. in
   *  subregion scope where collapsing to a single value is meaningless. */
  onBinByChange?: (v: "muni" | "subregion") => void;
  /** Feature-points overlay (the pins/shapes) state. */
  pointsEnabled: boolean;
  onTogglePoints: (enabled: boolean) => void;
  /** Choropleth fill state. */
  choroplethEnabled: boolean;
  onToggleChoropleth: (enabled: boolean) => void;
  /** Which bin index (0-5) is currently expanded, or null. */
  activeBin: number | null;
  onBinSelect: (bin: number | null) => void;
  /** Click an entity name in the expanded list — routes to muni or
   *  subregion scope. Both use the same `muni=` URL key (see
   *  subregions.ts slug-collision note). */
  onSelectEntity: (slug: string) => void;
}

export function ChoroplethLegend(props: Props) {
  const {
    bins,
    subtypeLabel,
    entityCounts,
    entityNameBySlug,
    entityKind,
    binBy,
    onBinByChange,
    pointsEnabled,
    onTogglePoints,
    choroplethEnabled,
    onToggleChoropleth,
    activeBin,
    onBinSelect,
    onSelectEntity,
  } = props;

  const entitiesByBin = useMemo(
    () => groupMunisByBin(entityCounts, entityNameBySlug, bins),
    [entityCounts, entityNameBySlug, bins],
  );

  // Drop bins at the top of the ramp that no entity actually falls into.
  // The bin-stops are quantile-derived but occasionally yield an empty
  // max bin (rounding + ties). We keep empty middle-of-ramp bins (they
  // carry useful "nothing here" info) and omit zero-count entities
  // from the legend entirely (white == absent is intuitive).
  const visibleBinEnd = useMemo(() => {
    for (let i = bins.colors.length - 1; i >= 0; i--) {
      if (entitiesByBin[i].length > 0) return i + 1;
    }
    return 0;
  }, [entitiesByBin, bins.colors.length]);

  const entityLabel = entityKind === "muni" ? "muni" : "subregion";

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
        <span className="text-slate-700">Show features</span>
      </label>

      <label className="flex items-center gap-2 cursor-pointer py-0.5 mb-1">
        <input
          type="checkbox"
          checked={choroplethEnabled}
          onChange={(e) => onToggleChoropleth(e.target.checked)}
        />
        <span className="text-slate-700">
          Shade {binBy === "subregion" ? "subregions" : "munis"} by
          feature count
        </span>
      </label>

      {onBinByChange && (
        <div className="flex items-center gap-2 py-0.5 mb-1">
          <span className="text-slate-500 text-[11px]">Bin by:</span>
          <div
            className="inline-flex rounded border border-slate-300 overflow-hidden"
            role="group"
            aria-label="Bin-by granularity"
          >
            <button
              type="button"
              onClick={() => onBinByChange("muni")}
              aria-pressed={binBy === "muni"}
              className={
                "px-2 py-0.5 text-[11px] cursor-pointer " +
                (binBy === "muni"
                  ? "bg-sky-600 text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50")
              }
            >
              Muni
            </button>
            <button
              type="button"
              onClick={() => onBinByChange("subregion")}
              aria-pressed={binBy === "subregion"}
              className={
                "px-2 py-0.5 text-[11px] cursor-pointer border-l border-slate-300 " +
                (binBy === "subregion"
                  ? "bg-sky-600 text-white"
                  : "bg-white text-slate-700 hover:bg-slate-50")
              }
            >
              Subregion
            </button>
          </div>
        </div>
      )}

      {bins.empty ? (
        <div className="text-slate-500 italic pt-1 border-t border-slate-100">
          No features found in any MAPC {entityLabel}.
        </div>
      ) : (
        <ul
          className={
            "pt-1 border-t border-slate-100 leading-snug " +
            (choroplethEnabled ? "" : "opacity-40")
          }
        >
          {bins.colors.slice(0, visibleBinEnd).map((color, i) => {
            const entities = entitiesByBin[i];
            const isActive = activeBin === i;
            return (
              <li key={i}>
                <button
                  onClick={() => onBinSelect(isActive ? null : i)}
                  className={
                    "w-full flex items-center gap-2 py-0.5 px-1 -mx-1 rounded cursor-pointer text-left " +
                    (isActive ? "bg-sky-50" : "hover:bg-slate-50")
                  }
                  disabled={entities.length === 0}
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
                      (entities.length === 0
                        ? "text-slate-300"
                        : "text-slate-500")
                    }
                  >
                    {entities.length} {entityLabel}
                    {entities.length === 1 ? "" : "s"}
                  </span>
                </button>
                {isActive && entities.length > 0 && (
                  <ul className="ml-6 mt-0.5 mb-1 max-h-32 overflow-auto pr-1 text-[11px] space-y-0.5">
                    {entities.map((e) => (
                      <li key={e.slug}>
                        <button
                          onClick={() => onSelectEntity(e.slug)}
                          className="text-sky-700 hover:text-sky-900 hover:underline cursor-pointer text-left"
                        >
                          {e.name}
                        </button>
                        <span className="text-slate-400 tabular-nums ml-1">
                          ({e.count.toLocaleString()})
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
