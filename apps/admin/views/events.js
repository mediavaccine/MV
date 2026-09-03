import * as api from '../api.js';
import { button, confirmDialog, empty, field, formatDate, h, mount, slugify, spinner, toast } from '../ui.js';

export async function renderEvents(container, navigate) {
  // See renderEvent: a render that resolves after the route changed must not
  // paint over whatever replaced it.
  const requestedHash = window.location.hash;
  const stillCurrent = () => window.location.hash === requestedHash;

  mount(container, spinner('Loading events…'));

  let events;
  try {
    events = await api.listEvents();
  } catch (error) {
    if (stillCurrent()) mount(container, empty('Could not load events: ' + error.message));
    return;
  }
  if (!stillCurrent()) return;

  const live = events.filter((e) => e.status === 'active');
  const archived = events.filter((e) => e.status !== 'active');

  mount(container,
    h('div', { class: 'page-head' },
      h('h1', {}, 'Events'),
      button('New event', () => showCreate(container, navigate), 'primary')),
    events.length === 0
      ? empty('No events yet.', button('Create your first event', () => showCreate(container, navigate), 'primary'))
      : h('div', {},
          eventTable(live, navigate, container),
          archived.length
            ? h('details', { class: 'archived' },
                h('summary', {}, `Archived (${archived.length})`),
                eventTable(archived, navigate, container))
            : null));
}

function eventTable(events, navigate, container) {
  if (events.length === 0) return empty('Nothing here.');

  return h('table', { class: 'table' },
    h('thead', {}, h('tr', {},
      h('th', {}, 'Event'), h('th', {}, 'Slug'), h('th', {}, 'Status'),
      h('th', {}, 'Updated'), h('th', {}, ''))),
    h('tbody', {}, events.map((event) => h('tr', {},
      h('td', {}, h('a', {
        href: '#/events/' + event.slug,
        onclick: (e) => { e.preventDefault(); navigate('/events/' + event.slug); },
      }, event.name)),
      h('td', {}, h('code', {}, event.slug)),
      h('td', {}, h('span', { class: 'pill pill--' + event.status }, event.status)),
      h('td', { class: 'muted' }, formatDate(event.updated_at)),
      h('td', { class: 'row-actions' },
        button('Open', () => navigate('/events/' + event.slug)),
        event.status === 'active'
          ? button('Archive', () => archive(event, container, navigate))
          : button('Restore', () => restore(event, container, navigate)))))));
}

async function archive(event, container, navigate) {
  if (!confirmDialog(
    `Archive "${event.name}"?\n\nThe kiosk URL stops working immediately. Guests and analytics are kept, and you can restore it at any time.`)) return;
  await api.updateEvent(event.id, { status: 'archived' });
  toast('Event archived. Its kiosk URL no longer resolves.', 'ok');
  renderEvents(container, navigate);
}

async function restore(event, container, navigate) {
  await api.updateEvent(event.id, { status: 'active' });
  toast('Event restored and live again.', 'ok');
  renderEvents(container, navigate);
}

function showCreate(container, navigate) {
  const name = h('input', { type: 'text', required: true, placeholder: 'Bukki Solanke Gala 2026' });
  const slug = h('input', { type: 'text', required: true, placeholder: 'bukki-solanke-gala-2026' });
  const tables = h('input', { type: 'number', min: '1', placeholder: '12' });
  const strategy = h('select', {},
    h('option', { value: 'provided-in-csv' }, 'Tables come from the CSV'),
    h('option', { value: 'auto-balanced' }, 'Balance groups across tables'),
    h('option', { value: 'auto-random' }, 'Spread guests evenly'),
    h('option', { value: 'manual' }, 'Assign tables by hand'));

  // The slug follows the name until someone edits it directly.
  let slugTouched = false;
  slug.addEventListener('input', () => { slugTouched = true; });
  name.addEventListener('input', () => { if (!slugTouched) slug.value = slugify(name.value); });

  const save = button('Create event', create, 'primary');

  async function create() {
    if (!name.value.trim()) return toast('Give the event a name.', 'error');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug.value)) {
      return toast('The slug may only contain lowercase letters, numbers and single hyphens.', 'error');
    }
    save.disabled = true;
    try {
      const event = await api.createEvent({
        name: name.value.trim(),
        slug: slug.value,
        table_count: tables.value ? Number(tables.value) : null,
        assignment_strategy: strategy.value,
      });
      toast('Event created.', 'ok');
      navigate('/events/' + event.slug);
    } catch (error) {
      // The database enforces slug uniqueness; say so in words rather than
      // showing the raw constraint name.
      toast(error.status === 409
        ? 'That slug is already used by another event.'
        : error.message, 'error');
      save.disabled = false;
    }
  }

  mount(container,
    h('div', { class: 'page-head' }, h('h1', {}, 'New event')),
    h('form', { class: 'card form', onsubmit: (e) => { e.preventDefault(); create(); } },
      field('Event name', name),
      field('URL slug', slug, 'The kiosk address will be /e/' + (slug.value || 'your-slug')),
      field('Number of tables', tables, 'Only needed for the automatic assignment strategies'),
      field('Table assignment', strategy),
      h('div', { class: 'form-actions' },
        save,
        button('Cancel', () => renderEvents(container, navigate)))));
  name.focus();
}
