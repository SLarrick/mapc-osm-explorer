/**
 * Hero dropdowns for Slice 2.
 *
 * The landing hero reads
 *   "I'm looking for data about [FEATURE ▾] in [MUNI ▾]."
 *
 * Feature picker is a native <select> (50ish options grouped by category
 * — the subregion "where is Wakefield?" problem doesn't apply, and a
 * native control gets keyboard + a11y for free).
 *
 * Muni picker is a custom combobox: with 101 munis grouped by MAPC
 * subregion, the native <select> worked but forced users to know which
 * subregion a muni lives in. The combobox lets you type the name and
 * still surfaces the subregion as secondary context in the list.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { SUBTYPES, type Subtype } from "../lib/taxonomy";
import type { MuniSummary } from "../lib/geo";
import {
  SUBREGIONS,
  getSubregionBySlug,
  subregionLabel,
} from "../lib/subregions";

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

interface MuniOption {
  slug: string;
  name: string;
  /** MAPC subregion names (shown as secondary context), or the tier
   *  sentinel ("Region-wide", "Subregion"). */
  subregion: string;
  /** Option kind — used to add visual dividers between tiers in the list
   *  (Region-wide → Subregions → Munis) without needing optgroup chrome. */
  tier: "region" | "subregion" | "muni";
}

/**
 * Display label for the current selection — "Entire MAPC region" for the
 * sentinel, a subregion's "Name (ACRONYM)" for a subregion slug, the
 * muni name for a real slug, or the placeholder prompt when nothing
 * is picked.
 */
function muniLabelFor(
  value: string | null,
  munis: MuniSummary[],
): string {
  if (!value) return "pick a place";
  if (value === MAPC_REGION_SLUG) return "Entire MAPC region";
  const sr = getSubregionBySlug(value);
  if (sr) return subregionLabel(sr);
  return munis.find((m) => m.slug === value)?.name ?? "pick a place";
}

export function MuniPicker({ munis, value, onChange }: MuniPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const rootRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Three tiers of scope, in geographic-zoom order:
  //   1. Entire MAPC region (101 munis)
  //   2. One of 8 MAPC subregions (e.g. Inner Core Committee — 21 munis)
  //   3. A single muni
  // The subregion tier is the MAPC-opinionated middle ground that makes
  // the tool useful for subregional planning work. We lean on the
  // subregion name as *context* for the muni tier ("where is this?")
  // so users don't have to know subregion membership up front.
  const options = useMemo<MuniOption[]>(() => {
    const regionOpt: MuniOption = {
      slug: MAPC_REGION_SLUG,
      name: "Entire MAPC region",
      subregion: "Region-wide",
      tier: "region",
    };
    const subregionOpts: MuniOption[] = SUBREGIONS.map((s) => ({
      slug: s.slug,
      name: subregionLabel(s),
      subregion: "Subregion",
      tier: "subregion",
    }));
    const muniOpts: MuniOption[] = munis
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((m) => ({
        slug: m.slug,
        name: m.name,
        subregion: m.subregion ?? "Other",
        tier: "muni",
      }));
    return [regionOpt, ...subregionOpts, ...muniOpts];
  }, [munis]);

  // Substring match on name + subregion. Case-insensitive, no fancy
  // fuzziness — users mostly know the start of the muni name.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.subregion.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Reset cursor when the filter changes so arrow keys don't point into
  // stale indexes.
  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  // Click-outside closes the panel. Mousedown (not click) so selecting a
  // list item via onMouseDown still wins — the outside handler sees the
  // picker is still the target.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // Autofocus the input + clear query when panel opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
      // Next tick so the input exists in the DOM.
      queueMicrotask(() => inputRef.current?.focus());
    }
  }, [open]);

  // Scroll the active row into view on arrow navigation.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const row = list.querySelector<HTMLLIElement>(
      `[data-idx="${activeIdx}"]`,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  function commit(slug: string) {
    onChange(slug);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[activeIdx];
      if (o) commit(o.slug);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  const label = muniLabelFor(value, munis);
  const isEmpty = !value;

  return (
    <span ref={rootRef} className="inline-block align-baseline relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Municipality"
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
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%230369a1' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E\")",
          backgroundPosition: "right 0.5rem center",
          backgroundRepeat: "no-repeat",
          backgroundSize: "0.9rem",
        }}
      >
        {label}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1 w-[320px] max-w-[90vw] bg-white rounded-md border border-slate-200 shadow-lg z-30 text-base"
          role="dialog"
        >
          <div className="p-2 border-b border-slate-100">
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type a municipality or subregion…"
              className="w-full px-2 py-1.5 text-sm rounded border border-slate-200 focus:outline-none focus:ring-1 focus:ring-sky-400 focus:border-sky-400 text-slate-900 placeholder:text-slate-400 italic"
              aria-autocomplete="list"
              aria-controls="muni-picker-list"
              aria-activedescendant={
                filtered[activeIdx]
                  ? `muni-opt-${filtered[activeIdx].slug}`
                  : undefined
              }
            />
          </div>
          <ul
            ref={listRef}
            id="muni-picker-list"
            role="listbox"
            className="max-h-72 overflow-auto py-1"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-slate-400 italic">
                No matches — try a different spelling?
              </li>
            ) : (
              filtered.map((o, i) => {
                const active = i === activeIdx;
                const selected = o.slug === value;
                const prev = filtered[i - 1];
                // Visual divider on tier transitions: region → subregion,
                // subregion → muni. Within a tier, no border.
                const tierChanged = prev && prev.tier !== o.tier;
                return (
                  <li
                    key={o.slug}
                    data-idx={i}
                    id={`muni-opt-${o.slug}`}
                    role="option"
                    aria-selected={selected}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(o.slug);
                    }}
                    onMouseEnter={() => setActiveIdx(i)}
                    className={
                      "px-3 py-1.5 text-sm cursor-pointer flex items-baseline gap-2 " +
                      (active ? "bg-sky-50 " : "") +
                      (selected ? "font-medium " : "") +
                      (tierChanged
                        ? "border-t border-slate-100 mt-1 pt-1.5 "
                        : "")
                    }
                  >
                    <span className="text-slate-900 flex-1 truncate">
                      {o.name}
                    </span>
                    {o.tier !== "region" && (
                      <span className="text-[11px] text-slate-400 truncate">
                        {o.tier === "subregion"
                          ? "Subregion"
                          : o.subregion}
                      </span>
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </span>
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
