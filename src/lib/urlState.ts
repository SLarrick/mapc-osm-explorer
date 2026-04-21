/**
 * URL state — sharable `?feature=…&muni=…&view=…` query strings.
 *
 * Scope (Slice 6, v1):
 *   - feature: subtype slug (e.g. "playgrounds")
 *   - muni:    muni slug (e.g. "salem"), or "mapc-region" for region scope
 *   - view:    "map" | "table" — omitted when "map" (the default)
 *
 * Deliberately out of scope:
 *   - active choropleth bin highlight (session state, not share state)
 *   - table column selection (session state; the user's override probably
 *     shouldn't override a recipient's defaults)
 *   - scope overrides (same reasoning)
 *
 * Implementation uses `history.replaceState` rather than `pushState` —
 * URL changes don't pollute browser history. The app provides its own
 * "← back to MAPC region" affordance; browser back goes to the actual
 * previous page. If we later want back/forward between app states, we
 * can add pushState + a popstate handler.
 */

export interface UrlState {
  feature: string | null;
  muni: string | null;
  view: "map" | "table";
}

const FEATURE_KEY = "feature";
const MUNI_KEY = "muni";
const VIEW_KEY = "view";

/** Read once at mount. Returns nulls when params are absent. */
export function readUrlState(): UrlState {
  if (typeof window === "undefined") {
    return { feature: null, muni: null, view: "map" };
  }
  const params = new URLSearchParams(window.location.search);
  const feature = params.get(FEATURE_KEY);
  const muni = params.get(MUNI_KEY);
  const viewRaw = params.get(VIEW_KEY);
  const view = viewRaw === "table" ? "table" : "map";
  return {
    feature: feature && feature.length > 0 ? feature : null,
    muni: muni && muni.length > 0 ? muni : null,
    view,
  };
}

/**
 * Write the current state to the URL via replaceState.
 *
 * Omits params that are at their default (null / "map") so the URL
 * stays clean when nothing is selected. Preserves any unknown params
 * already in the URL (e.g. Vercel analytics tokens) rather than nuking
 * them — we only overwrite our own keys.
 */
export function writeUrlState(state: UrlState): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const p = url.searchParams;

  if (state.feature) p.set(FEATURE_KEY, state.feature);
  else p.delete(FEATURE_KEY);

  if (state.muni) p.set(MUNI_KEY, state.muni);
  else p.delete(MUNI_KEY);

  if (state.view === "table") p.set(VIEW_KEY, "table");
  else p.delete(VIEW_KEY);

  const next = url.pathname + (p.toString() ? "?" + p.toString() : "") + url.hash;
  window.history.replaceState(null, "", next);
}
