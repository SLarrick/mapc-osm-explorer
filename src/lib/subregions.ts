/**
 * MAPC subregions — the 8 sub-regional planning districts that organize
 * MAPC's work below the full-region scale.
 *
 * Data source: MAPC subregion assignments CSV (2026-04). Four munis sit
 * in two subregions (Dover, Milton, Needham, Sherborn) — the canonical
 * record allows membership in multiple districts and we preserve that
 * here as an array. When we render a subregion on the map or compute
 * subregion totals, these munis contribute to each of their subregions.
 *
 * Slug convention: each subregion uses its official MAPC acronym,
 * lowercased (icc, magic, mwrc, nspc, nstf, ssc, swap, tric). The
 * acronyms don't collide with any MAPC muni slug or the "mapc-region"
 * sentinel, so they share the `muni` URL-state key without namespacing.
 *
 * Muni slug convention: uppercase CSV name → lowercase with spaces
 * collapsed to hyphens. Manchester-By-The-Sea stays hyphenated.
 */
export interface Subregion {
  /** URL-safe id, matches the acronym lowercased. */
  slug: string;
  /** Official MAPC acronym (ICC, MAGIC, NSTF, …). */
  acronym: string;
  /** Expanded district name. */
  name: string;
}

export const SUBREGIONS: Subregion[] = [
  { slug: "icc", acronym: "ICC", name: "Inner Core Committee" },
  {
    slug: "magic",
    acronym: "MAGIC",
    name: "Minuteman Advisory Group on Interlocal Coordination",
  },
  {
    slug: "mwrc",
    acronym: "MWRC",
    name: "MetroWest Regional Collaborative",
  },
  {
    slug: "nspc",
    acronym: "NSPC",
    name: "North Suburban Planning Council",
  },
  { slug: "nstf", acronym: "NSTF", name: "North Shore Task Force" },
  { slug: "ssc", acronym: "SSC", name: "South Shore Coalition" },
  {
    slug: "swap",
    acronym: "SWAP",
    name: "SouthWest Advisory Planning Committee",
  },
  {
    slug: "tric",
    acronym: "TRIC",
    name: "Three Rivers Interlocal Council",
  },
];

const SUBREGION_BY_SLUG = new Map(SUBREGIONS.map((s) => [s.slug, s]));
const SUBREGION_SLUGS = new Set(SUBREGIONS.map((s) => s.slug));

export function getSubregionBySlug(slug: string): Subregion | null {
  return SUBREGION_BY_SLUG.get(slug) ?? null;
}

export function isSubregionSlug(slug: string | null): boolean {
  return slug !== null && SUBREGION_SLUGS.has(slug);
}

/**
 * Display label: "Inner Core Committee (ICC)". Used in pickers, the
 * hero summary line, and the Summary tab headline.
 */
export function subregionLabel(s: Subregion): string {
  return `${s.name} (${s.acronym})`;
}

/**
 * Muni slug → subregion acronyms. Derived directly from the source CSV;
 * see docs at the top of this file for the slug normalization rule.
 *
 * Ordering of the array matters for the 4 multi-subregion munis only
 * when we need a "primary" subregion for tie-breaking in a choropleth
 * context (we use the first-listed). Everything else iterates without
 * caring about order.
 */
const MUNI_TO_SUBREGIONS: Record<string, string[]> = {
  acton: ["magic"],
  arlington: ["icc"],
  ashland: ["mwrc"],
  bedford: ["magic"],
  bellingham: ["swap"],
  belmont: ["icc"],
  beverly: ["nstf"],
  bolton: ["magic"],
  boston: ["icc"],
  boxborough: ["magic"],
  braintree: ["ssc"],
  brookline: ["icc"],
  burlington: ["nspc"],
  cambridge: ["icc"],
  canton: ["tric"],
  carlisle: ["magic"],
  chelsea: ["icc"],
  cohasset: ["ssc"],
  concord: ["magic"],
  danvers: ["nstf"],
  dedham: ["tric"],
  dover: ["swap", "tric"],
  duxbury: ["ssc"],
  essex: ["nstf"],
  everett: ["icc"],
  foxborough: ["tric"],
  framingham: ["mwrc"],
  franklin: ["swap"],
  gloucester: ["nstf"],
  hamilton: ["nstf"],
  hanover: ["ssc"],
  hingham: ["ssc"],
  holbrook: ["ssc"],
  holliston: ["mwrc"],
  hopkinton: ["swap"],
  hudson: ["magic"],
  hull: ["ssc"],
  ipswich: ["nstf"],
  lexington: ["magic"],
  lincoln: ["magic"],
  littleton: ["magic"],
  lynn: ["icc"],
  lynnfield: ["nspc"],
  malden: ["icc"],
  "manchester-by-the-sea": ["nstf"],
  marblehead: ["nstf"],
  marlborough: ["mwrc"],
  marshfield: ["ssc"],
  maynard: ["magic"],
  medfield: ["tric"],
  medford: ["icc"],
  medway: ["swap"],
  melrose: ["icc"],
  middleton: ["nstf"],
  milford: ["swap"],
  millis: ["swap"],
  milton: ["icc", "tric"],
  nahant: ["nstf"],
  natick: ["mwrc"],
  needham: ["icc", "tric"],
  newton: ["icc"],
  norfolk: ["swap"],
  "north-reading": ["nspc"],
  norwell: ["ssc"],
  norwood: ["tric"],
  peabody: ["nstf"],
  pembroke: ["ssc"],
  quincy: ["icc"],
  randolph: ["tric"],
  reading: ["nspc"],
  revere: ["icc"],
  rockland: ["ssc"],
  rockport: ["nstf"],
  salem: ["nstf"],
  saugus: ["icc"],
  scituate: ["ssc"],
  sharon: ["tric"],
  sherborn: ["mwrc", "swap"],
  somerville: ["icc"],
  southborough: ["mwrc"],
  stoneham: ["nspc"],
  stoughton: ["tric"],
  stow: ["magic"],
  sudbury: ["magic"],
  swampscott: ["nstf"],
  topsfield: ["nstf"],
  wakefield: ["nspc"],
  walpole: ["tric"],
  waltham: ["icc"],
  watertown: ["icc"],
  wayland: ["mwrc"],
  wellesley: ["mwrc"],
  wenham: ["nstf"],
  weston: ["mwrc"],
  westwood: ["tric"],
  weymouth: ["ssc"],
  wilmington: ["nspc"],
  winchester: ["nspc"],
  winthrop: ["icc"],
  woburn: ["nspc"],
  wrentham: ["swap"],
};

/**
 * Return the subregion slugs a muni belongs to (may be 0 if the muni
 * isn't in our mapping — tolerate gracefully — or 2 for multi-district
 * munis).
 */
export function subregionsForMuni(muniSlug: string): string[] {
  return MUNI_TO_SUBREGIONS[muniSlug] ?? [];
}

/**
 * All muni slugs that belong to a subregion. Used for:
 *   - filtering region query results to a subregion scope
 *   - computing the bounds of a subregion (union of muni bboxes)
 *   - the "top munis within subregion" breakdown in Summary
 */
export function munisInSubregion(subregionSlug: string): Set<string> {
  const out = new Set<string>();
  for (const [muni, subs] of Object.entries(MUNI_TO_SUBREGIONS)) {
    if (subs.includes(subregionSlug)) out.add(muni);
  }
  return out;
}

/**
 * Total-per-subregion counts from a per-muni count map.
 * Multi-subregion munis contribute to each of their subregions — a
 * deliberate choice: the dual-assignment is substantive (Dover works
 * with both SWAP and TRIC planners), and a subregion's feature count
 * should reflect the full set of munis it serves.
 */
export function countsBySubregion(
  countsByMuni: Map<string, number>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of SUBREGIONS) out.set(s.slug, 0);
  for (const [muni, count] of countsByMuni) {
    const subs = MUNI_TO_SUBREGIONS[muni];
    if (!subs) continue;
    for (const sr of subs) {
      out.set(sr, (out.get(sr) ?? 0) + count);
    }
  }
  return out;
}
