import * as api from '../api.js';
import { button, confirmDialog, empty, h, mount, spinner, toast } from '../ui.js';

/* Entrance screens (spec §3 kiosk_instances, §10.8).
 *
 * Every screen loads the same URL and the same data; the tag only separates
 * them in analytics. */
export async function renderKiosks(container, event) {
  const base = window.ADMIN_CONFIG.kioskBaseUrl + '/e/' + event.slug;
  mount(container, spinner('Loading screens…'));

  let kiosks;
  try {
    kiosks = await api.listKiosks(event.id);
  } catch (error) {
    return mount(container, empty('Could not load screens: ' + error.message));
  }

  const label = h('input', { type: 'text', placeholder: 'Main Entrance', class: 'inline-input' });
  const param = h('input', { type: 'text', placeholder: 'main', class: 'inline-input' });

  async function add() {
    if (!label.value.trim()) return toast('Give the screen a name.', 'error');
    if (!/^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(param.value.trim())) {
      return toast('The tag may only use lowercase letters, numbers and hyphens.', 'error');
    }
    try {
      const kiosk = await api.createKiosk({
        event_id: event.id, label: label.value.trim(), url_param: param.value.trim(),
      });
      kiosks = kiosks.concat(kiosk);
      label.value = ''; param.value = '';
      toast('Screen added.', 'ok');
      draw();
    } catch (error) {
      toast(error.status === 409 ? 'That tag is already used on this event.' : error.message, 'error');
    }
  }

  function urlRow(text) {
    return h('div', { class: 'url-row' },
      h('code', {}, text),
      button('Copy', async () => {
        try {
          await navigator.clipboard.writeText(text);
          toast('URL copied.', 'ok');
        } catch {
          // Clipboard access needs a secure context and permission; the URL is
          // on screen either way, so this is a convenience, not a failure.
          toast('Copy failed — select the URL and copy it manually.', 'error');
        }
      }));
  }

  function draw() {
    mount(container,
      h('div', { class: 'card' },
        h('h3', {}, 'Kiosk URL'),
        h('p', { class: 'muted' },
          'Open this on every entrance screen. All screens show the same event and the same guest list.'),
        urlRow(base),
        event.status !== 'active'
          ? h('p', { class: 'warn' }, 'This event is archived, so the URL currently shows "This event has ended".')
          : null),

      h('div', { class: 'card' },
        h('h3', {}, 'Tagged screens'),
        h('p', { class: 'muted' },
          'Optional. A tag adds ?k= to the URL so analytics can tell the entrances apart. The page and data are identical.'),
        kiosks.length === 0
          ? empty('No tagged screens yet.')
          : h('table', { class: 'table' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Screen'), h('th', {}, 'URL'), h('th', {}, ''))),
              h('tbody', {}, kiosks.map((kiosk) => h('tr', {},
                h('td', {}, kiosk.label),
                h('td', {}, urlRow(`${base}?k=${kiosk.url_param}`)),
                h('td', { class: 'row-actions' },
                  button('Remove', async () => {
                    if (!confirmDialog(`Remove "${kiosk.label}"? Past analytics for it stay, but become untagged.`)) return;
                    try {
                      await api.deleteKiosk(kiosk.id);
                      kiosks = kiosks.filter((k) => k.id !== kiosk.id);
                      toast('Screen removed.', 'ok');
                      draw();
                    } catch (error) { toast(error.message, 'error'); }
                  })))))),
        h('div', { class: 'add-row' },
          h('strong', {}, 'Add a screen'), label, param, button('Add', add, 'primary'))));
  }

  draw();
}
