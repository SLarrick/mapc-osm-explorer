/**
 * Footer "About the data" expandable.
 *
 * A persistent affordance that explains the crowdsourced-data frame in
 * one paragraph, so even users who ignore the per-query coverage
 * caveat have a reliable place to learn how to interpret counts.
 *
 * Lives in the footer (not the header) because it's a context cue, not
 * a navigational primary. Closed by default — the per-query caveats
 * carry the active message. Open state is local component state; we
 * deliberately don't persist it across sessions.
 */
import { useState } from "react";

export function AboutDataChip() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="underline hover:text-slate-700 cursor-pointer"
      >
        About the data
      </button>
      {open && (
        <div
          className="absolute bottom-14 left-6 right-6 max-w-3xl mx-auto rounded-md border border-slate-200 bg-white shadow-lg px-4 py-3 text-sm text-slate-700 leading-relaxed"
          role="region"
          aria-label="About the data"
        >
          <div className="flex items-start justify-between gap-3 mb-1">
            <strong className="font-semibold text-slate-900">
              About this data
            </strong>
            <button
              onClick={() => setOpen(false)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <p className="mb-2">
            Everything here comes from{" "}
            <a
              href="https://www.openstreetmap.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-700 hover:text-sky-900 underline"
            >
              OpenStreetMap
            </a>
            , a crowdsourced world map maintained by volunteers. A feature
            shown here was mapped by someone who visited or surveyed it —
            so what's on the map is generally trustworthy, but{" "}
            <strong>the absence of a feature rarely means absence on the ground</strong>.
          </p>
          <p className="mb-2">
            Coverage varies by feature type and by place. Large institutions
            (hospitals, schools, fire stations) are near-complete across
            MAPC. Everyday furniture (benches, bike parking, street trees)
            is wildly uneven. And even well-mapped categories like cafes or
            restaurants tend to be under-mapped in suburban and rural
            munis, where there are fewer active OSM contributors.
          </p>
          <p>
            Treat counts as descriptive of what OSM currently knows, not
            as a census of what exists. When in doubt, compare to an
            authoritative source or spot-check on the ground.
          </p>
        </div>
      )}
    </>
  );
}
