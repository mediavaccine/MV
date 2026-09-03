import * as api from '../api.js';
import { button, confirmDialog, empty, h, mount, spinner, toast } from '../ui.js';

/* Guest editor: search, inline edit, add, delete, and bulk table reassignment. */
export async function renderGuests(container, event) {
  mount(container, spinner('Loading guests…'));

  let guests;
  try {
    guests = await api.listGuests(event.id);
  } catch (error) {
    return mount(container, empty('Could not load guests: ' + error.message));
  }

  const selected = new Set();
  let filter = '';

  const search = h('input', {
    type: 'search', placeholder: 'Search guests…', class: 'search-input',
    oninput: () => { filter = search.value.trim().toLowerCase(); draw(); },
  });

  const body = h('tbody', {});
  const bulkBar = h('div', { class: 'bulk', hidden: true });
  const count = h('span', { class: 'muted' });

  function visible() {
    if (!filter) return guests;
    return guests.filter((g) =>
      g.full_name.toLowerCase().includes(filter) ||
      String(g.table_number || '').toLowerCase().includes(filter));
  }

  function drawBulk() {
    if (selected.size === 0) { bulkBar.hidden = true; return; }
    const table = h('input', { type: 'text', placeholder: 'New table', class: 'inline-input' });
    mount(bulkBar,
      h('span', {}, `${selected.size} selected`),
      table,
      button('Move to table', async () => {
        if (!table.value.trim()) return toast('Enter a table for the selected guests.', 'error');
        try {
          await api.updateGuestsTable([...selected], table.value.trim());
          guests.forEach((g) => { if (selected.has(g.id)) g.table_number = table.value.trim(); });
          toast(`Moved ${selected.size} guests to ${table.value.trim()}.`, 'ok');
          selected.clear();
          draw();
        } catch (error) { toast(error.message, 'error'); }
      }, 'primary'),
      button('Clear selection', () => { selected.clear(); draw(); }));
    bulkBar.hidden = false;
  }

  function draw() {
    const rows = visible();
    count.textContent = filter
      ? `${rows.length} of ${guests.length} guests`
      : `${guests.length} guests`;

    mount(body, rows.length === 0
      ? h('tr', {}, h('td', { colspan: '5' }, empty(filter ? 'No guests match that search.' : 'No guests yet — upload a CSV to get started.')))
      : rows.map((guest) => guestRow(guest)));
    drawBulk();
  }

  function guestRow(guest) {
    const tick = h('input', {
      type: 'checkbox', checked: selected.has(guest.id),
      onchange: (e) => {
        if (e.target.checked) selected.add(guest.id); else selected.delete(guest.id);
        drawBulk();
      },
    });

    // Inline edit: commit on blur, revert on Escape, so nothing needs a Save
    // button and a mistyped cell is never persisted by accident.
    const name = editableCell(guest.full_name, async (value) => {
      if (!value.trim()) { toast('A guest needs a name.', 'error'); return false; }
      await api.updateGuest(guest.id, { full_name: value.trim() });
      guest.full_name = value.trim();
      return true;
    });

    const table = editableCell(guest.table_number || '', async (value) => {
      const next = value.trim() || null;
      await api.updateGuest(guest.id, { table_number: next });
      guest.table_number = next;
      return true;
    }, 'unassigned');

    return h('tr', {},
      h('td', {}, tick),
      h('td', {}, name),
      h('td', {}, table),
      h('td', { class: 'muted small' }, Object.keys(guest.extra || {}).length
        ? Object.entries(guest.extra).map(([k, v]) => `${k}: ${v}`).join(' · ')
        : '—'),
      h('td', { class: 'row-actions' },
        button('Delete', async () => {
          if (!confirmDialog(`Remove ${guest.full_name} from this event?`)) return;
          try {
            await api.deleteGuest(guest.id);
            guests = guests.filter((g) => g.id !== guest.id);
            selected.delete(guest.id);
            toast('Guest removed.', 'ok');
            draw();
          } catch (error) { toast(error.message, 'error'); }
        })));
  }

  const addName = h('input', { type: 'text', placeholder: 'Full name', class: 'inline-input' });
  const addTable = h('input', { type: 'text', placeholder: 'Table', class: 'inline-input' });

  async function addGuest() {
    if (!addName.value.trim()) return toast('Enter a name.', 'error');
    try {
      const guest = await api.createGuest({
        event_id: event.id,
        full_name: addName.value.trim(),
        table_number: addTable.value.trim() || null,
        source: 'manual',
      });
      guests = guests.concat(guest).sort((a, b) => a.full_name.localeCompare(b.full_name));
      addName.value = ''; addTable.value = '';
      toast('Guest added.', 'ok');
      draw();
      addName.focus();
    } catch (error) { toast(error.message, 'error'); }
  }

  mount(container,
    h('div', { class: 'toolbar' }, search, count),
    bulkBar,
    h('div', { class: 'card add-row' },
      h('strong', {}, 'Add a guest'),
      addName, addTable,
      button('Add', addGuest, 'primary')),
    h('table', { class: 'table' },
      h('thead', {}, h('tr', {},
        h('th', { class: 'tick-col' }, ''), h('th', {}, 'Name'), h('th', {}, 'Table'),
        h('th', {}, 'Other fields'), h('th', {}, ''))),
      body));

  draw();
}

/** A cell that turns into an input on click and saves when it loses focus. */
function editableCell(value, save, placeholder) {
  const span = h('span', { class: 'editable' + (value ? '' : ' editable--empty'), tabindex: '0' },
    value || placeholder || '—');

  function beginEdit() {
    const input = h('input', { type: 'text', value: value, class: 'inline-input' });
    let settled = false;

    async function commit(next) {
      if (settled) return;
      settled = true;
      if (next === value) return span.replaceWith(span);
      try {
        const ok = await save(next);
        if (ok === false) { input.replaceWith(span); return; }
        value = next;
        span.textContent = next || placeholder || '—';
        span.className = 'editable' + (next ? '' : ' editable--empty');
      } catch (error) {
        span.textContent = value || placeholder || '—';
      }
      input.replaceWith(span);
    }

    input.addEventListener('blur', () => commit(input.value));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
      if (event.key === 'Escape') { settled = true; input.replaceWith(span); }
    });

    span.replaceWith(input);
    input.focus();
    input.select();
  }

  span.addEventListener('click', beginEdit);
  span.addEventListener('keydown', (e) => { if (e.key === 'Enter') beginEdit(); });
  return span;
}
