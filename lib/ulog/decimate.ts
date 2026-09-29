// Drawing helpers for long series. A chart a thousand pixels wide cannot show a
// million samples; min-max decimation keeps, for every pixel-wide slice of time,
// the lowest and the highest sample, so spikes survive and the picture is the
// same one the full data would draw.

/** Index of the first sample at or after x. */
export function lowerBound(t: Float64Array, x: number): number {
  let lo = 0;
  let hi = t.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Linear interpolation of a series at time x; NaN outside it. */
export function valueAt(t: Float64Array, v: Float64Array, x: number): number {
  const n = t.length;
  if (n === 0 || x < t[0] || x > t[n - 1]) return Number.NaN;
  const hi = Math.min(n - 1, lowerBound(t, x));
  if (hi === 0 || t[hi] === x) return v[hi];
  const lo = hi - 1;
  const f = (x - t[lo]) / (t[hi] - t[lo] || 1);
  return v[lo] + f * (v[hi] - v[lo]);
}

/**
 * The part of a series inside [min, max], plus one sample either side so the line
 * runs to the edges, reduced to at most about 2 × buckets points.
 */
export function decimate(
  t: Float64Array,
  v: Float64Array,
  min: number,
  max: number,
  buckets: number,
): [number[], number[]] {
  const from = Math.max(0, lowerBound(t, min) - 1);
  const to = Math.min(t.length, lowerBound(t, max) + 1);
  const n = to - from;
  const xs: number[] = [];
  const ys: number[] = [];
  if (n <= 0) return [xs, ys];

  if (n <= buckets * 2) {
    for (let i = from; i < to; i++) {
      xs.push(t[i]);
      ys.push(v[i]);
    }
    return [xs, ys];
  }

  const span = (t[to - 1] - t[from]) / buckets || 1;
  let i = from;
  for (let b = 0; b < buckets && i < to; b++) {
    const end = b === buckets - 1 ? Number.POSITIVE_INFINITY : t[from] + (b + 1) * span;
    let lo = i;
    let hi = i;
    const start = i;
    while (i < to && t[i] < end) {
      if (v[i] < v[lo]) lo = i;
      if (v[i] > v[hi]) hi = i;
      i++;
    }
    if (i === start) continue; // nothing logged in this slice
    const a = Math.min(lo, hi);
    const z = Math.max(lo, hi);
    xs.push(t[a]);
    ys.push(v[a]);
    if (z !== a) {
      xs.push(t[z]);
      ys.push(v[z]);
    }
  }
  return [xs, ys];
}
