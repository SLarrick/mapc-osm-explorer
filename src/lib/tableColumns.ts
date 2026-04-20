/**
 * Curated default table columns per category.
 *
 * --- Methodology (important — users can audit this) ---
 *
 * For each of the 12 MAPC OSM Explorer categories, we hand-pick a short
 * list of OSM tag keys to show as default table columns. The selection
 * is editorial, the same way the Census Bureau picks "featured variables"
 * for a topic — not AI-derived, not auto-ranked by fill-rate. A user who
 * wants to know what they're looking at can open this file and read the
 * list directly.
 *
 * Selection criteria, in priority order:
 *   1. Domain-useful attributes (the thing a planner would actually want
 *      to see — surface material for paths, operator for schools,
 *      building levels for buildings).
 *   2. Attributes with meaningful fill rate in the MAPC extract
 *      (verified against 2026-04 parquets).
 *   3. Attributes that distinguish rows from each other (so the table
 *      has information content beyond the name column).
 *
 * Administrative / provenance tags (`source`, `source:date`, `wikidata`,
 * `created_by`, `fixme`) are deliberately excluded from defaults. Users
 * who want them can add them via the column chooser.
 *
 * Universal columns (`osm_id`, `osm_type`, `name`, `geometry_type`) are
 * always present — not listed here.
 *
 * To change what users see by default, edit this file. To see a tag
 * that isn't listed here, use the column chooser in the Table view —
 * every tag key present in the current result set is available there,
 * with its fill rate shown.
 */

/**
 * Per-category default tag columns. Key = category slug from the
 * manifest; value = tag keys in the order they should appear after the
 * universal columns.
 */
export const DEFAULT_TAG_COLUMNS: Record<string, string[]> = {
  "parks-and-recreation": [
    "leisure",
    "access",
    "surface",
    "wheelchair",
    "opening_hours",
    "lit",
    "operator",
  ],
  "active-transportation": [
    "highway",
    "surface",
    "bicycle",
    "foot",
    "lit",
    "oneway",
    "covered",
  ],
  transit: [
    "highway",
    "railway",
    "public_transport",
    "network",
    "operator",
    "shelter",
    "wheelchair",
    "ref",
  ],
  "community-facilities": [
    "amenity",
    "operator",
    "wheelchair",
    "opening_hours",
    "religion",
    "denomination",
  ],
  "public-safety-and-health": [
    "amenity",
    "healthcare",
    "operator",
    "emergency",
    "wheelchair",
    "opening_hours",
  ],
  "food-access": [
    "amenity",
    "shop",
    "cuisine",
    "opening_hours",
    "wheelchair",
    "outdoor_seating",
    "takeaway",
  ],
  "civic-and-government": [
    "amenity",
    "operator",
    "government",
    "wheelchair",
    "opening_hours",
  ],
  streetscape: [
    "amenity",
    "highway",
    "covered",
    "bench",
    "lit",
    "material",
  ],
  "streets-and-roadways": [
    "highway",
    "surface",
    "maxspeed",
    "lanes",
    "oneway",
    "ref",
  ],
  "buildings-and-addresses": [
    "building",
    "building:levels",
    "roof:shape",
    "height",
    "addr:housenumber",
    "addr:street",
    "addr:postcode",
  ],
  "housing-and-land-use": [
    "landuse",
    "name",
    "operator",
  ],
  "natural-features-and-green-infrastructure": [
    "natural",
    "leaf_type",
    "leaf_cycle",
    "species",
    "water",
    "wetland",
  ],
};

/**
 * Return the ordered list of default tag keys for a category. Falls back
 * to empty array if the category slug is unknown — the table will then
 * show only the universal columns and the column chooser still works
 * (any tag present in the result set is addable).
 */
export function getDefaultTagColumns(categorySlug: string): string[] {
  return DEFAULT_TAG_COLUMNS[categorySlug] ?? [];
}
