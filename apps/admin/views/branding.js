import * as api from '../api.js';
import { button, field, h, mount, toast } from '../ui.js';

/* Branding editor with a live preview of the kiosk (spec §4.5). */
const FONTS = [
  ['inter', 'Inter / system'],
  ['system', 'System default'],
  ['serif', 'Serif'],
  ['rounded', 'Rounded'],
  ['mono', 'Monospace'],
];

const TEXT_FIELDS = [
  ['header_text', 'Header', 'Shown at the top of every kiosk screen'],
  ['subtitle_text', 'Subtitle', ''],
  ['search_placeholder', 'Search placeholder', ''],
  ['no_match_text', 'No-match message', 'Shown when a search finds nobody'],
  ['reveal_tagline', 'Reveal tagline', 'Shown under the table number'],
];

export function renderBranding(container, event) {
  const branding = Object.assign({
    primary_color: '#1f6feb', accent_color: '#f0b429', background_color: '#0b0d12',
    font: 'inter', header_text: event.name, subtitle_text: 'Find your table',
    search_placeholder: 'Start typing your name',
    no_match_text: 'We could not find that name — please see a host.',
    reveal_tagline: '',
  }, event.branding || {});

  const schema = normaliseSchema(event.extra_field_schema);
  const preview = h('div', { class: 'preview' });

  const inputs = {};

  function colorInput(key) {
    const picker = h('input', { type: 'color', value: branding[key], oninput: () => {
      branding[key] = picker.value; text.value = picker.value; drawPreview();
    } });
    const text = h('input', { type: 'text', value: branding[key], class: 'inline-input', oninput: () => {
      if (/^#[0-9a-f]{6}$/i.test(text.value)) { branding[key] = text.value; picker.value = text.value; drawPreview(); }
    } });
    return h('div', { class: 'color-row' }, picker, text);
  }

  function textInput(key) {
    const input = h('input', { type: 'text', value: branding[key] || '', oninput: () => {
      branding[key] = input.value; drawPreview();
    } });
    inputs[key] = input;
    return input;
  }

  const fontSelect = h('select', { onchange: () => { branding.font = fontSelect.value; drawPreview(); } },
    FONTS.map(([value, label]) => h('option', { value }, label)));
  fontSelect.value = branding.font;

  const logoInput = h('input', { type: 'file', accept: 'image/*' });
  logoInput.addEventListener('change', async () => {
    const file = logoInput.files && logoInput.files[0];
    if (!file) return;
    try {
      toast('Uploading logo…');
      branding.logo_url = await api.uploadLogo(event.slug, file);
      drawPreview();
      toast('Logo uploaded. Remember to save.', 'ok');
    } catch (error) { toast(error.message, 'error'); }
  });

  // Which extra fields the kiosk may show (spec §8: everything else stays in
  // the database and never reaches a screen).
  function schemaRows() {
    if (schema.fields.length === 0) {
      return h('p', { class: 'muted' }, 'No extra columns yet — they appear here after a CSV upload.');
    }
    return h('div', {}, schema.fields.map((entry) => {
      const tick = h('input', { type: 'checkbox', checked: !!entry.visible, onchange: () => {
        entry.visible = tick.checked; drawPreview();
      } });
      const label = h('input', { type: 'text', value: entry.label || entry.key, class: 'inline-input',
        oninput: () => { entry.label = label.value; } });
      return h('div', { class: 'schema-row' },
        h('label', {}, tick, ' ', h('code', {}, entry.key)), label,
        h('span', { class: 'muted small' }, entry.visible ? 'shown on the kiosk' : 'stored, never shown'));
    }));
  }

  function drawPreview() {
    const visibleExtras = schema.fields.filter((f) => f.visible).map((f) => f.label || f.key);
    mount(preview,
      h('div', {
        class: 'preview-screen',
        style: `background:${branding.background_color};color:#fff;font-family:${fontFamily(branding.font)}`,
      },
        branding.logo_url ? h('img', { src: branding.logo_url, class: 'preview-logo', alt: '' }) : null,
        h('div', { class: 'preview-title' }, branding.header_text || event.name),
        h('div', { class: 'preview-sub' }, branding.subtitle_text || ''),
        h('div', { class: 'preview-field' }, branding.search_placeholder || ''),
        h('div', { class: 'preview-result' },
          h('span', {}, 'Adaeze Okonkwo'),
          h('span', { style: `color:${branding.accent_color}` }, 'Table 1')),
        h('div', {
          class: 'preview-table',
          style: `border-color:${branding.primary_color};color:${branding.accent_color}`,
        }, 'Table 1'),
        visibleExtras.length ? h('div', { class: 'preview-sub' }, visibleExtras.join(' · ')) : null,
        h('div', { class: 'preview-sub' }, branding.reveal_tagline || '')));
  }

  const save = button('Save branding', async () => {
    save.disabled = true;
    try {
      await api.updateEvent(event.id, { branding, extra_field_schema: schema });
      // Deliberately no re-render: the form already shows exactly what was
      // saved, and a reload landing after the operator navigates would paint
      // this tab over whatever they moved to.
      event.branding = branding;
      event.extra_field_schema = schema;
      toast('Branding saved. Kiosks pick it up within two minutes.', 'ok');
    } catch (error) {
      toast(error.message, 'error');
    } finally { save.disabled = false; }
  }, 'primary');

  mount(container,
    h('div', { class: 'split' },
      h('div', { class: 'card' },
        h('h3', {}, 'Branding'),
        field('Primary colour', colorInput('primary_color')),
        field('Accent colour', colorInput('accent_color')),
        field('Background colour', colorInput('background_color')),
        field('Font', fontSelect),
        field('Logo', logoInput, 'Shown above the header on the kiosk'),
        TEXT_FIELDS.map(([key, label, hint]) => field(label, textInput(key), hint)),
        h('h3', { class: 'section' }, 'Extra fields from your CSV'),
        h('p', { class: 'muted small' },
          'Tick a field to show it on the kiosk. Unticked fields are still stored, but never leave the database.'),
        schemaRows(),
        h('div', { class: 'form-actions' }, save)),
      h('div', {}, h('h3', {}, 'Kiosk preview'), preview)));

  drawPreview();
}

function fontFamily(name) {
  switch (name) {
    case 'serif': return 'Georgia, serif';
    case 'rounded': return 'ui-rounded, system-ui, sans-serif';
    case 'mono': return 'ui-monospace, monospace';
    default: return 'system-ui, sans-serif';
  }
}

function normaliseSchema(raw) {
  const schema = raw && typeof raw === 'object' ? raw : {};
  const fields = Array.isArray(schema.fields) ? schema.fields : [];
  return { fields: fields.map((f) => ({ key: f.key, label: f.label || f.key, visible: !!f.visible })) };
}
