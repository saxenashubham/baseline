/**
 * Hand-drawn SVG charts — no charting library, no build step.
 *
 * The visual grammar is the product's argument: individual readings are faint
 * amber dots, the smoothed trend is a solid teal line. If the two disagree, the
 * chart already tells you which one to believe.
 */

import { svg, h } from '../core/dom.js';
import { fmtDate, fmtNum } from '../core/format.js';

const PAD = { top: 12, right: 10, bottom: 22, left: 34 };

/**
 * @param {Array<{date:string, value:number|null, trend:number|null}>} series
 * @param {object} [opts] { height, width, decimals, showRaw, band }
 */
export function trendChart(series, opts = {}) {
  const {
    height = 190,
    width = 360,
    decimals = 1,
    showRaw = true,
    label = ''
  } = opts;

  const points = series.filter((p) => Number.isFinite(p.value) || Number.isFinite(p.trend));
  if (points.length < 2) {
    return h('div.empty', null, 'Two readings will draw a line here.');
  }

  const values = points.flatMap((p) => [p.value, p.trend]).filter(Number.isFinite);
  let min = Math.min(...values);
  let max = Math.max(...values);
  const span = max - min || 1;
  min -= span * 0.12;
  max += span * 0.12;

  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (i / (points.length - 1)) * plotW;
  const y = (v) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

  const root = svg('svg', {
    class: 'chart',
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: 'none',
    role: 'img',
    'aria-label': label || 'Trend chart'
  });

  // Horizontal guides with value labels.
  for (let i = 0; i <= 2; i += 1) {
    const value = min + ((max - min) * i) / 2;
    const yy = y(value);
    root.appendChild(svg('line', { class: 'grid-line', x1: PAD.left, x2: width - PAD.right, y1: yy, y2: yy }));
    root.appendChild(svg('text', { class: 'axis-label', x: 2, y: yy + 3 }, fmtNum(value, decimals)));
  }

  if (showRaw) {
    for (let i = 0; i < points.length; i += 1) {
      if (!Number.isFinite(points[i].value)) continue;
      root.appendChild(svg('circle', { class: 'raw-dot', cx: x(i), cy: y(points[i].value), r: 2.6 }));
    }
  }

  const trendPath = buildPath(points, 'trend', x, y);
  if (trendPath) root.appendChild(svg('path', { class: 'trend-line', d: trendPath }));

  // First and last date labels only — a dense axis is noise on a phone.
  root.appendChild(svg('text', { class: 'axis-label', x: PAD.left, y: height - 6 }, fmtDate(points[0].date)));
  root.appendChild(
    svg('text', {
      class: 'axis-label',
      x: width - PAD.right,
      y: height - 6,
      'text-anchor': 'end'
    }, fmtDate(points[points.length - 1].date))
  );

  return root;
}

function buildPath(points, field, x, y) {
  let d = '';
  let started = false;
  for (let i = 0; i < points.length; i += 1) {
    const v = points[i][field];
    if (!Number.isFinite(v)) continue;
    d += `${started ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    started = true;
  }
  return started ? d.trim() : null;
}

export function chartLegend(items) {
  return h(
    'div.chart-legend',
    null,
    items.map((it) =>
      h('span', null, [
        h('i', { style: { background: it.color } }),
        it.label
      ])
    )
  );
}

/** Compact bar chart used for weekly calories and steps. */
export function barChart(bars, opts = {}) {
  const { height = 120, width = 360, target = null, format = (v) => fmtNum(v, 0) } = opts;
  const values = bars.map((b) => b.value).filter(Number.isFinite);
  if (!values.length) return h('div.empty', null, 'No data for this range yet.');
  const max = Math.max(...values, target || 0) * 1.15;
  const plotW = width - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;
  const slot = plotW / bars.length;
  const barW = Math.min(26, slot * 0.62);

  const root = svg('svg', { class: 'chart', viewBox: `0 0 ${width} ${height}`, role: 'img' });

  if (target) {
    const ty = PAD.top + plotH - (target / max) * plotH;
    root.appendChild(svg('line', {
      class: 'grid-line', x1: PAD.left, x2: width - PAD.right, y1: ty, y2: ty,
      'stroke-dasharray': '4 4'
    }));
    root.appendChild(svg('text', { class: 'axis-label', x: 2, y: ty + 3 }, format(target)));
  }

  bars.forEach((bar, i) => {
    const v = Number.isFinite(bar.value) ? bar.value : 0;
    const barH = (v / max) * plotH;
    const bx = PAD.left + slot * i + (slot - barW) / 2;
    root.appendChild(svg('rect', {
      x: bx,
      y: PAD.top + plotH - barH,
      width: barW,
      height: Math.max(1, barH),
      rx: 3,
      fill: bar.over ? 'var(--raw)' : 'var(--trend)',
      opacity: Number.isFinite(bar.value) ? 0.9 : 0.2
    }));
    root.appendChild(svg('text', {
      class: 'axis-label', x: bx + barW / 2, y: height - 6, 'text-anchor': 'middle'
    }, bar.label));
  });

  return root;
}
