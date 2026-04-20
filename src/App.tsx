/**
 * Slice 3 shell.
 *
 * Three display modes, all driven by `selectedMuniSlug`:
 *   1. Landing  — big hero sentence with inline Feature / Muni dropdowns,
 *                 comfortable 540px map showing the MAPC region.
 *   2. Region   — user picked "Entire MAPC region" from the muni dropdown.
 *                 Looks like Landing, but "Find data" runs a region-wide
 *                 query (capped render + honest "N of M" messaging).
 *   3. Focused  — user picked a single muni. Compact filter bar with the
 *                 muni name as a header, "← back to MAPC region" affordance,
 *                 and a taller 720px map zoomed to the selected muni.
 *
 * Why share state between landing and region:
 *   Region isn't a separate surface — it's the landing layout with a
 *   region-scoped query underneath. Keeping them in one branch means the
 *   dropdown stays the single source of truth for geography and there's
 *   one less transition for the user to track.
 *
 * The map drives muni selection too: clicking a muni polygon sets
 * `selectedMuniSlug` exactly as if the dropdown had changed.
 */
import { useEffect, useMemo, useState } from "react";
import { MapView } from "./components/MapView";
import { DetailPanel, downloadGeoJSON } from "./components/DetailPanel";
import { ChoroplethLegend } from "./components/ChoroplethLegend";
import { TableView, type TableScope } from "./components/TableView";
import { FeaturePicker, MuniPicker, MAPC_REGION_SLUG } from "./components/Pickers";
import {
  findFeaturesInMuni,
  findFeaturesInRegion,
  type ResultFeature,
} from "./lib/queries";
import { listMunicipalities, type MuniSummary } from "./lib/geo";
import { getSubtypeBySlug } from "./lib/taxonomy";
import { computeChoropleth, groupMunisByBin } from "./lib/choropleth";

type View = "map" | "table";

interface ManifestCategory {
  slug: string;
  label: string;
}

/**
 * Metadata about a region query. `renderable` is the primary gate: when
 * false, the total count was above our render threshold (too many to
 * make a useful point map) and we skipped the feature fetch entirely.
 * The UI leans on `total` alone in that case.
 *
 * `countsByMuni` drives the Slice 4A choropleth — always present for
 * region queries, shown whenever we're in region mode.
 */
interface RegionMeta {
  total: number;
  renderable: boolean;
  truncated: boolean;
  cap: number;
  countsByMuni: Map<string, number>;
}

/**
 * Metadata about a focused (single-muni) query. Same two-phase shape as
 * RegionMeta — `renderable=false` means we had too many features to
 * return a payload (e.g. Boston + all-buildings → ~180k), so the UI
 * falls back to a count-only view with a download affordance.
 */
interface FocusedMeta {
  total: number;
  renderable: boolean;
  threshold: number;
}

function App() {
  // User-facing selections.
  const [selectedSubtypeSlug, setSelectedSubtypeSlug] = useState<string | null>(
    null,
  );
  const [selectedMuniSlug, setSelectedMuniSlug] = useState<string | null>(null);

  // Catalog data for the dropdowns.
  const [categories, setCategories] = useState<ManifestCategory[]>([]);
  const [munis, setMunis] = useState<MuniSummary[]>([]);

  // Query result state.
  const [results, setResults] = useState<
    GeoJSON.FeatureCollection<GeoJSON.Geometry> | null
  >(null);
  const [regionMeta, setRegionMeta] = useState<RegionMeta | null>(null);
  const [focusedMeta, setFocusedMeta] = useState<FocusedMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Slice 5 — view + scope + choropleth toggle state.
  //
  // view:                   Map vs Table tab.
  // choroplethEnabled:      user-facing switch inside the legend. null means
  //                         "use the default for the current query shape";
  //                         a boolean means the user overrode it.
  // tableScopeOverride:     likewise for the Table's feature/muni scope.
  //                         null = follow choropleth state; boolean = explicit.
  //
  // The override-null-means-follow-default pattern is what makes the UI feel
  // continuous: if the user never clicks the toggles, the defaults track the
  // query shape. Once they click, their choice sticks through subsequent
  // queries until they reset it (happens automatically when the selection
  // changes — see the useEffect below).
  const [view, setView] = useState<View>("map");
  const [choroplethOverride, setChoroplethOverride] =
    useState<boolean | null>(null);
  const [tableScopeOverride, setTableScopeOverride] =
    useState<TableScope | null>(null);
  // Slice 5.1 — region-layers toggles + bin highlight.
  //
  // pointsOverride:  null = follow query-shape default (on when renderable,
  //                  off when over the region-render threshold). User toggle
  //                  in the legend's "Show as points" checkbox overrides.
  // activeBin:       which choropleth bin (0-5) the user clicked in the
  //                  legend to expand + highlight on the map. null = none.
  const [pointsOverride, setPointsOverride] = useState<boolean | null>(null);
  const [activeBin, setActiveBin] = useState<number | null>(null);

  // Load manifest categories + muni list once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [manifestRes, muniList] = await Promise.all([
          fetch("/data/_manifest.json").then((r) => r.json()),
          listMunicipalities(),
        ]);
        if (cancelled) return;
        const cats: ManifestCategory[] = (
          manifestRes.categories as ManifestCategory[]
        ).map((c) => ({ slug: c.slug, label: c.label }));
        setCategories(cats);
        setMunis(muniList);
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Geography/subtype change invalidates stale results — otherwise the
  // previous query's pins would hover over the new geography while the
  // new query runs.
  //
  // Auto-rerun policy: if the user already had an active query (results
  // or regionMeta non-null) AND both selections are still set, kick off
  // a new query for the new (muni, subtype) pair automatically. This is
  // what makes "I searched region-wide playgrounds, now click Salem"
  // feel continuous instead of forcing a second "Find data" click. Same
  // principle in reverse (back to region) and on subtype swaps within
  // the same muni.
  useEffect(() => {
    const hadActiveQuery = results !== null || regionMeta !== null;
    setResults(null);
    setRegionMeta(null);
    setFocusedMeta(null);
    setSelectedId(null);
    setError(null);
    // Reset toggle overrides on selection change — each new query starts
    // from the query-shape default (points under threshold, choropleth
    // over threshold). If users want sticky preferences across queries
    // we can revisit.
    setChoroplethOverride(null);
    setTableScopeOverride(null);
    setPointsOverride(null);
    setActiveBin(null);
    if (hadActiveQuery && selectedSubtypeSlug && selectedMuniSlug) {
      void handleFind();
    }
    // We deliberately depend only on the *selections* — results/regionMeta
    // would cause a re-run loop (handleFind sets them).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMuniSlug, selectedSubtypeSlug]);

  const isRegion = selectedMuniSlug === MAPC_REGION_SLUG;

  async function handleFind() {
    if (!selectedSubtypeSlug || !selectedMuniSlug) return;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    try {
      if (isRegion) {
        const res = await findFeaturesInRegion(selectedSubtypeSlug);
        setResults(res.fc);
        setRegionMeta({
          total: res.totalCount,
          renderable: res.renderable,
          truncated: res.truncated,
          cap: res.cap,
          countsByMuni: res.countsByMuni,
        });
        setFocusedMeta(null);
      } else {
        const res = await findFeaturesInMuni(
          selectedSubtypeSlug,
          selectedMuniSlug,
        );
        setResults(res.fc);
        setRegionMeta(null);
        setFocusedMeta({
          total: res.totalCount,
          renderable: res.renderable,
          threshold: res.threshold,
        });
      }
    } catch (e) {
      console.error(e);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  const count = results?.features.length ?? 0;

  const selectedFeature = useMemo<ResultFeature | null>(() => {
    if (!selectedId || !results) return null;
    const f = results.features.find((feat) => feat.id === selectedId) ?? null;
    return f as ResultFeature | null;
  }, [selectedId, results]);

  const selectedMuni = useMemo(
    () =>
      isRegion
        ? null
        : munis.find((m) => m.slug === selectedMuniSlug) ?? null,
    [munis, selectedMuniSlug, isRegion],
  );
  const selectedSubtype = useMemo(
    () =>
      selectedSubtypeSlug ? getSubtypeBySlug(selectedSubtypeSlug) : null,
    [selectedSubtypeSlug],
  );

  const canFind = Boolean(selectedSubtypeSlug && selectedMuniSlug);

  // Focus mode is "I've picked one specific muni." Region doesn't count —
  // there's no single muni to frame the page around.
  const focused = Boolean(selectedMuniSlug) && !isRegion;

  // Tier-3 features (benches, street trees, etc.) deserve a prominent
  // coverage caveat at region scale, because the number-on-screen is
  // primarily a function of where mappers live, not where the thing is.
  const showCoverageCaveat =
    isRegion && selectedSubtype?.completeness === "spotty";

  function handleDownloadAll() {
    if (!results || !selectedSubtype) return;
    const suffix = isRegion ? "mapc-region" : (selectedMuni?.slug ?? "geo");
    downloadGeoJSON(results, `${selectedSubtype.slug}-${suffix}.geojson`);
  }

  function handleBackToRegion() {
    setSelectedMuniSlug(null);
    // keep the feature selection — user just backs out geographically
  }

  /** For the MapView, region-mode looks the same as no-selection: no
   *  focus paint, no fit-bounds-to-muni. Pass null to opt out of those. */
  const mapMuniSlug = isRegion ? null : selectedMuniSlug;

  // Choropleth bins: only in region mode, only after a region query has
  // run. Focused mode passes null to MapView so the muni-fill reverts to
  // the neighbor-dim post-selection style. Bins are recomputed whenever
  // the count map changes — cheap (101 values, O(n log n)).
  const choroplethData = useMemo(() => {
    if (!isRegion || !regionMeta) return null;
    return {
      counts: regionMeta.countsByMuni,
      bins: computeChoropleth(regionMeta.countsByMuni),
    };
  }, [isRegion, regionMeta]);

  // Default-on-when-over-threshold, default-off-when-under-threshold.
  // Rationale: under threshold the points are the useful render; over
  // threshold the points would be noise so the choropleth is the answer.
  // User can override with the legend checkbox — the override sticks
  // for the current query.
  const defaultChoroplethEnabled = Boolean(
    choroplethData && regionMeta && !regionMeta.renderable,
  );
  const choroplethEnabled =
    choroplethOverride ?? defaultChoroplethEnabled;

  // Table scope default tracks the choropleth toggle (they're two views
  // of the same "muni-scale vs feature-scale" decision). When a region
  // query has no renderable features AND choropleth is off, we still
  // default to "muni" because there's nothing to show at feature scope.
  const canToggleTableScope =
    isRegion && regionMeta !== null && regionMeta.renderable;
  const defaultTableScope: TableScope = choroplethEnabled
    ? "muni"
    : regionMeta && !regionMeta.renderable
      ? "muni" // no renderable features to show anyway
      : "feature";
  const tableScope: TableScope =
    tableScopeOverride ?? defaultTableScope;

  // MapView only paints the choropleth when enabled. When disabled,
  // passing null reverts to the pre-selection / post-selection fill,
  // which in region mode is the ambient neutral fill.
  const mapChoropleth = choroplethEnabled ? choroplethData : null;

  // Points-on-map state.
  //
  // In region mode: the query-shape default is "off when over render
  // threshold, on otherwise." The user can override in the legend — we
  // keep that override until the selection changes.
  //
  // Outside region mode (focused or landing), points default to on and
  // the legend toggle isn't exposed.
  const defaultPointsEnabled = isRegion
    ? Boolean(regionMeta && regionMeta.renderable)
    : true;
  const pointsEnabled = pointsOverride ?? defaultPointsEnabled;

  // The map only draws the results overlay when points are enabled. When
  // off, we pass null so the circle / fill / line layers go empty.
  const mapResults = pointsEnabled ? results : null;

  // Slug → name lookup for the legend's expanded muni list + map tooltips.
  const muniNameBySlug = useMemo(() => {
    const m = new Map<string, string>();
    for (const muni of munis) m.set(muni.slug, muni.name);
    return m;
  }, [munis]);

  // When a bin is active, compute the slugs of munis in that bin so the
  // MapView can outline them and the Legend can list them.
  const highlightedMuniSlugs = useMemo(() => {
    if (activeBin === null || !choroplethData) return [];
    const grouped = groupMunisByBin(
      choroplethData.counts,
      muniNameBySlug,
      choroplethData.bins,
    );
    return grouped[activeBin]?.map((m) => m.slug) ?? [];
  }, [activeBin, choroplethData, muniNameBySlug]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold tracking-tight">
            MAPC OSM Explorer
          </h1>
          <nav className="text-sm text-slate-500">
            <span className="mr-1">Pre-alpha</span>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        {focused ? (
          // Compact focused-mode bar: muni name + inline pickers + back link.
          <section className="max-w-6xl mx-auto px-6 pt-8 pb-4">
            <div className="flex flex-wrap items-baseline gap-x-6 gap-y-3 mb-4">
              <button
                onClick={handleBackToRegion}
                className="text-sm text-sky-700 hover:text-sky-900 hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <span aria-hidden>←</span> back to MAPC region
              </button>
              <h2 className="text-3xl font-semibold tracking-tight text-slate-900">
                {selectedMuni?.name ?? "—"}
                {selectedMuni ? (
                  <span className="text-slate-400 font-normal">, MA</span>
                ) : null}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-3 text-lg">
              <span className="text-slate-500">Show</span>
              <FeaturePicker
                categories={categories}
                value={selectedSubtypeSlug}
                onChange={setSelectedSubtypeSlug}
              />
              <button
                onClick={handleFind}
                disabled={loading || !canFind}
                className={
                  "px-4 py-2 rounded-md text-white text-sm transition-colors " +
                  (loading || !canFind
                    ? "bg-slate-400 cursor-not-allowed"
                    : "bg-sky-600 hover:bg-sky-700 cursor-pointer")
                }
              >
                {loading ? "Finding…" : "Find data →"}
              </button>
              <div className="text-sm text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-1 ml-2">
                {error ? (
                  <span className="text-red-600">Error: {error}</span>
                ) : focusedMeta && !focusedMeta.renderable ? (
                  // Over the focused threshold: too many to render as points
                  // or as table rows. Count only — mirrors the region
                  // over-threshold UX.
                  <>
                    <span>
                      <strong>
                        {focusedMeta.total.toLocaleString()}
                      </strong>{" "}
                      {selectedSubtype?.label.toLowerCase() ?? "features"} in
                      the MAPC extract match this filter —{" "}
                      <span className="text-slate-400">
                        too many to render individually.
                      </span>
                    </span>
                  </>
                ) : results ? (
                  <>
                    <span>
                      Found <strong>{count}</strong>{" "}
                      {selectedSubtype
                        ? selectedSubtype.label.toLowerCase()
                        : "feature" + (count === 1 ? "" : "s")}
                      .
                    </span>
                    {count > 0 && (
                      <button
                        onClick={handleDownloadAll}
                        className="text-sky-700 hover:text-sky-900 hover:underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        Download GeoJSON
                      </button>
                    )}
                  </>
                ) : (
                  <span>Pick a feature to query.</span>
                )}
              </div>
            </div>
          </section>
        ) : (
          // Big hero: the landing sentence with inline dropdowns. Region
          // mode shares this layout — the only difference is what happens
          // when you click Find.
          <section className="max-w-4xl mx-auto px-6 pt-20 pb-10 text-center">
            <p className="text-sm uppercase tracking-wider text-slate-500 mb-4">
              Census Reporter for OpenStreetMap — Greater Boston
            </p>
            <h2 className="text-4xl md:text-5xl font-semibold leading-tight text-slate-900 mb-8">
              I'm looking for data about{" "}
              <FeaturePicker
                categories={categories}
                value={selectedSubtypeSlug}
                onChange={setSelectedSubtypeSlug}
              />{" "}
              in{" "}
              <MuniPicker
                munis={munis}
                value={selectedMuniSlug}
                onChange={setSelectedMuniSlug}
              />
              .
            </h2>

            {/* Tier-3 coverage caveat — shown pre-query, so the user frames
                what they're about to look at as "where mapping has
                happened" rather than "where the thing actually is." */}
            {showCoverageCaveat && (
              <div className="mx-auto mb-4 max-w-xl rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 text-left">
                <strong className="font-semibold">Heads up:</strong> OSM
                coverage of {selectedSubtype?.label.toLowerCase()} across
                MAPC is uneven. Regional results reflect where mappers have
                been active as much as where the feature actually exists.
              </div>
            )}

            <button
              onClick={handleFind}
              disabled={loading || !canFind}
              className={
                "px-6 py-3 rounded-md text-white transition-colors " +
                (loading || !canFind
                  ? "bg-slate-400 cursor-not-allowed"
                  : "bg-sky-600 hover:bg-sky-700 cursor-pointer")
              }
            >
              {loading ? "Finding…" : "Find data →"}
            </button>
            <div className="mt-4 text-sm text-slate-500 min-h-[1.25rem] flex flex-col items-center justify-center gap-1">
              {error ? (
                <span className="text-red-600">Error: {error}</span>
              ) : regionMeta && isRegion ? (
                // Three region-result shapes:
                //   a) Count above threshold — show count only, no map render,
                //      no download. Most honest answer for high-N features
                //      like buildings (1M+) where a 5000-point sample misleads.
                //   b) Rendered (below threshold) with cap truncation —
                //      rare edge case, "showing X of Y."
                //   c) Rendered fully — "Found X."
                regionMeta.renderable === false ? (
                  <>
                    <span>
                      There are{" "}
                      <strong>{regionMeta.total.toLocaleString()}</strong>{" "}
                      {selectedSubtype?.label.toLowerCase() ?? "features"}{" "}
                      across the MAPC region.
                    </span>
                    <span className="text-slate-400">
                      Too many to render as points — the map shades each
                      muni by count instead. Click a muni for the full
                      feature-level view.
                    </span>
                  </>
                ) : (
                  <>
                    <span>
                      {regionMeta.truncated ? (
                        <>
                          Showing <strong>{count.toLocaleString()}</strong> of{" "}
                          <strong>
                            {regionMeta.total.toLocaleString()}
                          </strong>{" "}
                          {selectedSubtype?.label.toLowerCase() ?? "features"}{" "}
                          across the MAPC region.
                        </>
                      ) : (
                        <>
                          Found <strong>{count.toLocaleString()}</strong>{" "}
                          {selectedSubtype?.label.toLowerCase() ?? "features"}{" "}
                          across the MAPC region.
                        </>
                      )}
                      {count > 0 && (
                        <>
                          {"  "}
                          <button
                            onClick={handleDownloadAll}
                            className="text-sky-700 hover:text-sky-900 hover:underline cursor-pointer"
                          >
                            Download GeoJSON
                          </button>
                        </>
                      )}
                    </span>
                    {regionMeta.truncated && (
                      <span className="text-slate-400">
                        Zoom in or pick a muni to see the rest — richer
                        region-wide views are coming.
                      </span>
                    )}
                  </>
                )
              ) : (
                <span>
                  Pick a feature and a place — or click a municipality on the
                  map.
                </span>
              )}
            </div>
          </section>
        )}

        <section className="max-w-6xl mx-auto px-6 pb-20">
          {/* Map / Table tabs. Shown once a subtype is picked (or a query
              has run) so the tab chrome doesn't clutter the empty state. */}
          <div className="flex items-center border-b border-slate-200 mb-3">
            <ViewTab
              label="Map"
              active={view === "map"}
              onClick={() => setView("map")}
            />
            <ViewTab
              label="Table"
              active={view === "table"}
              onClick={() => setView("table")}
            />
            {view === "map" && regionMeta && !regionMeta.renderable &&
              !choroplethEnabled && (
                <span className="ml-auto text-xs text-slate-500 italic pr-2">
                  Choropleth off — {regionMeta.total.toLocaleString()}{" "}
                  {selectedSubtype?.label.toLowerCase() ?? "features"} can't
                  be drawn as points. Toggle it back on, or switch to the
                  Table tab.
                </span>
              )}
            {focusedMeta && !focusedMeta.renderable && (
              <span className="ml-auto text-xs text-slate-500 italic pr-2">
                {focusedMeta.total.toLocaleString()}{" "}
                {selectedSubtype?.label.toLowerCase() ?? "features"} is past
                the {focusedMeta.threshold.toLocaleString()} render cap —
                neither the map nor the table can load individual rows.
              </span>
            )}
          </div>

          {view === "map" ? (
            <div
              className={
                "relative transition-[height] duration-300 " +
                (focused ? "h-[720px]" : "h-[540px]")
              }
            >
              <MapView
                results={mapResults}
                selectedId={selectedId}
                onSelectFeature={setSelectedId}
                selectedMuniSlug={mapMuniSlug}
                onSelectMuni={setSelectedMuniSlug}
                choropleth={mapChoropleth}
                highlightedMuniSlugs={highlightedMuniSlugs}
              />
              {choroplethData && selectedSubtype && (
                <ChoroplethLegend
                  bins={choroplethData.bins}
                  subtypeLabel={selectedSubtype.label}
                  counts={choroplethData.counts}
                  muniNameBySlug={muniNameBySlug}
                  pointsEnabled={pointsEnabled}
                  onTogglePoints={(v) => setPointsOverride(v)}
                  choroplethEnabled={choroplethEnabled}
                  onToggleChoropleth={(v) => setChoroplethOverride(v)}
                  activeBin={activeBin}
                  onBinSelect={setActiveBin}
                  onSelectMuni={setSelectedMuniSlug}
                />
              )}
              {selectedFeature && (
                <DetailPanel
                  feature={selectedFeature}
                  onClose={() => setSelectedId(null)}
                />
              )}
            </div>
          ) : (
            <TableView
              features={results ? (results.features as ResultFeature[]) : null}
              countsByMuni={regionMeta?.countsByMuni ?? null}
              munis={munis}
              categorySlug={selectedSubtype?.categorySlug ?? null}
              subtypeLabel={selectedSubtype?.label ?? null}
              selectedId={selectedId}
              onSelectFeature={setSelectedId}
              onSelectMuni={setSelectedMuniSlug}
              scope={tableScope}
              onScopeChange={(s) => setTableScopeOverride(s)}
              canToggleScope={canToggleTableScope}
            />
          )}
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 text-sm text-slate-500 flex flex-wrap gap-x-6 gap-y-1">
          <span>
            Data ©{" "}
            <a
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-slate-700"
            >
              OpenStreetMap contributors
            </a>
          </span>
          <span>Snapshot: TBD</span>
          <span className="ml-auto">MAPC OSM Explorer · v0.0.1</span>
        </div>
      </footer>
    </div>
  );
}

function ViewTab(props: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const { label, active, onClick } = props;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={
        "px-4 py-2 text-sm border-b-2 -mb-px transition-colors cursor-pointer " +
        (active
          ? "border-sky-600 text-slate-900 font-medium"
          : "border-transparent text-slate-500 hover:text-slate-900")
      }
    >
      {label}
    </button>
  );
}

export default App;
