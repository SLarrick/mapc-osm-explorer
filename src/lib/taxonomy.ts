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

export interface Subtype {
  /** Globally unique user-facing slug, e.g. "playgrounds". */
  slug: string;
  /** Display label, e.g. "Playgrounds". */
  label: string;
  /** Which parquet this filter runs against — matches manifest category slug. */
  categorySlug: string;
  /** Predicate on the parquet's `tags` JSON column. */
  filter: TagFilter;
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
  },
  {
    slug: "fire-stations",
    label: "Fire stations",
    categorySlug: "public-safety-and-health",
    filter: { kind: "eq", key: "amenity", values: ["fire_station"] },
  },
  {
    slug: "police-stations",
    label: "Police stations",
    categorySlug: "public-safety-and-health",
    filter: { kind: "eq", key: "amenity", values: ["police"] },
  },

  // Transit
  {
    slug: "bus-stops",
    label: "Bus stops",
    categorySlug: "transit",
    filter: { kind: "eq", key: "highway", values: ["bus_stop"] },
  },
  {
    slug: "train-stations",
    label: "Train stations",
    categorySlug: "transit",
    filter: { kind: "eq", key: "railway", values: ["station", "halt"] },
  },
  {
    slug: "subway-stations",
    label: "Subway stations",
    categorySlug: "transit",
    filter: { kind: "eq", key: "station", values: ["subway"] },
  },

  // Food Access
  {
    slug: "supermarkets",
    label: "Supermarkets",
    categorySlug: "food-access",
    filter: { kind: "eq", key: "shop", values: ["supermarket"] },
  },
  {
    slug: "restaurants",
    label: "Restaurants",
    categorySlug: "food-access",
    filter: { kind: "eq", key: "amenity", values: ["restaurant"] },
  },
  {
    slug: "cafes",
    label: "Cafés",
    categorySlug: "food-access",
    filter: { kind: "eq", key: "amenity", values: ["cafe"] },
  },

  // Civic & Government
  {
    slug: "town-halls",
    label: "Town halls",
    categorySlug: "civic-and-government",
    filter: { kind: "eq", key: "amenity", values: ["townhall"] },
  },
  {
    slug: "libraries",
    label: "Libraries",
    categorySlug: "civic-and-government",
    filter: { kind: "eq", key: "amenity", values: ["library"] },
  },
  {
    slug: "post-offices",
    label: "Post offices",
    categorySlug: "civic-and-government",
    filter: { kind: "eq", key: "amenity", values: ["post_office"] },
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
  },
  {
    slug: "places-of-worship",
    label: "Places of worship",
    categorySlug: "community-facilities",
    filter: { kind: "eq", key: "amenity", values: ["place_of_worship"] },
  },
  {
    slug: "community-centers",
    label: "Community centers",
    categorySlug: "community-facilities",
    filter: { kind: "eq", key: "amenity", values: ["community_centre"] },
  },

  // Parks & Recreation
  {
    slug: "playgrounds",
    label: "Playgrounds",
    categorySlug: "parks-and-recreation",
    filter: { kind: "eq", key: "leisure", values: ["playground"] },
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
  },
  {
    slug: "sports-fields",
    label: "Sports fields",
    categorySlug: "parks-and-recreation",
    filter: { kind: "eq", key: "leisure", values: ["pitch"] },
  },

  // Active Transportation
  {
    slug: "bike-paths",
    label: "Bike paths",
    categorySlug: "active-transportation",
    filter: { kind: "eq", key: "highway", values: ["cycleway"] },
  },
  {
    slug: "footpaths",
    label: "Footpaths",
    categorySlug: "active-transportation",
    filter: { kind: "eq", key: "highway", values: ["footway"] },
  },
  {
    slug: "trails",
    label: "Trails",
    categorySlug: "active-transportation",
    filter: { kind: "eq", key: "highway", values: ["path"] },
  },

  // Streetscape
  {
    slug: "benches",
    label: "Benches",
    categorySlug: "streetscape",
    filter: { kind: "eq", key: "amenity", values: ["bench"] },
  },
  {
    slug: "bike-parking",
    label: "Bike parking",
    categorySlug: "streetscape",
    filter: { kind: "eq", key: "amenity", values: ["bicycle_parking"] },
  },
  {
    slug: "street-trees",
    label: "Street trees",
    categorySlug: "streetscape",
    filter: { kind: "eq", key: "natural", values: ["tree"] },
  },

  // Natural Features & Green Infrastructure
  {
    slug: "water-bodies",
    label: "Water bodies",
    categorySlug: "natural-features-and-green-infrastructure",
    filter: { kind: "eq", key: "natural", values: ["water"] },
  },
  {
    slug: "forests",
    label: "Forests",
    categorySlug: "natural-features-and-green-infrastructure",
    filter: { kind: "eq", key: "natural", values: ["wood"] },
  },
  {
    slug: "wetlands",
    label: "Wetlands",
    categorySlug: "natural-features-and-green-infrastructure",
    filter: { kind: "eq", key: "natural", values: ["wetland"] },
  },

  // Streets & Roadways
  {
    slug: "primary-roads",
    label: "Primary roads",
    categorySlug: "streets-and-roadways",
    filter: { kind: "eq", key: "highway", values: ["primary", "trunk"] },
  },
  {
    slug: "residential-streets",
    label: "Residential streets",
    categorySlug: "streets-and-roadways",
    filter: { kind: "eq", key: "highway", values: ["residential"] },
  },
  {
    slug: "highways",
    label: "Highways",
    categorySlug: "streets-and-roadways",
    filter: { kind: "eq", key: "highway", values: ["motorway"] },
  },

  // Housing & Land Use
  {
    slug: "residential-land",
    label: "Residential land",
    categorySlug: "housing-and-land-use",
    filter: { kind: "eq", key: "landuse", values: ["residential"] },
  },
  {
    slug: "commercial-land",
    label: "Commercial land",
    categorySlug: "housing-and-land-use",
    filter: { kind: "eq", key: "landuse", values: ["commercial", "retail"] },
  },
  {
    slug: "industrial-land",
    label: "Industrial land",
    categorySlug: "housing-and-land-use",
    filter: { kind: "eq", key: "landuse", values: ["industrial"] },
  },

  // Buildings & Addresses
  {
    slug: "all-buildings",
    label: "All buildings",
    categorySlug: "buildings-and-addresses",
    filter: { kind: "present", key: "building" },
  },
  {
    slug: "addresses",
    label: "Addresses",
    categorySlug: "buildings-and-addresses",
    filter: { kind: "present", key: "addr:housenumber" },
  },
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
