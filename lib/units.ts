// Unit formatting — every number shown to the user goes through here so a
// metric/imperial switch never leaves a stray figure behind.
import type { UnitSystem } from '@/stores/core/prefsStore';

const M_TO_FT = 3.280839895;

export function fmtNum(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return 'n/a';
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtDistance(m: number, units: UnitSystem, digits = 0): string {
  if (!Number.isFinite(m)) return 'n/a';
  if (units === 'imperial') {
    const ft = m * M_TO_FT;
    return ft >= 5280 ? `${fmtNum(ft / 5280, 2)} mi` : `${fmtNum(ft, digits)} ft`;
  }
  return m >= 1000 ? `${fmtNum(m / 1000, 2)} km` : `${fmtNum(m, digits)} m`;
}

export function fmtAltitude(m: number, units: UnitSystem, digits = 1): string {
  if (!Number.isFinite(m)) return 'n/a';
  return units === 'imperial' ? `${fmtNum(m * M_TO_FT, 0)} ft` : `${fmtNum(m, digits)} m`;
}

export function fmtSpeed(ms: number, units: UnitSystem): string {
  if (!Number.isFinite(ms)) return 'n/a';
  return units === 'imperial' ? `${fmtNum(ms * 2.2369363, 1)} mph` : `${fmtNum(ms, 1)} m/s`;
}

export function fmtArea(m2: number, units: UnitSystem): string {
  if (!Number.isFinite(m2)) return 'n/a';
  if (units === 'imperial') return `${fmtNum(m2 / 4046.8564224, 2)} ac`;
  return m2 >= 10000 ? `${fmtNum(m2 / 10000, 2)} ha` : `${fmtNum(m2, 0)} m²`;
}

export function fmtDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'n/a';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  if (m >= 60) return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
  return m > 0 ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}

/** Clock-style time for chart cursors: 1:05.3 */
export function fmtClock(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'n/a';
  const sign = seconds < 0 ? '-' : '';
  const a = Math.abs(seconds);
  const m = Math.floor(a / 60);
  return `${sign}${m}:${(a % 60).toFixed(1).padStart(4, '0')}`;
}

/** Download a text or binary payload as a file, from the browser. */
export function downloadFile(name: string, content: string | Blob, mime = 'text/plain'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** File-name-safe slug. */
export function slug(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'untitled'
  );
}

export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
