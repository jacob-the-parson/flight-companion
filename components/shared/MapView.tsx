// MapView — the one map: a thin, declarative skin over Leaflet, shared by the
// planner and the log viewer. The caller describes WHAT is on the map (shapes);
// this component owns HOW (layers, colours from the theme tokens, fitting).
// Tiles are OpenStreetMap: no account, no key. With no internet the tiles stay
// blank and everything drawn on top still works.
'use client';
import { useEffect, useRef } from 'react';
import type { Map as LeafletMap, LayerGroup } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useThemeStore } from '@/stores/core/themeStore';

export interface MapPoint {
  lat: number;
  lng: number;
}

export type MapColor = 'series-1' | 'series-2' | 'series-3' | 'series-4' | 'ink' | 'muted' | 'good' | 'critical';

export type MapShape =
  | {
      kind: 'polygon' | 'polyline';
      id: string;
      points: MapPoint[];
      color: MapColor;
      weight?: number;
      dashed?: boolean;
      /** Fill opacity for polygons; 0 = outline only. */
      fill?: number;
      title?: string;
    }
  | { kind: 'circle'; id: string; center: MapPoint; radiusM: number; color: MapColor; fill?: number; dashed?: boolean }
  | {
      kind: 'marker';
      id: string;
      at: MapPoint;
      color: MapColor;
      /** One or two characters drawn inside the marker. */
      label?: string;
      title?: string;
      size?: number;
      draggable?: boolean;
      /** dot = small round point; pin = labelled disc; square = takeoff point. */
      style?: 'dot' | 'pin' | 'square';
      /** Drawn with a second ring in ink, and above its neighbours. */
      selected?: boolean;
    };

interface MapViewProps {
  shapes: MapShape[];
  /** Where to open when there is nothing to frame. */
  initialView?: { center: MapPoint; zoom: number } | null;
  /** Change this value to frame everything on the map. */
  fitKey?: string | number;
  onMapClick?: (p: MapPoint) => void;
  onMarkerDrag?: (id: string, p: MapPoint) => void;
  onMarkerContext?: (id: string) => void;
  onMarkerClick?: (id: string) => void;
  onViewChange?: (center: MapPoint, zoom: number) => void;
  /** Cursor over the map: crosshair while a click places something. */
  cursor?: 'crosshair' | 'grab';
  className?: string;
}

const TOKEN: Record<MapColor, string> = {
  'series-1': '--viz-1',
  'series-2': '--viz-2',
  'series-3': '--viz-3',
  'series-4': '--viz-4',
  ink: '--ink',
  muted: '--ink-muted',
  good: '--status-good',
  critical: '--status-critical',
};

function cssColor(c: MapColor): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(TOKEN[c]).trim();
  return v || '#2a78d6';
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

export function MapView({
  shapes,
  initialView,
  fitKey,
  onMapClick,
  onMarkerDrag,
  onMarkerContext,
  onMarkerClick,
  onViewChange,
  cursor = 'grab',
  className = '',
}: MapViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LayerGroup | null>(null);
  const leafletRef = useRef<typeof import('leaflet') | null>(null);
  const readyRef = useRef(false);
  const isDark = useThemeStore((s) => s.isDark);

  // handlers and data live in refs so the map is built once, not per render
  const handlers = useRef({ onMapClick, onMarkerDrag, onMarkerContext, onMarkerClick, onViewChange });
  const shapesRef = useRef(shapes);
  const lastFit = useRef<string | number | undefined>(undefined);
  // Stores restored from the browser arrive one render after the page hydrates,
  // so the view to open on is read when the map is built, not when it mounts.
  const initialRef = useRef(initialView);
  const openedOnView = useRef(false);
  useEffect(() => {
    handlers.current = { onMapClick, onMarkerDrag, onMarkerContext, onMarkerClick, onViewChange };
    initialRef.current = initialView;
  });

  const draw = () => {
    const L = leafletRef.current;
    const map = mapRef.current;
    const group = layerRef.current;
    if (!L || !map || !group) return;
    group.clearLayers();
    const surface = getComputedStyle(document.documentElement).getPropertyValue('--surface-raised').trim() || '#fff';
    const ink = getComputedStyle(document.documentElement).getPropertyValue('--ink').trim() || '#111';

    for (const s of shapesRef.current) {
      if (s.kind === 'polygon' || s.kind === 'polyline') {
        if (s.points.length < 2) continue;
        const color = cssColor(s.color);
        const latlngs = s.points.map((p) => [p.lat, p.lng] as [number, number]);
        const style = {
          color,
          weight: s.weight ?? 2,
          dashArray: s.dashed ? '6 6' : undefined,
          fillColor: color,
          fillOpacity: s.kind === 'polygon' ? (s.fill ?? 0.1) : 0,
          interactive: false,
          lineJoin: 'round' as const,
          lineCap: 'round' as const,
        };
        (s.kind === 'polygon' ? L.polygon(latlngs, style) : L.polyline(latlngs, style)).addTo(group);
      } else if (s.kind === 'circle') {
        const color = cssColor(s.color);
        L.circle([s.center.lat, s.center.lng], {
          radius: s.radiusM,
          color,
          weight: 2,
          dashArray: s.dashed ? '6 6' : undefined,
          fillColor: color,
          fillOpacity: s.fill ?? 0.08,
          interactive: false,
        }).addTo(group);
      } else if (s.kind === 'marker') {
        const color = cssColor(s.color);
        const style = s.style ?? 'dot';
        const size = s.size ?? (style === 'dot' ? 12 : 22);
        const radius = style === 'square' ? '4px' : '50%';
        // surface ring: markers stay legible where they sit on a line
        const html =
          `<div style="width:${size}px;height:${size}px;border-radius:${radius};background:${color};` +
          `box-shadow:0 0 0 2px ${surface}${s.selected ? `,0 0 0 4px ${ink}` : ''};display:flex;align-items:center;justify-content:center;` +
          `color:#fff;font:600 10px/1 system-ui,sans-serif;">${s.label ? escapeHtml(s.label) : ''}</div>`;
        // the hit area is larger than the painted mark
        const hit = Math.max(size, 28);
        const marker = L.marker([s.at.lat, s.at.lng], {
          draggable: !!s.draggable,
          title: s.title,
          keyboard: false,
          zIndexOffset: s.selected ? 1000 : 0,
          icon: L.divIcon({
            className: '',
            html: `<div style="width:${hit}px;height:${hit}px;display:flex;align-items:center;justify-content:center;">${html}</div>`,
            iconSize: [hit, hit],
            iconAnchor: [hit / 2, hit / 2],
          }),
        });
        if (s.draggable) {
          marker.on('dragend', () => {
            const p = marker.getLatLng();
            handlers.current.onMarkerDrag?.(s.id, { lat: p.lat, lng: p.lng });
          });
        }
        marker.on('contextmenu', (e) => {
          L.DomEvent.stop(e);
          handlers.current.onMarkerContext?.(s.id);
        });
        // a click on a marker is not a click on the map
        marker.on('click', (e) => {
          L.DomEvent.stop(e);
          handlers.current.onMarkerClick?.(s.id);
        });
        marker.addTo(group);
      }
    }
  };

  const fit = () => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!L || !map) return;
    const pts: [number, number][] = [];
    for (const s of shapesRef.current) {
      if (s.kind === 'marker') pts.push([s.at.lat, s.at.lng]);
      else if (s.kind === 'circle') {
        const d = s.radiusM / 111320;
        pts.push([s.center.lat - d, s.center.lng - d], [s.center.lat + d, s.center.lng + d]);
      } else for (const p of s.points) pts.push([p.lat, p.lng]);
    }
    if (pts.length === 0) return;
    if (pts.length === 1) map.setView(pts[0], Math.max(map.getZoom(), 17));
    else map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 19 });
  };

  // build the map once
  useEffect(() => {
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !hostRef.current) return;
      leafletRef.current = L;
      const start = initialRef.current;
      openedOnView.current = !!start;
      const map = L.map(hostRef.current, {
        center: start ? [start.center.lat, start.center.lng] : [20, 0],
        zoom: start?.zoom ?? 2,
        zoomControl: true,
        attributionControl: true,
        doubleClickZoom: false,
      });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        maxNativeZoom: 19,
        attribution: '&copy; OpenStreetMap contributors',
      }).addTo(map);
      L.control.scale({ metric: true, imperial: true }).addTo(map);
      layerRef.current = L.layerGroup().addTo(map);
      mapRef.current = map;

      map.on('click', (e) => handlers.current.onMapClick?.({ lat: e.latlng.lat, lng: e.latlng.lng }));
      map.on('moveend', () => {
        const c = map.getCenter();
        handlers.current.onViewChange?.({ lat: c.lat, lng: c.lng }, map.getZoom());
      });
      // the workspace island springs wider and narrower as drawers move
      observer = new ResizeObserver(() => map.invalidateSize());
      observer.observe(hostRef.current);

      readyRef.current = true;
      // Tell the owner where the map opened; it never saw the first move. Only
      // when it opened on a view it was given: reporting the default world view
      // would overwrite a saved view that has not arrived yet.
      if (start) {
        const c0 = map.getCenter();
        handlers.current.onViewChange?.({ lat: c0.lat, lng: c0.lng }, map.getZoom());
      }
      draw();
      if (!start) fit();
      lastFit.current = fitKey;
    })();
    return () => {
      cancelled = true;
      observer?.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      layerRef.current = null;
      readyRef.current = false;
    };
    // built once; later changes flow through the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a saved view that arrives after the map was built is applied, once
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || openedOnView.current || !initialView) return;
    openedOnView.current = true;
    map.setView([initialView.center.lat, initialView.center.lng], initialView.zoom, { animate: false });
  }, [initialView]);

  useEffect(() => {
    shapesRef.current = shapes;
    if (readyRef.current) draw();
  }, [shapes, isDark]);

  useEffect(() => {
    if (!readyRef.current || fitKey === lastFit.current) return;
    lastFit.current = fitKey;
    fit();
  }, [fitKey]);

  return (
    <div
      ref={hostRef}
      className={`h-full w-full ${className}`}
      style={{ cursor: cursor === 'crosshair' ? 'crosshair' : undefined }}
    />
  );
}
