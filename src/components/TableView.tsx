/**
 * Slice 5 — TanStack-Table-backed tabular view.
 *
 * Two scopes:
 *   - "feature" — one row per feature (name, osm_id, osm_type,
 *     geometry_type, + curated tag columns). Virtualized scroll so ~25k
 *     rows stays smooth. Row click mirrors the map's feature selection.
 *   - "muni"    — one row per municipality with the feature count for
 *     the current region query. Shown only when a region query is
 *     active; row click drives onSelectMuni (same as clicking the map).
 *
 * Default scope is driven from outside: the Map's choropleth-on state
 * maps to "muni" default, choropleth-off to "feature" default. The
 * user can override via the segmented control — after an override we
 * hold that choice until the user's own action changes it again.
 *
 * Column defaults come from src/lib/tableColumns.ts (hand-curated per
 * category, auditable in that single file). The column chooser lets
 * the user add any tag key present in the current result set — each
 * shown with its fill rate. A "hide columns below X%" filter further
 * trims the view.
 *
 * Fill rate is always scoped to the current result set, not global —
 * "62% of *Salem's* playgrounds have a surface tag" is what a user
 * actually cares about.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { ResultFeature } from "../lib/queries";
import type { MuniSummary } from "../lib/geo";
import { getDefaultTagColumns } from "../lib/tableColumns";
import {
  downloadCsv,
  featureRowsToCsv,
  muniRowsToCsv,
} from "../lib/csvExport";

export type TableScope = "feature" | "muni";

interface Props {
  /** Feature rows for the current query. Empty or null when there's no
   *  query yet, or when the region count exceeded the render threshold. */
  features: ResultFeature[] | null;
  /** Feature count per muni slug, for the muni-aggregate scope. Only
   *  non-null for region-wide queries. */
  countsByMuni: Map<string, number> | null;
  /** All MAPC munis — used to label rows in muni-scope and to include
   *  zero-count munis in the table. */
  munis: MuniSummary[];
  /** Category slug of the active subtype (picks the default tag columns). */
  categorySlug: string | null;
  /** Label used in the header, e.g. "Playgrounds". */
  subtypeLabel: string | null;
  /** Currently selected feature id, for row highlighting. */
  selectedId: string | null;
  onSelectFeature: (id: string | null) => void;
  onSelectMuni: (slug: string) => void;
  /** Current scope (controlled). */
  scope: TableScope;
  onScopeChange: (scope: TableScope) => void;
  /** True when both scopes are available (region query with renderable
   *  features). False in focused mode or when we only have a count. */
  canToggleScope: boolean;
}

// ---- Feature-scope columns ----------------------------------------------

type FeatureRow = {
  id: string;
  name: string;
  muni_name: string;
  osm_id: number;
  osm_type: string;
  geometry_type: string;
  tags: Record<string, string>;
};

function toFeatureRow(f: ResultFeature): FeatureRow {
  return {
    id: f.id,
    name: f.properties.name ?? "",
    muni_name: f.properties.muni_name ?? "—",
    osm_id: f.properties.osm_id,
    osm_type: f.properties.osm_type,
    geometry_type: f.geometry?.type ?? "—",
    tags: f.properties.tags ?? {},
  };
}

/** Compute fill rate (% non-empty) for each tag key across a set of rows. */
function computeFillRates(
  rows: FeatureRow[],
  tagKeys: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (rows.length === 0) {
    for (const k of tagKeys) out.set(k, 0);
    return out;
  }
  for (const k of tagKeys) {
    let filled = 0;
    for (const r of rows) {
      const v = r.tags[k];
      if (v !== undefined && v !== null && v !== "") filled++;
    }
    out.set(k, (filled / rows.length) * 100);
  }
  return out;
}

/** Union of tag keys that appear in any row. Sorted for stable UI. */
function collectTagKeys(rows: FeatureRow[]): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r.tags)) set.add(k);
  return Array.from(set).sort();
}

// ---- Muni-scope columns -------------------------------------------------

type MuniRow = {
  slug: string;
  name: string;
  subregion: string | null;
  count: number;
};

// ---- Component ----------------------------------------------------------

export function TableView(props: Props) {
  const {
    features,
    countsByMuni,
    munis,
    categorySlug,
    subtypeLabel,
    selectedId,
    onSelectFeature,
    onSelectMuni,
    scope,
    onScopeChange,
    canToggleScope,
  } = props;

  const featureRows = useMemo<FeatureRow[]>(
    () => (features ?? []).map(toFeatureRow),
    [features],
  );

  const muniRows = useMemo<MuniRow[]>(() => {
    if (!countsByMuni) return [];
    return munis.map((m) => ({
      slug: m.slug,
      name: m.name,
      subregion: m.subregion,
      count: countsByMuni.get(m.slug) ?? 0,
    }));
  }, [munis, countsByMuni]);

  const featureCount = features?.length ?? 0;
  const muniCount = muniRows.length;

  // CSV export. Feature scope → one row per feature with geometry_geojson.
  // Muni scope → one row per MAPC muni with the count. Button is disabled
  // when there's nothing to export (no query yet, or zero rows).
  const canDownloadCsv =
    scope === "feature"
      ? (features?.length ?? 0) > 0
      : muniRows.length > 0 && countsByMuni !== null;
  const slugBit = subtypeLabel
    ? subtypeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")
    : "features";
  function handleDownloadCsv() {
    if (!canDownloadCsv) return;
    if (scope === "feature") {
      const csv = featureRowsToCsv(features ?? []);
      downloadCsv(csv, `${slugBit}.csv`);
    } else if (countsByMuni) {
      const csv = muniRowsToCsv(munis, countsByMuni);
      downloadCsv(csv, `${slugBit}-by-muni.csv`);
    }
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-200 bg-slate-50">
        <div className="text-sm text-slate-700">
          <strong className="font-semibold">
            {subtypeLabel ?? "No feature selected"}
          </strong>
          {scope === "feature" && features ? (
            <span className="text-slate-500">
              {" "}— {featureCount.toLocaleString()} row
              {featureCount === 1 ? "" : "s"}
            </span>
          ) : null}
          {scope === "muni" && countsByMuni ? (
            <span className="text-slate-500">
              {" "}— {muniCount} municipalit{muniCount === 1 ? "y" : "ies"}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {canToggleScope && (
            <ScopeToggle
              scope={scope}
              onChange={onScopeChange}
              featureCount={featureCount}
              muniCount={muniCount}
            />
          )}
          <button
            onClick={handleDownloadCsv}
            disabled={!canDownloadCsv}
            className={
              "px-2.5 py-1 text-xs rounded border transition-colors " +
              (canDownloadCsv
                ? "border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
                : "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed")
            }
            title={
              scope === "feature"
                ? "Download one row per feature, with geometry as GeoJSON"
                : "Download one row per MAPC municipality, with counts"
            }
          >
            Download CSV
          </button>
        </div>
      </div>

      {scope === "muni" ? (
        <MuniTable
          rows={muniRows}
          onSelectMuni={onSelectMuni}
        />
      ) : features === null || features.length === 0 ? (
        <EmptyState
          reason={
            features === null
              ? "Run a query to populate the table."
              : "Query returned no features."
          }
        />
      ) : (
        <FeatureTable
          rows={featureRows}
          categorySlug={categorySlug}
          selectedId={selectedId}
          onSelectFeature={onSelectFeature}
        />
      )}
    </div>
  );
}

// ---- Scope toggle -------------------------------------------------------

function ScopeToggle(props: {
  scope: TableScope;
  onChange: (s: TableScope) => void;
  featureCount: number;
  muniCount: number;
}) {
  const { scope, onChange, featureCount, muniCount } = props;
  const btn = (s: TableScope, label: string, count: number) => (
    <button
      onClick={() => onChange(s)}
      aria-pressed={scope === s}
      className={
        "px-3 py-1 text-xs transition-colors " +
        (scope === s
          ? "bg-white text-slate-900 shadow-sm"
          : "text-slate-600 hover:text-slate-900 cursor-pointer")
      }
    >
      {label}{" "}
      <span
        className={
          "tabular-nums " +
          (scope === s ? "text-slate-500" : "text-slate-400")
        }
      >
        ({count.toLocaleString()})
      </span>
    </button>
  );
  return (
    <div
      role="group"
      aria-label="Table scope"
      className="inline-flex rounded-md bg-slate-200/60 p-0.5 border border-slate-200"
    >
      {btn("feature", "By feature", featureCount)}
      {btn("muni", "By municipality", muniCount)}
    </div>
  );
}

// ---- Empty state --------------------------------------------------------

function EmptyState({ reason }: { reason: string }) {
  return (
    <div className="px-6 py-10 text-center text-sm text-slate-500">
      {reason}
    </div>
  );
}

// ---- Feature table ------------------------------------------------------

function FeatureTable(props: {
  rows: FeatureRow[];
  categorySlug: string | null;
  selectedId: string | null;
  onSelectFeature: (id: string | null) => void;
}) {
  const { rows, categorySlug, selectedId, onSelectFeature } = props;

  // All tag keys in the result set — drives the column chooser.
  const allTagKeys = useMemo(() => collectTagKeys(rows), [rows]);
  const fillRates = useMemo(
    () => computeFillRates(rows, allTagKeys),
    [rows, allTagKeys],
  );

  // Starting set of tag columns — curated defaults for the category,
  // filtered to those that actually exist in the current data. Users
  // can add/remove from here via the column chooser.
  const defaultKeys = useMemo(() => {
    if (!categorySlug) return [] as string[];
    const curated = getDefaultTagColumns(categorySlug);
    return curated.filter((k) => allTagKeys.includes(k));
  }, [categorySlug, allTagKeys]);

  const [selectedTagKeys, setSelectedTagKeys] = useState<string[]>([]);
  const [showChooser, setShowChooser] = useState(false);
  const [minFillRate, setMinFillRate] = useState(0);

  // Reset tag selection to the curated defaults whenever the query
  // shape changes (category or result-set size). Keyed on a cheap
  // "did the query change" proxy rather than on defaultKeys directly,
  // because defaultKeys is a new array each render (computed from
  // allTagKeys + categorySlug) and would re-fire this on every keystroke.
  const resetKey = `${categorySlug ?? ""}:${rows.length}`;
  useEffect(() => {
    setSelectedTagKeys(defaultKeys);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const visibleTagKeys = useMemo(() => {
    const active = selectedTagKeys.length > 0 ? selectedTagKeys : defaultKeys;
    if (minFillRate <= 0) return active;
    return active.filter((k) => (fillRates.get(k) ?? 0) >= minFillRate);
  }, [selectedTagKeys, defaultKeys, fillRates, minFillRate]);

  const columns = useMemo<ColumnDef<FeatureRow>[]>(() => {
    const base: ColumnDef<FeatureRow>[] = [
      {
        id: "name",
        header: "Name",
        accessorFn: (r) => r.name || "—",
        size: 220,
      },
      {
        // Derived, not OSM — computed client-side by PIP against the
        // MAPC muni boundaries. See queries.ts `assignMuni`.
        id: "muni_name",
        header: "Municipality",
        accessorKey: "muni_name",
        size: 140,
      },
      {
        id: "osm_type",
        header: "OSM Type",
        accessorKey: "osm_type",
        size: 90,
      },
      {
        id: "osm_id",
        header: "OSM ID",
        accessorKey: "osm_id",
        size: 110,
      },
      {
        id: "geometry_type",
        header: "Geometry",
        accessorKey: "geometry_type",
        size: 120,
      },
    ];
    const tagCols = visibleTagKeys.map<ColumnDef<FeatureRow>>((k) => ({
      id: `tag:${k}`,
      header: () => (
        <div className="flex flex-col items-start leading-tight">
          <span className="font-mono text-[11px] text-slate-700">{k}</span>
          <FillRateBadge pct={fillRates.get(k) ?? 0} />
        </div>
      ),
      accessorFn: (r) => r.tags[k] ?? "",
      size: 140,
      enableSorting: true,
      sortingFn: (a, b, colId) => {
        const av = String(a.getValue(colId) ?? "");
        const bv = String(b.getValue(colId) ?? "");
        return av.localeCompare(bv);
      },
    }));
    return [...base, ...tagCols];
  }, [visibleTagKeys, fillRates]);

  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Virtualize the body rows.
  const parentRef = useRef<HTMLDivElement | null>(null);
  const modelRows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: modelRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 34,
    overscan: 10,
  });

  const totalTagKeys = allTagKeys.length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-slate-200 text-xs text-slate-600 bg-white">
        <button
          onClick={() => setShowChooser((v) => !v)}
          className="px-2 py-1 rounded border border-slate-300 hover:bg-slate-50 cursor-pointer"
        >
          Columns ({visibleTagKeys.length}/{totalTagKeys} tag keys)
        </button>
        <label className="flex items-center gap-2">
          <span className="text-slate-500">Hide columns below</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={minFillRate}
            onChange={(e) => setMinFillRate(Number(e.target.value))}
            className="w-28"
          />
          <span className="tabular-nums text-slate-700 w-10 text-right">
            {minFillRate}%
          </span>
        </label>
      </div>

      {showChooser && (
        <ColumnChooser
          allTagKeys={allTagKeys}
          selected={
            selectedTagKeys.length > 0 ? selectedTagKeys : defaultKeys
          }
          fillRates={fillRates}
          defaultKeys={defaultKeys}
          onChange={setSelectedTagKeys}
          onClose={() => setShowChooser(false)}
        />
      )}

      <div
        ref={parentRef}
        className="overflow-auto max-h-[560px] relative"
      >
        <table
          className="text-xs w-full border-collapse"
          style={{ tableLayout: "fixed" }}
        >
          <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    scope="col"
                    className="text-left align-top px-2 py-1.5 font-medium text-slate-700 border-r border-slate-200 last:border-r-0 cursor-pointer select-none"
                    style={{ width: h.getSize() }}
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-start gap-1">
                      <div className="flex-1 min-w-0">
                        {h.isPlaceholder
                          ? null
                          : flexRender(
                              h.column.columnDef.header,
                              h.getContext(),
                            )}
                      </div>
                      <span className="text-slate-400 mt-0.5">
                        {h.column.getIsSorted() === "asc"
                          ? "↑"
                          : h.column.getIsSorted() === "desc"
                            ? "↓"
                            : ""}
                      </span>
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody
            style={{
              display: "block",
              height: rowVirtualizer.getTotalSize(),
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((vRow) => {
              const row = modelRows[vRow.index];
              const isSelected = row.original.id === selectedId;
              return (
                <tr
                  key={row.id}
                  onClick={() => onSelectFeature(row.original.id)}
                  className={
                    "cursor-pointer " +
                    (isSelected
                      ? "bg-sky-100"
                      : vRow.index % 2 === 0
                        ? "bg-white hover:bg-slate-50"
                        : "bg-slate-50/50 hover:bg-slate-100")
                  }
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    transform: `translateY(${vRow.start}px)`,
                    width: "100%",
                    display: "table",
                    tableLayout: "fixed",
                  }}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      className="px-2 py-1.5 border-r border-b border-slate-100 last:border-r-0 truncate text-slate-800"
                      style={{ width: cell.column.getSize() }}
                      title={String(cell.getValue() ?? "")}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ---- Muni-aggregate table ----------------------------------------------

function MuniTable(props: {
  rows: MuniRow[];
  onSelectMuni: (slug: string) => void;
}) {
  const { rows, onSelectMuni } = props;
  const columns = useMemo<ColumnDef<MuniRow>[]>(
    () => [
      {
        id: "name",
        header: "Municipality",
        accessorKey: "name",
        size: 220,
      },
      {
        id: "subregion",
        header: "MAPC subregion",
        accessorFn: (r) => r.subregion ?? "—",
        size: 180,
      },
      {
        id: "count",
        header: "Count",
        accessorKey: "count",
        size: 120,
        sortingFn: (a, b) =>
          (a.original.count ?? 0) - (b.original.count ?? 0),
        cell: (ctx) => (
          <span className="tabular-nums">
            {(ctx.getValue() as number).toLocaleString()}
          </span>
        ),
      },
    ],
    [],
  );

  const [sorting, setSorting] = useState<SortingState>([
    { id: "count", desc: true },
  ]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <div className="overflow-auto max-h-[560px]">
      <table className="text-xs w-full border-collapse">
        <thead className="sticky top-0 bg-slate-50 border-b border-slate-200">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th
                  key={h.id}
                  scope="col"
                  className="text-left px-3 py-2 font-medium text-slate-700 border-r border-slate-200 last:border-r-0 cursor-pointer select-none"
                  style={{ width: h.getSize() }}
                  onClick={h.column.getToggleSortingHandler()}
                >
                  <span className="inline-flex items-center gap-1">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                    <span className="text-slate-400">
                      {h.column.getIsSorted() === "asc"
                        ? "↑"
                        : h.column.getIsSorted() === "desc"
                          ? "↓"
                          : ""}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, i) => (
            <tr
              key={row.id}
              onClick={() => onSelectMuni(row.original.slug)}
              className={
                "cursor-pointer " +
                (i % 2 === 0
                  ? "bg-white hover:bg-sky-50"
                  : "bg-slate-50/50 hover:bg-sky-50")
              }
            >
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className="px-3 py-1.5 border-r border-b border-slate-100 last:border-r-0 text-slate-800"
                  style={{ width: cell.column.getSize() }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---- Fill-rate badge ---------------------------------------------------

function FillRateBadge({ pct }: { pct: number }) {
  // Color ramp: green ≥75%, yellow 30–75%, red <30%.
  const color =
    pct >= 75
      ? "text-emerald-700 bg-emerald-100"
      : pct >= 30
        ? "text-amber-700 bg-amber-100"
        : "text-rose-700 bg-rose-100";
  return (
    <span
      className={
        "text-[10px] tabular-nums px-1 py-px rounded mt-0.5 font-normal " +
        color
      }
      title={`${pct.toFixed(1)}% of rows have this tag`}
    >
      {Math.round(pct)}%
    </span>
  );
}

// ---- Column chooser ----------------------------------------------------

function ColumnChooser(props: {
  allTagKeys: string[];
  selected: string[];
  fillRates: Map<string, number>;
  defaultKeys: string[];
  onChange: (keys: string[]) => void;
  onClose: () => void;
}) {
  const { allTagKeys, selected, fillRates, defaultKeys, onChange, onClose } =
    props;
  const [query, setQuery] = useState("");
  const selSet = new Set(selected);
  const filtered = useMemo(() => {
    if (!query) return allTagKeys;
    const q = query.toLowerCase();
    return allTagKeys.filter((k) => k.toLowerCase().includes(q));
  }, [allTagKeys, query]);

  // Sort filtered keys by fill rate descending — easier to find useful
  // tags when the list is long.
  const ordered = useMemo(
    () =>
      [...filtered].sort(
        (a, b) => (fillRates.get(b) ?? 0) - (fillRates.get(a) ?? 0),
      ),
    [filtered, fillRates],
  );

  function toggle(k: string) {
    const next = new Set(selSet);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    onChange(Array.from(next));
  }

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-xs text-slate-600">
          <strong className="font-semibold">Column chooser</strong> — every
          tag key in the current result, sorted by fill rate.
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-xs text-slate-600 underline hover:text-slate-900"
            onClick={() => onChange(defaultKeys)}
          >
            Reset to defaults
          </button>
          <button
            className="text-xs text-slate-600 hover:text-slate-900"
            onClick={onClose}
            aria-label="Close column chooser"
          >
            ×
          </button>
        </div>
      </div>
      <input
        type="search"
        placeholder="Filter tag keys…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full px-2 py-1 text-xs rounded border border-slate-300 mb-2"
      />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-3 gap-y-1 max-h-48 overflow-auto">
        {ordered.map((k) => {
          const pct = fillRates.get(k) ?? 0;
          return (
            <label
              key={k}
              className="flex items-center gap-1.5 text-xs cursor-pointer py-0.5"
            >
              <input
                type="checkbox"
                checked={selSet.has(k)}
                onChange={() => toggle(k)}
              />
              <span className="font-mono text-slate-700 truncate">{k}</span>
              <FillRateBadge pct={pct} />
            </label>
          );
        })}
        {ordered.length === 0 && (
          <span className="text-xs text-slate-400 italic col-span-full">
            No tag keys match.
          </span>
        )}
      </div>
    </div>
  );
}
