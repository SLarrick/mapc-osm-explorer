import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { bboxOfPoints } from "../lib/geo";

/**
 * Base map centered on MAPC region.
 *
 * Renders:
 *   - Light vector base from OpenFreeMap Positron (no API key required)
 *   - MAPC outer boundary as a thick soft outline
 *   - Municipality polygons with hover highlight
 *   - Optional query-results layer (points) supplied via props
 */
const BASE_STYLE = "https://tiles.openfreemap.org/styles/positron";

// MAPC region roughly fills this envelope; using it as the initial view
const INITIAL_CENTER: [number, number] = [-71.06, 42.36];
const INITIAL_ZOOM = 8.4;

interface MapViewProps {
  /** Optional overlay of query-result points. When it changes, the map
   *  rerenders the `results` source and fits to its bbox. */
  results?: GeoJSON.FeatureCollection<GeoJSON.Point> | null;
}

export function MapView({ results }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const mapReadyRef = useRef(false);

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

      // Hover interaction
      let hoveredId: string | number | null = null;

      map.on("mousemove", "munis-fill", (e) => {
        if (!e.features?.length) return;
        map.getCanvas().style.cursor = "pointer";
        const id = e.features[0].id as string | number | undefined;
        if (hoveredId !== null && hoveredId !== id) {
          map.setFeatureState(
            { source: "mapc-munis", id: hoveredId },
            { hover: false },
          );
        }
        if (id !== undefined) {
          hoveredId = id;
          map.setFeatureState(
            { source: "mapc-munis", id },
            { hover: true },
          );
        }
      });

      map.on("mouseleave", "munis-fill", () => {
        map.getCanvas().style.cursor = "";
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
        const bbox = turfBbox(boundary);
        map.fitBounds(bbox as [number, number, number, number], {
          padding: 24,
          duration: 0,
        });
      } catch {
        /* fallback to initial center/zoom */
      }

      mapReadyRef.current = true;
      // If results arrived before map finished loading, render them now
      if (resultsRef.current) renderResults(map, resultsRef.current);
    });

    return () => {
      map.remove();
      mapRef.current = null;
      mapReadyRef.current = false;
    };
  }, []);

  // Keep the latest results in a ref so the load handler can see them
  const resultsRef = useRef<typeof results>(null);
  useEffect(() => {
    resultsRef.current = results ?? null;
    const map = mapRef.current;
    if (!map || !mapReadyRef.current) return;
    renderResults(map, results ?? null);
  }, [results]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full min-h-[480px] rounded-lg overflow-hidden border border-slate-200 bg-slate-100"
    />
  );
}

/**
 * Add or update a `results-points` source + `results-circle` layer. When
 * `results` is null or empty, the source is cleared and the map refits to
 * the MAPC boundary.
 */
function renderResults(
  map: maplibregl.Map,
  results: GeoJSON.FeatureCollection<GeoJSON.Point> | null,
): void {
  const empty: GeoJSON.FeatureCollection<GeoJSON.Point> = {
    type: "FeatureCollection",
    features: [],
  };
  const data = results ?? empty;

  const existing = map.getSource("results-points") as
    | maplibregl.GeoJSONSource
    | undefined;
  if (existing) {
    existing.setData(data);
  } else {
    map.addSource("results-points", { type: "geojson", data });
    map.addLayer({
      id: "results-halo",
      type: "circle",
      source: "results-points",
      paint: {
        "circle-radius": 10,
        "circle-color": "#0ea5e9", // sky-500
        "circle-opacity": 0.18,
      },
    });
    map.addLayer({
      id: "results-circle",
      type: "circle",
      source: "results-points",
      paint: {
        "circle-radius": 5,
        "circle-color": "#0284c7", // sky-600
        "circle-stroke-width": 1.5,
        "circle-stroke-color": "#ffffff",
      },
    });
  }

  if (data.features.length > 0) {
    const pts = data.features.map(
      (f) => f.geometry.coordinates as [number, number],
    );
    const bbox = bboxOfPoints(pts);
    if (bbox) {
      map.fitBounds(bbox as [number, number, number, number], {
        padding: 60,
        maxZoom: 14,
        duration: 600,
      });
    }
  }
}

/** Minimal GeoJSON bbox without pulling in turf. Accepts Feature or FeatureCollection. */
function turfBbox(
  gj: GeoJSON.Feature | GeoJSON.FeatureCollection,
): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const features =
    gj.type === "FeatureCollection" ? gj.features : [gj];
  for (const feat of features) {
    walkCoords(feat.geometry, (x, y) => {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    });
  }
  return [minX, minY, maxX, maxY];
}

function walkCoords(
  geom: GeoJSON.Geometry | null,
  fn: (x: number, y: number) => void,
): void {
  if (!geom) return;
  const recurse = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === "number") {
      fn(c[0] as number, c[1] as number);
    } else if (Array.isArray(c)) {
      for (const child of c) recurse(child);
    }
  };
  if ("coordinates" in geom) recurse(geom.coordinates);
}
