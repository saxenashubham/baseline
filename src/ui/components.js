/** Reusable pieces of interface. Presentational only — no store access. */

import { h, svg, fill, on, clear } from '../core/dom.js';
import { fmtNum, clamp } from '../core/format.js';
import { state, setViewing, subscribe } from '../core/store.js';

/* ----------------------------------------------------------------- sheet */

const sheetStack = [];

/**
 * Bottom sheet. Returns a handle with `close()`.
 *
 * Sheets stack: the meal-correction flow opens an item editor on top of the
 * estimate sheet, and closing the editor must return to the estimate rather
 * than dismissing both. Scroll lock is released only when the stack empties.
 */
export function sheet({ title, body, actions = [], onClose }) {
  const root = document.getElementById('sheet-root');

  const closeBtn = h('button.btn.quiet', { type: 'button', 'aria-label': 'Close' }, 'Done');
  const panel = h('div.sheet', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Details' }, [
    h('div.sheet-head', null, [h('h3', null, title || ''), closeBtn]),
    body,
    actions.length ? h('div.btn-row', { style: { marginTop: '16px' } }, actions) : null
  ]);
  const backdrop = h('div.sheet-backdrop', null, panel);

  const handle = {
    close(silent) {
      if (!backdrop.isConnected) return;
      backdrop.remove();
      const idx = sheetStack.indexOf(handle);
      if (idx !== -1) sheetStack.splice(idx, 1);
      if (!sheetStack.length) document.body.style.overflow = '';
      if (!silent && onClose) onClose();
    },
    panel
  };

  on(closeBtn, 'click', () => handle.close());
  on(backdrop, 'click', (e) => { if (e.target === backdrop) handle.close(); });
  const esc = (e) => {
    if (e.key !== 'Escape') return;
    if (sheetStack[sheetStack.length - 1] !== handle) return;
    handle.close();
    document.removeEventListener('keydown', esc);
  };
  on(document, 'keydown', esc);

  root.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  sheetStack.push(handle);
  panel.querySelector('input, button, select, textarea')?.focus?.();
  return handle;
}

/* ----------------------------------------------------------------- toast */

let toastTimer = null;

export function toast(message, ms = 2600) {
  const root = document.getElementById('toast-root');
  clear(root);
  root.appendChild(h('div.toast', null, message));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => clear(root), ms);
}

/* ------------------------------------------------------------ primitives */

export function statusPill(tone, label) {
  const cls = tone === 'on' ? 'on' : tone === 'off' ? 'off' : 'watch';
  return h(`span.status.${cls}`, null, label);
}

export function confidenceTag(level) {
  const label = level === 'high' ? 'High' : level === 'low' ? 'Low' : 'Medium';
  return h('span.conf', null, [h('b', null, label), ' confidence']);
}

/**
 * A target row with a fill bar. Returns the node plus an `update` so the home
 * screen can refresh numbers without rebuilding rows.
 */
export function metricRow({ name, value, target, unit = '', decimals = 0 }) {
  const valEl = h('span.metric-val');
  const bar = h('i');
  const row = h('div.metric', null, [
    h('span.metric-name', null, name),
    valEl,
    target ? h('div.bar', null, bar) : null
  ]);

  const update = (nextValue, nextTarget = target) => {
    fill(valEl, nextTarget
      ? [fmtNum(nextValue, decimals), h('span.of', null, ` / ${fmtNum(nextTarget, decimals)}${unit}`)]
      : `${fmtNum(nextValue, decimals)}${unit}`);
    if (nextTarget) {
      const pct = clamp((nextValue / nextTarget) * 100, 0, 100);
      bar.style.width = `${pct}%`;
      bar.classList.toggle('over', nextValue > nextTarget * 1.05);
    }
  };

  update(value, target);
  return { el: row, update };
}

export function tile(label, value, sub) {
  return h('div.tile', null, [
    h('div.k', null, label),
    h('div.v', null, value),
    sub ? h('div.k', null, sub) : null
  ]);
}

export function field(label, control, hint) {
  return h('label.field', null, [h('span', null, label), control, hint ? h('div.small.muted', null, hint) : null]);
}

export function numberInput(props = {}) {
  return h('input.input.num-in', {
    type: 'number',
    inputmode: 'decimal',
    step: 'any',
    ...props
  });
}

export function stepper({ value, step = 5, min = 0, max = 2000, suffix = ' g', onChange }) {
  const val = h('span.val');
  let current = value;
  const set = (next) => {
    current = clamp(Math.round(next), min, max);
    val.textContent = `${current}${suffix}`;
    onChange(current);
  };
  const el = h('div.stepper', null, [
    h('button', { type: 'button', 'aria-label': 'Decrease', onClick: () => set(current - step) }, '−'),
    val,
    h('button', { type: 'button', 'aria-label': 'Increase', onClick: () => set(current + step) }, '+')
  ]);
  val.textContent = `${current}${suffix}`;
  return { el, set, get value() { return current; } };
}

export function chipGroup({ options, value, onChange, multi = false }) {
  let selected = multi ? new Set(value || []) : value;
  const chips = options.map((opt) => {
    const val = typeof opt === 'string' ? opt : opt.value;
    const label = typeof opt === 'string' ? opt : opt.label;
    const chip = h('button.chip', {
      type: 'button',
      'aria-pressed': multi ? selected.has(val) : selected === val,
      onClick: () => {
        if (multi) {
          if (selected.has(val)) selected.delete(val); else selected.add(val);
          onChange([...selected]);
        } else {
          selected = val;
          onChange(val);
        }
        chips.forEach((c) => {
          c.setAttribute('aria-pressed', multi ? selected.has(c.dataset.value) : selected === c.dataset.value);
        });
      }
    }, label);
    chip.dataset.value = val;
    return chip;
  });
  return h('div.row.wrap', null, chips);
}

export function ratingRow({ value, onChange, max = 5, labels = null }) {
  let current = value;
  const buttons = [];
  const row = h('div.row.wrap');
  for (let i = 1; i <= max; i += 1) {
    const btn = h('button.chip', {
      type: 'button',
      'aria-pressed': current === i,
      'aria-label': labels ? labels[i - 1] : `${i} of ${max}`,
      onClick: () => {
        current = i;
        buttons.forEach((b, idx) => b.setAttribute('aria-pressed', idx + 1 === current));
        onChange(i);
      }
    }, String(i));
    buttons.push(btn);
    row.appendChild(btn);
  }
  return row;
}

export function spinnerRow(label) {
  return h('div.row', { style: { padding: '18px 0' } }, [h('span.spinner'), h('span.muted', null, label)]);
}

export function callout(text, tone = '') {
  return h(`div.callout${tone ? `.${tone}` : ''}`, null, text);
}

export function progressBar(fraction) {
  return h('div.progress-track', null, h('i', { style: { width: `${clamp(fraction * 100, 0, 100)}%` } }));
}

/* ------------------------------------------------------- person switcher */

/**
 * Switches which person's data every screen is rendering.
 *
 * Rendered on the main screens and absent entirely when nobody else has signed
 * in, so a single-user install never sees it. Viewing the other person is
 * read-only everywhere — the switcher changes what you read, never where a
 * write lands.
 */
export function personSwitcher() {
  const wrap = h('div.switcher', { role: 'group', 'aria-label': 'Whose data to show' });

  const paint = () => {
    if (!state.partner) {
      wrap.style.display = 'none';
      return;
    }
    wrap.style.display = '';
    fill(wrap, [
      button('You', 'self'),
      button(firstName(state.partner.name), 'partner')
    ]);
  };

  const button = (label, who) => h('button.switcher-btn', {
    type: 'button',
    'aria-pressed': state.viewing === who,
    onClick: () => setViewing(who)
  }, label);

  const firstName = (name) => String(name || 'Partner').split(' ')[0];

  paint();

  // Views are destroyed and rebuilt on every navigation, so this subscriber
  // would accumulate one leak per screen change. It retires itself the first
  // time it fires after its node has left the document.
  const unsubscribe = subscribe((_, changed) => {
    if (!wrap.isConnected) {
      unsubscribe();
      return;
    }
    if (changed.includes('partner') || changed.includes('viewing') || changed.includes('*')) paint();
  });
  return wrap;
}

/** A banner the write-capable screens show when you are looking at someone else. */
export function readOnlyNotice() {
  if (!state.partner || state.viewing !== 'partner') return null;
  return h('div.callout.trend', null,
    `Viewing ${String(state.partner.name || 'your partner').split(' ')[0]}'s data. Nothing here can be edited, and photos are never shared.`);
}

/* ------------------------------------------------------------------ nav */

const ICONS = {
  home: 'M3 11.2 12 4l9 7.2M6 10v9h12v-9',
  food: 'M4 8h16M6 8v11a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8M9 8V5a3 3 0 0 1 6 0v3',
  progress: 'M4 18 9 12l3.5 3.5L20 7M20 7h-4M20 7v4',
  training: 'M4 10v4M8 7v10M16 7v10M20 10v4M8 12h8',
  insights: 'M12 3a6 6 0 0 0-3 11.2V17h6v-2.8A6 6 0 0 0 12 3ZM9.5 20h5'
};

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'food', label: 'Food' },
  { id: 'progress', label: 'Progress' },
  { id: 'training', label: 'Training' },
  { id: 'insights', label: 'Insights' }
];

export function bottomNav(activeId) {
  const nav = h('nav.nav', { 'aria-label': 'Sections' });
  for (const tab of TABS) {
    const icon = svg('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }, svg('path', { d: ICONS[tab.id] }));
    const link = h('a', { href: `#/${tab.id}` }, [icon, h('span', null, tab.label)]);
    if (tab.id === activeId) link.setAttribute('aria-current', 'page');
    nav.appendChild(link);
  }
  return nav;
}

export function appHeader(title, right) {
  return h('header.app-header', null, [h('h1', null, title), right || null]);
}

export function gearLink() {
  return h('a', { href: '#/profile', 'aria-label': 'Profile and settings', class: 'day-badge' }, 'Profile');
}
