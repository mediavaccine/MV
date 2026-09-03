import * as api from '../api.js';
import { button, empty, formatDate, h, mount, spinner } from '../ui.js';

/* Usage dashboard (spec §4.6).
 *
 * The aggregates are computed in the database; this only draws them. The
 * no-match list is the one worth reading before doors open — every row is
 * either a typo or a guest missing from the list. */
export async function renderAnalytics(container, event) {
  mount(container, spinner('Loading analytics…'));

  let data;
  try {
    data = await api.analytics(event.slug);
  } catch (error) {
    return mount(container, empty('Could not load analytics: ' + error.message));
  }

  if (!data) return mount(container, empty('No analytics for this event yet.'));

  const totals = data.totals || {};
  const noMatch = data.no_match_terms || [];
  const byHour = data.by_hour || [];
  const byKiosk = data.by_kiosk || [];
  const busiest = data.busiest_guests || [];

  const searches = Number(totals.searches || 0);
  const misses = Number(totals.no_matches || 0);
  const attempts = searches + misses;
  const missRate = attempts ? Math.round((misses / attempts) * 100) : 0;

  mount(container,
    h('div', { class: 'page-head' },
      h('h2', {}, 'Usage'),
      button('Refresh', () => renderAnalytics(container, event))),

    Number(totals.total || 0) === 0
      ? empty('Nothing recorded yet. Numbers appear here as soon as the kiosk is used.')
      : h('div', {},
          h('div', { class: 'stats' },
            stat('Searches', searches),
            stat('Tables revealed', Number(totals.reveals || 0)),
            stat('No matches', misses),
            stat('No-match rate', missRate + '%', missRate > 15 ? 'warn' : null)),

          h('h3', { class: 'section' }, 'Searches that found nobody'),
          noMatch.length === 0
            ? h('p', { class: 'muted' }, 'None — every search found someone.')
            : h('div', {},
                h('p', { class: 'muted small' },
                  'Each of these is a typo or a guest who is not on the list. Worth checking before doors open.'),
                h('table', { class: 'table' },
                  h('thead', {}, h('tr', {}, h('th', {}, 'Typed'), h('th', {}, 'Times'), h('th', {}, 'Last seen'))),
                  h('tbody', {}, noMatch.map((row) => h('tr', {},
                    h('td', {}, h('code', {}, row.query)),
                    h('td', {}, String(row.count)),
                    h('td', { class: 'muted' }, formatDate(row.last_seen))))))),

          byHour.length
            ? h('div', {}, h('h3', { class: 'section' }, 'Activity by hour'), barChart(byHour))
            : null,

          byKiosk.length
            ? h('div', {},
                h('h3', { class: 'section' }, 'By entrance'),
                h('table', { class: 'table' },
                  h('thead', {}, h('tr', {}, h('th', {}, 'Screen'), h('th', {}, 'Interactions'))),
                  h('tbody', {}, byKiosk.map((row) => h('tr', {},
                    h('td', {}, row.label), h('td', {}, String(row.count)))))))
            : null,

          busiest.length
            ? h('div', {},
                h('h3', { class: 'section' }, 'Most looked-up guests'),
                h('table', { class: 'table' },
                  h('thead', {}, h('tr', {}, h('th', {}, 'Guest'), h('th', {}, 'Reveals'))),
                  h('tbody', {}, busiest.map((row) => h('tr', {},
                    h('td', {}, row.name), h('td', {}, String(row.count)))))))
            : null));
}

function stat(label, value, tone) {
  return h('div', { class: 'stat' + (tone ? ' stat--' + tone : '') },
    h('div', { class: 'stat-value' }, String(value)),
    h('div', { class: 'stat-label' }, label));
}

/* A CSS bar chart: no library, no canvas, and it prints. */
function barChart(rows) {
  const peak = Math.max(...rows.map((r) => Number(r.count)), 1);
  return h('div', { class: 'chart' }, rows.map((row) => {
    const height = Math.max(2, Math.round((Number(row.count) / peak) * 100));
    const label = new Date(row.hour);
    return h('div', { class: 'chart-col', title: `${row.count} interactions` },
      h('div', { class: 'chart-bar', style: `height:${height}%` }),
      h('div', { class: 'chart-label' },
        Number.isNaN(label.getTime()) ? '' : String(label.getHours()).padStart(2, '0')));
  }));
}
