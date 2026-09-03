import * as api from '../api.js';
import { button, confirmDialog, empty, h, mount, spinner, toast } from '../ui.js';
import { renderGuests } from './guests.js';
import { renderUpload } from './upload.js';
import { renderBranding } from './branding.js';
import { renderKiosks } from './kiosks.js';
import { renderAnalytics } from './analytics.js';

const TABS = [
  ['guests', 'Guests'],
  ['upload', 'Upload CSV'],
  ['branding', 'Branding'],
  ['screens', 'Screens'],
  ['analytics', 'Usage'],
];

export async function renderEvent(container, slug, tab, navigate) {
  const active = TABS.some(([id]) => id === tab) ? tab : 'guests';

  // Rendering is async, and a render can also be triggered by something that
  // finished late — saving, archiving — long after the operator moved on.
  // Comparing against the hash this render *started* with is not enough: a
  // reload fired after navigation captures the new hash while still carrying
  // the old tab, and would paint that tab over the current screen. So compare
  // against the route this render actually draws.
  const base = '#/events/' + encodeURIComponent(slug);
  const stillCurrent = () => {
    const live = window.location.hash;
    return live === base + '/' + active || (active === 'guests' && live === base);
  };

  if (!stillCurrent()) return;

  mount(container, spinner('Loading event…'));

  let event;
  try {
    event = await api.getEvent(slug);
  } catch (error) {
    if (!stillCurrent()) return;
    return mount(container, empty('Could not load the event: ' + error.message));
  }
  if (!stillCurrent()) return;
  if (!event) return mount(container, empty('No event with that slug.'));

  const panel = h('div', { class: 'panel' });

  function reload() { renderEvent(container, slug, active, navigate); }

  mount(container,
    h('div', { class: 'page-head' },
      h('div', {},
        h('a', {
          href: '#/events', class: 'back',
          onclick: (e) => { e.preventDefault(); navigate('/events'); },
        }, '← All events'),
        h('h1', {}, event.name),
        h('p', { class: 'muted' },
          h('code', {}, '/e/' + event.slug), ' · ',
          h('span', { class: 'pill pill--' + event.status }, event.status))),
      h('div', { class: 'row-actions' },
        event.status === 'active'
          ? button('Archive', () => archive(event, reload))
          : button('Restore', () => restore(event, reload)),
        button('Delete permanently', () => hardDelete(event, navigate), 'danger'))),

    h('nav', { class: 'tabs' }, TABS.map(([id, label]) =>
      h('button', {
        type: 'button',
        class: 'tab' + (id === active ? ' tab--active' : ''),
        onclick: () => navigate(`/events/${slug}/${id}`),
      }, label))),

    panel);

  switch (active) {
    case 'upload': return renderUpload(panel, event, () => navigate(`/events/${slug}/guests`));
    case 'branding': return renderBranding(panel, event);
    case 'screens': return renderKiosks(panel, event);
    case 'analytics': return renderAnalytics(panel, event);
    default: return renderGuests(panel, event);
  }
}

async function archive(event, reload) {
  if (!confirmDialog(
    `Archive "${event.name}"?\n\nThe kiosk URL stops resolving immediately. Guests and analytics are kept and it can be restored at any time.`)) return;
  try {
    await api.updateEvent(event.id, { status: 'archived' });
    toast('Archived. The kiosk URL now shows "This event has ended".', 'ok');
    reload();
  } catch (error) { toast(error.message, 'error'); }
}

async function restore(event, reload) {
  try {
    await api.updateEvent(event.id, { status: 'active' });
    toast('Restored and live again.', 'ok');
    reload();
  } catch (error) { toast(error.message, 'error'); }
}

/* Hard delete is deliberately awkward: it takes the guest list and every
 * analytics row with it, and there is no undo. Archiving is the safe default
 * offered right next to it. */
async function hardDelete(event, navigate) {
  if (!confirmDialog(
    `Permanently delete "${event.name}"?\n\nThis removes the event, its guests, its upload history and all of its analytics. It cannot be undone.\n\nArchiving keeps everything and also stops the kiosk URL — use that instead unless you are sure.`)) return;

  const typed = window.prompt(`Type the event slug to confirm permanent deletion:\n\n${event.slug}`);
  if (typed !== event.slug) {
    toast('Slug did not match — nothing was deleted.', 'info');
    return;
  }

  try {
    await api.deleteEvent(event.id);
    toast('Event permanently deleted.', 'ok');
    navigate('/events');
  } catch (error) { toast(error.message, 'error'); }
}
