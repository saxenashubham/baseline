/**
 * Minimal DOM helpers.
 *
 * Everything is built from real nodes rather than HTML strings, so user text
 * and AI output can never be interpreted as markup. Views hold references to
 * the nodes they need to mutate instead of re-rendering the whole page — that
 * is what keeps input focus and scroll position stable between state updates.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} tag  e.g. 'div', 'button.btn.primary', 'span#total'
 * @param {object} [props] attributes, `class`, `dataset`, `style`, on* handlers
 * @param {Array|Node|string} [children]
 */
export function h(tag, props = null, children = null) {
  const { name, cls, id } = parseTag(tag);
  const el = document.createElement(name);
  if (id) el.id = id;
  if (cls.length) el.classList.add(...cls);
  applyProps(el, props);
  append(el, children);
  return el;
}

export function svg(tag, props = null, children = null) {
  const el = document.createElementNS(SVG_NS, tag);
  applyProps(el, props, true);
  append(el, children);
  return el;
}

export function frag(children) {
  const f = document.createDocumentFragment();
  append(f, children);
  return f;
}

export function text(value) {
  return document.createTextNode(value == null ? '' : String(value));
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/** Replace a node's children in one shot. */
export function fill(node, children) {
  clear(node);
  append(node, children);
  return node;
}

export function on(node, type, handler, opts) {
  node.addEventListener(type, handler, opts);
  return () => node.removeEventListener(type, handler, opts);
}

/** Set text only when it actually changed — avoids pointless layout work. */
export function setText(node, value) {
  const next = value == null ? '' : String(value);
  if (node.textContent !== next) node.textContent = next;
  return node;
}

export function setClass(node, cls, active) {
  node.classList.toggle(cls, !!active);
  return node;
}

function parseTag(tag) {
  const idSplit = tag.split('#');
  const clsParts = idSplit[0].split('.');
  const idParts = (idSplit[1] || '').split('.');
  return {
    name: clsParts[0] || 'div',
    cls: clsParts.slice(1).concat(idParts.slice(1)).filter(Boolean),
    id: idParts[0] || null
  };
}

function applyProps(el, props, isSvg = false) {
  if (!props) return;
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') {
      el.setAttribute('class', value);
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(el.style, value);
    } else if (key === 'dataset') {
      Object.assign(el.dataset, value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (!isSvg && key in el && key !== 'list' && key !== 'form') {
      el[key] = value;
    } else {
      el.setAttribute(key, value === true ? '' : value);
    }
  }
}

function append(parent, children) {
  if (children == null || children === false) return;
  if (Array.isArray(children)) {
    for (const child of children) append(parent, child);
    return;
  }
  parent.appendChild(children instanceof Node ? children : text(children));
}
