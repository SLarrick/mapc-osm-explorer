/**
 * Slice 2 shell.
 *
 * Two layout modes, driven by `selectedMuniSlug`:
 *   1. Landing  — big hero sentence with inline Feature / Muni dropdowns,
 *                 comfortable 540px map showing the MAPC region.
 *   2. Focused  — compact filter bar with the muni name as a header,
 *                 "← back to MAPC region" affordance, and a taller 720px
 *                 map zoomed to the selected muni.
 *
 * The map drives selection too: clicking a muni polygon sets
 * `selectedMuniSlug` exactly as if the dropdown had changed. The two
 * controls stay in sync because they share this state.
 */
import { useEffect, useMemo, useState } from "react";
import { MapView } from "./components/MapView";
import { DetailPanel, downloadGeoJSON } from "./components/DetailPanel";
import { FeaturePicker, MuniPicker } from "./components/Pickers";
import { findFeaturesInMuni, type ResultFeature } from "./lib/queries";
import { listMunicipalities, type MuniSummary } from "./lib/geo";
import { getSubtypeBySlug } from "./lib/taxonomy";

interface ManifestCategory {
  slug: string;
  label: string;
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

  // Muni selection is the "focus mode" switch. When it changes, we throw
  // away any stale results so the map doesn't show the previous muni's
  // pins hovering over the new muni while the new query runs.
  useEffect(() => {
    setResults(null);
    setSelectedId(null);
    setError(null);
  }, [selectedMuniSlug]);

  async function handleFind() {
    if (!selectedSubtypeSlug || !selectedMuniSlug) return;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    try {
      const fc = await findFeaturesInMuni(
        selectedSubtypeSlug,
        selectedMuniSlug,
      );
      setResults(fc);
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
    () => munis.find((m) => m.slug === selectedMuniSlug) ?? null,
    [munis, selectedMuniSlug],
  );
  const selectedSubtype = useMemo(
    () =>
      selectedSubtypeSlug ? getSubtypeBySlug(selectedSubtypeSlug) : null,
    [selectedSubtypeSlug],
  );

  const canFind = Boolean(selectedSubtypeSlug && selectedMuniSlug);
  const focused = Boolean(selectedMuniSlug);

  function handleDownloadAll() {
    if (!results || !selectedSubtype || !selectedMuni) return;
    downloadGeoJSON(
      results,
      `${selectedSubtype.slug}-${selectedMuni.slug}.geojson`,
    );
  }

  function handleBackToRegion() {
    setSelectedMuniSlug(null);
    // keep the feature selection — user just backs out geographically
  }

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
          // Big hero: the landing sentence with inline dropdowns.
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
            <div className="mt-4 text-sm text-slate-500 min-h-[1.25rem] flex items-center justify-center gap-3">
              {error ? (
                <span className="text-red-600">Error: {error}</span>
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
              selectedMuniSlug={selectedMuniSlug}
              onSelectMuni={setSelectedMuniSlug}
            />
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
