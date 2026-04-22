/**
 * CSV export for the table view.
 *
 * Why GeoJSON (not WKT) in the `geometry_geojson` column:
 *   - GeoJSON is the same shape the user sees if they grab the Download
 *     GeoJSON affordance — consistency matters when people bounce a CSV
 *     into a different tool. WKT is valid but it's a second lingua
 *     franca to learn.
 *   - Most spatial tools (QGIS, duckdb-spatial, turf) round-trip GeoJSON
 *     just as easily as WKT.
 *
 * Feature-scope CSV columns (in order):
 *   osm_id, osm_type, name, municipality, geometry_type,
 *   centroid_lon, centroid_lat, geometry_geojson, <tag:*>...
 *
 * Muni-scope CSV columns:
 *   muni_slug, municipality, subregion, count
 *
 * Quoting rules: always wrap in quotes, double internal quotes. Simple,
 * produces valid RFC-4180 output across Excel, Google Sheets, etc.
 */
import type { ResultFeature } from "./queries";
import type { MuniSummary } from "./geo";
import {
  SUBREGIONS,
  countsBySubregion,
  munisInSubregion,
} from "./subregions";

/** RFC-4180 field: quote everything, double internal quotes. */
function csvField(v: unknown): string {
  if (v === null || v === undefined) return '""';
  const s = String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function csvRow(cells: unknown[]): string {
  return cells.map(csvField).join(",");
}

/**
 * Build a feature-scope CSV. Includes every tag key present in the
 * data, prefixed with "tag:" so tag columns can't collide with the
 * built-in columns. The geometry column holds the feature's full
 * GeoJSON geometry stringified — null when the feature had no geometry.
 */
export function featureRowsToCsv(features: ResultFeature[]): string {
  // Stable union of tag keys. Sorted alphabetically so CSVs diff cleanly
  // between runs (e.g. if the user exports twice with different queries
  // for the same subtype).
  const tagKeys = new Set<string>();
  for (const f of features) {
    for (const k of Object.keys(f.properties.tags ?? {})) tagKeys.add(k);
  }
  const orderedTagKeys = Array.from(tagKeys).sort();

  const header = [
    "osm_id",
    "osm_type",
    "name",
    "municipality",
    "geometry_type",
    "centroid_lon",
    "centroid_lat",
    "geometry_geojson",
    ...orderedTagKeys.map((k) => `tag:${k}`),
  ];

  const lines: string[] = [csvRow(header)];
  for (const f of features) {
    const p = f.properties;
    const row: unknown[] = [
      p.osm_id,
      p.osm_type,
      p.name ?? "",
      p.muni_name ?? "",
      f.geometry?.type ?? "",
      Number.isFinite(p.centroid_lon) ? p.centroid_lon : "",
      Number.isFinite(p.centroid_lat) ? p.centroid_lat : "",
      f.geometry ? JSON.stringify(f.geometry) : "",
    ];
    for (const k of orderedTagKeys) row.push(p.tags?.[k] ?? "");
    lines.push(csvRow(row));
  }
  return lines.join("\n");
}

/** Muni-scope CSV: one row per MAPC muni with the per-muni count. */
export function muniRowsToCsv(
  munis: MuniSummary[],
  counts: Map<string, number>,
): string {
  const header = ["muni_slug", "municipality", "subregion", "count"];
  const lines: string[] = [csvRow(header)];
  // Sort by count desc so the CSV is pre-ranked (matches the common table
  // sort). Stable tie-break by name.
  const sorted = [...munis].sort((a, b) => {
    const ca = counts.get(a.slug) ?? 0;
    const cb = counts.get(b.slug) ?? 0;
    if (ca !== cb) return cb - ca;
    return a.name.localeCompare(b.name);
  });
  for (const m of sorted) {
    lines.push(
      csvRow([m.slug, m.name, m.subregion ?? "", counts.get(m.slug) ?? 0]),
    );
  }
  return lines.join("\n");
}

/**
 * Subregion-scope CSV: one row per MAPC subregion with its total count
 * and the number of member munis. Counts are computed the same way as
 * the on-screen aggregation — multi-subregion munis contribute to each
 * of their subregions (see countsBySubregion for the rationale).
 */
export function subregionRowsToCsv(
  counts: Map<string, number>,
): string {
  const header = ["subregion_slug", "acronym", "name", "muni_count", "count"];
  const lines: string[] = [csvRow(header)];
  const totals = countsBySubregion(counts);
  const sorted = [...SUBREGIONS].sort((a, b) => {
    const ca = totals.get(a.slug) ?? 0;
    const cb = totals.get(b.slug) ?? 0;
    if (ca !== cb) return cb - ca;
    return a.acronym.localeCompare(b.acronym);
  });
  for (const s of sorted) {
    lines.push(
      csvRow([
        s.slug,
        s.acronym,
        s.name,
        munisInSubregion(s.slug).size,
        totals.get(s.slug) ?? 0,
      ]),
    );
  }
  return lines.join("\n");
}

/** Trigger a browser download for a CSV string. */
export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
