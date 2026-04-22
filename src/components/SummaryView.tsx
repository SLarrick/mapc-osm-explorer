/**
 * Summary tab — descriptive stats for the current result set.
 *
 * Sections:
 *   1. Headline — count + place + geometry mix
 *   2. Top municipalities (region mode only) + coverage across munis
 *   3. Completeness — top 10 tag keys by fill rate, with inline bars
 *   4. Top values — breakdown of the 3 most-filled categorical tags
 *
 * No interactivity (no drill-in, no filter-by-value). That's a post-v1
 * enhancement; v1's goal is to make the per-query "what's here" legible
 * at a glance.
 *
 * All computation happens in src/lib/summary.ts. Component is dumb.
 */
import { useMemo } from "react";
import type { ResultFeature } from "../lib/queries";
import type { MuniSummary } from "../lib/geo";
import type { Subtype } from "../lib/taxonomy";
import {
  computeFillRates,
  computeGeometryMix,
  computeTopValues,
  muniCoverage,
  topMunisByCount,
} from "../lib/summary";

interface Props {
  features: ResultFeature[] | null;
  /** Region or subregion scope; null in focused-muni mode. In subregion
   *  scope, this is already pre-filtered to the subregion's munis. */
  countsByMuni: Map<string, number> | null;
  munis: MuniSummary[];
  subtype: Subtype | null;
  /** Focused-muni display name, if applicable. Otherwise null. */
  focusedMuniName: string | null;
  /** Current query scope. Drives the headline place label + whether
   *  the Geographic distribution section appears (it's meaningful for
   *  region + subregion, not for single-muni). */
  scope: "region" | "subregion" | "muni";
  /** When scope === "subregion", the display label for the subregion,
   *  e.g. "Inner Core Committee (ICC)". Null otherwise. */
  subregionLabel: string | null;
  /** Total feature count from the region/subregion query. Used so the
   *  headline can report the true total even when the rendered feature
   *  set is empty (over-threshold — no features fetched, counts only). */
  regionMetaTotal: number | null;
  /** Whether the region/subregion query fetched feature geometries. When
   *  false, the features prop is an empty list but the scope is still
   *  a valid answer — we want to show headline + distribution, not the
   *  "Run a query" empty state. */
  regionRenderable: boolean | null;
  onSelectMuni: (slug: string) => void;
}

export function SummaryView(props: Props) {
  const {
    features,
    countsByMuni,
    munis,
    subtype,
    focusedMuniName,
    scope,
    subregionLabel,
    regionMetaTotal,
    regionRenderable,
    onSelectMuni,
  } = props;
  const showDistribution = scope === "region" || scope === "subregion";

  const muniNameBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const muni of munis) m.set(muni.slug, muni.name);
    return m;
  }, [munis]);

  const fillRates = useMemo(
    () => (features ? computeFillRates(features) : []),
    [features],
  );
  const geometryMix = useMemo(
    () => (features ? computeGeometryMix(features) : null),
    [features],
  );
  // Pick the top 3 tag keys by fill for the top-values breakdown. Skip
  // 'name' (always essentially a unique-value free-form) and anything
  // that's osm_* (ids, timestamps).
  const topValueKeys = useMemo(() => {
    return fillRates
      .map((e) => e.key)
      .filter(
        (k) =>
          k !== "name" &&
          !k.startsWith("name:") &&
          !k.startsWith("osm_") &&
          k !== "ref" &&
          !k.includes("wikidata") &&
          !k.includes("wikipedia"),
      )
      .slice(0, 6);
  }, [fillRates]);
  const topValues = useMemo(
    () => (features ? computeTopValues(features, topValueKeys) : []),
    [features, topValueKeys],
  );

  const topMunis = useMemo(() => {
    if (!countsByMuni) return [];
    return topMunisByCount(countsByMuni, muniNameBySlug, 5);
  }, [countsByMuni, muniNameBySlug]);

  const coverage = useMemo(
    () => (countsByMuni ? muniCoverage(countsByMuni) : null),
    [countsByMuni],
  );

  // Over-threshold region/subregion: we have a real total + count map
  // but no feature payload. Still a valid summary — the Geographic
  // distribution section is the useful answer. Skip the rich
  // completeness + top-values sections (they need feature tags).
  const overThreshold =
    showDistribution && regionRenderable === false && regionMetaTotal !== null;

  if ((!features || features.length === 0) && !overThreshold) {
    return (
      <div className="rounded-md border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500">
        {features === null
          ? "Run a query to populate the summary."
          : "Query returned no features."}
      </div>
    );
  }

  const label = subtype?.label ?? "features";
  const place =
    scope === "subregion"
      ? (subregionLabel ?? "this subregion")
      : scope === "muni"
        ? (focusedMuniName ?? "this muni")
        : "the MAPC region";
  // Headline number: true total when we have it (region/subregion),
  // else the rendered feature count (single-muni mode).
  const n = overThreshold
    ? (regionMetaTotal ?? 0)
    : (features?.length ?? 0);
  const hasFeatures = (features?.length ?? 0) > 0;

  return (
    <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
      {/* ---- Headline ---- */}
      <div className="px-5 py-4 border-b border-slate-200 bg-slate-50">
        <h3 className="text-lg font-semibold text-slate-900">
          <span className="tabular-nums">{n.toLocaleString()}</span>{" "}
          {label.toLowerCase()} in {place}
        </h3>
        {geometryMix && hasFeatures && (
          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap gap-x-3">
            {geometryMix.point > 0 && (
              <span>
                <span className="tabular-nums">
                  {geometryMix.point.toLocaleString()}
                </span>{" "}
                point{geometryMix.point === 1 ? "" : "s"}
              </span>
            )}
            {geometryMix.line > 0 && (
              <span>
                <span className="tabular-nums">
                  {geometryMix.line.toLocaleString()}
                </span>{" "}
                line{geometryMix.line === 1 ? "" : "s"}
              </span>
            )}
            {geometryMix.polygon > 0 && (
              <span>
                <span className="tabular-nums">
                  {geometryMix.polygon.toLocaleString()}
                </span>{" "}
                polygon{geometryMix.polygon === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </div>

      <div className="grid gap-5 p-5 md:grid-cols-2">
        {/* ---- Geographic distribution (region + subregion) ---- */}
        {showDistribution && coverage && (
          <Section
            title={
              scope === "subregion"
                ? "Geographic distribution within subregion"
                : "Geographic distribution"
            }
          >
            <div className="text-xs text-slate-500 mb-2">
              <span className="tabular-nums">{coverage.withFeatures}</span> of{" "}
              {coverage.total}{" "}
              {scope === "subregion" ? "subregion" : "MAPC"} munis have at
              least one mapped {label.toLowerCase()}.{" "}
              {coverage.withoutFeatures > 0 && (
                <>
                  {" "}
                  <span className="tabular-nums">
                    {coverage.withoutFeatures}
                  </span>{" "}
                  have none.
                </>
              )}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-slate-500 mb-1 mt-2">
              Top 5 munis
            </div>
            <ul className="space-y-1">
              {topMunis.map((m) => (
                <li key={m.slug} className="flex items-center gap-2 text-sm">
                  <button
                    onClick={() => onSelectMuni(m.slug)}
                    className="text-sky-700 hover:text-sky-900 hover:underline cursor-pointer flex-1 text-left truncate"
                  >
                    {m.name}
                  </button>
                  <span className="tabular-nums text-slate-700 w-14 text-right">
                    {m.count.toLocaleString()}
                  </span>
                  <span className="tabular-nums text-slate-400 w-12 text-right">
                    {((m.count / n) * 100).toFixed(1)}%
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* ---- Completeness (top-N fill rates) ---- */}
        {hasFeatures && (
        <Section title="Tag completeness (top 10)">
          <div className="text-xs text-slate-500 mb-2">
            What share of these {label.toLowerCase()} carry each tag.
            Higher means "the data is richer for that attribute."
          </div>
          <ul className="space-y-1">
            {fillRates.slice(0, 10).map((e) => (
              <li key={e.key} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-slate-700 w-32 truncate">
                  {e.key}
                </span>
                <div className="flex-1 h-2 rounded bg-slate-100 overflow-hidden">
                  <div
                    className={
                      "h-full " +
                      (e.pct >= 75
                        ? "bg-emerald-400"
                        : e.pct >= 30
                          ? "bg-amber-400"
                          : "bg-rose-300")
                    }
                    style={{ width: `${Math.max(2, e.pct)}%` }}
                  />
                </div>
                <span className="tabular-nums text-slate-600 w-10 text-right">
                  {Math.round(e.pct)}%
                </span>
              </li>
            ))}
          </ul>
          {fillRates.length > 10 && (
            <div className="text-[11px] text-slate-400 mt-2">
              {fillRates.length - 10} more tag keys in the result set — see
              the Table view for the full column chooser.
            </div>
          )}
        </Section>
        )}

        {/* ---- Top values per key ---- */}
        {hasFeatures && (
        <Section
          title="Most common values"
          className="md:col-span-2"
        >
          <div className="text-xs text-slate-500 mb-3">
            Top values for the most-filled categorical tags. Tags with
            too many distinct values (names, ids, free-form text) are
            skipped.
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {topValues
              .filter((tv) => !tv.skippedHighCardinality)
              .slice(0, 3)
              .map((tv) => (
                <div key={tv.key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs text-slate-700 truncate">
                      {tv.key}
                    </span>
                    <span className="text-[10px] tabular-nums text-slate-400">
                      {tv.distinct} distinct
                    </span>
                  </div>
                  <ul className="space-y-0.5">
                    {tv.entries.map((v) => (
                      <li
                        key={v.value}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span className="flex-1 truncate text-slate-700">
                          {v.value}
                        </span>
                        <span className="tabular-nums text-slate-600 w-12 text-right">
                          {v.count.toLocaleString()}
                        </span>
                        <span className="tabular-nums text-slate-400 w-11 text-right">
                          {v.pct.toFixed(1)}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            {topValues.filter((tv) => !tv.skippedHighCardinality).length ===
              0 && (
              <div className="text-xs italic text-slate-400 col-span-full">
                No low-cardinality tags in the top results — mostly
                free-form fields like names and ids.
              </div>
            )}
          </div>
        </Section>
        )}
      </div>
    </div>
  );
}

function Section(props: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={props.className}>
      <h4 className="text-[11px] uppercase tracking-wider text-slate-500 mb-2 font-medium">
        {props.title}
      </h4>
      {props.children}
    </section>
  );
}
