/**
 * Hero dropdowns for Slice 2.
 *
 * The landing hero reads
 *   "I'm looking for data about [FEATURE ▾] in [MUNI ▾]."
 * Each bracketed token is a styled <select> — it looks like the dashed-border
 * pill we had when these were hardcoded, but it's a real native control
 * (so keyboard + screen readers work for free).
 *
 * Manifest categories are used only as optgroup headers in the feature
 * picker; the selected value is still a subtype slug. Munis are grouped
 * by MAPC sub-region when that's available.
 */
import { useMemo } from "react";
import { SUBTYPES, type Subtype } from "../lib/taxonomy";
import type { MuniSummary } from "../lib/geo";

interface Category {
  slug: string;
  label: string;
}

interface FeaturePickerProps {
  /** Manifest categories, ordered for display. */
  categories: Category[];
  value: string | null;
  onChange: (subtypeSlug: string) => void;
}

export function FeaturePicker({
  categories,
  value,
  onChange,
}: FeaturePickerProps) {
  // Group subtypes by category, preserving the manifest's category order.
  const grouped = useMemo(() => {
    const byCat: Record<string, Subtype[]> = {};
    for (const s of SUBTYPES) {
      if (!byCat[s.categorySlug]) byCat[s.categorySlug] = [];
      byCat[s.categorySlug].push(s);
    }
    return categories
      .map((c) => ({
        label: c.label,
        subtypes: byCat[c.slug] ?? [],
      }))
      .filter((g) => g.subtypes.length > 0);
  }, [categories]);

  return (
    <PillSelect value={value ?? ""} onChange={onChange} ariaLabel="Feature type">
      <option value="" disabled>
        pick a feature
      </option>
      {grouped.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.subtypes.map((s) => (
            <option key={s.slug} value={s.slug}>
              {s.label.toLowerCase()}
            </option>
          ))}
        </optgroup>
      ))}
    </PillSelect>
  );
}

interface MuniPickerProps {
  munis: MuniSummary[];
  value: string | null;
  onChange: (muniSlug: string) => void;
}

export function MuniPicker({ munis, value, onChange }: MuniPickerProps) {
  // Group by MAPC sub-region when present, alphabetize within each group.
  const grouped = useMemo(() => {
    const byRegion: Record<string, MuniSummary[]> = {};
    for (const m of munis) {
      const key = m.subregion ?? "Other";
      if (!byRegion[key]) byRegion[key] = [];
      byRegion[key].push(m);
    }
    const regions = Object.keys(byRegion).sort((a, b) => a.localeCompare(b));
    return regions.map((r) => ({
      label: r,
      items: byRegion[r].sort((a, b) => a.name.localeCompare(b.name)),
    }));
  }, [munis]);

  return (
    <PillSelect value={value ?? ""} onChange={onChange} ariaLabel="Municipality">
      <option value="" disabled>
        pick a place
      </option>
      {/* Region-wide option sits in its own optgroup at the top, above the
          sub-region groups. Native <select> can't render a visual divider,
          but the solo-group position and "Entire MAPC region" phrasing
          read as a distinct tier from the 101 individual munis. */}
      <optgroup label="Region-wide">
        <option value={MAPC_REGION_SLUG}>Entire MAPC region</option>
      </optgroup>
      {grouped.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.items.map((m) => (
            <option key={m.slug} value={m.slug}>
              {m.name}
            </option>
          ))}
        </optgroup>
      ))}
    </PillSelect>
  );
}

/**
 * Sentinel slug for "whole MAPC region" in the muni dropdown. Using a
 * sentinel rather than a separate state keeps the dropdown as the single
 * source of truth for the geography selection. Callers branch on it to
 * drive the region-wide query path (see App.tsx / queries.ts).
 */
export const MAPC_REGION_SLUG = "mapc-region";

/**
 * The dashed sky-blue pill as a real <select>. We keep the native arrow
 * glyph in Safari/Firefox by *not* appearance-none-ing; the existing
 * design already leans casual so the platform arrow looks fine.
 */
function PillSelect({
  value,
  onChange,
  children,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  ariaLabel: string;
}) {
  const isEmpty = value === "";
  return (
    <span className="inline-block align-baseline">
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={
          "px-3 py-1 rounded-md border border-dashed bg-sky-50 " +
          "text-2xl md:text-3xl font-semibold tracking-tight " +
          "focus:outline-none focus:ring-2 focus:ring-sky-400 " +
          "cursor-pointer appearance-none pr-7 " +
          (isEmpty
            ? "border-sky-400 text-sky-600/70 italic "
            : "border-sky-500 text-sky-700 ")
        }
        style={{
          // Custom chevron on the right; doesn't depend on Tailwind's
          // arbitrary-values and keeps sizing consistent across browsers.
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%230369a1' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")",
          backgroundPosition: "right 0.5rem center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "0.9rem",
        }}
      >
        {children}
      </select>
    </span>
  );
}
