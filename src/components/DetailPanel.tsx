/**
 * Floating detail panel anchored top-left over the map. Shown when a
 * feature is selected. Displays name, OSM type/id, all tags, a link
 * back to openstreetmap.org, and a download-this-feature button.
 */
import type { ResultFeature } from "../lib/queries";

interface DetailPanelProps {
  feature: ResultFeature;
  onClose: () => void;
}

export function DetailPanel({ feature, onClose }: DetailPanelProps) {
  const { name, osm_id, osm_type, tags } = feature.properties;
  const osmUrl = `https://www.openstreetmap.org/${osm_type}/${osm_id}`;
  const tagEntries = Object.entries(tags).sort(([a], [b]) => a.localeCompare(b));

  const displayName =
    name && name.trim() !== "" ? name : `Unnamed ${humanType(osm_type)}`;

  function handleDownload() {
    const fc: GeoJSON.FeatureCollection<GeoJSON.Geometry> = {
      type: "FeatureCollection",
      features: [feature],
    };
    downloadGeoJSON(fc, `${osm_type}-${osm_id}.geojson`);
  }

  return (
    <div
      className="absolute top-4 left-4 z-10 w-80 max-h-[calc(100%-2rem)] overflow-auto
                 rounded-lg border border-slate-200 bg-white/95 backdrop-blur shadow-lg"
      role="dialog"
      aria-label="Feature details"
    >
      <div className="flex items-start justify-between px-4 pt-3 pb-2 border-b border-slate-100">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">
            {displayName}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            OSM {osm_type}{" "}
            <span className="font-mono text-slate-400">{osm_id}</span>
          </p>
        </div>
        <button
          onClick={onClose}
          className="ml-3 text-slate-400 hover:text-slate-700 transition-colors"
          aria-label="Close"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>

      <div className="px-4 py-3">
        <h4 className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1.5">
          Tags ({tagEntries.length})
        </h4>
        {tagEntries.length === 0 ? (
          <p className="text-xs text-slate-400 italic">No tags</p>
        ) : (
          <dl className="text-xs divide-y divide-slate-100">
            {tagEntries.map(([k, v]) => (
              <div key={k} className="py-1 flex gap-2">
                <dt className="text-slate-500 font-mono shrink-0 min-w-[6rem]">
                  {k}
                </dt>
                <dd className="text-slate-800 break-words">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      <div className="px-4 pb-4 pt-1 flex flex-col gap-2 text-sm">
        <a
          href={osmUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sky-700 hover:text-sky-900 hover:underline inline-flex items-center gap-1"
        >
          View on OpenStreetMap
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
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        </a>
        <button
          onClick={handleDownload}
          className="w-full text-center px-3 py-1.5 rounded-md border border-slate-300
                     text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-colors"
        >
          Download feature (GeoJSON)
        </button>
      </div>
    </div>
  );
}

function humanType(osmType: string): string {
  switch (osmType) {
    case "node":
      return "point";
    case "way":
      return "way";
    case "relation":
      return "relation";
    default:
      return "feature";
  }
}

/** Trigger a browser download for a GeoJSON FeatureCollection. Exported
 *  for reuse by the collection-level "Download all" button. */
export function downloadGeoJSON(
  fc: GeoJSON.FeatureCollection,
  filename: string,
): void {
  const blob = new Blob([JSON.stringify(fc, null, 2)], {
    type: "application/geo+json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
