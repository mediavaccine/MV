/* Admin Control Center — router and shell.
 *
 * Hash routing, so the whole app is one static file with no server rewrites.
 * Everything below the auth gate assumes a session; the gate re-checks on every
 * navigation, because a token can expire mid-visit.
 */
import * as api from './api.js';
import { h, mount, toast } from './ui.js';
import { renderLogin } from './views/login.js';
import { renderEvents } from './views/events.js';
import { renderEvent } from './views/event.js';

const root = document.getElementById('root');
const chrome = document.getElementById('chrome');

function navigate(path) {
  window.location.hash = '#' + path;
}

function currentPath() {
  const hash = window.location.hash.replace(/^#/, '');
  return hash || '/events';
}

function drawChrome() {
  const session = api.currentSession();
  if (!session) { mount(chrome); chrome.hidden = true; return; }
  chrome.hidden = false;
  mount(chrome,
    h('div', { class: 'brand', onclick: () => navigate('/events') }, 'Seating Kiosk'),
    h('div', { class: 'chrome-right' },
      h('span', { class: 'muted small' }, (session.user && session.user.email) || ''),
      h('button', {
        type: 'button', class: 'btn',
        onclick: () => { api.signOut(); route(); },
      }, 'Sign out')));
}

async function route() {
  drawChrome();

  if (!api.currentSession()) {
    renderLogin(root, () => { drawChrome(); navigate('/events'); route(); });
    return;
  }

  const path = currentPath();
  const parts = path.split('/').filter(Boolean);

  try {
    if (parts[0] !== 'events') return navigate('/events');
    if (parts.length === 1) return await renderEvents(root, navigate);
    return await renderEvent(root, decodeURIComponent(parts[1]), parts[2], navigate);
  } catch (error) {
    // A 401 anywhere means the session died; api.js has already cleared it, so
    // re-routing lands on the login screen rather than a broken panel.
    if (error && error.status === 401) { drawChrome(); return route(); }
    toast(error.message || 'Something went wrong.', 'error');
  }
}

window.addEventListener('hashchange', route);

api.loadSession();
route();
