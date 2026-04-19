import { useState } from "react";
import { MapView } from "./components/MapView";
import { findPlaygroundsInMuni } from "./lib/queries";

function App() {
  const [results, setResults] = useState<
    GeoJSON.FeatureCollection<GeoJSON.Geometry> | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFind() {
    setLoading(true);
    setError(null);
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
          <p className="mt-4 text-sm text-slate-500 min-h-[1.25rem]">
            {error ? (
              <span className="text-red-600">Error: {error}</span>
            ) : results ? (
              <>
                Found <strong>{count}</strong> playground
                {count === 1 ? "" : "s"} in Salem.
              </>
            ) : (
              <>Slice 1b: hardcoded demo query. Dropdowns coming in Slice 2.</>
            )}
          </p>
        </section>

        <section className="max-w-6xl mx-auto px-6 pb-20">
          <div className="h-[540px]">
            <MapView results={results} />
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
