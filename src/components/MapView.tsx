import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

/**
 * Base map centered on MAPC region.
 *
 * Renders:
 *   - Light vector base from OpenFreeMap Positron (no API key required)
 *   - MAPC outer boundary as a thick soft outline
 *   - Municipality polygons with hover highlight
 *   - Optional query-results overlay (mixed Point/Line/Polygon) with a
 *     hover tooltip showing feature name
 */
const BASE_STYLE = "https://tiles.openfreemap.org/styles/positron";

// MAPC region roughly fills this envelope; using it as the initial view
const INITIAL_CENTER: [number, number] = [-71.06, 42.36];
const INITIAL_ZOOM = 8.4;

interface MapViewProps {
  /** Optional overlay of query-result features. When it changes, the map
   *  rerenders the `results-data` source and fits to its bbox. */
  results?: GeoJSON.FeatureCollection<GeoJSON.Geometry> | null;
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

export function MapView({ results }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASE_STYLE,
      center: INITIAL_CENTER,
      zoom: INITIAL_ZOOM,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;

    // Tooltip popup, created lazily. closeOnClick: false so it doesn't fight
    // with future click-to-select; closeButton: false because it auto-hides.
    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 10,
      className: "results-popup",
    });
    popupRef.current = popup;

    map.on("load", async () => {
      // Load boundary geojsons
      const [boundaryRes, muniRes] = await Promise.all([
        fetch("/data/mapc-boundary.geojson"),
        fetch("/data/mapc-municipalities.geojson"),
      ]);
      const boundary = await boundaryRes.json();
      const munis = await muniRes.json();

      map.addSource("mapc-boundary", { type: "geojson", data: boundary });
      map.addSource("mapc-munis", {
        type: "geojson",
        data: munis,
        promoteId: "slug",
      });

      // Municipality fill (hoverable)
      map.addLayer({
        id: "munis-fill",
        type: "fill",
        source: "mapc-munis",
        paint: {
          "fill-color": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            "#0ea5e9", // sky-500
            "#f1f5f9", // slate-100
          ],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "hover"], false],
            0.25,
            0.15,
          ],
        },
      });

      // Municipality outlines
      map.addLayer({
        id: "munis-outline",
        type: "line",
        source: "mapc-munis",
        paint: {
          "line-color": "#94a3b8", // slate-400
          "line-width": 0.6,
        },
      });

      // MAPC outer boundary — thick, on top of munis
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
      });

      // Fit to MAPC boundary extent with a touch of padding
      try {
        const bbox = boundsOfFeatureCollection(boundary);
        if (bbox)
          map.fitBounds(bbox, { padding: 24, duration: 0 });
      } catch {
        /* fallback to initial center/zoom */
      }

      mapReadyRef.current = true;
      // If results arrived before map finished loading, render them now
      if (resultsRef.current) renderResults(map, popup, resultsRef.current);
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
  }, [results]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[480px] rounded-lg overflow-hidden border border-slate-200 bg-slate-100"
    />
  );
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
    map.addSource("results-data", { type: "geojson", data });
    map.addSource("results-centroids", { type: "geojson", data: centroids });

    // Shared zoom expressions. Polygons/lines fade in as you zoom past
    // the muni-scale threshold; circles shrink + fade so they act as
    // gentle anchor dots at high zoom rather than competing with shapes.
    const fadeInOpacity = (peak: number) =>
      [
        "interpolate",
        ["linear"],
        ["zoom"],
        Z_SHAPES_FADE_START,
        0,
        Z_SHAPES_FADE_END,
        peak,
      ] as maplibregl.ExpressionSpecification;
    const fadeInWidth = (peak: number) =>
      [
        "interpolate",
        ["linear"],
        ["zoom"],
        Z_SHAPES_FADE_START,
        0,
        Z_SHAPES_FADE_END,
        peak,
      ] as maplibregl.ExpressionSpecification;

    // Polygon fill
    map.addLayer({
      id: "results-fill",
      type: "fill",
      source: "results-data",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "fill-color": "#0284c7", // sky-600
        "fill-opacity": fadeInOpacity(0.3),
      },
    });

    // Polygon outlines
    map.addLayer({
      id: "results-outline",
      type: "line",
      source: "results-data",
      filter: ["==", ["geometry-type"], "Polygon"],
      paint: {
        "line-color": "#0369a1", // sky-700
        "line-width": fadeInWidth(1.8),
        "line-opacity": fadeInOpacity(1),
      },
    });

    // LineString features (future-proof for streets / trails)
    map.addLayer({
      id: "results-line",
      type: "line",
      source: "results-data",
      filter: ["==", ["geometry-type"], "LineString"],
      paint: {
        "line-color": "#0369a1",
        "line-width": fadeInWidth(2.4),
        "line-opacity": fadeInOpacity(1),
      },
    });

    // Centroid halo + dot. Every feature (point or polygon) gets an
    // anchor pin from the centroids source.
    map.addLayer({
      id: "results-halo",
      type: "circle",
      source: "results-centroids",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          8,
          13,
          10,
          16,
          6,
        ],
        "circle-color": "#0ea5e9",
        "circle-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          12,
          0.18,
          15,
          0,
        ],
      },
    });
    map.addLayer({
      id: "results-circle",
      type: "circle",
      source: "results-centroids",
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          10,
          4.5,
          13,
          5,
          16,
          3.5,
        ],
        "circle-color": "#0284c7",
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          1,
          16,
          0.6,
        ],
        "circle-stroke-opacity": [
          "interpolate",
          ["linear"],
          ["zoom"],
          13,
          1,
          16,
          0.6,
        ],
      },
    });

    // Hover → tooltip. MapLibre doesn't support multi-layer hover in one
    // handler, so we attach the same logic to each interactive layer.
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
          : "<em class='text-slate-400'>Unnamed playground</em>";
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
 */
function centroidsOf(
  fc: GeoJSON.FeatureCollection<GeoJSON.Geometry>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const out: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const f of fc.features) {
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
