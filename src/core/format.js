/** Formatting + date arithmetic. All dates are local-day ISO strings: YYYY-MM-DD. */

export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

export function todayISO(d = new Date()) {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function isoAddDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return todayISO(dt);
}

export function daysBetween(fromISO, toISO) {
  const a = Date.parse(`${fromISO}T00:00:00`);
  const b = Date.parse(`${toISO}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

/** Monday-anchored week start for a given ISO day. */
export function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const shift = (dt.getDay() + 6) % 7;
  return isoAddDays(iso, -shift);
}

export function fmtDate(iso, opts = { month: 'short', day: 'numeric' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}

export function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function round(n, places = 0) {
  if (!Number.isFinite(n)) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function fmtNum(n, places = 0, fallback = '—') {
  if (n == null || !Number.isFinite(n)) return fallback;
  return round(n, places).toLocaleString(undefined, {
    minimumFractionDigits: places,
    maximumFractionDigits: places
  });
}

export function signed(n, places = 1, unit = '') {
  if (n == null || !Number.isFinite(n)) return '—';
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return `${sign}${fmtNum(Math.abs(n), places)}${unit}`;
}

export function fmtWeight(value, units) {
  if (value == null) return '—';
  return `${fmtNum(value, 1)} ${units === 'metric' ? 'kg' : 'lb'}`;
}

export function fmtLength(value, units) {
  if (value == null) return '—';
  return units === 'metric' ? `${fmtNum(value, 1)} cm` : `${fmtNum(value, 1)}"`;
}

export function fmtDuration(hours) {
  if (hours == null) return '—';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function mean(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function median(values) {
  const nums = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

export function pluralize(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}
