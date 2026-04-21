/**
 * Coverage caveat — the honesty line attached to every query result.
 *
 * Why: OSM is crowdsourced, and the count you see is always "features
 * someone has mapped" rather than "features that exist." This gap is
 * largest for less-mapped feature types ("spotty" tier) and in
 * less-urban municipalities where there are fewer contributors.
 *
 * The caveat was previously only shown pre-query, above the Find
 * button, and only for "spotty" tier features in region mode. That was
 * the wrong time (the user has moved past it when they're staring at
 * results) and the wrong scope (a partial-tier feature in Ipswich can
 * be just as undercounted as a spotty one).
 *
 * Now:
 *   - always shown post-query, attached to the result line;
 *   - tiered copy (spotty > partial > high-gets-nothing);
 *   - available in both region and focused modes.
 */
import type { CompletenessTier } from "../lib/taxonomy";

interface Props {
  tier: CompletenessTier;
  /** Plural feature label, e.g. "cafes" — lowercased for inline use. */
  subtypeLabel: string;
  /** Muni display name, if we're in focused mode. Region mode passes null. */
  muniName: string | null;
  /** Optional extra Tailwind classes (e.g. text alignment). */
  className?: string;
}

export function CoverageCaveat(props: Props) {
  const { tier, subtypeLabel, muniName, className } = props;
  if (tier === "high") return null;

  const feature = subtypeLabel.toLowerCase();
  const place = muniName ?? "the MAPC region";

  const message =
    tier === "spotty"
      ? muniName
        ? `OSM coverage of ${feature} is uneven. What's mapped here is real, but likely a small fraction of the actual ${feature} in ${place}.`
        : `OSM coverage of ${feature} is uneven. The pattern here reflects where mapping has happened more than where ${feature} actually exist.`
      : // partial
        muniName
        ? `This shows what's been mapped in OpenStreetMap. Actual counts — especially in less-urban places — are often higher than what appears here.`
        : `Counts reflect what's been mapped in OpenStreetMap. Less-urban munis often have lower mapped counts than reality.`;

  return (
    <span
      className={
        "text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 " +
        (className ?? "")
      }
    >
      <span aria-hidden className="mr-1">⚠</span>
      {message}
    </span>
  );
}
