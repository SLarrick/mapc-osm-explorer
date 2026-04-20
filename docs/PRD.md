# PRD: MAPC OSM Explorer

**Status:** Living document. Supersedes `OSM-Explorer_PRD.docx` (April 18, 2026).
**Last updated:** 2026-04-20
**Repo:** [mapc-osm-explorer](https://github.com/SLarrick/mapc-osm-explorer)

---

## 0. Changelog from v1 PRD

This document replaces the original April 18 PRD. Key shifts since then, all captured in full below:

- **Architecture:** Moved from "one GeoParquet with a `category` column" to **one parquet per category** (12 files) plus a small `_manifest.json`. This keeps per-category downloads small and lazy.
- **Taxonomy:** Introduced a **two-level model** — manifest categories (12) × curated **subtypes** (35, hand-picked 2–3 per category). Subtypes are the unit the user picks; each subtype maps to `(category parquet, tag filter)`. The original PRD's "category dropdown with preset subset" is superseded by this cleaner split.
- **UX (landing):** Hero fill-in-the-blank sentence is real — native `<select>` pills grouped by manifest category / MAPC sub-region via `<optgroup>`.
- **UX (focus mode):** New — when a muni is selected (by dropdown *or* by clicking the polygon on the map), the page switches to a compact filter bar, "Salem, MA" style header, "← back to MAPC region" affordance, taller map, and a **dim-others paint treatment** on surrounding munis. The original PRD's left-sidebar-chips + tabbed-view concept is deprecated in favor of this layered hero/focus model.
- **Detail panel:** Implemented as a floating overlay on the map (top-left), not as the right sidebar of a tabbed view.
- **Geometries:** Renderer handles real Point / LineString / Polygon / MultiPolygon geometries, not just centroid pins. A zoom-driven cross-fade moves from "uniform pins" (low zoom) to "real shapes + halo" (high zoom).
- **Selection model:** MapLibre `feature-state` drives selection coloring; `promoteId: "uid"` gives stable per-feature ids (`"way/12345"`) usable across the whole app.
- **Completeness becomes first-class.** The original PRD mentioned fill-rate badges in the table view as a nicety. After design review (see §9) we now treat completeness — both tag-level fill rate *and* feature-level OSM coverage per muni — as a primary signal, not a caveat. This informs the regional-view design.
- **Regional view (in design):** The original PRD's muni-choropleth-when-geography-is-MAPC-wide is being reshaped into a more nuanced plan driven by completeness tier + feature count + the distinction between "discrete facilities" (muni-binnable) and "continuous phenomena" (hex-binnable). Details in §10 and §11.
- **Build status (as of 2026-04-20):** Slices 0, 1, 1b, 1c, 2, 3, 3.5, 3.5.1, 4, 5, and 5.1 are shipped. See §5 for details.
- **Roadmap reshape (Slice 5-era):**
  - **Slice 4B (hex density) skipped for v1.** The Slice 4A muni choropleth plus the per-feature pin cap covers enough of the "continuous phenomena" question for a first release. Hex density is deferred to post-v1.
  - **URL state promoted to pre-v1.** Sharable `?feature=…&muni=…` URLs are a core planner use case (send the map of Salem playgrounds to a colleague), too important to ship v1 without.
  - **CSV export absorbed into Slice 5.1** (tabular data wants CSV, not a later slice).
  - **Normalization (e.g. feature-per-1000-people, per-mile-of-road) moved explicitly post-v1.** A reliable denominator dataset is its own lift.
- **Tabular view formalized (Slice 5).** Two scopes — one row per feature (with curated per-category columns + a column chooser with fill-rate badges) and one row per municipality. Municipality is a standard feature-scope column, computed client-side via PIP because OSM itself doesn't carry a muni tag. Default scope tracks the choropleth toggle: when shading munis is the right answer on the map, muni rows are the right answer in the table.
- **Over-threshold two-phase query pattern.** Both region (25k cap) and focused single-muni (50k cap) queries COUNT first and skip the geometry payload when over-threshold. The UI falls back to an honest "N features — too many to render individually" message rather than silently truncating. Boston + all-buildings (~180k) was the forcing function.
- **Region layers legend.** The choropleth legend evolved into a "Region layers" card with two toggles (show features as points; shade munis by count), per-bin muni counts, and click-to-expand listing of the munis in each bin (sorted by count desc) with a sky-600 outline highlight on the map.

---

## 1. Summary

MAPC OSM Explorer is a hosted web app that lets regional and municipal planners in Greater Boston extract, browse, and lightly analyze OpenStreetMap data for the MAPC region — without learning Overpass QL, without installing GIS software, and without having to know which OSM tags exist.

One-line elevator pitch: *"Census Reporter for OpenStreetMap data in the MAPC region."*

## 2. Problem

OpenStreetMap contains rich, frequently-updated civic data — playgrounds, bike infrastructure, streetlights, benches, public buildings — but accessing it is gated by two barriers:

- **Discoverability.** Planners don't know what OSM has. The taxonomy of tags is a black box.
- **Extraction.** The canonical extraction tool (Overpass Turbo) requires writing Overpass QL, a language that only GIS developers know.

As a result, planners who would benefit enormously from this data default to commissioning bespoke datasets, hand-counting from satellite imagery, or doing without.

A related gap the original PRD under-stated: **the regional-scale rankings and descriptive physical-feature counts** (how many fire stations per muni, how much bike-path mileage per muni, how many residential parcels per muni) that planners routinely want are not well-served by existing MAPC/MMA dashboards, which focus on interpretive/derivative indexes rather than descriptive counts of physical features.

## 3. Users & Primary Use Cases

**User 1: MAPC regional planner**
- Use case A: Generate a recreational-asset inventory for the MAPC region → hand off to QA/QC for MOOR.
- Use case B: Support Salem's digital-equity plan by finding parks with seating + shelter + tables (candidate outdoor-Wi-Fi sites).
- Use case C (new in this revision): Produce a descriptive regional summary — "bike-path mileage by municipality across MAPC" — as a briefing input.
- Outputs: GeoJSON for ArcGIS Pro, CSVs for R/Python, PNGs/screenshots for reports.

**User 2: Municipal planner (small town, no GIS team)**
- Use case: "How many streetlights are in my town, where are they, and are there gaps?" → grant application.
- Outputs: A count, a map, and sometimes a CSV.

**Both users share:** need for geographic scoping, want to browse/discover rather than query, need to export, want lightweight summary analysis.

## 4. Non-Goals for v1

Explicitly out of scope:

- Editing / writing back to OSM.
- Non-OSM data sources (Census, MassGIS, GTFS) — reserved for v2.
- Subregions, census tracts as geographies — v1.5.
- Saved queries, user accounts — post-v1. (URL-state sharing is now **in scope** for v1; see §11 Slice 6.)
- Natural-language search — v2+.
- Mobile/tablet layout — desktop-first.
- Advanced spatial operations beyond boundary clip + muni-binned aggregation — v2. (Hex-binned density was scoped for v1 as Slice 4B and is now deferred to post-v1.)
- Live Overpass queries — v1 uses a periodically refreshed snapshot.
- **Normalization** (features per 1,000 residents, per mile of road, per acre) — post-v1. A defensible denominator dataset is its own lift; v1 ships descriptive counts only.

## 5. What's Built Today

As of 2026-04-19, the following is shipped to `main`:

### Slice 0 — Scaffold
Vite + React + TypeScript + Tailwind v4. Deployed to Vercel. MapLibre + OpenFreeMap Positron base tiles (no API key).

### Slice 1 — "Playgrounds in Salem, end-to-end"
DuckDB-WASM queries a category parquet over HTTP range requests. Point-in-polygon filter (JS ray-cast against the muni GeoJSON boundary) narrows results to Salem. GeoJSON feature collection rendered as pins on the map.

### Slice 1b — Real geometries + zoom-driven styling
- WKB decoder handles Point / LineString / Polygon / MultiPolygon (and their Multi* variants).
- Map paints polygons as polygons, lines as lines. Every feature also gets a centroid anchor pin for low-zoom visibility.
- Zoom-interpolated paint expressions cross-fade between "uniform pins only" (z < 12.5) and "real shapes + halo" (z ≥ 14). Feature-state-aware `case` inside each interpolation stop handles selection coloring under the zoom curve.
- Hover tooltip on any interactive layer.

### Slice 1c — Click-to-inspect + export
- Click a result feature → floating `DetailPanel` (top-left overlay on the map) with name, OSM ID, full tag list, link back to openstreetmap.org, and "Download this feature" button.
- "Download GeoJSON" for the full result set.
- MapLibre `promoteId: "uid"` on both `results-data` and `results-centroids` sources — solves string-id coercion so selection state survives source swaps.

### Slice 2 — Working dropdowns + muni focus UX
- **Curated subtype taxonomy** (`src/lib/taxonomy.ts`): 35 subtypes across 12 categories. Tagged-union filter shape (`{kind: "eq" | "present"}`) compiles to `json_extract_string(tags, '$.key') IN (...)` or `IS NOT NULL`.
- **Generalized query** (`findFeaturesInMuni(subtypeSlug, muniSlug)`) — dynamic parquet URL keyed off `categorySlug`, WHERE clause from `filterToSql`.
- **`FeaturePicker` + `MuniPicker`** (`Pickers.tsx`) — native `<select>` styled as the dashed sky-blue hero pill. FeaturePicker uses `<optgroup>` for category headers (manifest order preserved). MuniPicker groups by MAPC sub-region, alphabetized within each group.
- **Focus mode:** selecting a muni (dropdown or map click) swaps the layout: compact filter bar with muni name as a header (e.g. "Salem, MA"), "← back to MAPC region" link, map grows 540 → 720px, camera `fitBounds` to the muni, surrounding munis tint to slate gray, selected muni gets a bolder slate-900 outline and transparent fill. Back-to-region restores the hero layout and flies the camera back to the MAPC envelope.
- **Click priority:** result feature > muni polygon > empty space (deselects).

See `src/lib/taxonomy.ts` for the current subtype list.

### Slice 3 — Region-wide queries + completeness tiers
- `"Entire MAPC region"` option at the top of the muni dropdown (visually separated from sub-region groups).
- `findFeaturesInRegion(subtypeSlug)` queries the whole category parquet. Two-phase shape: always COUNT first; only fetch the geometry payload if the count is under the region-render threshold.
- Initial cap of 5,000 features with a "Showing N of M" note.
- `completeness: "high" | "partial" | "spotty"` added to each Subtype. Spotty-tier features surface a pre-query "OSM coverage is uneven" caveat at region scale.
- MA state boundary added as a reference line (dashed slate-500) so the MAPC footprint reads in its geographic context.

### Slice 3.5 — Truth-check pass
After shipping Slice 3 the data was spot-checked against MassGIS / local knowledge. Adjustments included filter corrections for several subtypes where the initial taxonomy was too broad or too narrow (e.g. bike parking), and tightening of the muni-assignment PIP edge cases.

### Slice 3.5.1 — Raise region render threshold
Real traffic numbers from Slice 3 showed that the 5,000-feature cap was conservative for how much MapLibre actually handles cleanly. The threshold was raised to 25,000 for region queries. Features above that fall into the count-only "too many to render as points" path.

### Slice 4 — Muni-count choropleth (region mode)
- DuckDB-side `SELECT count(*) GROUP BY muni_slug`-style aggregation wired through `findFeaturesInRegion`. Per-muni counts live in `regionMeta.countsByMuni`.
- `src/lib/choropleth.ts` computes 5 quantile bins over *non-zero* counts (so Boston doesn't collapse everyone else into bin 1) plus a separate neutral color for muni count = 0 ("mapped and zero" vs. "no data").
- Fill applied via a MapLibre `step` expression on `feature-state.count`; paint expression swapped in/out based on selection state.
- `ChoroplethLegend` shows bin swatches + ranges. Sky-blue sequential ramp matches the rest of the app's primary palette.
- ETL gained explicit relation handling (`osmium export`) so area features like parks and water bodies render fully rather than as unstitched ways.

### Slice 5 — Tabular view
- TanStack Table + TanStack React Virtual, virtualized so 25k feature-rows scroll smoothly.
- Two scopes driven by a segmented control: **By feature** (one row per feature) and **By municipality** (one row per MAPC muni with per-muni count, available only when a region query is active). Scope default tracks the map's choropleth toggle — muni scope when shading is on, feature scope when it's off.
- **Curated default columns per category** in `src/lib/tableColumns.ts` — hand-coded, deterministic, auditable in one file. Not an AI-magic derivation. For each of the 12 categories a small ordered list of the tag keys planners actually care about (e.g. parks → `leisure, access, surface, wheelchair, opening_hours, lit, operator`).
- **Column chooser** lists every tag key in the current result set, sorted by fill rate, with a search box and "Reset to defaults" affordance. A "hide columns below X%" slider trims low-fill columns.
- **Fill-rate badges** on each tag column header — green ≥75%, amber 30–75%, rose <30%. Scoped to the *current* result set, not global (the question is "of Salem's playgrounds…," not "across MAPC").
- **Municipality as a standard feature-scope column.** OSM features don't carry a muni identifier, so each `ResultFeature` is stamped client-side via PIP against the already-loaded muni boundaries. See `assignMuni` in `src/lib/queries.ts`.
- **Row click ↔ map selection** — clicking a feature row selects it in MapLibre; clicking a muni row in muni-scope enters focused mode.
- **Over-threshold focused queries.** A single muni above the 50,000-feature focused cap (Boston + all buildings, ~180k) now returns metadata only, avoiding a browser OOM. The UI renders a count-and-honest-message panel rather than attempting a partial payload.

### Slice 5.1 — Region-layers polish + CSV export
- Legend restructured to a **"Region layers — \<subtype\>"** card with two checkboxes — *Show as points* (toggles the feature overlay) and *Shade munis by count* (toggles the choropleth) — plus the bin legend itself. Disabling points is the correct move whenever the dot cloud is dense enough to occlude the choropleth (region-wide parks is the canonical case).
- **Per-bin muni counts** on every legend row. Clicking a bin expands a scrollable list of munis in that bin (sorted by count descending, alphabetical tie-break) and outlines those munis on the map in a new sky-600 highlight layer, distinct from the slate-900 selection outline.
- **CSV export** from the table view. Feature scope writes one row per feature with `name, municipality, osm_type, osm_id, geometry_type, centroid_lon, centroid_lat, geometry_geojson`, and one `tag:<key>` column for every tag key in the set. Muni scope writes one row per MAPC muni with the per-muni count, sorted count-desc.
- `centroid_lon` / `centroid_lat` are computed at WKB parse time and stamped onto every `ResultFeature` — available to the CSV and future column-chooser entries without re-walking the geometry.
- Buildings parquet was re-simplified in-place (tolerance 0.00001 → 0.00003, ≈3m) after the centroid columns pushed the file past GitHub's 100 MB limit. Visual fidelity at neighborhood zoom is unchanged; file went 112 → 88 MB.

## 6. Data Architecture (as-built)

### 6.1 One-time ETL (`etl/build_parquet.py`)
- Download the Massachusetts extract from Geofabrik (`massachusetts-latest.osm.pbf`).
- Clip to the MAPC boundary: `osmium extract --polygon MAPC_boundary.geojson`.
- Route every feature into one of the 12 categories based on its tags (`etl/categories.py`).
- Emit **one parquet per category** to `public/data/<category-slug>.parquet`.
- Emit `public/data/_manifest.json` with `{snapshot, source, license, categories: [{slug, label, file, feature_count, file_size_bytes, simplified}]}`.

**Current sizes:**

| Category | Features | Bytes |
|---|---:|---:|
| Public Safety & Health | 9,042 | 0.37 MB |
| Transit | 10,144 | 0.53 MB |
| Food Access | 6,909 | 0.81 MB |
| Civic & Government | 484 | 0.09 MB |
| Community Facilities | 3,911 | 0.96 MB |
| Parks & Recreation | 20,196 | 5.29 MB |
| Active Transportation | 165,574 | 17.64 MB |
| Streetscape | 165,955 | 6.09 MB |
| Natural Features & Green Infrastructure | 87,369 | 24.55 MB |
| Streets & Roadways | 242,224 | 32.70 MB |
| Housing & Land Use | 5,202 | 1.32 MB |
| Buildings & Addresses | 1,024,546 | 97.07 MB *(simplified)* |
| **Total** | **1,741,556** | **187.42 MB** |

Because each category is a separate file, most queries pull < 5 MB. Even region-wide high-N queries never load more than one category at a time.

### 6.2 Parquet schema (per-category)
Every per-category parquet has the same columns:

- `osm_id` (bigint)
- `osm_type` (varchar) — `node`, `way`, or `relation`
- `name` (varchar, nullable)
- `tags` (varchar, JSON string — not yet converted to STRUCT)
- `geometry_wkb` (blob, little-endian WKB)

### 6.3 Runtime
- User lands → DuckDB-WASM initializes (1–2s first load, cached after).
- User picks subtype + geography → app opens the category parquet at `/data/<category-slug>.parquet` via HTTP range-read, runs `SELECT … WHERE <tag filter>`.
- Results are decoded client-side (WKB → GeoJSON geometry) and passed to MapLibre via a `GeoJSONSource`. The WKB parser also emits a bbox-centroid so downstream consumers (CSV export, muni assignment, future table columns) don't re-walk the geometry.
- Muni *filter* (focused mode) and muni *stamping* (region mode, so every feature gets a `muni_slug` / `muni_name` on its properties) are done in JS via ray-cast point-in-polygon with a bbox pre-filter. This is why Municipality can appear as a standard column in the feature-scope table even though OSM itself doesn't carry a muni tag.
- Will migrate to DuckDB spatial extension (`ST_Intersects`) when we need polygon-polygon intersection or sub-muni geographies.
- Two-phase query pattern for over-threshold results: region queries COUNT up-front and skip the geometry fetch above the 25,000-feature render threshold; focused single-muni queries do the same above 50,000. Callers get a `{fc, totalCount, renderable, threshold}` shape and the UI switches to a count-only presentation.

### 6.4 Why this works
- **Zero backend.** Deploy = `git push`. $0 on Vercel free tier.
- **Fast.** Most queries sub-500ms end-to-end (download + parse + render).
- **Resilient.** No Overpass rate limits, no API keys, no auth.
- **Refactor-safe.** Can swap the runtime to a backend later without UX change.

## 7. Taxonomy Model

A two-level model introduced in Slice 2, replacing the original PRD's "category dropdown populated by preset subset."

### 7.1 Level 1 — Category (from the manifest, 12 total)
Defined in `public/data/_manifest.json`, generated by the ETL. These are the parquet file boundaries. Categories are roughly aligned with the iD preset library but tuned for MAPC planner needs.

### 7.2 Level 2 — Subtype (hand-curated, ~35 total, in `src/lib/taxonomy.ts`)
Each subtype is a `(category parquet, tag filter)` pair with a user-facing label and a stable slug.

```ts
interface Subtype {
  slug: string;              // "playgrounds"
  label: string;             // "Playgrounds"
  categorySlug: string;      // "parks-and-recreation"
  filter: TagFilter;         // { kind: "eq", key: "leisure", values: ["playground"] }
}
```

The subtype is what the user picks in the dropdown and what `?feature=` URLs refer to. Subtype slugs are globally unique — the URL `?feature=playgrounds&muni=salem` is unambiguous regardless of which category owns playgrounds.

The subtype list is **hand-picked for MVP demo purposes** — 2–3 per category, weighted toward what we want to show off. It's meant to grow and eventually be supplemented by an "advanced" tag-level query mode (see §13).

### 7.3 Future — Advanced tag query (deferred)
A future advanced-mode UI will let power users pick category + arbitrary tag key/value filters — essentially a Overpass-Turbo-query builder with a friendly UI. Not in scope for v1. The current subtype taxonomy is intentionally the curated "easy mode."

## 8. UX (as built + near-term)

### 8.1 Header
- Site title: "MAPC OSM Explorer"
- Pre-alpha badge.
- *Deferred:* About page link, OSM attribution link in header.

### 8.2 Landing mode
Fill-in-the-blank hero sentence in large type:

> **I'm looking for data about [*pick a feature* ▾] in [*pick a place* ▾].**

- **Feature dropdown** (35 subtypes, grouped by category via `<optgroup>`).
- **Muni dropdown** (101 munis, grouped by MAPC sub-region via `<optgroup>`).
- **Find data →** button — disabled until both selections made.
- Beneath: a map at 540px showing the MAPC region with muni outlines and ambient slate hover tint ("juice" to suggest clickability).

### 8.3 Focus mode (entered when a muni is selected)
- Compact filter bar replaces hero: `[← back to MAPC region]  Salem, MA  Show [playgrounds ▾] [Find data →] Found 15 playgrounds. Download GeoJSON`.
- Map grows to 720px and `fitBounds` to the selected muni.
- Surrounding munis paint slate-300 at 0.25 opacity (slate-400 at 0.35 on hover). The selected muni paints transparent with a bolder slate-900 outline.
- Clicking a *different* muni swaps the focus.
- Back-to-region deselects, flies the camera back to the MAPC envelope, and restores the hero.

### 8.4 Results on the map
- Points render as circles (halo + dot, zoom-scaled).
- Polygons render as filled shapes with outline; below a zoom threshold they cross-fade out and only the centroid pin is visible.
- LineStrings render as stroked lines; visible at all zooms (they'd disappear at low zoom otherwise).
- Selected feature paints amber instead of sky blue, everywhere.
- Hover on any feature pops a name tooltip.

### 8.5 Detail panel
Floating overlay (top-left of the map, on a selected feature):
- Name (or `Unnamed <type>`).
- OSM type/id, link to openstreetmap.org.
- All tags, alphabetized.
- "Download this feature" button.
- Close (×).

### 8.6 Regional view (shipped, Slices 3–5.1)
- Landing-style layout. Picking "Entire MAPC region" runs a region-wide query without entering focused mode.
- When the count is under threshold: feature overlay plus a muni choropleth tinted by per-muni count.
- When the count is over threshold: choropleth-only; honest "N features — too many to render individually" note.
- Spotty-tier features surface a pre-query "OSM coverage is uneven" caveat so the user frames the result as "where mapping has happened" rather than "where the thing exists."
- **Region layers legend** (bottom-left of the map): points-on-map toggle, shade-munis-by-count toggle, bin swatches with per-bin muni counts, click-to-expand muni lists (sorted by count desc) with map highlight.

### 8.7 Table view (shipped, Slice 5 + 5.1)
- Map / Table tabs at the top of the results area. Both views share the same result set and selection state.
- By-feature scope: one row per feature with curated default columns per category plus a column chooser (fill-rate-sorted, searchable, with green/amber/rose fill-rate badges). Row click selects the feature on the map.
- By-muni scope: one row per MAPC muni with per-muni count, sorted count-desc by default. Row click enters focused mode for that muni.
- Default scope tracks the choropleth toggle. User overrides stick until the query shape changes.
- Download CSV button — writes feature rows (with `geometry_geojson` + centroid lat/lon) or muni rows depending on current scope.

### 8.8 Planned UX (not yet built)
- **Summary tab** — count, density, top-N values on the most-filled tags. Expanded per §9.
- **About page.**
- **URL state** — `?feature=…&muni=…` sharable URLs. The app's state model already supports this; just needs the query-string sync plumbing. Moved to in-scope for v1; see §11 Slice 6.

## 9. Completeness as First-Class Signal

**Upgraded from caveat to primary signal in this revision.**

OpenStreetMap is a crowdsourced data set. Completeness varies by feature type (hospitals are near-universal, street trees are wildly incomplete) and by municipality (Cambridge has 50× the OSM contributor activity per capita of Hull). For a planner asking *"where can I get data about X?"*, completeness is not a footnote — it's the answer.

### 9.1 Philosophy
- OSM completeness is useful data in its own right. A "benches per muni" map can honestly be interpreted as "mapping effort per muni" — and that's often valuable information.
- The product should make this visible, not hide it. Caveats should be in-UI, not in a footer.
- MAPC's existing public dashboards (MetroCommon 2050, Regional Indicators) lean heavily on *interpretive* indexes. This product fills a different gap: **descriptive counts of physical features**, derived from geospatial data, which the dashboards don't cover. Being honest about completeness is the thing that makes those descriptive counts trustworthy as descriptive counts (rather than proxies for ground truth).

### 9.2 Two kinds of completeness
| Kind | Scope | How surfaced |
|---|---|---|
| **Feature-level** | "How complete is OSM's `<subtype>` coverage for this muni / for MAPC?" | Completeness tier on the subtype + per-muni coverage signal in regional views |
| **Tag-level (fill rate)** | "Of the parks OSM knows about, what % have a `name`? a `surface`? a `wheelchair`?" | Column header badges in the table view |

### 9.3 Completeness tier (to be added to `Subtype` in Slice 3)
A hand-curated `completeness: "high" | "partial" | "spotty"` field on each subtype, informed by OSM knowledge + spot-checking against authoritative sources where available (MassGIS, DESE, DPH rosters). Rough first draft:

| Tier | Examples | Regional-view treatment |
|---|---|---|
| **high** | hospitals, fire/police stations, libraries, post offices, town halls, train/subway stations, schools, parks, water bodies, all-buildings, primary roads, highways | Default: raw features. Choropleth/hex overlay optionally available |
| **partial** | supermarkets, restaurants, cafés, playgrounds, community centers, places of worship, bike paths, footpaths | Default: raw features. Choropleth available with a "partial coverage" badge |
| **spotty** | benches, bike parking, street trees, sports fields (depends), trails (depends) | Default: coverage-first view framed as "where has mapping happened?" rather than "how much of X exists?" |

We'll refine this with quantitative measures over time (ratio to authoritative counts where available, per-capita variance across munis where not), but hand-curated tiers are enough to ship.

### 9.4 UI messaging
Every regional view (and, eventually, every muni view too) should carry a subtle, always-visible OSM-is-crowdsourced note. Exact copy TBD. Goal: set the frame before the user interprets the numbers.

## 10. Regional View — Design Principles

The original PRD's "choropleth when geography = MAPC-wide" was reshaped during Slice 2 design, then partially realized in Slices 3–5.1. What actually shipped:

- Region queries always COUNT first. Under the 25k render threshold, raw features are drawn; over, the choropleth carries the answer alone.
- Muni choropleth with a quantile-bin ramp applies to every subtype (not just discrete facilities). Users can toggle it off when the dot cloud is the more useful read.
- Hex density (the "continuous phenomena" case from this section) was scoped out of v1 — see §11 "Skipped / deferred."

Core principles from the original Slice 2 discussion, retained as guidance:

### 10.1 One size doesn't fit all features
Region-scale rendering depends on two orthogonal properties of the feature type:

- **Feature count N** (how many there are in the region): low-N (<~100), mid-N (hundreds), high-N (10k+).
- **Geography of the phenomenon**:
  - *Discrete facilities* (hospitals, schools, town halls) — the question is usually about which *places* have them.
  - *Continuous phenomena* (trees, buildings, street networks) — the question is about the *pattern* on the landscape.

### 10.2 Rendering strategies
- **Raw points** (low / mid-N): one dot per feature, clickable. Works for hospitals, libraries, town halls, train stations.
- **Muni choropleth** (discrete facilities where the question is "which places"): pre-compute per-muni count, tint the muni fill. Best for comparing places. Worst for anything that's 1-per-muni by definition (town halls, post offices — one fire department per town isn't interesting as a choropleth).
- **Hex-bin density** (continuous phenomena, high-N): DuckDB-side aggregation into a hex grid, rendered as a density fill. Best for patterns that don't respect admin boundaries (trees, buildings, restaurant clusters). Hex bins also neutralize muni-size variance (Boston vs. Medway as equal "bins" is misleading).
- **Length-per-muni choropleth** (road / path networks): `sum(ST_Length)` aggregated per muni, rendered as a tint. Useful for bike-path-mileage-style questions.
- **Coverage-first view** (tier-3 features): primary story is "where has OSM mapping happened?" rather than "how much is there?" May be presented as a muni choropleth tinted by feature count, but framed with coverage language.

### 10.3 Feature-type → default rendering (first-draft matrix)

| Subtype | Tier | N (approx regional) | Recommended regional default |
|---|---|---:|---|
| Hospitals | high | ~30 | Raw points |
| Fire stations | high | ~150 | Raw points (optional muni count overlay) |
| Police stations | high | ~100 | Raw points (optional muni count overlay) |
| Town halls | high | ~100 | Raw points (1-per-muni; choropleth is meaningless) |
| Libraries | high | ~150 | Raw points |
| Post offices | high | ~120 | Raw points |
| Train stations | high | ~80 | Raw points |
| Subway stations | high | ~70 | Raw points |
| Schools | high | ~600 | Raw points + optional muni count choropleth |
| Playgrounds | partial | ~1,500 | Raw points + optional muni count choropleth |
| Parks | high | ~3,000 | Muni *area* choropleth (acres of parkland per muni) + raw polygons |
| Supermarkets | partial | ~300 | Raw points |
| Restaurants | partial | ~3,000 | Raw points (clustered at low zoom) |
| Cafés | partial | ~1,000 | Raw points |
| Community centers | partial | ~200 | Raw points |
| Places of worship | partial | ~800 | Raw points |
| Bus stops | high | ~8,000 | Hex density + raw points at high zoom |
| Bike paths | partial | ~4,000 segs | Hex density OR length-per-muni choropleth |
| Footpaths | partial | ~20,000 segs | Hex density |
| Trails | partial | many | Hex density (coverage-first framing) |
| Benches | spotty | ~10,000 | Coverage-first; muni choropleth framed as mapping effort |
| Bike parking | spotty | ~4,000 | Coverage-first |
| Street trees | spotty | ~20,000 | Coverage-first hex density |
| Sports fields | partial | ~3,000 | Raw points + optional count overlay |
| Water bodies | high | ~2,000 polys | Raw polygons |
| Forests | high | ~3,000 polys | Raw polygons |
| Wetlands | high | ~2,000 polys | Raw polygons |
| Primary roads | high | long | Length-per-muni OR raw lines |
| Residential streets | high | long | Hex density |
| Highways | high | modest | Raw lines |
| Residential land | high | moderate | Muni share choropleth (% of muni area) |
| Commercial land | high | moderate | Muni share choropleth |
| Industrial land | high | moderate | Muni share choropleth |
| All buildings | high | ~1M | Hex density |
| Addresses | high | ~800k | Hex density |

This matrix drives Slice 4+ rendering logic. For Slice 3 we ship with raw-only + a cap.

## 11. Slice Plan

### Shipped
- ✅ **Slice 0** — Scaffold + deploy.
- ✅ **Slice 1** — Playgrounds in Salem end-to-end.
- ✅ **Slice 1b** — Real geometries + zoom-driven cross-fade.
- ✅ **Slice 1c** — Click-to-inspect detail panel + GeoJSON export.
- ✅ **Slice 2** — Curated subtype taxonomy, working dropdowns, muni focus UX.
- ✅ **Slice 3** — Regional view v1: "Entire MAPC region" option, region-wide query with 5k render cap, completeness tiers, spotty-tier coverage caveat, MA state boundary reference line.
- ✅ **Slice 3.5** — Truth-check pass: filter corrections across subtypes after spot-checking results.
- ✅ **Slice 3.5.1** — Raise region render threshold to 25,000 based on observed MapLibre performance.
- ✅ **Slice 4 (a.k.a. 4A)** — Muni-count choropleth with a quantile-bin sky-blue ramp, separate "no data" color, legend with bin ranges, ETL relation handling for area features.
- ✅ **Slice 5** — Tabular view: TanStack Table + virtualization, two scopes (feature / muni), curated per-category columns, column chooser with fill-rate badges, hide-below-X% slider, Municipality as a standard feature column (PIP-stamped client-side), over-threshold count-only path for focused queries.
- ✅ **Slice 5.1** — Region-layers polish + CSV export: "Region layers" card with points / choropleth toggles, per-bin muni counts + click-to-expand with map highlight, feature-scope CSV (with GeoJSON geometry + centroid lat/lon), muni-scope CSV.

### Skipped / deferred
- ⛔ **Slice 4B — Hex density.** Deferred to post-v1. Slice 4A's muni choropleth plus the render-cap + count-only path covers the "continuous phenomena" cases adequately for a first release. Hex binning warrants its own future slice if and when a real use case pushes for it.

### Next up (pre-v1)
- **Slice 6 — URL state.** Sharable `?feature=<subtype>&muni=<slug>` URLs with two-way sync. Covers the "send this map to a colleague" use case. State model already supports it — wiring only. Also reset the view parameter (map / table) and table column selection to safe defaults on load, or encode those in the URL too (TBD).
- **Slice 7 — Summary tab.** Count, density, top-N values for the most-filled tags. Per §9, this is where completeness becomes a first-class summary statistic, not just a column badge. Scope includes a headline number, a couple of charts, and a textual "N of the top 10 values cover X% of features" style summary.
- **Slice 8 — About page + snapshot badge.** About copy (source, methodology, OSM attribution, completeness philosophy). Snapshot date wired from `_manifest.json` into the footer. Minimal polish pass on any rough edges before sharing the URL with 5–10 colleagues for validation.

### Post-v1
- **Advanced tag query mode** — power-user category + arbitrary tag filter UI. Sketch in §7.3.
- **Hex density** (née Slice 4B) — as a dedicated slice if the use case materializes.
- **Normalization** — per-capita, per-mile-of-road, per-acre. Requires a defensible denominator dataset.
- **Sub-region geography** as a selectable unit (Inner Core, North Shore, etc.).
- **Authoritative-source joins** (DESE school roster, DPH licensed-facility list) for ratio-to-truth completeness signals.

### Rough time estimates (remaining)
Slice 6: 1 evening. Slice 7: 2 evenings. Slice 8: 1 evening + writing time.

## 12. Tech Stack (as-built)

- **Scaffold:** Vite 8 + React 19 + TypeScript
- **Map:** MapLibre GL JS 5.x
- **Viz layers:** native MapLibre (no deck.gl yet — may add if we need 3D or very large datasets)
- **Data runtime:** DuckDB-WASM (spatial extension not yet enabled — PIP done in JS)
- **Geom ops (supplementary):** in-house WKB parser + ray-cast PIP in `src/lib/geo.ts`; Turf.js not yet pulled in
- **Table:** TanStack Table (planned for Slice 5)
- **UI:** Tailwind v4. No shadcn/ui yet; custom components are simple enough not to need it
- **Hosting:** Vercel (free tier)
- **Data format:** Parquet (per category) + GeoJSON (muni boundaries, MAPC boundary, manifest)
- **ETL:** Python (`etl/build_parquet.py`) + osmium CLI

## 13. Acceptance Criteria for v1 Launch

Updated from the original PRD:

- [x] User can pick feature + municipality and see results on a map within 3 seconds. *(Slice 2)*
- [x] User can export the current result as GeoJSON. *(Slice 1c)*
- [x] All 12 categories and all 101 municipalities are selectable. *(Slice 2)*
- [x] Map click on a muni polygon commits the geographic selection. *(Slice 2)*
- [x] OSM attribution visible; snapshot "TBD" placeholder in footer. *(Slice 0)*
- [x] MAPC-wide feature queries work. *(Slice 3)*
- [x] Regional view renders defensibly for at least one representative of each (low-N, mid-N, high-N) × (discrete, continuous) combination. *(Slice 3 baseline; Slice 4 refinement)*
- [x] User can toggle to a table view and filter by any column. *(Slice 5)*
- [x] Fill-rate indicators on table columns. *(Slice 5)*
- [x] CSV export. *(Slice 5.1)*
- [ ] Sharable URL state — `?feature=…&muni=…`. *(Slice 6)*
- [ ] Summary stats panel. *(Slice 7)*
- [ ] About page + snapshot date visible. *(Slice 8)*
- [ ] Deployed at a public URL Stephen can share with 5–10 colleagues for validation.

## 14. Design Principles (codified from discussions)

1. **Descriptive over interpretive.** This tool surfaces counts and locations. Indexes and composites belong elsewhere.
2. **Completeness is a feature, not a footnote.** OSM coverage is itself information a planner can use.
3. **Within-muni spatial texture is the edge.** Summary dashboards already exist; this product's unique value is showing where things are *inside* a place.
4. **The map is primary, but controls stay available.** Focus mode preserves filter controls in a compact bar rather than hiding them.
5. **Ship skinny slices with honest caps.** Real-world numbers from a capped Slice 3 beat design against theoretical numbers.
6. **Hex bins for patterns, muni bins for places.** Don't conflate the two.

## 15. Open Questions / Deferred Decisions

- **Completeness tier values.** First-draft tiering in §9.3 and §10.3 is hand-wavey; needs a pass with someone who knows MAPC's data landscape better than I do.
- **Authoritative-source joins.** Where we know the true count (e.g., DESE school roster), should the completeness view show `(OSM count) / (authoritative)` as an explicit ratio? Probably yes eventually, but out of scope for Slice 3.
- **Snapshot freshness.** Footer currently says "Snapshot: TBD." Need to wire `snapshot` from `_manifest.json` into the footer (Slice 8).
- **URL state scope.** Slice 6 wires `?feature=` and `?muni=`. Open: should `?view=` (map/table), `?bin=` (active bin highlight), and table column selection also round-trip? Arguing for yes ("send someone the Salem playgrounds *table* pre-scrolled to the surface column"). Arguing against: URL bloat and fragile state. Probably start with feature+muni and expand if real usage pushes for more.
- **Sub-region geography.** "MAPC sub-region" is used for the muni-dropdown grouping. Should sub-regions be selectable as a geography unit too ("Inner Core," "North Shore")? Post-v1.
- **Advanced mode.** Post-v1; sketch only (§7.3).
- **Hex density.** Deferred from v1 (was Slice 4B). Revisit post-launch if a use case materializes.
- **Normalization.** Post-v1. Blocked on picking a defensible denominator dataset.
- **Mobile.** Deferred.
- **About copy.** Who writes it.
- **Branding.** Neutral for now. Eventually may want to match MAPC/DataCommon visual language.

---

*This document is the source of truth. When it drifts from the code, fix the code or fix the document — don't leave the drift.*
