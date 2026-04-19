import { useMemo, useState } from "react";
import { MapView } from "./components/MapView";
import { DetailPanel, downloadGeoJSON } from "./components/DetailPanel";
import { findPlaygroundsInMuni, type ResultFeature } from "./lib/queries";

function App() {
  const [results, setResults] = useState<
    GeoJSON.FeatureCollection<GeoJSON.Geometry> | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  async function handleFind() {
    setLoading(true);
    setError(null);
    setSelectedId(null);
    try {
      const fc = await findPlaygroundsInMuni("salem");
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

  function handleDownloadAll() {
    if (!results) return;
    downloadGeoJSON(results, "playgrounds-salem.geojson");
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
        <section className="max-w-4xl mx-auto px-6 pt-20 pb-10 text-center">
          <p className="text-sm uppercase tracking-wider text-slate-500 mb-4">
            Census Reporter for OpenStreetMap — Greater Boston
          </p>
          <h2 className="text-4xl md:text-5xl font-semibold leading-tight text-slate-900 mb-8">
            I'm looking for data about{" "}
            <span className="inline-block px-3 py-1 rounded-md border border-dashed border-sky-500 text-sky-700 bg-sky-50">
              playgrounds
            </span>{" "}
            in{" "}
            <span className="inline-block px-3 py-1 rounded-md border border-dashed border-sky-500 text-sky-700 bg-sky-50">
              Salem
            </span>
            .
          </h2>
          <button
            onClick={handleFind}
            disabled={loading}
            className={
              "px-6 py-3 rounded-md text-white transition-colors " +
              (loading
                ? "bg-slate-400 cursor-wait"
                : "bg-sky-600 hover:bg-sky-700 cursor-pointer")
            }
          >
            {loading ? "Finding…" : "Find data →"}
          </button>
          <div className="mt-4 text-sm text-slate-500 min-h-[1.25rem] flex items-center justify-center gap-3">
            {error ? (
              <span className="text-red-600">Error: {error}</span>
            ) : results ? (
              <>
                <span>
                  Found <strong>{count}</strong> playground
                  {count === 1 ? "" : "s"} in Salem.
                </span>
                {count > 0 && (
                  <button
                    onClick={handleDownloadAll}
                    className="text-sky-700 hover:text-sky-900 hover:underline inline-flex items-center gap-1"
                  >
                    Download GeoJSON
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                      <polyline points="7 10 12 15 17 10"></polyline>
                      <line x1="12" y1="15" x2="12" y2="3"></line>
                    </svg>
                  </button>
                )}
              </>
            ) : (
              <span>
                Slice 1c: click any feature for details. Dropdowns in Slice 2.
              </span>
            )}
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-6 pb-20">
          <div className="h-[540px] relative">
            <MapView
              results={results}
              selectedId={selectedId}
              onSelectFeature={setSelectedId}
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
