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
import { FeaturePicker, MuniPicker, MAPC_REGION_SLUG } from "./components/Pickers";
import {
  findFeaturesInMuni,
  findFeaturesInRegion,
  type ResultFeature,
} from "./lib/queries";
import { listMunicipalities, type MuniSummary } from "./lib/geo";
import { getSubtypeBySlug } from "./lib/taxonomy";
import { computeChoropleth } from "./lib/choropleth";

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
    setSelectedId(null);
    setError(null);
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
      } else {
        const fc = await findFeaturesInMuni(
          selectedSubtypeSlug,
          selectedMuniSlug,
        );
        setResults(fc);
        setRegionMeta(null);
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

  // Choropleth: only in region mode, only after a region query has run.
  // Focused mode must pass null so the muni-fill reverts to the
  // neighbor-dim post-selection style. Bins are recomputed whenever
  // the count map changes — cheap (101 values, O(n log n)).
  const choropleth = useMemo(() => {
    if (!isRegion || !regionMeta) return null;
    return {
      counts: regionMeta.countsByMuni,
      bins: computeChoropleth(regionMeta.countsByMuni),
    };
  }, [isRegion, regionMeta]);

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
              <div className="text-sm text-slate-500 flex items-center gap-3 ml-2">
                {error ? (
                  <span className="text-red-600">Error: {error}</span>
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
          <div
            className={
              "relative transition-[height] duration-300 " +
              (focused ? "h-[720px]" : "h-[540px]")
            }
          >
            <MapView
              results={results}
              selectedId={selectedId}
              onSelectFeature={setSelectedId}
              selectedMuniSlug={mapMuniSlug}
              onSelectMuni={setSelectedMuniSlug}
              choropleth={choropleth}
            />
            {choropleth && selectedSubtype && (
              <ChoroplethLegend
                bins={choropleth.bins}
                subtypeLabel={selectedSubtype.label}
              />
            )}
            {selectedFeature && (
              <DetailPanel
                feature={selectedFeature}
                onClose={() => setSelectedId(null)}
              />
            )}
          </div>
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

export default App;
