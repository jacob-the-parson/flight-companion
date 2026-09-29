// Geometry for flight planning. Survey areas are a few hundred metres across, so
// the work is done on a flat local plane (east/north metres around a reference
// point) and converted back to latitude and longitude at the end. At that size
// the flat-plane error is centimetres.
//
// No imports: runs in the browser and under plain Node for the verification script.

export interface LatLng {
  lat: number;
  lng: number;
}

/** Local plane: x east, y north, metres. */
export interface XY {
  x: number;
  y: number;
}

const R = 6371008.8; // mean Earth radius, metres
const RAD = Math.PI / 180;

export function toLocal(p: LatLng, ref: LatLng): XY {
  return {
    x: (p.lng - ref.lng) * RAD * R * Math.cos(ref.lat * RAD),
    y: (p.lat - ref.lat) * RAD * R,
  };
}

export function toLatLng(p: XY, ref: LatLng): LatLng {
  return {
    lat: ref.lat + p.y / R / RAD,
    lng: ref.lng + p.x / (R * Math.cos(ref.lat * RAD)) / RAD,
  };
}

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function centroid(points: LatLng[]): LatLng {
  if (points.length === 0) return { lat: 0, lng: 0 };
  let lat = 0;
  let lng = 0;
  for (const p of points) {
    lat += p.lat;
    lng += p.lng;
  }
  return { lat: lat / points.length, lng: lng / points.length };
}

export function dist(a: XY, b: XY): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function pathLength(points: XY[], closed = false): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += dist(points[i - 1], points[i]);
  if (closed && points.length > 2) d += dist(points[points.length - 1], points[0]);
  return d;
}

/** Signed area by the shoelace formula; positive when the vertices run anticlockwise. */
export function signedArea(poly: XY[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function polygonArea(poly: XY[]): number {
  return poly.length < 3 ? 0 : Math.abs(signedArea(poly));
}

/** Rotate about the origin, anticlockwise, angle in radians. */
export function rotate(p: XY, angle: number): XY {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

/**
 * Where a horizontal line y = Y crosses a polygon: sorted x values, always an even
 * count. A vertex lying exactly on the line is counted by the half-open rule, so a
 * line through a corner never produces an odd crossing.
 */
export function scanline(poly: XY[], Y: number): number[] {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    if ((a.y <= Y && b.y > Y) || (b.y <= Y && a.y > Y)) {
      xs.push(a.x + ((Y - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
  }
  return xs.sort((p, q) => p - q);
}

/** A polyline moved sideways by `offset` metres (positive = to the left of travel). */
export function offsetPolyline(line: XY[], offset: number): XY[] {
  if (line.length < 2) return line.slice();
  const out: XY[] = [];
  for (let i = 0; i < line.length; i++) {
    const prev = line[Math.max(0, i - 1)];
    const next = line[Math.min(line.length - 1, i + 1)];
    const here = line[i];
    // left normal of the incoming and outgoing legs
    const normal = (a: XY, b: XY): XY => {
      const d = dist(a, b) || 1;
      return { x: -(b.y - a.y) / d, y: (b.x - a.x) / d };
    };
    const n1 = i === 0 ? normal(here, next) : normal(prev, here);
    const n2 = i === line.length - 1 ? n1 : normal(here, next);
    // miter: the bisector, lengthened so both legs stay `offset` away, capped at
    // 4x so a hairpin does not throw the corner into the next county
    const bx = n1.x + n2.x;
    const by = n1.y + n2.y;
    const len = Math.hypot(bx, by);
    if (len < 1e-9) {
      out.push({ x: here.x + n1.x * offset, y: here.y + n1.y * offset });
      continue;
    }
    const cos = (n1.x * n2.x + n1.y * n2.y + 1) / 2; // cos² of the half angle
    const scale = Math.min(4, 1 / Math.sqrt(Math.max(cos, 1e-6)));
    out.push({
      x: here.x + (bx / len) * offset * scale,
      y: here.y + (by / len) * offset * scale,
    });
  }
  return out;
}

/** Compass bearing from a to b in degrees, 0 = north, clockwise. */
export function bearing(a: XY, b: XY): number {
  const deg = (Math.atan2(b.x - a.x, b.y - a.y) / RAD + 360) % 360;
  return deg;
}
