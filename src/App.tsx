function App() {
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
            <span className="inline-block px-3 py-1 rounded-md border border-dashed border-slate-400 text-slate-500">
              a category
            </span>{" "}
            in{" "}
            <span className="inline-block px-3 py-1 rounded-md border border-dashed border-slate-400 text-slate-500">
              a place
            </span>
            .
          </h2>
          <button
            disabled
            className="px-6 py-3 rounded-md bg-slate-300 text-slate-500 cursor-not-allowed"
          >
            Find data →
          </button>
          <p className="mt-4 text-sm text-slate-400">
            Dropdowns coming in Slice 1.
          </p>
        </section>

        <section className="max-w-6xl mx-auto px-6 pb-20">
          <div className="aspect-[16/9] rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-400">
            Map of the MAPC region will render here
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
