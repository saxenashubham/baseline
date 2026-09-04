/**
 * Hash router.
 *
 * A view is a factory: `(ctx) => { el, update?(state, changed), destroy?() }`.
 * The router mounts one at a time and calls `destroy` before swapping, so views
 * can clean up object URLs, timers and listeners deterministically.
 */

import { clear } from './dom.js';

const routes = new Map();
let mountEl = null;
let current = null;
let currentName = null;
let onChange = () => {};

export function defineRoutes(map) {
  for (const [name, factory] of Object.entries(map)) routes.set(name, factory);
}

export function startRouter(el, { fallback = 'home', onNavigate } = {}) {
  mountEl = el;
  onChange = onNavigate || onChange;
  window.addEventListener('hashchange', () => render(fallback));
  render(fallback);
}

export function navigate(name, params = {}) {
  const query = new URLSearchParams(params).toString();
  const next = `#/${name}${query ? `?${query}` : ''}`;
  if (window.location.hash === next) render();
  else window.location.hash = next;
}

export function currentRoute() {
  return currentName;
}

export function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  return {
    name: path || '',
    params: Object.fromEntries(new URLSearchParams(query || ''))
  };
}

function render(fallback = 'home') {
  const { name, params } = parseHash();
  const target = routes.has(name) ? name : fallback;
  const factory = routes.get(target);
  if (!factory) return;

  if (current?.destroy) {
    try { current.destroy(); } catch (err) { console.error('view destroy failed', err); }
  }
  clear(mountEl);

  current = factory({ params });
  currentName = target;
  mountEl.appendChild(current.el);
  window.scrollTo(0, 0);
  onChange(target, params);
}

/** Push a state update into the mounted view, if it wants one. */
export function updateCurrent(state, changed) {
  if (current?.update) {
    try { current.update(state, changed); } catch (err) { console.error('view update failed', err); }
  }
}

/** Re-run the current route factory from scratch (used after onboarding). */
export function remount() {
  render();
}
