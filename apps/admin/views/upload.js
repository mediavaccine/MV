import * as api from '../api.js';
import { detectDelimiter, parseCsv, rowsToGuests, suggestMapping } from '../shared/csv.js';
import { applyStrategy, summariseTables } from '../shared/assignment.js';
import { button, confirmDialog, empty, field, formatDate, h, mount, spinner, toast } from '../ui.js';

/* The CSV upload wizard (spec §4.3).
 *
 * Four steps, each reversible until the last: choose a file, confirm what the
 * columns mean, choose how tables are assigned, then decide whether this
 * replaces the guest list or merges into it. Nothing is written to the database
 * until the final Import.
 */
export async function renderUpload(container, event, onImported) {
  const state = {
    filename: null,
    rows: null,
    mapping: null,
    guests: null,
    assigned: null,
    strategy: event.assignment_strategy || 'provided-in-csv',
    tableCount: event.table_count || null,
    mode: 'replace',
  };

  const stepArea = h('div', {});
  const history = h('div', {});

  mount(container, h('div', { class: 'page-head' }, h('h2', {}, 'Upload guest list')), stepArea, history);
  loadHistory();
  stepFile();

  async function loadHistory() {
    try {
      const uploads = await api.listUploads(event.id);
      if (uploads.length === 0) return;
      mount(history,
        h('h3', { class: 'section' }, 'Previous uploads'),
        h('table', { class: 'table' },
          h('thead', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Rows'), h('th', {}, 'Mode'), h('th', {}, 'When'))),
          h('tbody', {}, uploads.map((u) => h('tr', {},
            h('td', {}, u.filename), h('td', {}, String(u.row_count)),
            h('td', {}, u.mode), h('td', { class: 'muted' }, formatDate(u.uploaded_at)))))));
    } catch { /* history is a nicety; never block the wizard on it */ }
  }

  // --- Step 1: the file ---------------------------------------------------

  function stepFile() {
    const input = h('input', { type: 'file', accept: '.csv,text/csv,text/plain' });

    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) return;

      if (/\.(xlsx|xls)$/i.test(file.name)) {
        toast('Excel files are not supported yet — export the sheet as CSV first.', 'error');
        input.value = '';
        return;
      }

      const text = await file.text();
      const rows = parseCsv(text, { delimiter: detectDelimiter(text) });

      if (rows.length < 2) {
        toast('That file has no data rows.', 'error');
        return;
      }

      state.filename = file.name;
      state.rows = rows;
      state.mapping = suggestMapping(rows[0]);
      stepMapping();
    });

    mount(stepArea,
      h('div', { class: 'card' },
        h('h3', {}, 'Step 1 — choose a file'),
        h('p', { class: 'muted' },
          'Any CSV will do. The next step shows what each column was understood to mean, so nothing is assumed.'),
        input));
  }

  // --- Step 2: what the columns mean --------------------------------------

  function stepMapping() {
    const headers = state.rows[0];
    const preview = state.rows.slice(1, 6);

    const selects = state.mapping.map((entry, i) => {
      const select = h('select', {
        onchange: () => {
          // A role can only belong to one column; taking it frees the other.
          if (select.value !== 'extra') {
            state.mapping.forEach((other, j) => {
              if (j !== i && other.role === select.value) {
                other.role = 'extra';
                selects[j].value = 'extra';
              }
            });
          }
          state.mapping[i].role = select.value;
          validate();
        },
      },
        h('option', { value: 'extra' }, 'Extra data'),
        h('option', { value: 'full_name' }, 'Full name'),
        h('option', { value: 'first_name' }, 'First name'),
        h('option', { value: 'last_name' }, 'Last name'),
        h('option', { value: 'table_number' }, 'Table'),
        h('option', { value: 'group_id' }, 'Group / party'));
      select.value = entry.role;
      return select;
    });

    const warning = h('p', { class: 'warn', hidden: true });
    const next = button('Continue', () => {
      state.guests = rowsToGuests(state.rows, state.mapping);
      if (state.guests.length === 0) {
        toast('No usable rows — check which column holds the name.', 'error');
        return;
      }
      stepStrategy();
    }, 'primary');

    function validate() {
      const roles = state.mapping.map((m) => m.role);
      const hasName = roles.includes('full_name') || roles.includes('first_name') || roles.includes('last_name');
      warning.hidden = hasName;
      warning.textContent = hasName ? '' : 'Choose which column holds the guest name — nothing can be imported without one.';
      next.disabled = !hasName;
    }

    mount(stepArea,
      h('div', { class: 'card' },
        h('h3', {}, 'Step 2 — check the columns'),
        h('p', { class: 'muted' },
          `${state.filename} · ${state.rows.length - 1} data rows. Anything left as "Extra data" is stored with the guest but stays hidden from the kiosk unless you make it visible in Branding.`),
        h('div', { class: 'scroll-x' },
          h('table', { class: 'table table--tight' },
            h('thead', {},
              h('tr', {}, headers.map((header) => h('th', {}, header))),
              h('tr', {}, selects.map((select) => h('th', {}, select)))),
            h('tbody', {}, preview.map((row) =>
              h('tr', {}, headers.map((_, i) => h('td', { class: 'muted' }, row[i] || '')))))),
        ),
        warning,
        h('div', { class: 'form-actions' }, next, button('Back', stepFile))));

    validate();
  }

  // --- Step 3: how tables get assigned ------------------------------------

  function stepStrategy() {
    const strategy = h('select', { onchange: () => { state.strategy = strategy.value; redraw(); } },
      h('option', { value: 'provided-in-csv' }, 'Use the table column from the CSV'),
      h('option', { value: 'auto-balanced' }, 'Balance groups across tables'),
      h('option', { value: 'auto-random' }, 'Spread guests evenly across tables'),
      h('option', { value: 'manual' }, 'Leave tables empty, assign by hand'));
    strategy.value = state.strategy;

    const tableCount = h('input', {
      type: 'number', min: '1', value: state.tableCount || '',
      oninput: () => { state.tableCount = Number(tableCount.value) || null; redraw(); },
    });

    const result = h('div', {});
    const next = button('Continue', stepMode, 'primary');

    function redraw() {
      const needsCount = state.strategy === 'auto-balanced' || state.strategy === 'auto-random';
      tableCount.parentElement.hidden = !needsCount;

      const hasGroups = state.guests.some((g) => g.group_id);
      let notes = [];

      if (state.strategy === 'auto-balanced' && !hasGroups) {
        notes.push('No group column was mapped, so every guest is treated as a party of one — this behaves like spreading guests evenly.');
      }
      if (state.strategy === 'provided-in-csv') {
        const missing = state.guests.filter((g) => !g.table_number).length;
        if (missing) notes.push(`${missing} of ${state.guests.length} guests have no table in the file. They will be imported unassigned.`);
      }

      if (needsCount && !state.tableCount) {
        state.assigned = null;
        next.disabled = true;
        mount(result, h('p', { class: 'warn' }, 'Enter how many tables the room has.'));
        return;
      }

      next.disabled = false;
      try {
        state.assigned = applyStrategy(state.strategy, state.guests, { tableCount: state.tableCount });
      } catch (error) {
        next.disabled = true;
        mount(result, h('p', { class: 'warn' }, error.message));
        return;
      }

      const summary = summariseTables(state.assigned);
      mount(result,
        notes.map((note) => h('p', { class: 'note' }, note)),
        h('h4', {}, 'Result'),
        h('div', { class: 'chips' }, summary.map((row) =>
          h('span', { class: 'chip' + (row.table === '(unassigned)' ? ' chip--warn' : '') },
            `${row.table}: ${row.count}`))));
    }

    mount(stepArea,
      h('div', { class: 'card' },
        h('h3', {}, 'Step 3 — assign tables'),
        h('p', { class: 'muted' }, `${state.guests.length} guests ready.`),
        field('Strategy', strategy),
        field('Number of tables', tableCount),
        result,
        h('div', { class: 'form-actions' }, next, button('Back', stepMapping))));

    redraw();
  }

  // --- Step 4: replace or merge, then commit ------------------------------

  async function stepMode() {
    let existing = [];
    try { existing = await api.listGuests(event.id); } catch { /* treated as empty */ }

    const mode = h('select', { onchange: () => { state.mode = mode.value; describe(); } },
      h('option', { value: 'replace' }, 'Replace the current guest list'),
      h('option', { value: 'merge' }, 'Merge into the current guest list'));
    mode.value = state.mode;

    const description = h('div', {});
    const go = button('Import', commit, 'primary');
    const progress = h('p', { class: 'muted', hidden: true });

    function describe() {
      if (state.mode === 'replace') {
        mount(description,
          h('p', {}, existing.length
            ? `All ${existing.length} guests currently on this event will be deleted and replaced by the ${state.assigned.length} in this file.`
            : `${state.assigned.length} guests will be imported.`),
          existing.length
            ? h('p', { class: 'warn' }, 'Anything added by hand since the last upload is deleted too.')
            : null);
      } else {
        // Name matching is exact after trimming and case folding. It is the
        // weak point the spec flags: "Bob" and "Robert" are different people
        // as far as this is concerned.
        const byName = new Map(existing.map((g) => [g.full_name.trim().toLowerCase(), g]));
        const updates = state.assigned.filter((g) => byName.has(g.full_name.trim().toLowerCase()));
        const additions = state.assigned.length - updates.length;
        mount(description,
          h('p', {}, `${updates.length} existing guests will be updated and ${additions} added. Nobody is removed.`),
          h('p', { class: 'note' },
            'Matching is by exact name. A guest whose name is spelled differently in this file will be added as a second person rather than updated.'));
      }
    }

    async function commit() {
      if (state.mode === 'replace' && existing.length &&
          !confirmDialog(`Delete all ${existing.length} current guests and import ${state.assigned.length} from ${state.filename}?`)) return;

      go.disabled = true;
      progress.hidden = false;
      progress.textContent = 'Importing…';

      try {
        const rows = state.assigned.map((guest) => ({
          event_id: event.id,
          full_name: guest.full_name,
          table_number: guest.table_number,
          extra: guest.extra || {},
          source: 'csv',
        }));

        if (state.mode === 'replace') {
          await api.deleteAllGuests(event.id);
          await api.insertGuests(rows, (done, total) => {
            progress.textContent = `Importing… ${done} of ${total}`;
          });
        } else {
          const byName = new Map(existing.map((g) => [g.full_name.trim().toLowerCase(), g]));
          const additions = [];
          for (const row of rows) {
            const match = byName.get(row.full_name.trim().toLowerCase());
            if (match) {
              await api.updateGuest(match.id, { table_number: row.table_number, extra: row.extra });
            } else {
              additions.push(row);
            }
          }
          if (additions.length) await api.insertGuests(additions);
        }

        await api.logUpload({
          event_id: event.id,
          filename: state.filename,
          row_count: state.assigned.length,
          mode: state.mode,
          column_mapping: state.mapping.reduce((acc, m) => {
            acc[m.header] = m.role; return acc;
          }, {}),
        });

        // Keep the event's own defaults in step with what was just done.
        await api.updateEvent(event.id, {
          assignment_strategy: state.strategy,
          table_count: state.tableCount,
        });

        toast(`Imported ${state.assigned.length} guests.`, 'ok');
        onImported();
      } catch (error) {
        toast('Import failed: ' + error.message, 'error');
        go.disabled = false;
        progress.hidden = true;
      }
    }

    mount(stepArea,
      h('div', { class: 'card' },
        h('h3', {}, 'Step 4 — replace or merge'),
        field('Mode', mode),
        description,
        progress,
        h('div', { class: 'form-actions' }, go, button('Back', stepStrategy))));

    describe();
  }
}
