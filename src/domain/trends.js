/**
 * Trend maths (PRD §21).
 *
 * The product's whole claim is that a smoothed series is worth acting on and a
 * single reading is not, so nothing here ever returns a bare latest value —
 * everything is either an average, a slope, or a comparison of two windows.
 */

import { isoAddDays, daysBetween, mean, todayISO, weekStart } from '../core/format.js';

/** Turn sparse dated records into a dense day-by-day series (nulls for gaps). */
export function densify(records, field, fromISO, toISO) {
  const byDay = new Map(records.map((r) => [r.date, r[field]]));
  const out = [];
  const span = daysBetween(fromISO, toISO);
  for (let i = 0; i <= span; i += 1) {
    const date = isoAddDays(fromISO, i);
    out.push({ date, value: byDay.has(date) ? byDay.get(date) : null });
  }
  return out;
}

/**
 * Centred-ish rolling mean over the trailing `window` days, tolerating gaps.
 * Returns null until at least `minPoints` real readings exist in the window.
 */
export function rollingMean(series, window = 7, minPoints = 3) {
  return series.map((point, idx) => {
    const slice = series.slice(Math.max(0, idx - window + 1), idx + 1);
    const values = slice.map((p) => p.value).filter(Number.isFinite);
    return {
      date: point.date,
      value: point.value,
      trend: values.length >= minPoints ? mean(values) : null
    };
  });
}

/**
 * Exponentially weighted trend — reacts faster than a flat 7-day mean while
 * still ignoring single-day spikes. Used for the headline number.
 */
export function ema(series, alpha = 0.25) {
  let acc = null;
  return series.map((point) => {
    if (Number.isFinite(point.value)) {
      acc = acc == null ? point.value : alpha * point.value + (1 - alpha) * acc;
    }
    return { date: point.date, value: point.value, trend: acc };
  });
}

/** Least-squares slope in units per day over the supplied points. */
export function slopePerDay(points) {
  const pts = points.filter((p) => Number.isFinite(p.value));
  if (pts.length < 3) return null;
  const x0 = Date.parse(`${pts[0].date}T00:00:00`);
  const xs = pts.map((p) => (Date.parse(`${p.date}T00:00:00`) - x0) / 86400000);
  const ys = pts.map((p) => p.value);
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    den += (xs[i] - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}

/** Convenience: slope over the last N days, expressed per week. */
export function weeklySlope(records, field, days = 14, endISO = todayISO()) {
  const from = isoAddDays(endISO, -(days - 1));
  const pts = records
    .filter((r) => r.date >= from && r.date <= endISO)
    .map((r) => ({ date: r.date, value: r[field] }));
  const s = slopePerDay(pts);
  return s == null ? null : s * 7;
}

/**
 * The headline pair: current smoothed value and the change against the
 * equivalent window one week earlier.
 */
export function trendSummary(records, field, endISO = todayISO(), window = 7) {
  const from = isoAddDays(endISO, -41);
  const dense = densify(records, field, from, endISO);
  const smoothed = rollingMean(dense, window, 2);
  const last = [...smoothed].reverse().find((p) => p.trend != null) || null;
  const weekAgoDate = isoAddDays(endISO, -7);
  const prev = [...smoothed].reverse().find((p) => p.date <= weekAgoDate && p.trend != null) || null;
  const latestReading = [...records].reverse().find((r) => Number.isFinite(r[field])) || null;

  return {
    trend: last?.trend ?? null,
    trendDate: last?.date ?? null,
    weekChange: last && prev ? last.trend - prev.trend : null,
    latest: latestReading ? latestReading[field] : null,
    latestDate: latestReading?.date ?? null,
    perWeek: weeklySlope(records, field, 14, endISO),
    series: smoothed
  };
}

/** Aggregate any dated record set into Monday-anchored weeks. */
export function groupByWeek(records) {
  const map = new Map();
  for (const r of records) {
    const key = weekStart(r.date);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([week, items]) => ({ week, items }));
}

/** Direction classifier with a dead band, so "flat" is an honest answer. */
export function direction(change, deadband) {
  if (change == null) return 'unknown';
  if (change <= -deadband) return 'down';
  if (change >= deadband) return 'up';
  return 'flat';
}
