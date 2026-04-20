/**
 * Curated MVP taxonomy of "features" the user can ask for.
 *
 * The manifest (public/data/_manifest.json) gives us 12 broad categories —
 * one parquet each. That granularity is too coarse for the UX: asking for
 * "Parks & Recreation in Salem" returns a grab-bag of playgrounds, benches,
 * courts, trails, etc. So we introduce a second level — "subtype" — which
 * maps each user-facing feature (playgrounds, libraries, …) to
 *   (category parquet, tag filter inside that parquet).
 *
 * The subtype list is hand-picked for MVP demo purposes — 2–3 per category,
 * weighted toward the ones we actually want to show off. We'll expand this
 * over time, and eventually add an "advanced" mode that exposes raw
 * category + tag-key/value filters.
 *
 * Keep this flat (not nested): the UI groups by category via `optgroup`,
 * but we want a stable global slug namespace so URLs like `?feature=playgrounds`
 * work regardless of which category owns them.
 */

export type TagFilter =
  | { kind: "eq"; key: string; values: string[] }
  | { kind: "present"; key: string };

/**
 * Hand-curated estimate of how complete OSM's coverage of this feature
 * type is across the MAPC region. Used to:
 *   - pick a default rendering strategy at regional scale (raw vs
 *     choropleth vs "where-has-mapping-happened?")
 *   - decide whether to surface a prominent coverage caveat
 *
 * "high"    — authoritative sources (MassGIS imports, DESE rosters, etc.)
 *             or feature type important enough that mappers keep it current
 * "partial" — substantial but uneven; enough signal to be useful with caveat
 * "spotty"  — mapping effort is the dominant signal; treat counts as
 *             "where has mapping happened?" rather than ground truth
 */
export type CompletenessTier = "high" | "partial" | "spotty";

export interface Subtype {
  /** Globally unique user-facing slug, e.g. "playgrounds". */
  slug: string;
  /** Display label, e.g. "Playgrounds". */
  label: string;
  /** Which parquet this filter runs against — matches manifest category slug. */
  categorySlug: string;
  /** Predicate on the parquet's `tags` JSON column. */
  filter: TagFilter;
  /** Rough OSM-completeness tier. First-draft hand-curated; refine over time. */
  completeness: CompletenessTier;
}

/**
 * MVP subtype taxonomy. Tag filters follow OSM conventions; we'll tighten
 * (or loosen) them based on what actually shows up in each parquet once we
 * do data-eyes review.
 */
export const SUBTYPES: Subtype[] = [
  // Public Safety & Health
  {
    slug: "hospitals",
    label: "Hospitals",
    categorySlug: "public-safety-and-health",
    filter: { kind: "eq", key: "amenity", values: ["hospital"] },
    completeness: "high",
  },
  {
    slug: "fire-stations",
    label: "Fire stations",
    categorySlug: "public-safety-and-health",
    filter: { kind: "eq", key: "amenity", values: ["fire_station"] },
    completeness: "high",
  },
  {
    slug: "police-stations",
    label: "Police stations",
    categorySlug: "public-safety-and-health",
    filter: { kind: "eq", key: "amenity", values: ["police"] },
    completeness: "high",
  },

  // Transit
  {
    slug: "bus-stops",
    label: "Bus stops",
    categorySlug: "transit",
    filter: { kind: "eq", key: "highway", values: ["bus_stop"] },
    completeness: "high",
  },
  {
    slug: "train-stations",
    label: "Train stations",
    categorySlug: "transit",
    filter: { kind: "eq", key: "railway", values: ["station", "halt"] },
    completeness: "high",
  },
  {
    slug: "subway-stations",
    label: "Subway stations",
    categorySlug: "transit",
    filter: { kind: "eq", key: "station", values: ["subway"] },
    completeness: "high",
  },

  // Food Access
  {
    slug: "supermarkets",
    label: "Supermarkets",
    categorySlug: "food-access",
    filter: { kind: "eq", key: "shop", values: ["supermarket"] },
    completeness: "partial",
  },
  {
    slug: "restaurants",
    label: "Restaurants",
    categorySlug: "food-access",
    filter: { kind: "eq", key: "amenity", values: ["restaurant"] },
    completeness: "partial",
  },
  {
    slug: "cafes",
    label: "Cafés",
    categorySlug: "food-access",
    filter: { kind: "eq", key: "amenity", values: ["cafe"] },
    completeness: "partial",
  },

  // Civic & Government
  {
    slug: "town-halls",
    label: "Town halls",
    categorySlug: "civic-and-government",
    filter: { kind: "eq", key: "amenity", values: ["townhall"] },
    completeness: "high",
  },
  {
    // Libraries live in the community-facilities parquet, not civic-and-government
    // (confirmed by ETL audit 2026-04: civic has 0 amenity=library rows, community
    // has 423). Slug kept as "libraries" for URL stability.
    slug: "libraries",
    label: "Libraries",
    categorySlug: "community-facilities",
    filter: { kind: "eq", key: "amenity", values: ["library"] },
    completeness: "high",
  },
  {
    slug: "post-offices",
    label: "Post offices",
    categorySlug: "civic-and-government",
    filter: { kind: "eq", key: "amenity", values: ["post_office"] },
    completeness: "high",
  },

  // Community Facilities
  {
    slug: "schools",
    label: "Schools",
    categorySlug: "community-facilities",
    filter: {
      kind: "eq",
      key: "amenity",
      values: ["school", "kindergarten"],
    },
    completeness: "high",
  },
  {
    slug: "places-of-worship",
    label: "Places of worship",
    categorySlug: "community-facilities",
    filter: { kind: "eq", key: "amenity", values: ["place_of_worship"] },
    completeness: "partial",
  },
  {
    slug: "community-centers",
    label: "Community centers",
    categorySlug: "community-facilities",
    filter: { kind: "eq", key: "amenity", values: ["community_centre"] },
    completeness: "partial",
  },

  // Parks & Recreation
  {
    slug: "playgrounds",
    label: "Playgrounds",
    categorySlug: "parks-and-recreation",
    filter: { kind: "eq", key: "leisure", values: ["playground"] },
    completeness: "partial",
  },
  {
    slug: "parks",
    label: "Parks",
    categorySlug: "parks-and-recreation",
    filter: {
      kind: "eq",
      key: "leisure",
      values: ["park", "nature_reserve"],
    },
    completeness: "high",
  },
  {
    slug: "sports-fields",
    label: "Sports fields",
    categorySlug: "parks-and-recreation",
    filter: { kind: "eq", key: "leisure", values: ["pitch"] },
    completeness: "partial",
  },

  // Active Transportation
  {
    slug: "bike-paths",
    label: "Bike paths",
    categorySlug: "active-transportation",
    filter: { kind: "eq", key: "highway", values: ["cycleway"] },
    completeness: "partial",
  },
  {
    slug: "footpaths",
    label: "Footpaths",
    categorySlug: "active-transportation",
    filter: { kind: "eq", key: "highway", values: ["footway"] },
    completeness: "partial",
  },
  {
    slug: "trails",
    label: "Trails",
    categorySlug: "active-transportation",
    filter: { kind: "eq", key: "highway", values: ["path"] },
    completeness: "partial",
  },

  // Streetscape
  {
    slug: "benches",
    label: "Benches",
    categorySlug: "streetscape",
    filter: { kind: "eq", key: "amenity", values: ["bench"] },
    completeness: "spotty",
  },
  {
    // amenity=bicycle_parking lives in the active-transportation parquet
    // (3683 rows), not streetscape (0 rows) — the ETL bundles it with
    // other bike-network infrastructure. Confirmed by audit 2026-04.
    slug: "bike-parking",
    label: "Bike parking",
    categorySlug: "active-transportation",
    filter: { kind: "eq", key: "amenity", values: ["bicycle_parking"] },
    completeness: "spotty",
  },
  // "street-trees" removed: the OSM tag `natural=tree` covers *all* mapped
  // trees (not specifically street trees), and those 34k features live in
  // the natural-features parquet, not streetscape. Re-surfaced as "Trees"
  // under Natural Features below. See ETL audit 2026-04.

  // Natural Features & Green Infrastructure
  {
    slug: "water-bodies",
    label: "Water bodies",
    categorySlug: "natural-features-and-green-infrastructure",
    filter: { kind: "eq", key: "natural", values: ["water"] },
    completeness: "high",
  },
  {
    slug: "forests",
    label: "Forests",
    categorySlug: "natural-features-and-green-infrastructure",
    filter: { kind: "eq", key: "natural", values: ["wood"] },
    completeness: "high",
  },
  {
    slug: "wetlands",
    label: "Wetlands",
    categorySlug: "natural-features-and-green-infrastructure",
    filter: { kind: "eq", key: "natural", values: ["wetland"] },
    completeness: "high",
  },
  {
    // OSM `natural=tree` — any individually-mapped tree, which in MAPC
    // skews heavily to a few munis where volunteer tree-mapping happened
    // (Cambridge, Somerville). Honest framing is "where tree-mapping has
    // happened," not "where trees are" — hence tier-3 completeness.
    slug: "trees",
    label: "Trees",
    categorySlug: "natural-features-and-green-infrastructure",
    filter: { kind: "eq", key: "natural", values: ["tree"] },
    completeness: "spotty",
  },

  // Streets & Roadways
  {
    slug: "primary-roads",
    label: "Primary roads",
    categorySlug: "streets-and-roadways",
    filter: { kind: "eq", key: "highway", values: ["primary", "trunk"] },
    completeness: "high",
  },
  {
    slug: "residential-streets",
    label: "Residential streets",
    categorySlug: "streets-and-roadways",
    filter: { kind: "eq", key: "highway", values: ["residential"] },
    completeness: "high",
  },
  {
    slug: "highways",
    label: "Highways",
    categorySlug: "streets-and-roadways",
    filter: { kind: "eq", key: "highway", values: ["motorway"] },
    completeness: "high",
  },

  // Housing & Land Use
  {
    slug: "residential-land",
    label: "Residential land",
    categorySlug: "housing-and-land-use",
    filter: { kind: "eq", key: "landuse", values: ["residential"] },
    completeness: "high",
  },
  {
    slug: "commercial-land",
    label: "Commercial land",
    categorySlug: "housing-and-land-use",
    filter: { kind: "eq", key: "landuse", values: ["commercial", "retail"] },
    completeness: "high",
  },
  {
    slug: "industrial-land",
    label: "Industrial land",
    categorySlug: "housing-and-land-use",
    filter: { kind: "eq", key: "landuse", values: ["industrial"] },
    completeness: "high",
  },

  // Buildings & Addresses
  {
    slug: "all-buildings",
    label: "All buildings",
    categorySlug: "buildings-and-addresses",
    filter: { kind: "present", key: "building" },
    completeness: "high",
  },
  // "addresses" removed: `addr:housenumber` is a data-completeness artifact,
  // not a feature type. Addresses are an attribute of other features (mostly
  // buildings). The MassGIS import gives us ~780k rows — meaningful as a
  // *coverage check*, not as a "show me a thing" answer. If we surface it
  // later, it'll be a quality-of-data view, not a feature subtype.
];

export function getSubtypeBySlug(slug: string): Subtype | null {
  return SUBTYPES.find((s) => s.slug === slug) ?? null;
}

/**
 * Build the SQL WHERE clause fragment for a subtype's tag filter. Matches
 * rows in the parquet where `tags` (a JSON string column) satisfies the
 * filter. Uses DuckDB's `json_extract_string`.
 */
export function filterToSql(filter: TagFilter): string {
  const key = filter.key.replace(/'/g, "''"); // basic quoting
  if (filter.kind === "present") {
    return `json_extract_string(tags, '$.${key}') IS NOT NULL`;
  }
  const values = filter.values.map((v) => `'${v.replace(/'/g, "''")}'`);
  return `json_extract_string(tags, '$.${key}') IN (${values.join(", ")})`;
}
