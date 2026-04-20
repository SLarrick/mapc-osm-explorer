import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { ChoroplethBins } from "../lib/choropleth";

/**
 * Base map centered on MAPC region.
 *
 * Renders:
 *   - Light vector base from OpenFreeMap Positron (no API key required)
 *   - MAPC outer boundary as a thick soft outline
 *   - Municipality polygons. Pre-selection: blue hover "juice" that nudges
 *     the user to click a muni. Post-selection: the selected muni has a
 *     bolder outline and no fill, neighboring munis dim to gray (so the
 *     selection reads as scoped), and hover on *other* munis is lighter
 *     (still switchable, not competing with the data overlay).
 *   - Optional query-results overlay with hover tooltips + click-to-select.
 */
const BASE_STYLE = "https://tiles.openfreemap.org/styles/positron";

// MAPC region roughly fills this envelope; using it as the initial view
const INITIAL_CENTER: [number, number] = [-71.06, 42.36];
const INITIAL_ZOOM = 8.4;

interface MapViewProps {
  /** Optional overlay of query-result features. When it changes, the map
   *  rerenders the `results-data` source and fits to its bbox. */
  results?: GeoJSON.FeatureCollection<GeoJSON.Geometry> | null;
  /** Currently-selected feature id (matches top-level `feature.id`). */
  selectedId?: string | null;
  /** Called with a feature id on click, or null when the user clicks
   *  empty map space to deselect. */
  onSelectFeature?: (id: string | null) => void;
  /** Currently-selected municipality slug. When set, drives the
   *  dim-others / bolder-outline / focused-view treatment. */
  selectedMuniSlug?: string | null;
  /** Called when the user clicks a muni polygon on the map. */
  onSelectMuni?: (slug: string) => void;
  /** Slice 4A choropleth. When set, the muni-fill layer paints by
   *  per-muni feature count using the provided bins. Takes precedence
   *  over the pre-selection "juice" fill; coexists with post-selection
   *  (the selected muni still gets the bolder outline, but its fill
   *  stays on the choropleth color for consistency with its neighbors
   *  in the regional view).
   *
   *  Only meaningful in region mode — focused mode (selectedMuniSlug
   *  not null) should pass null here so the neighbor-dim style returns. */
  choropleth?: {
    counts: Map<string, number>;
    bins: ChoroplethBins;
  } | null;
  /** Muni slugs to highlight with a bolder accent outline. Used for the
   *  legend's bin-click "show me which munis are in this bin" affordance.
   *  Layered above the selection outline, distinct color so selection
   *  vs bin-highlight are visually separate. */
  highlightedMuniSlugs?: string[];
}

// Layer ids we hit-test for the hover tooltip. The circle layer rides the
// centroids source so it covers both native points and polygon centroids.
const RESULT_LAYER_IDS = [
  "results-fill",
  "results-line",
  "results-circle",
];

// Zoom thresholds for the cross-fade between "pins" and "real shapes".
// At MAPC-region zoom (~8.4) the polygons would be a few pixels across —
// invisible. So we show uniform pins until you're clearly inside a muni
// (z ≥ 12.5), then fade the shapes in and shrink the pins.
const Z_SHAPES_FADE_START = 12.5;
const Z_SHAPES_FADE_END = 14;

// Paint expressions for the muni-fill layer in the two modes. We swap the
// whole expression via setPaintProperty when selection state changes.
const MUNI_FILL_PRESELECTION: {
  color: maplibregl.ExpressionSpecification;
  opacity: maplibregl.ExpressionSpecification;
} = {
  color: [
    "case",
    ["boolean", ["feature-state", "hover"], false],
    "#0ea5e9", // sky-500 — the blue "juice"
    "#f1f5f9", // slate-100 — ambient
  ],
  opacity: [
    "case",
    ["boolean", ["feature-state", "hover"], false],
    0.25,
    0.15,
  ],
};

/**
 * Choropleth fill paint: a `step` expression on feature-state `count`.
 * Count 0 or missing → the neutral zeroColor. Positive counts step up
 * through the 6-color ramp by the computed bin stops.
 *
 * Opacity is uniform (no hover juice) — the shaded fill is the signal;
 * juicing it would fight the count legibility.
 */
function muniFillChoropleth(bins: ChoroplethBins): {
  color: maplibregl.ExpressionSpecification;
  opacity: maplibregl.ExpressionSpecification;
} {
  // Default count to 0 when feature-state hasn't been set (unknown muni
  // or cleared state). MapLibre's ["number", expr, fallback] coerces
  // null → fallback.
  const count: maplibregl.ExpressionSpecification = [
    "number",
    ["feature-state", "count"],
    0,
  ];
  return {
    color: [
      "case",
      ["<=", count, 0],
      bins.zeroColor,
      [
        "step",
        count,
        bins.colors[0],
        bins.stops[0] + 1,
        bins.colors[1],
        bins.stops[1] + 1,
        bins.colors[2],
        bins.stops[2] + 1,
        bins.colors[3],
        bins.stops[3] + 1,
        bins.colors[4],
        bins.stops[4] + 1,
        bins.colors[5],
      ],
    ],
    opacity: [
      "case",
      ["<=", count, 0],
      0.35, // dim but visible so "no data" munis still read as part of the region
      0.7, // shaded fill — dominant signal
    ],
  };
}

function muniFillPostSelection(slug: string): {
  color: maplibregl.ExpressionSpecification;
  opacity: maplibregl.ExpressionSpecification;
} {
  return {
    // Selected: transparent (no fill, data can breathe).
    // Others: slate dim mask; lighter gray on hover (signal: still clickable
    // to switch) — deliberately NOT blue, to avoid competing with the
    // selection accent + data colors.
    color: [
      "case",
      ["==", ["get", "slug"], slug],
      "#ffffff", // value ignored because opacity is 0, but must parse
      [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        "#94a3b8", // slate-400
        "#cbd5e1", // slate-300
      ],
    ],
    opacity: [
      "case",
      ["==", ["get", "slug"], slug],
      0,
      [
        "case",
        ["boolean", ["feature-state", "hover"], false],
        0.35,
        0.25,
      ],
    ],
  };
}

export function MapView({
  results,
  selectedId,
  onSelectFeature,
  selectedMuniSlug,
  onSelectMuni,
  choropleth,
  highlightedMuniSlugs,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const munisFcRef = useRef<GeoJSON.FeatureCollection | null>(null);
  const boundaryBboxRef = useRef<[number, number, number, number] | null>(null);

  // Keep latest callbacks in refs so the load-time handlers always see
  // the current closures.
  const onSelectRef = useRef(onSelectFeature);
  onSelectRef.current = onSelectFeature;
  const onSelectMuniRef = useRef(onSelectMuni);
  onSelectMuniRef.current = onSelectMuni;

  const prevSelectedIdRef = useRef<string | null>(null);

  // Choropleth state: latest prop kept in a ref so the map-load callback
  // can re-apply on initial render (user could pick a feature + region
  // before the map has finished loading).
  const choroplethRef = useRef<typeof choropleth>(choropleth ?? null);
  choroplethRef.current = choropleth ?? null;

  // Same pattern for bin-highlight slugs so the map-load handler can
  // apply an initial highlight if one was set before map was ready.
  const highlightedMuniSlugsRef = useRef<string[]>(highlightedMuniSlugs ?? []);
  highlightedMuniSlugsRef.current = highlightedMuniSlugs ?? [];

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: true },
    });

    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "top-right",
    );
    mapRef.current = map;

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 10,
      className: "results-popup",
    });
    popupRef.current = popup;

    map.on("load", async () => {
      const [boundaryRes, muniRes, maRes] = await Promise.all([
        fetch("/data/mapc-boundary.geojson"),
        fetch("/data/mapc-municipalities.geojson"),
        // MA boundary is optional: if the fetch script hasn't been run,
        // we skip the state-boundary layer without breaking the map.
        fetch("/data/ma-boundary.geojson").catch(() => null),
      ]);
      const boundary = await boundaryRes.json();
      const munis = await muniRes.json();
      const ma =
        maRes && maRes.ok ? await maRes.json().catch(() => null) : null;
      munisFcRef.current = munis;
      boundaryBboxRef.current = boundsOfFeatureCollection(boundary);

      map.addSource("mapc-boundary", { type: "geojson", data: boundary });
      map.addSource("mapc-munis", {
        type: "geojson",
        data: munis,
        promoteId: "slug",
      });
      if (ma) {
        map.addSource("ma-state-boundary", { type: "geojson", data: ma });
      }

      // Municipality fill (hoverable)
      map.addLayer({
        id: "munis-fill",
        type: "fill",
        source: "mapc-munis",
        paint: {
          "fill-color": MUNI_FILL_PRESELECTION.color,
          "fill-opacity": MUNI_FILL_PRESELECTION.opacity,
        },
      });

      // Municipality outlines (ambient, thin)
      map.addLayer({
        id: "munis-outline",
        type: "line",
        source: "mapc-munis",
        paint: {
          "line-color": "#94a3b8", // slate-400
          "line-width": 0.6,
        },
      });

      // Massachusetts state boundary — reference line, intentionally
      // lighter + thinner than the MAPC boundary. Its job is purely to
      // anchor the eye geographically ("MAPC sits inside MA"); it should
      // not compete visually with the MAPC emphasis or with data layers.
      // Only drawn when the /data/ma-boundary.geojson asset is present.
      if (ma) {
        map.addLayer({
          id: "ma-state-boundary-outline",
          type: "line",
          source: "ma-state-boundary",
          paint: {
            "line-color": "#64748b", // slate-500
            "line-width": 0.9,
            "line-opacity": 0.55,
            "line-dasharray": [4, 3],
          },
        });
      }

      // MAPC outer boundary — thick, on top of munis and state line
      map.addLayer({
        id: "mapc-boundary-outline",
        type: "line",
        source: "mapc-boundary",
        paint: {
          "line-color": "#0f172a", // slate-900
          "line-width": 1.8,
          "line-opacity": 0.85,
        },
      });

      // Bolder outline just for the SELECTED muni. Driven by a filter that
      // starts matching nothing and gets updated when a selection comes in.
      map.addLayer({
        id: "munis-selected-outline",
        type: "line",
        source: "mapc-munis",
        filter: ["==", ["get", "slug"], "__none__"],
        paint: {
          "line-color": "#0f172a", // slate-900
          "line-width": 3,
          "line-opacity": 1,
        },
      });

      // Bin-highlight outline — the legend's "show me which munis are in
      // this bin" affordance. Sky-600 accent so it's visually distinct
      // from the slate-900 selection outline. Filter starts empty,
      // gets set from the highlightedMuniSlugs prop.
      map.addLayer({
        id: "munis-bin-highlight-outline",
        type: "line",
        source: "mapc-munis",
        filter: ["in", ["get", "slug"], ["literal", []]],
        paint: {
          "line-color": "#0284c7", // sky-600
          "line-width": 2.25,
          "line-opacity": 0.95,
        },
      });

      // Muni hover highlight
      let hoveredId: string | number | null = null;
      map.on("mousemove", "munis-fill", (e) => {
        if (!e.features?.length) return;
        const id = e.features[0].id as string | number | undefined;
        if (hoveredId !== null && hoveredId !== id) {
          map.setFeatureState(
            { source: "mapc-munis", id: hoveredId },
            { hover: false },
          );
        }
        if (id !== undefined) {
          hoveredId = id;
          map.setFeatureState({ source: "mapc-munis", id }, { hover: true });
          map.getCanvas().style.cursor = "pointer";
        }
      });
      map.on("mouseleave", "munis-fill", () => {
        if (hoveredId !== null) {
          map.setFeatureState(
            { source: "mapc-munis", id: hoveredId },
            { hover: false },
          );
          hoveredId = null;
        }
        map.getCanvas().style.cursor = "";
      });

      // Initial fit: MAPC boundary
      if (boundaryBboxRef.current)
        map.fitBounds(boundaryBboxRef.current, { padding: 24, duration: 0 });

      // Click handler: priority is result feature > muni > empty (deselect).
      map.on("click", (e) => {
        const resultFeats = map.queryRenderedFeatures(e.point, {
          layers: RESULT_LAYER_IDS.filter((id) =>
            Boolean(map.getLayer(id)),
          ),
        });
        if (resultFeats.length > 0) {
          const f = resultFeats[0];
          const id =
            (f.properties as { uid?: string } | null)?.uid ?? null;
          onSelectRef.current?.(id);
          return;
        }
        const muniFeats = map.queryRenderedFeatures(e.point, {
          layers: ["munis-fill"],
        });
        if (muniFeats.length > 0) {
          const slug = (
            muniFeats[0].properties as { slug?: string } | null
          )?.slug;
          if (slug) {
            onSelectMuniRef.current?.(slug);
            return;
          }
        }
        // Empty space → deselect any currently-highlighted result feature
        onSelectRef.current?.(null);
      });

      mapReadyRef.current = true;
      if (resultsRef.current) renderResults(map, popup, resultsRef.current);
      if (prevSelectedIdRef.current !== selectedIdRef.current) {
        applySelection(map, prevSelectedIdRef.current, selectedIdRef.current);
        prevSelectedIdRef.current = selectedIdRef.current;
      }
      // Apply initial muni selection + choropleth, if any. Choropleth
      // state (per-muni count) is applied first so the fill-paint swap
      // sees up-to-date feature-state.
      applyChoroplethFeatureState(
        map,
        choroplethRef.current?.counts ?? null,
        munisFcRef.current,
      );
      applyMuniSelection(
        map,
        selectedMuniSlugRef.current,
        munisFcRef.current,
        boundaryBboxRef.current,
      );
      applyMuniFillPaint(
        map,
        selectedMuniSlugRef.current,
        choroplethRef.current,
      );
      applyBinHighlight(map, highlightedMuniSlugsRef.current);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
      popupRef.current = null;
    };
  }, []);

  // Keep the latest results in a ref so the load handler can see them
  const resultsRef = useRef<typeof results>(null);
  useEffect(() => {
    resultsRef.current = results ?? null;
    const map = mapRef.current;
    const popup = popupRef.current;
    if (!map || !popup || !mapReadyRef.current) return;
    renderResults(map, popup, results ?? null);
    // Re-apply selection after data swap — feature-state is cleared when
    // source data changes, so we need to reassert it.
    applySelection(map, null, selectedIdRef.current);
  }, [results]);

  // Sync selectedId prop → MapLibre feature-state on both result sources
  const selectedIdRef = useRef<string | null>(selectedId ?? null);
  useEffect(() => {
    const next = selectedId ?? null;
    selectedIdRef.current = next;
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    applySelection(map, prevSelectedIdRef.current, next);
    prevSelectedIdRef.current = next;
  }, [selectedId]);

  // Sync selectedMuniSlug prop → selected-outline filter, camera fly-to,
  // and fill-paint swap (coordinated with choropleth state).
  const selectedMuniSlugRef = useRef<string | null>(selectedMuniSlug ?? null);
  useEffect(() => {
    const slug = selectedMuniSlug ?? null;
    selectedMuniSlugRef.current = slug;
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    applyMuniSelection(map, slug, munisFcRef.current, boundaryBboxRef.current);
    applyMuniFillPaint(map, slug, choroplethRef.current);
  }, [selectedMuniSlug]);

  // Sync choropleth prop → per-muni feature-state + fill-paint swap.
  // Feature-state is cleared and re-set on every change; the paint
  // expression reads feature-state["count"] and the ["step"] stops
  // come from bins in the paint expression itself.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    applyChoroplethFeatureState(
      map,
      choropleth?.counts ?? null,
      munisFcRef.current,
    );
    applyMuniFillPaint(map, selectedMuniSlugRef.current, choropleth ?? null);
  }, [choropleth]);

  // Sync highlightedMuniSlugs prop → bin-highlight outline filter.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    applyBinHighlight(map, highlightedMuniSlugs ?? []);
  }, [highlightedMuniSlugs]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[480px] rounded-lg overflow-hidden border border-slate-200 bg-slate-100"
    />
  );
}

/**
 * Update the selected-muni outline filter + fly the camera to its bbox
 * (or back to the MAPC extent on deselect). Does NOT touch the muni-fill
 * paint — that's `applyMuniFillPaint`'s responsibility, because the
 * fill has a third state (choropleth) that this function doesn't know
 * about.
 */
function applyMuniSelection(
  map: maplibregl.Map,
  slug: string | null,
  munisFc: GeoJSON.FeatureCollection | null,
  regionBbox: [number, number, number, number] | null,
): void {
  if (!map.getLayer("munis-selected-outline")) return;

  if (slug) {
    map.setFilter("munis-selected-outline", ["==", ["get", "slug"], slug]);
    if (munisFc) {
      const feat = munisFc.features.find(
        (f) => (f.properties as { slug?: string } | null)?.slug === slug,
      );
      if (feat) {
        const bbox = boundsOfFeatureCollection(feat);
        if (bbox)
          map.fitBounds(bbox, {
            padding: 40,
            duration: 600,
            maxZoom: 14,
          });
      }
    }
  } else {
    map.setFilter("munis-selected-outline", [
      "==",
      ["get", "slug"],
      "__none__",
    ]);
    if (regionBbox)
      map.fitBounds(regionBbox, {
        padding: 24,
        duration: 600,
      });
  }
}

/**
 * Three-mode fill-paint swap. Priority: choropleth > post-selection >
 * pre-selection. App.tsx enforces that choropleth and selectedMuniSlug
 * aren't both set (choropleth clears on muni-focus), but we handle the
 * collision gracefully just in case.
 */
function applyMuniFillPaint(
  map: maplibregl.Map,
  selectedMuniSlug: string | null,
  choropleth: MapViewProps["choropleth"] | null,
): void {
  if (!map.getLayer("munis-fill")) return;

  let paint: {
    color: maplibregl.ExpressionSpecification;
    opacity: maplibregl.ExpressionSpecification;
  };
  if (choropleth) {
    paint = muniFillChoropleth(choropleth.bins);
  } else if (selectedMuniSlug) {
    paint = muniFillPostSelection(selectedMuniSlug);
  } else {
    paint = {
      color: MUNI_FILL_PRESELECTION.color,
      opacity: MUNI_FILL_PRESELECTION.opacity,
    };
  }
  map.setPaintProperty("munis-fill", "fill-color", paint.color);
  map.setPaintProperty("munis-fill", "fill-opacity", paint.opacity);
}

/**
 * Update the bin-highlight outline filter to match the given slug list.
 * Empty list → filter matches nothing.
 */
function applyBinHighlight(map: maplibregl.Map, slugs: string[]): void {
  if (!map.getLayer("munis-bin-highlight-outline")) return;
  map.setFilter("munis-bin-highlight-outline", [
    "in",
    ["get", "slug"],
    ["literal", slugs],
  ]);
}

/**
 * Clear + re-set the `count` feature-state on every muni. MapLibre reads
 * feature-state by id, so we use promoteId="slug" → id=slug. Passing
 * null clears all counts (e.g. when the user backs out to landing).
 */
function applyChoroplethFeatureState(
  map: maplibregl.Map,
  counts: Map<string, number> | null,
  munisFc: GeoJSON.FeatureCollection | null,
): void {
  if (!munisFc) return;
  for (const f of munisFc.features) {
    const slug = (f.properties as { slug?: string } | null)?.slug;
    if (!slug) continue;
    const n = counts?.get(slug) ?? 0;
    map.setFeatureState({ source: "mapc-munis", id: slug }, { count: n });
  }
}

/**
 * Add or update the `results-data` + `results-centroids` sources and
 * their layers. Zoom-interpolated paint properties cross-fade between
 * "pins only" (low zoom) and "real shapes" (high zoom), so the overlay
 * reads consistently from regional zoom down to neighborhood zoom.
 * Hover on any interactive layer pops a tooltip with the feature name.
 */
function renderResults(
  map: maplibregl.Map,
  popup: maplibregl.Popup,
  results: GeoJSON.FeatureCollection<GeoJSON.Geometry> | null,
): void {
  const empty: GeoJSON.FeatureCollection<GeoJSON.Geometry> = {
    type: "FeatureCollection",
    features: [],
  };
  const data = results ?? empty;
  const centroids = centroidsOf(data);

  const existing = map.getSource("results-data") as
    | maplibregl.GeoJSONSource
    | undefined;

  if (existing) {
    existing.setData(data);
    const existingCentroids = map.getSource("results-centroids") as
      | maplibregl.GeoJSONSource
      | undefined;
    existingCentroids?.setData(centroids);
  } else {
    // promoteId: "uid" — tell MapLibre to use properties.uid as the
    // feature id. Without this, our string ids like "way/123" get coerced
    // to 0 and setFeatureState / feature-state lookups all collide.
    map.addSource("results-data", {
      type: "geojson",
      data,
      promoteId: "uid",
    });
    map.addSource("results-centroids", {
      type: "geojson",
      data: centroids,
      promoteId: "uid",
    });

    // MapLibre forbids putting `["zoom"]` inside anything other than a
    // top-level `interpolate`/`step`. So selection-aware + zoom-driven
    // paint has to live as interpolate-at-top with a `case` inside each
    // stop value.
    const zoomSel = (
      stops: Array<[number, number, number]>, // [zoom, unselected, selected]
    ): maplibregl.ExpressionSpecification => {
      const expr: unknown[] = ["interpolate", ["linear"], ["zoom"]];
      for (const [z, uns, sel] of stops) {
        expr.push(z);
        expr.push([
          "case",
          ["boolean", ["feature-state", "selected"], false],
          sel,
          uns,
        ]);
      }
      return expr as maplibregl.ExpressionSpecification;
    };

    // Pure selection (no zoom) — plain `case` is fine.
    const FILL_COLOR: maplibregl.ExpressionSpecification = [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      "#f59e0b", // amber-500
      "#0284c7", // sky-600
    ];
    const STROKE_COLOR: maplibregl.ExpressionSpecification = [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      "#b45309", // amber-700
      "#0369a1", // sky-700
    ];
    const CIRCLE_COLOR_HALO: maplibregl.ExpressionSpecification = [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      "#f59e0b",
      "#0ea5e9", // sky-500
    ];
    const CIRCLE_COLOR_DOT: maplibregl.ExpressionSpecification = [
      "case",
      ["boolean", ["feature-state", "selected"], false],
      "#f59e0b",
      "#0284c7", // sky-600
    ];

    // Polygon fill
    map.addLayer({
      id: "results-fill",
      type: "fill",
      source: "results-data",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": FILL_COLOR,
        "fill-opacity": zoomSel([
          [Z_SHAPES_FADE_START, 0, 0.5],
          [Z_SHAPES_FADE_END, 0.3, 0.5],
        ]),
      },
    });

    // Polygon outlines
    map.addLayer({
      id: "results-outline",
      type: "line",
      source: "results-data",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": STROKE_COLOR,
        "line-width": zoomSel([
          [Z_SHAPES_FADE_START, 0, 2.5],
          [Z_SHAPES_FADE_END, 1.8, 2.5],
        ]),
        "line-opacity": zoomSel([
          [Z_SHAPES_FADE_START, 0, 1],
          [Z_SHAPES_FADE_END, 1, 1],
        ]),
      },
    });

    // LineString features (streets, trails, paths). Visible at every zoom —
    // the line *is* the feature's visual identity, and we suppress the
    // usual centroid pin so the line has the stage to itself (see
    // centroidsOf). Width steps up slightly at neighborhood zooms, and
    // selected features get a thicker + warmer stroke.
    map.addLayer({
      id: "results-line",
      type: "line",
      source: "results-data",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": STROKE_COLOR,
        "line-width": zoomSel([
          [8, 1.8, 3],
          [Z_SHAPES_FADE_START, 2.2, 3.5],
          [Z_SHAPES_FADE_END, 3, 4.5],
        ]),
        "line-opacity": zoomSel([
          [8, 0.85, 1],
          [Z_SHAPES_FADE_END, 1, 1],
        ]),
      },
    });

    // Centroid halo + dot. Every feature (point or polygon) gets an
    // anchor pin from the centroids source.
    map.addLayer({
      id: "results-halo",
      type: "circle",
      source: "results-centroids",
      paint: {
        "circle-radius": zoomSel([
          [10, 8, 14],
          [13, 10, 14],
          [16, 6, 14],
        ]),
        "circle-color": CIRCLE_COLOR_HALO,
        "circle-opacity": zoomSel([
          [12, 0.18, 0.35],
          [15, 0, 0.35],
        ]),
      },
    });
    map.addLayer({
      id: "results-circle",
      type: "circle",
      source: "results-centroids",
      paint: {
        "circle-radius": zoomSel([
          [10, 4.5, 7],
          [13, 5, 7],
          [16, 3.5, 7],
        ]),
        "circle-color": CIRCLE_COLOR_DOT,
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": zoomSel([
          [13, 1, 1],
          [16, 0.6, 1],
        ]),
        "circle-stroke-opacity": zoomSel([
          [13, 1, 1],
          [16, 0.6, 1],
        ]),
      },
    });

    // Hover → tooltip
    const showTooltip = (e: maplibregl.MapLayerMouseEvent) => {
      const f = e.features?.[0];
      if (!f) return;
      map.getCanvas().style.cursor = "pointer";
      const props = (f.properties ?? {}) as {
        name?: string | null;
        osm_type?: string;
      };
      const name =
        props.name && props.name.trim() !== ""
          ? escapeHtml(props.name)
          : "<em class='text-slate-400'>Unnamed feature</em>";
      const subtitle = props.osm_type
        ? `<div class='text-xs text-slate-500 mt-0.5'>OSM ${escapeHtml(props.osm_type)}</div>`
        : "";
      popup
        .setLngLat(e.lngLat)
        .setHTML(
          `<div class='text-sm font-medium text-slate-800'>${name}</div>${subtitle}`,
        )
        .addTo(map);
    };
    const hideTooltip = () => {
      map.getCanvas().style.cursor = "";
      popup.remove();
    };
    for (const id of RESULT_LAYER_IDS) {
      map.on("mousemove", id, showTooltip);
      map.on("mouseleave", id, hideTooltip);
    }
  }

  if (data.features.length > 0) {
    const bbox = boundsOfFeatureCollection(data);
    if (bbox) {
      map.fitBounds(bbox, {
        padding: 60,
        maxZoom: 16,
        duration: 600,
      });
    }
  } else {
    popup.remove();
  }
}

/**
 * Flip MapLibre `feature-state: selected` off the previous feature and
 * on for the next one, across both results-data and results-centroids.
 */
function applySelection(
  map: maplibregl.Map,
  prev: string | null,
  next: string | null,
): void {
  if (!map.getSource("results-data")) return;
  for (const source of ["results-data", "results-centroids"]) {
    if (prev) {
      map.setFeatureState({ source, id: prev }, { selected: false });
    }
    if (next) {
      map.setFeatureState({ source, id: next }, { selected: true });
    }
  }
}

/** Full-coordinate bbox of any FeatureCollection. */
function boundsOfFeatureCollection(
  fc: GeoJSON.FeatureCollection | GeoJSON.Feature,
): [number, number, number, number] | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const features = fc.type === "FeatureCollection" ? fc.features : [fc];
  for (const feat of features) {
    walkCoords(feat.geometry, (x, y) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
  }
  if (minX === Infinity) return null;
  return [minX, minY, maxX, maxY];
}

function walkCoords(
  geom: GeoJSON.Geometry | null,
  fn: (x: number, y: number) => void,
): void {
  if (!geom) return;
  if (geom.type === "GeometryCollection") {
    for (const g of geom.geometries) walkCoords(g, fn);
    return;
  }
  const recurse = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      fn(c[0] as number, c[1] as number);
    } else if (Array.isArray(c)) {
      for (const child of c) recurse(child);
    }
  };
  if ("coordinates" in geom) recurse(geom.coordinates);
}

/**
 * Project each feature to a Point at the bbox-center of its geometry,
 * preserving properties. Native Point features are passed through
 * unchanged. Used to drive the always-on "anchor pin" circle layers.
 *
 * LineString / MultiLineString features are deliberately excluded: the
 * line itself is the feature's visual identity (a bike path, a street),
 * and stamping a centroid dot on top just reads as "dots along a line"
 * rather than "a line." Lines draw through the `results-line` layer at
 * all zooms, with width tuned to stay visible at regional zoom.
 */
function centroidsOf(
  fc: GeoJSON.FeatureCollection<GeoJSON.Geometry>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const out: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const f of fc.features) {
    const t = f.geometry?.type;
    if (t === "LineString" || t === "MultiLineString") continue;
    const center = bboxCenter(f.geometry);
    if (!center) continue;
    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: center },
      properties: f.properties,
    });
  }
  return { type: "FeatureCollection", features: out };
}

function bboxCenter(
  geom: GeoJSON.Geometry | null,
): [number, number] | null {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  walkCoords(geom, (x, y) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });
  if (minX === Infinity) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
