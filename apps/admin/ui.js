/* Small DOM helpers.
 *
 * Deliberately not a framework. `h` builds elements, `mount` swaps a subtree,
 * and everything else is plain DOM — which keeps the admin app buildless and
 * means text always goes through textContent rather than innerHTML.
 */

/** h('div', {class: 'x', onclick: fn}, child, child…) */
export function h(tag, props, ...children) {
  const node = document.createElement(tag);
  const attrs = props || {};

  Object.keys(attrs).forEach((key) => {
    const value = attrs[key];
    if (value == null || value === false) return;

    if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else if (key === 'class') {
      node.className = value;
    } else if (key === 'html') {
      throw new Error('raw html is not allowed here; pass text children instead');
    } else if (key in node && key !== 'list' && key !== 'type' && key !== 'form') {
      node[key] = value;
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  });

  children.flat(Infinity).forEach((child) => {
    if (child == null || child === false) return;
    node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  });

  return node;
}

export function mount(container, ...nodes) {
  container.textContent = '';
  nodes.flat(Infinity).forEach((node) => {
    if (node != null && node !== false) container.appendChild(node);
  });
  return container;
}

export function field(label, control, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    control,
    hint ? h('span', { class: 'field-hint' }, hint) : null);
}

export function button(label, onClick, variant) {
  return h('button', {
    type: 'button',
    class: 'btn' + (variant ? ' btn--' + variant : ''),
    onclick: onClick,
  }, label);
}

/** Non-blocking status line; `kind` is 'info', 'ok' or 'error'. */
export function toast(message, kind = 'info') {
  const bar = document.getElementById('toast');
  if (!bar) return;
  bar.textContent = message;
  bar.className = 'toast toast--' + kind;
  bar.hidden = false;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { bar.hidden = true; }, kind === 'error' ? 8000 : 3500);
}

export function confirmDialog(message) {
  return window.confirm(message);
}

export function empty(message, action) {
  return h('div', { class: 'empty' }, h('p', {}, message), action || null);
}

export function spinner(label = 'Loading…') {
  return h('p', { class: 'muted' }, label);
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString();
}

/** Slugify a name into the URL segment shape events.slug enforces. */
export function slugify(text) {
  return String(text)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
